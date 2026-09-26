import { adminSupabase } from './supabase';

const BASE = 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p/w500';
const BACKDROP = 'https://image.tmdb.org/t/p/w1280';
const MAX_PAGES = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const THROTTLE_MS = 180;

type SyncJob = { id: string };
type Counts = {
  movies: number;
  series: number;
  seasons: number;
  episodes: number;
  pages: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function headers() {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('TMDB_API_READ_ACCESS_TOKEN is not configured');
  return { Authorization: 'Bearer ' + token, accept: 'application/json' };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function tmdbGet<T>(
  path: string,
  params: Record<string, string | number | boolean> = {},
  attempt = 0,
): Promise<T> {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(2_000, Number(process.env.TMDB_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS)),
  );

  let response: Response;
  try {
    response = await fetch(url, { headers: headers(), signal: controller.signal });
  } catch (error) {
    if (attempt < 3) {
      await sleep(500 * (attempt + 1));
      return tmdbGet<T>(path, params, attempt + 1);
    }
    throw new Error(`TMDB request failed: ${errorMessage(error)}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) return response.json() as Promise<T>;

  if ((response.status === 429 || response.status >= 500) && attempt < 4) {
    const retryAfter = Number(response.headers.get('retry-after') || 0);
    await sleep(Math.max(retryAfter * 1000, 700 * (attempt + 1)));
    return tmdbGet<T>(path, params, attempt + 1);
  }

  let body = '';
  try { body = await response.text(); } catch {}
  throw new Error(`TMDB request failed: HTTP ${response.status}${body ? ` — ${body.slice(0, 180)}` : ''}`);
}

async function throttle() {
  await sleep(THROTTLE_MS);
}

function genreSlug(id: number, name: string) {
  const clean = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return 'tmdb-' + id + '-' + (clean || 'genre');
}

async function assertDatabaseReady() {
  const required = [
    'profiles',
    'movies',
    'series',
    'genres',
    'movie_genres',
    'series_genres',
    'people',
    'movie_cast',
    'series_cast',
    'seasons',
    'episodes',
    'providers',
    'provider_mappings',
    'playback_sources',
    'sync_jobs',
  ];

  const failures: string[] = [];
  for (const table of required) {
    const { error } = await adminSupabase.from(table).select('*', { head: true, count: 'exact' });
    if (error) failures.push(`${table}: ${error.message}`);
  }

  if (failures.length) {
    throw new Error('Database preflight failed: ' + failures.join(' | '));
  }

  const { error: providersError } = await adminSupabase.from('providers').select('id,key,enabled').limit(1);
  if (providersError) throw new Error('Provider table is not readable: ' + providersError.message);
}

async function startJob(jobType: string, pages: number) {
  const staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: runningJobs, error: runningError } = await adminSupabase
    .from('sync_jobs')
    .select('id,created_at')
    .eq('provider', 'tmdb')
    .eq('job_type', jobType)
    .eq('status', 'running')
    .order('created_at', { ascending: true });

  if (runningError) throw new Error('Unable to inspect running sync jobs: ' + runningError.message);

  const stale = (runningJobs || []).filter((job: any) => job.created_at && job.created_at < staleBefore);
  if (stale.length) {
    const staleIds = stale.map((job: any) => job.id);
    const { error } = await adminSupabase.from('sync_jobs').update({
      status: 'failed',
      stage: 'failed',
      error: 'Marked failed automatically because the worker was stale for more than 2 hours.',
      finished_at: new Date().toISOString(),
    }).in('id', staleIds);
    if (error) throw new Error('Unable to close stale sync jobs: ' + error.message);
  }

  const active = (runningJobs || []).filter((job: any) => !stale.some((item: any) => item.id === job.id));
  if (active.length) {
    throw new Error(`A TMDB ${jobType} sync is already running (job ${active[0].id})`);
  }

  const { data: job, error } = await adminSupabase.from('sync_jobs').insert({
    provider: 'tmdb',
    job_type: jobType,
    status: 'running',
    stage: 'preflight',
    pages,
    started_at: new Date().toISOString(),
    details: {},
  }).select('id').single();

  if (error || !job) {
    const detail = error
      ? `${error.code || 'unknown'}: ${error.message}${error.details ? ` (${error.details})` : ''}`
      : 'No job row returned';
    throw new Error('Unable to start sync job: ' + detail);
  }
  return job as SyncJob;
}

async function updateJob(jobId: string, patch: Record<string, unknown>) {
  const { error } = await adminSupabase.from('sync_jobs').update(patch).eq('id', jobId);
  if (error) console.error('Failed to update sync job', jobId, error.message);
}

async function finishJob(jobId: string, status: 'succeeded' | 'failed', counts: Partial<Counts>, error?: unknown) {
  await updateJob(jobId, {
    status,
    stage: status === 'succeeded' ? 'complete' : 'failed',
    movies_synced: counts.movies || 0,
    series_synced: counts.series || 0,
    seasons_synced: counts.seasons || 0,
    episodes_synced: counts.episodes || 0,
    details: counts,
    error: error ? errorMessage(error) : null,
    finished_at: new Date().toISOString(),
  });
}

async function syncGenres() {
  const [movieAr, movieEn, tvAr, tvEn] = await Promise.all([
    tmdbGet<any>('/genre/movie/list', { language: 'ar-SA' }),
    tmdbGet<any>('/genre/movie/list', { language: 'en-US' }),
    tmdbGet<any>('/genre/tv/list', { language: 'ar-SA' }),
    tmdbGet<any>('/genre/tv/list', { language: 'en-US' }),
  ]);

  const arMap = new Map<number, string>();
  const enMap = new Map<number, string>();
  for (const genre of [...(movieAr.genres || []), ...(tvAr.genres || [])]) {
    if (Number.isInteger(genre.id) && genre.name && !arMap.has(genre.id)) arMap.set(genre.id, genre.name);
  }
  for (const genre of [...(movieEn.genres || []), ...(tvEn.genres || [])]) {
    if (Number.isInteger(genre.id) && genre.name && !enMap.has(genre.id)) enMap.set(genre.id, genre.name);
  }

  const rows = [...arMap.entries()].map(([id, nameAr]) => ({
    id,
    name_ar: nameAr,
    name_en: enMap.get(id) || nameAr,
    slug: genreSlug(id, enMap.get(id) || nameAr),
  }));

  if (!rows.length) throw new Error('TMDB returned no genres');
  const { error } = await adminSupabase.from('genres').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error('Failed to sync genres: ' + error.message);
}

async function syncPeople(
  type: 'movie' | 'series',
  contentId: string,
  credits: any,
) {
  const people = Array.isArray(credits?.cast) ? credits.cast : [];
  const validPeople = people.filter((person: any) => Number.isInteger(person?.id)).slice(0, 20);

  const joinTable = type === 'movie' ? 'movie_cast' : 'series_cast';
  const foreignKey = type === 'movie' ? 'movie_id' : 'series_id';

  const { error: deleteError } = await adminSupabase.from(joinTable).delete().eq(foreignKey, contentId);
  if (deleteError) throw new Error(`Failed to refresh ${type} cast: ${deleteError.message}`);

  for (let index = 0; index < validPeople.length; index++) {
    const person = validPeople[index];
    const { data, error } = await adminSupabase.from('people').upsert({
      tmdb_id: person.id,
      name_en: person.name || '',
      name_ar: person.name || '',
      original_name: person.original_name || person.name || '',
      avatar_url: person.profile_path ? IMAGE + person.profile_path : '',
    }, { onConflict: 'tmdb_id' }).select('id').single();

    if (error || !data) {
      throw new Error(`Failed to sync person ${person.id}: ${error?.message || 'no row returned'}`);
    }

    const payload: Record<string, unknown> = {
      [foreignKey]: contentId,
      person_id: data.id,
      character_en: type === 'movie' ? person.character || '' : person.character || '',
      character_ar: person.character || '',
      cast_order: index,
    };

    const { error: joinError } = await adminSupabase
      .from(joinTable)
      .upsert(payload, { onConflict: type === 'movie' ? 'movie_id,person_id' : 'series_id,person_id' });

    if (joinError) throw new Error(`Failed to sync cast for ${contentId}: ${joinError.message}`);
  }
}

async function findExisting(table: 'movies' | 'series', tmdbId: number) {
  const { data, error } = await adminSupabase
    .from(table)
    .select('id,status')
    .eq('tmdb_id', tmdbId)
    .maybeSingle();
  if (error) throw new Error(`Failed to inspect existing ${table} row: ${error.message}`);
  return data as { id: string; status: 'draft' | 'published' | 'archived' } | null;
}

async function syncMovie(arMovie: any, enMovie: any) {
  if (!Number.isInteger(arMovie?.id)) throw new Error('TMDB movie result is missing an id');
  const tmdbId = arMovie.id;
  const detail = await tmdbGet<any>(`/movie/${tmdbId}`, {
    language: 'en-US',
    append_to_response: 'credits,alternative_titles',
  });
  const existing = await findExisting('movies', tmdbId);
  const titleEn = enMovie.title || enMovie.original_title || arMovie.title;
  const titleAr = arMovie.title || titleEn;
  if (!titleAr || !titleEn) throw new Error(`Movie ${tmdbId} is missing title data`);

  const { data: row, error } = await adminSupabase.from('movies').upsert({
    tmdb_id: tmdbId,
    title_ar: titleAr,
    title_en: titleEn,
    original_title: enMovie.original_title || titleEn,
    alternative_titles: detail.alternative_titles?.titles || [],
    overview_ar: arMovie.overview || '',
    overview_en: enMovie.overview || '',
    poster_url: arMovie.poster_path ? IMAGE + arMovie.poster_path : (enMovie.poster_path ? IMAGE + enMovie.poster_path : ''),
    backdrop_url: arMovie.backdrop_path ? BACKDROP + arMovie.backdrop_path : (enMovie.backdrop_path ? BACKDROP + enMovie.backdrop_path : ''),
    release_date: arMovie.release_date || enMovie.release_date || null,
    runtime_minutes: Number.isFinite(detail.runtime) ? detail.runtime : null,
    rating: Number(enMovie.vote_average || arMovie.vote_average || 0),
    vote_count: Number(enMovie.vote_count || arMovie.vote_count || 0),
    status: existing?.status || 'draft',
    popular: true,
    metadata: {
      ...(existing ? {} : {}),
      director_en: (detail.credits?.crew || []).find((x: any) => x.job === 'Director')?.name || '',
      tmdb_popularity: enMovie.popularity || arMovie.popularity || 0,
    },
  }, { onConflict: 'tmdb_id' }).select('id').single();

  if (error || !row) throw new Error(`Failed to upsert movie ${tmdbId}: ${error?.message || 'no row returned'}`);

  await adminSupabase.from('movie_genres').delete().eq('movie_id', row.id).throwOnError();
  const genreIds = [...new Set([...(enMovie.genre_ids || []), ...(arMovie.genre_ids || [])])].filter((id) => Number.isInteger(id));
  if (genreIds.length) {
    const { error: genreError } = await adminSupabase.from('movie_genres').upsert(
      genreIds.map((genreId) => ({ movie_id: row.id, genre_id: genreId })),
      { onConflict: 'movie_id,genre_id' },
    );
    if (genreError) throw new Error(`Failed to sync genres for movie ${tmdbId}: ${genreError.message}`);
  }

  await syncPeople('movie', row.id, detail.credits);
  const { error: publishError } = await adminSupabase.from('movies').update({ status: 'published' }).eq('id', row.id);
  if (publishError) throw new Error(`Failed to publish movie ${tmdbId}: ${publishError.message}`);
  return row.id as string;
}

async function syncSeasonEpisodes(seriesId: string, seasonId: string, tmdbId: number, seasonNumber: number) {
  const [en, ar] = await Promise.all([
    tmdbGet<any>(`/tv/${tmdbId}/season/${seasonNumber}`, { language: 'en-US' }),
    tmdbGet<any>(`/tv/${tmdbId}/season/${seasonNumber}`, { language: 'ar-SA' }),
  ]);

  const englishEpisodes = Array.isArray(en.episodes) ? en.episodes : [];
  const arabicByNumber = new Map<number, any>(
    (Array.isArray(ar.episodes) ? ar.episodes : []).map((episode: any) => [episode.episode_number, episode]),
  );

  const incoming = englishEpisodes
    .filter((episode: any) => Number.isInteger(episode?.id) && Number.isInteger(episode?.episode_number))
    .map((episode: any) => {
      const arEpisode = arabicByNumber.get(episode.episode_number) || episode;
      return {
        season_id: seasonId,
        tmdb_id: episode.id,
        episode_number: episode.episode_number,
        name_ar: arEpisode.name || episode.name || `الحلقة ${episode.episode_number}`,
        name_en: episode.name || `Episode ${episode.episode_number}`,
        overview_ar: arEpisode.overview || '',
        overview_en: episode.overview || '',
        still_url: episode.still_path ? IMAGE + episode.still_path : '',
        air_date: episode.air_date || null,
        runtime_minutes: Number.isFinite(episode.runtime) ? episode.runtime : null,
      };
    });

  const { data: existing, error: existingError } = await adminSupabase
    .from('episodes')
    .select('id,tmdb_id')
    .eq('season_id', seasonId);
  if (existingError) throw new Error(`Failed to inspect episodes for season ${seasonNumber}: ${existingError.message}`);

  const keepIds = new Set(incoming.map((episode) => episode.tmdb_id));
  const staleIds = (existing || []).filter((episode: any) => episode.tmdb_id && !keepIds.has(episode.tmdb_id)).map((episode: any) => episode.id);
  if (staleIds.length) {
    const { error: staleError } = await adminSupabase.from('episodes').delete().in('id', staleIds);
    if (staleError) throw new Error(`Failed to remove stale episodes from season ${seasonNumber}: ${staleError.message}`);
  }

  if (incoming.length) {
    const { error } = await adminSupabase.from('episodes').upsert(incoming, {
      onConflict: 'season_id,episode_number',
    });
    if (error) throw new Error(`Failed to sync episodes for season ${seasonNumber}: ${error.message}`);
  }

  return incoming.length;
}

async function syncSeries(arSeries: any, enSeries: any) {
  if (!Number.isInteger(arSeries?.id)) throw new Error('TMDB series result is missing an id');
  const tmdbId = arSeries.id;

  const [detailEn, detailAr] = await Promise.all([
    tmdbGet<any>(`/tv/${tmdbId}`, { language: 'en-US', append_to_response: 'credits,alternative_titles' }),
    tmdbGet<any>(`/tv/${tmdbId}`, { language: 'ar-SA' }),
  ]);

  const existing = await findExisting('series', tmdbId);
  const titleEn = enSeries.name || enSeries.original_name || arSeries.name;
  const titleAr = arSeries.name || titleEn;
  if (!titleAr || !titleEn) throw new Error(`Series ${tmdbId} is missing title data`);

  const { data: row, error } = await adminSupabase.from('series').upsert({
    tmdb_id: tmdbId,
    title_ar: titleAr,
    title_en: titleEn,
    original_title: enSeries.original_name || titleEn,
    alternative_titles: detailEn.alternative_titles?.results || detailEn.alternative_titles || [],
    overview_ar: arSeries.overview || '',
    overview_en: enSeries.overview || '',
    poster_url: arSeries.poster_path ? IMAGE + arSeries.poster_path : (enSeries.poster_path ? IMAGE + enSeries.poster_path : ''),
    backdrop_url: arSeries.backdrop_path ? BACKDROP + arSeries.backdrop_path : (enSeries.backdrop_path ? BACKDROP + enSeries.backdrop_path : ''),
    first_air_date: arSeries.first_air_date || enSeries.first_air_date || null,
    last_air_date: enSeries.last_air_date || null,
    rating: Number(enSeries.vote_average || arSeries.vote_average || 0),
    vote_count: Number(enSeries.vote_count || arSeries.vote_count || 0),
    status: existing?.status || 'draft',
    popular: true,
    metadata: {
      creator_en: (detailEn.created_by || []).map((x: any) => x.name).join(', '),
      creator_ar: (detailAr.created_by || []).map((x: any) => x.name).join(', '),
      tmdb_popularity: enSeries.popularity || arSeries.popularity || 0,
    },
  }, { onConflict: 'tmdb_id' }).select('id').single();

  if (error || !row) throw new Error(`Failed to upsert series ${tmdbId}: ${error?.message || 'no row returned'}`);

  const { error: genreDeleteError } = await adminSupabase.from('series_genres').delete().eq('series_id', row.id);
  if (genreDeleteError) throw new Error(`Failed to refresh genres for series ${tmdbId}: ${genreDeleteError.message}`);

  const genreIds = [...new Set([...(enSeries.genre_ids || []), ...(arSeries.genre_ids || [])])].filter((id) => Number.isInteger(id));
  if (genreIds.length) {
    const { error: genreError } = await adminSupabase.from('series_genres').upsert(
      genreIds.map((genreId) => ({ series_id: row.id, genre_id: genreId })),
      { onConflict: 'series_id,genre_id' },
    );
    if (genreError) throw new Error(`Failed to sync genres for series ${tmdbId}: ${genreError.message}`);
  }

  await syncPeople('series', row.id, detailEn.credits);

  const arSeasonMap = new Map<number, any>(
    (Array.isArray(detailAr.seasons) ? detailAr.seasons : []).map((season: any) => [season.season_number, season]),
  );
  const seasons = (Array.isArray(detailEn.seasons) ? detailEn.seasons : [])
    .filter((season: any) => season && Number.isInteger(season.season_number) && season.season_number > 0);

  let episodesSynced = 0;
  for (const season of seasons) {
    await throttle();
    const arSeason = arSeasonMap.get(season.season_number) || season;

    const { data: seasonRow, error: seasonError } = await adminSupabase.from('seasons').upsert({
      series_id: row.id,
      tmdb_id: season.id,
      season_number: season.season_number,
      name_ar: arSeason.name || season.name || `الموسم ${season.season_number}`,
      name_en: season.name || `Season ${season.season_number}`,
      overview_ar: arSeason.overview || '',
      overview_en: season.overview || '',
      poster_url: season.poster_path ? IMAGE + season.poster_path : '',
      air_date: season.air_date || null,
    }, { onConflict: 'series_id,season_number' }).select('id').single();

    if (seasonError || !seasonRow) {
      throw new Error(`Failed to sync season ${season.season_number} for series ${tmdbId}: ${seasonError?.message || 'no row returned'}`);
    }

    episodesSynced += await syncSeasonEpisodes(row.id, seasonRow.id, tmdbId, season.season_number);
  }

  const { data: dbSeasons, error: dbSeasonsError } = await adminSupabase
    .from('seasons')
    .select('id,season_number')
    .eq('series_id', row.id);
  if (dbSeasonsError) throw new Error(`Failed to verify seasons for series ${tmdbId}: ${dbSeasonsError.message}`);

  const expectedSeasonNumbers = new Set(seasons.map((season: any) => season.season_number));
  const staleSeasonIds = (dbSeasons || [])
    .filter((season: any) => !expectedSeasonNumbers.has(season.season_number))
    .map((season: any) => season.id);

  if (staleSeasonIds.length) {
    const { error: staleError } = await adminSupabase.from('seasons').delete().in('id', staleSeasonIds);
    if (staleError) throw new Error(`Failed to remove stale seasons for series ${tmdbId}: ${staleError.message}`);
  }

  const { error: publishError } = await adminSupabase.from('series').update({ status: 'published' }).eq('id', row.id);
  if (publishError) throw new Error(`Failed to publish series ${tmdbId}: ${publishError.message}`);

  return { id: row.id as string, seasons: seasons.length, episodes: episodesSynced };
}

async function syncMovies(page: number) {
  const [ar, en] = await Promise.all([
    tmdbGet<any>('/movie/popular', { language: 'ar-SA', page, include_adult: false, include_video: false }),
    tmdbGet<any>('/movie/popular', { language: 'en-US', page, include_adult: false, include_video: false }),
  ]);

  const enById = new Map<number, any>((en.results || []).map((movie: any) => [movie.id, movie]));
  let synced = 0;

  for (const arMovie of ar.results || []) {
    const enMovie = enById.get(arMovie.id) || arMovie;
    await throttle();
    await syncMovie(arMovie, enMovie);
    synced++;
  }

  return synced;
}

async function syncSeriesPage(page: number) {
  const [ar, en] = await Promise.all([
    tmdbGet<any>('/tv/popular', { language: 'ar-SA', page }),
    tmdbGet<any>('/tv/popular', { language: 'en-US', page }),
  ]);

  const enById = new Map<number, any>((en.results || []).map((series: any) => [series.id, series]));
  let seriesCount = 0;
  let seasons = 0;
  let episodes = 0;

  for (const arSeries of ar.results || []) {
    const enSeries = enById.get(arSeries.id) || arSeries;
    await throttle();
    const result = await syncSeries(arSeries, enSeries);
    seriesCount++;
    seasons += result.seasons;
    episodes += result.episodes;
  }

  return { series: seriesCount, seasons, episodes };
}

export async function syncEpisodesForSeries(seriesLimit?: number) {
  const limit = seriesLimit == null ? 10_000 : Math.min(Math.max(seriesLimit, 1), 10_000);
  const job = await startJob('episodes', 0);

  try {
    await assertDatabaseReady();
    await updateJob(job.id, { stage: 'episodes' });

    const { data: seriesRows, error } = await adminSupabase
      .from('series')
      .select('id,tmdb_id')
      .not('tmdb_id', 'is', null)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error('Unable to load series for episode sync: ' + error.message);

    let seasons = 0;
    let episodes = 0;
    for (const series of seriesRows || []) {
      if (!series.tmdb_id) continue;
      const { data: rows, error: seasonError } = await adminSupabase.from('seasons')
        .select('id,tmdb_id,season_number')
        .eq('series_id', series.id)
        .order('season_number');
      if (seasonError) throw new Error(`Unable to load seasons for series ${series.tmdb_id}: ${seasonError.message}`);

      for (const season of rows || []) {
        if (!season.season_number) continue;
        await throttle();
        episodes += await syncSeasonEpisodes(series.id, season.id, series.tmdb_id, season.season_number);
        seasons++;
      }
    }

    const result = { series: (seriesRows || []).length, seasons, episodes };
    await finishJob(job.id, 'succeeded', result);
    return result;
  } catch (error) {
    await finishJob(job.id, 'failed', {}, error);
    throw error;
  }
}

export async function runTmdbSync(options: { pages?: number } = {}) {
  const pages = Math.min(Math.max(options.pages || 1, 1), MAX_PAGES);
  const job = await startJob('catalog', pages);
  const counts: Counts = { movies: 0, series: 0, seasons: 0, episodes: 0, pages };

  try {
    await assertDatabaseReady();
    await updateJob(job.id, { stage: 'genres' });
    await syncGenres();

    for (let page = 1; page <= pages; page++) {
      await updateJob(job.id, {
        stage: 'movies',
        pages: page,
        details: { ...counts, currentPage: page },
      });
      counts.movies += await syncMovies(page);

      await updateJob(job.id, {
        stage: 'series',
        pages: page,
        details: { ...counts, currentPage: page },
      });
      const seriesResult = await syncSeriesPage(page);
      counts.series += seriesResult.series;
      counts.seasons += seriesResult.seasons;
      counts.episodes += seriesResult.episodes;
    }

    await finishJob(job.id, 'succeeded', counts);
    return { ...counts, total: counts.movies + counts.series };
  } catch (error) {
    await finishJob(job.id, 'failed', counts, error);
    throw error;
  }
}

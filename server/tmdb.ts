import { adminSupabase } from './supabase';

const BASE = 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p/w500';
const BACKDROP = 'https://image.tmdb.org/t/p/w1280';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function headers() {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN;
  if (!token) throw new Error('TMDB_API_READ_ACCESS_TOKEN is not configured');
  return { Authorization: 'Bearer ' + token, accept: 'application/json' };
}

async function tmdbGet<T>(
  path: string,
  params: Record<string, string | number> = {},
  attempt = 0
): Promise<T> {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, { headers: headers() });

  if (response.ok) return response.json() as Promise<T>;

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const retryAfter = Number(response.headers.get('retry-after') || 0);
    await sleep(Math.max(retryAfter * 1000, 500 * (attempt + 1)));
    return tmdbGet<T>(path, params, attempt + 1);
  }

  throw new Error('TMDB request failed: ' + response.status);
}

async function throttle() {
  await sleep(120);
}

function genreSlug(id: number, name: string) {
  const clean = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return 'tmdb-' + id + '-' + (clean || 'genre');
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
    if (!arMap.has(genre.id)) arMap.set(genre.id, genre.name);
  }
  for (const genre of [...(movieEn.genres || []), ...(tvEn.genres || [])]) {
    if (!enMap.has(genre.id)) enMap.set(genre.id, genre.name);
  }

  for (const [id, arabicName] of arMap) {
    const englishName = enMap.get(id) || arabicName;
    await adminSupabase.from('genres').upsert({
      id,
      name_ar: arabicName,
      name_en: englishName,
      slug: genreSlug(id, englishName),
    }, { onConflict: 'id' });
  }
}

async function syncMoviePeople(movieId: string, credits: any) {
  await adminSupabase.from('movie_cast').delete().eq('movie_id', movieId);

  for (let index = 0; index < Math.min((credits?.cast || []).length, 20); index++) {
    const person = credits.cast[index];
    const { data } = await adminSupabase.from('people').upsert({
      tmdb_id: person.id,
      name_en: person.name || '',
      name_ar: person.name || '',
      original_name: person.original_name || person.name || '',
      avatar_url: person.profile_path ? IMAGE + person.profile_path : '',
    }, { onConflict: 'tmdb_id' }).select('id').single();

    if (data) {
      await adminSupabase.from('movie_cast').upsert({
        movie_id: movieId,
        person_id: data.id,
        character_en: person.character || '',
        character_ar: person.character || '',
        cast_order: index,
      }, { onConflict: 'movie_id,person_id' });
    }
  }
}

async function syncSeriesPeople(seriesId: string, credits: any) {
  await adminSupabase.from('series_cast').delete().eq('series_id', seriesId);

  for (let index = 0; index < Math.min((credits?.cast || []).length, 20); index++) {
    const person = credits.cast[index];
    const { data } = await adminSupabase.from('people').upsert({
      tmdb_id: person.id,
      name_en: person.name || '',
      name_ar: person.name || '',
      original_name: person.original_name || person.name || '',
      avatar_url: person.profile_path ? IMAGE + person.profile_path : '',
    }, { onConflict: 'tmdb_id' }).select('id').single();

    if (data) {
      await adminSupabase.from('series_cast').upsert({
        series_id: seriesId,
        person_id: data.id,
        character_en: person.character || '',
        character_ar: person.character || '',
        cast_order: index,
      }, { onConflict: 'series_id,person_id' });
    }
  }
}

async function syncMovies(page: number) {
  const [ar, en] = await Promise.all([
    tmdbGet<any>('/movie/popular', { language: 'ar-SA', page, include_adult: 'false', include_video: 'false' }),
    tmdbGet<any>('/movie/popular', { language: 'en-US', page, include_adult: 'false', include_video: 'false' }),
  ]);

  const enById = new Map<number, any>((en.results || []).map((m: any) => [m.id, m]));
  let synced = 0;

  for (const arMovie of ar.results || []) {
    const enMovie = enById.get(arMovie.id) || arMovie;
    await throttle();

    const detail = await tmdbGet<any>(
      '/movie/' + arMovie.id,
      { language: 'en-US', append_to_response: 'credits,alternative_titles' }
    );

    const { data: row, error } = await adminSupabase.from('movies').upsert({
      tmdb_id: arMovie.id,
      title_ar: arMovie.title || enMovie.title || enMovie.original_title,
      title_en: enMovie.title || enMovie.original_title,
      original_title: enMovie.original_title || enMovie.title,
      alternative_titles: detail.alternative_titles?.titles || [],
      overview_ar: arMovie.overview || '',
      overview_en: enMovie.overview || '',
      poster_url: arMovie.poster_path ? IMAGE + arMovie.poster_path : (enMovie.poster_path ? IMAGE + enMovie.poster_path : ''),
      backdrop_url: arMovie.backdrop_path ? BACKDROP + arMovie.backdrop_path : (enMovie.backdrop_path ? BACKDROP + enMovie.backdrop_path : ''),
      release_date: arMovie.release_date || enMovie.release_date || null,
      runtime_minutes: detail.runtime || null,
      rating: Number(enMovie.vote_average || arMovie.vote_average || 0),
      vote_count: Number(enMovie.vote_count || arMovie.vote_count || 0),
      status: 'published',
      popular: true,
      metadata: {
        director_en: (detail.credits?.crew || []).find((x: any) => x.job === 'Director')?.name || '',
        tmdb_popularity: enMovie.popularity || arMovie.popularity || 0,
      },
    }, { onConflict: 'tmdb_id' }).select('id').single();

    if (error || !row) throw new Error('Failed to upsert movie ' + arMovie.id);

    await adminSupabase.from('movie_genres').delete().eq('movie_id', row.id);
    const genreRows = (enMovie.genre_ids || arMovie.genre_ids || []).map((genreId: number) => ({
      movie_id: row.id,
      genre_id: genreId,
    }));
    if (genreRows.length) {
      await adminSupabase.from('movie_genres').upsert(genreRows, { onConflict: 'movie_id,genre_id' });
    }

    await syncMoviePeople(row.id, detail.credits);
    synced++;
  }

  return synced;
}

async function syncSeries(page: number) {
  const [ar, en] = await Promise.all([
    tmdbGet<any>('/tv/popular', { language: 'ar-SA', page }),
    tmdbGet<any>('/tv/popular', { language: 'en-US', page }),
  ]);

  const enById = new Map<number, any>((en.results || []).map((s: any) => [s.id, s]));
  let synced = 0;

  for (const arSeries of ar.results || []) {
    const enSeries = enById.get(arSeries.id) || arSeries;
    await throttle();

    const [detailEn, detailAr] = await Promise.all([
      tmdbGet<any>('/tv/' + arSeries.id, { language: 'en-US', append_to_response: 'credits,alternative_titles' }),
      tmdbGet<any>('/tv/' + arSeries.id, { language: 'ar-SA' }),
    ]);

    const { data: row, error } = await adminSupabase.from('series').upsert({
      tmdb_id: arSeries.id,
      title_ar: arSeries.name || enSeries.name || enSeries.original_name,
      title_en: enSeries.name || enSeries.original_name,
      original_title: enSeries.original_name || enSeries.name,
      alternative_titles: detailEn.alternative_titles?.results || detailEn.alternative_titles || [],
      overview_ar: arSeries.overview || '',
      overview_en: enSeries.overview || '',
      poster_url: arSeries.poster_path ? IMAGE + arSeries.poster_path : (enSeries.poster_path ? IMAGE + enSeries.poster_path : ''),
      backdrop_url: arSeries.backdrop_path ? BACKDROP + arSeries.backdrop_path : (enSeries.backdrop_path ? BACKDROP + enSeries.backdrop_path : ''),
      first_air_date: arSeries.first_air_date || enSeries.first_air_date || null,
      last_air_date: enSeries.last_air_date || null,
      rating: Number(enSeries.vote_average || arSeries.vote_average || 0),
      vote_count: Number(enSeries.vote_count || arSeries.vote_count || 0),
      status: 'published',
      popular: true,
      metadata: {
        creator_en: (detailEn.created_by || []).map((x: any) => x.name).join(', '),
        creator_ar: (detailAr.created_by || []).map((x: any) => x.name).join(', '),
        tmdb_popularity: enSeries.popularity || arSeries.popularity || 0,
      },
    }, { onConflict: 'tmdb_id' }).select('id').single();

    if (error || !row) throw new Error('Failed to upsert series ' + arSeries.id);

    await adminSupabase.from('series_genres').delete().eq('series_id', row.id);
    const genreRows = (enSeries.genre_ids || arSeries.genre_ids || []).map((genreId: number) => ({
      series_id: row.id,
      genre_id: genreId,
    }));
    if (genreRows.length) {
      await adminSupabase.from('series_genres').upsert(genreRows, { onConflict: 'series_id,genre_id' });
    }

    await syncSeriesPeople(row.id, detailEn.credits);

    const arSeasonMap = new Map<number, any>((detailAr.seasons || []).map((s: any) => [s.season_number, s]));
    for (const season of detailEn.seasons || []) {
      if (!season || season.season_number === 0) continue;
      const arSeason = arSeasonMap.get(season.season_number) || season;

      await adminSupabase.from('seasons').upsert({
        series_id: row.id,
        tmdb_id: season.id,
        season_number: season.season_number,
        name_ar: arSeason.name || season.name || 'الموسم ' + season.season_number,
        name_en: season.name || 'Season ' + season.season_number,
        overview_ar: arSeason.overview || '',
        overview_en: season.overview || '',
        poster_url: season.poster_path ? IMAGE + season.poster_path : '',
        air_date: season.air_date || null,
      }, { onConflict: 'series_id,season_number' });
    }

    synced++;
  }

  return synced;
}

export async function syncEpisodesForSeries(seriesLimit = 10) {
  const limit = Math.min(Math.max(seriesLimit, 1), 25);
  const { data: job, error: jobError } = await adminSupabase.from('sync_jobs').insert({
    provider: 'tmdb',
    job_type: 'episodes',
    status: 'running',
    pages: 0,
    started_at: new Date().toISOString(),
  }).select('id').single();

  if (jobError || !job) throw new Error('Unable to start episode sync job');

  try {
    const { data: seriesRows, error } = await adminSupabase
      .from('series')
      .select('id,tmdb_id')
      .not('tmdb_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error('Unable to load series for episode sync');

    let seasonsSynced = 0;
    let episodesSynced = 0;

    for (const series of seriesRows || []) {
      if (!series.tmdb_id) continue;

      const { data: seasons } = await adminSupabase
        .from('seasons')
        .select('id,season_number')
        .eq('series_id', series.id)
        .order('season_number');

      for (const season of seasons || []) {
        if (!season.season_number) continue;
        await throttle();

        const [en, ar] = await Promise.all([
          tmdbGet<any>('/tv/' + series.tmdb_id + '/season/' + season.season_number, { language: 'en-US' }),
          tmdbGet<any>('/tv/' + series.tmdb_id + '/season/' + season.season_number, { language: 'ar-SA' }),
        ]);

        const arByNumber = new Map<number, any>((ar.episodes || []).map((e: any) => [e.episode_number, e]));

        const episodeRows = (en.episodes || []).map((episode: any) => {
          const arEpisode = arByNumber.get(episode.episode_number) || episode;
          return {
            season_id: season.id,
            tmdb_id: episode.id,
            episode_number: episode.episode_number,
            name_ar: arEpisode.name || episode.name || 'الحلقة ' + episode.episode_number,
            name_en: episode.name || 'Episode ' + episode.episode_number,
            overview_ar: arEpisode.overview || '',
            overview_en: episode.overview || '',
            still_url: episode.still_path ? IMAGE + episode.still_path : '',
            air_date: episode.air_date || null,
            runtime_minutes: episode.runtime || null,
          };
        });

        if (episodeRows.length) {
          const { error: episodeError } = await adminSupabase
            .from('episodes')
            .upsert(episodeRows, { onConflict: 'season_id,episode_number' });

          if (episodeError) throw new Error('Failed to sync season ' + season.season_number);
          episodesSynced += episodeRows.length;
        }

        seasonsSynced++;
      }
    }

    const result = {
      series: (seriesRows || []).length,
      seasons: seasonsSynced,
      episodes: episodesSynced,
    };

    await adminSupabase.from('sync_jobs').update({
      status: 'succeeded',
      series_synced: result.series,
      seasons_synced: result.seasons,
      episodes_synced: result.episodes,
      finished_at: new Date().toISOString(),
    }).eq('id', job.id);

    return result;
  } catch (error) {
    await adminSupabase.from('sync_jobs').update({
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown TMDB episode sync error',
      finished_at: new Date().toISOString(),
    }).eq('id', job.id);

    throw error;
  }
}

export async function runTmdbSync(options: { pages?: number } = {}) {
  const pages = Math.min(Math.max(options.pages || 1, 1), 3);

  const { data: job, error: jobError } = await adminSupabase.from('sync_jobs').insert({
    provider: 'tmdb',
    job_type: 'catalog',
    status: 'running',
    pages,
    started_at: new Date().toISOString(),
  }).select('id').single();

  if (jobError || !job) {
    const detail = jobError
      ? `${jobError.code || 'unknown'}: ${jobError.message}${jobError.details ? ` (${jobError.details})` : ''}`
      : 'No job row returned';
    throw new Error('Unable to start sync job: ' + detail);
  }

  try {
    await syncGenres();

    let movies = 0;
    let series = 0;

    for (let page = 1; page <= pages; page++) {
      movies += await syncMovies(page);
      series += await syncSeries(page);
    }

    await adminSupabase.from('sync_jobs').update({
      status: 'succeeded',
      movies_synced: movies,
      series_synced: series,
      finished_at: new Date().toISOString(),
    }).eq('id', job.id);

    return { movies, series, total: movies + series, pages };
  } catch (error) {
    await adminSupabase.from('sync_jobs').update({
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown TMDB sync error',
      finished_at: new Date().toISOString(),
    }).eq('id', job.id);

    throw error;
  }
}

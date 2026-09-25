import { adminSupabase } from './supabase';

const BASE = 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p/w500';
const BACKDROP = 'https://image.tmdb.org/t/p/w1280';

function headers() {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN;
  if (!token) throw new Error('TMDB_API_READ_ACCESS_TOKEN is not configured');
  return { Authorization: `Bearer ${token}`, accept: 'application/json' };
}

async function tmdbGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) throw new Error(`TMDB request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9\u0600-\u06ff]+/g, '-').replace(/^-|-$/g, '') || `genre-${Date.now()}`;
}

type TmdbList = { results: any[] };

async function syncGenres() {
  const [ar, en] = await Promise.all([
    tmdbGet<any>('/genre/movie/list', { language: 'ar-SA' }),
    tmdbGet<any>('/genre/movie/list', { language: 'en-US' }),
  ]);
  const enMap = new Map((en.genres || []).map((g: any) => [g.id, g.name]));
  for (const genre of ar.genres || []) {
    await adminSupabase.from('genres').upsert({
      id: genre.id,
      name_ar: genre.name,
      name_en: enMap.get(genre.id) || genre.name,
      slug: slug(enMap.get(genre.id) || genre.name),
    }, { onConflict: 'id' });
  }
}

async function syncMovies(page: number) {
  const [ar, en] = await Promise.all([
    tmdbGet<TmdbList>('/movie/popular', { language: 'ar-SA', page, include_adult: 'false', include_video: 'false' }),
    tmdbGet<TmdbList>('/movie/popular', { language: 'en-US', page, include_adult: 'false', include_video: 'false' }),
  ]);
  const enById = new Map((en.results || []).map((m: any) => [m.id, m]));
  let synced = 0;

  for (const arMovie of ar.results || []) {
    const enMovie = enById.get(arMovie.id) || arMovie;
    const detail = await tmdbGet<any>(`/movie/${arMovie.id}`, { language: 'en-US', append_to_response: 'credits' });

    const { data: row, error } = await adminSupabase.from('movies').upsert({
      tmdb_id: arMovie.id,
      title_ar: arMovie.title || enMovie.title || enMovie.original_title,
      title_en: enMovie.title || enMovie.original_title,
      original_title: enMovie.original_title || enMovie.title,
      overview_ar: arMovie.overview || '',
      overview_en: enMovie.overview || '',
      poster_url: arMovie.poster_path ? `${IMAGE}${arMovie.poster_path}` : (enMovie.poster_path ? `${IMAGE}${enMovie.poster_path}` : ''),
      backdrop_url: arMovie.backdrop_path ? `${BACKDROP}${arMovie.backdrop_path}` : (enMovie.backdrop_path ? `${BACKDROP}${enMovie.backdrop_path}` : ''),
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

    if (error || !row) throw new Error(`Failed to upsert movie ${arMovie.id}`);

    await adminSupabase.from('movie_genres').delete().eq('movie_id', row.id);
    const genreRows = (enMovie.genre_ids || arMovie.genre_ids || []).map((genreId: number) => ({ movie_id: row.id, genre_id: genreId }));
    if (genreRows.length) await adminSupabase.from('movie_genres').upsert(genreRows);
    synced++;
  }
  return synced;
}

async function syncSeries(page: number) {
  const [ar, en] = await Promise.all([
    tmdbGet<TmdbList>('/tv/popular', { language: 'ar-SA', page }),
    tmdbGet<TmdbList>('/tv/popular', { language: 'en-US', page }),
  ]);
  const enById = new Map((en.results || []).map((s: any) => [s.id, s]));
  let synced = 0;

  for (const arSeries of ar.results || []) {
    const enSeries = enById.get(arSeries.id) || arSeries;
    const detail = await tmdbGet<any>(`/tv/${arSeries.id}`, { language: 'en-US' });

    const { data: row, error } = await adminSupabase.from('series').upsert({
      tmdb_id: arSeries.id,
      title_ar: arSeries.name || enSeries.name || enSeries.original_name,
      title_en: enSeries.name || enSeries.original_name,
      original_title: enSeries.original_name || enSeries.name,
      overview_ar: arSeries.overview || '',
      overview_en: enSeries.overview || '',
      poster_url: arSeries.poster_path ? `${IMAGE}${arSeries.poster_path}` : (enSeries.poster_path ? `${IMAGE}${enSeries.poster_path}` : ''),
      backdrop_url: arSeries.backdrop_path ? `${BACKDROP}${arSeries.backdrop_path}` : (enSeries.backdrop_path ? `${BACKDROP}${enSeries.backdrop_path}` : ''),
      first_air_date: arSeries.first_air_date || enSeries.first_air_date || null,
      last_air_date: enSeries.last_air_date || null,
      rating: Number(enSeries.vote_average || arSeries.vote_average || 0),
      vote_count: Number(enSeries.vote_count || arSeries.vote_count || 0),
      status: 'published',
      popular: true,
      metadata: { tmdb_popularity: enSeries.popularity || arSeries.popularity || 0 },
    }, { onConflict: 'tmdb_id' }).select('id').single();

    if (error || !row) throw new Error(`Failed to upsert series ${arSeries.id}`);

    await adminSupabase.from('series_genres').delete().eq('series_id', row.id);
    const genreRows = (enSeries.genre_ids || arSeries.genre_ids || []).map((genreId: number) => ({ series_id: row.id, genre_id: genreId }));
    if (genreRows.length) await adminSupabase.from('series_genres').upsert(genreRows);

    for (const season of detail.seasons || []) {
      if (!season || season.season_number === 0) continue;
      await adminSupabase.from('seasons').upsert({
        series_id: row.id,
        tmdb_id: season.id,
        season_number: season.season_number,
        name_en: season.name || `Season ${season.season_number}`,
        overview_en: season.overview || '',
        poster_url: season.poster_path ? `${IMAGE}${season.poster_path}` : '',
        air_date: season.air_date || null,
      }, { onConflict: 'series_id,season_number' });
    }
    synced++;
  }
  return synced;
}

export async function syncEpisodesForSeries(seriesLimit = 10) {
  const { data: seriesRows, error } = await adminSupabase
    .from('series')
    .select('id,tmdb_id')
    .not('tmdb_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(seriesLimit, 1), 25));

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
      const detail = await tmdbGet<any>(
        `/tv/${series.tmdb_id}/season/${season.season_number}`,
        { language: 'en-US' }
      );

      const episodeRows = (detail.episodes || []).map((episode: any) => ({
        season_id: season.id,
        tmdb_id: episode.id,
        episode_number: episode.episode_number,
        name_en: episode.name || `Episode ${episode.episode_number}`,
        overview_en: episode.overview || '',
        still_url: episode.still_path ? `${IMAGE}${episode.still_path}` : '',
        air_date: episode.air_date || null,
        runtime_minutes: episode.runtime || null,
      }));

      if (episodeRows.length) {
        const { error: episodeError } = await adminSupabase
          .from('episodes')
          .upsert(episodeRows, { onConflict: 'season_id,episode_number' });
        if (episodeError) throw new Error(`Failed to sync season ${season.season_number}`);
        episodesSynced += episodeRows.length;
      }
      seasonsSynced++;
    }
  }

  return { series: (seriesRows || []).length, seasons: seasonsSynced, episodes: episodesSynced };
}

export async function runTmdbSync(options: { pages?: number } = {}) {
  const pages = Math.min(Math.max(options.pages || 1, 1), 3);
  await syncGenres();
  let movies = 0;
  let series = 0;
  for (let page = 1; page <= pages; page++) {
    movies += await syncMovies(page);
    series += await syncSeries(page);
  }
  return { movies, series, total: movies + series, pages };
}

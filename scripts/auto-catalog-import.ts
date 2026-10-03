import 'dotenv/config';

import { adminSupabase } from '../server/supabase';
import { syncMovieCandidate, syncSeriesCandidate } from '../server/tmdb';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const RUN_PAGES = Math.min(Math.max(Number(process.env.CATALOG_PAGES_PER_RUN || 3), 1), 6);
const MOVIE_DAILY_CAP = Math.min(Math.max(Number(process.env.MOVIE_DAILY_CAP || 240), 1), 1000);
const SERIES_DAILY_CAP = Math.min(Math.max(Number(process.env.SERIES_DAILY_CAP || 20), 1), 200);
const PAGE_SPACE = 500;
const SLOT_HOUR_UTC = new Date().getUTCHours() >= 12 ? 1 : 0;

type Counts = { movies: number; series: number; seasons: number; episodes: number };

function token() {
  const value = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  if (!value) throw new Error('TMDB_API_READ_ACCESS_TOKEN is missing');
  return value;
}

async function tmdbGet<T>(path: string, params: Record<string, string | number | boolean> = {}, attempt = 0): Promise<T> {
  const url = new URL(TMDB_BASE + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token(), accept: 'application/json' },
      signal: controller.signal,
    });

    if (response.ok) return response.json() as Promise<T>;

    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter * 1000, 1000 * (attempt + 1))));
      return tmdbGet<T>(path, params, attempt + 1);
    }

    const body = await response.text().catch(() => '');
    throw new Error(`TMDB ${path}: HTTP ${response.status}${body ? ' — ' + body.slice(0, 180) : ''}`);
  } catch (error) {
    if (attempt < 3 && !(error instanceof Error && error.message.startsWith('TMDB '))) {
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      return tmdbGet<T>(path, params, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function existingIds(table: 'movies' | 'series', ids: number[]) {
  if (!ids.length) return new Set<number>();
  const { data, error } = await adminSupabase
    .from(table)
    .select('tmdb_id')
    .in('tmdb_id', ids);

  if (error) throw new Error(`${table} existing-id lookup failed: ${error.message}`);
  return new Set((data || []).map((row: any) => Number(row.tmdb_id)).filter(Number.isInteger));
}

function utcStartOfDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

async function readDailyUsage(): Promise<Counts> {
  const { data, error } = await adminSupabase
    .from('sync_jobs')
    .select('movies_synced,series_synced,seasons_synced,episodes_synced')
    .eq('provider', 'tmdb')
    .eq('job_type', 'catalog-auto')
    .gte('created_at', utcStartOfDay());

  if (error) throw new Error('Daily catalog usage lookup failed: ' + error.message);

  return (data || []).reduce(
    (sum: Counts, row: any) => ({
      movies: sum.movies + Number(row.movies_synced || 0),
      series: sum.series + Number(row.series_synced || 0),
      seasons: sum.seasons + Number(row.seasons_synced || 0),
      episodes: sum.episodes + Number(row.episodes_synced || 0),
    }),
    { movies: 0, series: 0, seasons: 0, episodes: 0 },
  );
}

async function startJob(): Promise<string | null> {
  const { data: active, error: activeError } = await adminSupabase
    .from('sync_jobs')
    .select('id,job_type')
    .eq('provider', 'tmdb')
    .eq('status', 'running')
    .limit(1);

  if (activeError) throw new Error('Unable to inspect active sync jobs: ' + activeError.message);
  if (active?.length) {
    console.log(JSON.stringify({
      skipped: 'another-tmdb-sync-running',
      jobType: active[0].job_type,
    }));
    return null;
  }

  const { data, error } = await adminSupabase
    .from('sync_jobs')
    .insert({
      provider: 'tmdb',
      job_type: 'catalog-auto',
      status: 'running',
      stage: 'catalog',
      pages: RUN_PAGES,
      started_at: new Date().toISOString(),
      details: {
        movieDailyCap: MOVIE_DAILY_CAP,
        seriesDailyCap: SERIES_DAILY_CAP,
        runPages: RUN_PAGES,
      },
    })
    .select('id')
    .single();

  if (error || !data) throw new Error('Unable to start auto catalog job: ' + (error?.message || 'no row'));
  return data.id as string;
}

async function finishJob(jobId: string, status: 'succeeded' | 'failed', counts: Counts, error?: unknown) {
  await adminSupabase
    .from('sync_jobs')
    .update({
      status,
      stage: status === 'succeeded' ? 'complete' : 'failed',
      movies_synced: counts.movies,
      series_synced: counts.series,
      seasons_synced: counts.seasons,
      episodes_synced: counts.episodes,
      details: {
        ...counts,
        movieDailyCap: MOVIE_DAILY_CAP,
        seriesDailyCap: SERIES_DAILY_CAP,
        runPages: RUN_PAGES,
      },
      error: error instanceof Error ? error.message : error ? String(error) : null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

function getPageNumbers() {
  const now = new Date();
  const dayIndex = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000);
  const start = ((dayIndex * RUN_PAGES * 2 + SLOT_HOUR_UTC * RUN_PAGES) % PAGE_SPACE) + 1;
  return Array.from({ length: RUN_PAGES }, (_, index) => ((start - 1 + index) % PAGE_SPACE) + 1);
}

async function loadPopularPage(type: 'movie' | 'tv', page: number) {
  const language = type === 'movie' ? 'movie' : 'tv';
  const [ar, en] = await Promise.all([
    tmdbGet<any>(`/${language === 'movie' ? 'movie' : 'tv'}/popular`, {
      language: 'ar-SA',
      page,
      include_adult: false,
      include_video: false,
    }),
    tmdbGet<any>(`/${language === 'movie' ? 'movie' : 'tv'}/popular`, {
      language: 'en-US',
      page,
      include_adult: false,
      include_video: false,
    }),
  ]);
  return { ar, en };
}

async function main() {
  const jobId = await startJob();
  if (!jobId) return;
  const counts: Counts = { movies: 0, series: 0, seasons: 0, episodes: 0 };

  try {
    const usage = await readDailyUsage();
    let movieBudget = Math.max(0, MOVIE_DAILY_CAP - usage.movies);
    let seriesBudget = Math.max(0, SERIES_DAILY_CAP - usage.series);

    if (movieBudget <= 0 && seriesBudget <= 0) {
      await finishJob(jobId, 'succeeded', counts);
      console.log(JSON.stringify({ skipped: 'daily-cap-reached', usage, caps: { movies: MOVIE_DAILY_CAP, series: SERIES_DAILY_CAP } }));
      return;
    }

    const pages = getPageNumbers();

    for (const page of pages) {
      if (movieBudget > 0) {
        const { ar, en } = await loadPopularPage('movie', page);
        const arResults = Array.isArray(ar.results) ? ar.results : [];
        const enById = new Map<number, any>((Array.isArray(en.results) ? en.results : []).map((item: any) => [Number(item.id), item]));
        const ids = arResults.map((item: any) => Number(item.id)).filter((id: number) => Number.isInteger(id));
        const existing = await existingIds('movies', ids);

        for (const arMovie of arResults) {
          if (movieBudget <= 0) break;
          const tmdbId = Number(arMovie?.id);
          if (!Number.isInteger(tmdbId) || existing.has(tmdbId)) continue;

          const enMovie = enById.get(tmdbId) || arMovie;
          const movieId = await syncMovieCandidate(arMovie, enMovie);
          if (movieId) {
            counts.movies++;
            movieBudget--;
            existing.add(tmdbId);
            console.log('AUTO_IMPORTED_MOVIE', JSON.stringify({
              tmdbId,
              title: enMovie.title || arMovie.title,
              playback: 'cinepro-on-demand',
            }));
          }
        }
      }

      if (seriesBudget > 0) {
        const { ar, en } = await loadPopularPage('tv', page);
        const arResults = Array.isArray(ar.results) ? ar.results : [];
        const enById = new Map<number, any>((Array.isArray(en.results) ? en.results : []).map((item: any) => [Number(item.id), item]));
        const ids = arResults.map((item: any) => Number(item.id)).filter((id: number) => Number.isInteger(id));
        const existing = await existingIds('series', ids);

        for (const arSeries of arResults) {
          if (seriesBudget <= 0) break;
          const tmdbId = Number(arSeries?.id);
          if (!Number.isInteger(tmdbId) || existing.has(tmdbId)) continue;

          const enSeries = enById.get(tmdbId) || arSeries;
          const result = await syncSeriesCandidate(arSeries, enSeries);
          counts.series++;
          counts.seasons += Number(result?.seasons || 0);
          counts.episodes += Number(result?.episodes || 0);
          seriesBudget--;
          existing.add(tmdbId);
          console.log('AUTO_IMPORTED_SERIES', JSON.stringify({
            tmdbId,
            title: enSeries.name || arSeries.name,
            seasons: result?.seasons || 0,
            episodes: result?.episodes || 0,
          }));
        }
      }

      if (movieBudget <= 0 && seriesBudget <= 0) break;
    }

    await finishJob(jobId, 'succeeded', counts);
    console.log(JSON.stringify({
      imported: counts,
      remainingToday: { movies: movieBudget, series: seriesBudget },
      pages,
      caps: { movies: MOVIE_DAILY_CAP, series: SERIES_DAILY_CAP },
    }, null, 2));
  } catch (error) {
    await finishJob(jobId, 'failed', counts, error);
    throw error;
  }
}

await main();

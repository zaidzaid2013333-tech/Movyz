import 'dotenv/config';

import { adminSupabase } from '../server/supabase';
import { syncMovieByTmdbId, syncSeriesByTmdbId } from '../server/tmdb';

type RebuildIds = {
  movies: number[];
  series: number[];
};

const MOVIE_CONCURRENCY = Math.min(Math.max(Number(process.env.REBUILD_MOVIE_CONCURRENCY || 4), 1), 8);
const SERIES_CONCURRENCY = Math.min(Math.max(Number(process.env.REBUILD_SERIES_CONCURRENCY || 2), 1), 4);
const RETRIES = Math.min(Math.max(Number(process.env.REBUILD_RETRIES || 2), 0), 4);

async function loadIds(): Promise<RebuildIds> {
  const [movies, series] = await Promise.all([
    adminSupabase.from('movies').select('tmdb_id').not('tmdb_id', 'is', null).order('tmdb_id'),
    adminSupabase.from('series').select('tmdb_id').not('tmdb_id', 'is', null).order('tmdb_id'),
  ]);

  if (movies.error) throw new Error('Unable to snapshot movie IDs: ' + movies.error.message);
  if (series.error) throw new Error('Unable to snapshot series IDs: ' + series.error.message);

  return {
    movies: (movies.data || []).map((row: any) => Number(row.tmdb_id)).filter(Number.isInteger),
    series: (series.data || []).map((row: any) => Number(row.tmdb_id)).filter(Number.isInteger),
  };
}

async function deleteAll(table: string) {
  const { error } = await adminSupabase
    .from(table)
    .delete()
    .not('id', 'is', null);

  if (error) throw new Error('Unable to clear ' + table + ': ' + error.message);
}

async function clearCatalog() {
  // Playback rows first so reports can SET NULL their source_id references.
  await deleteAll('playback_sources');

  // Clear the episode/season tree explicitly, then its parent catalog rows.
  await deleteAll('episodes');
  await deleteAll('seasons');
  await deleteAll('series');
  await deleteAll('movies');
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= RETRIES) break;
      const delay = Math.min(15_000, 1_000 * (attempt + 1));
      console.warn('REBUILD_RETRY', JSON.stringify({
        label,
        attempt: attempt + 1,
        delayMs: delay,
        error: error instanceof Error ? error.message : String(error),
      }));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });

  await Promise.all(workers);
}

async function rebuildMovies(ids: number[]) {
  const failed: number[] = [];
  let completed = 0;

  await mapWithConcurrency(ids, MOVIE_CONCURRENCY, async (tmdbId) => {
    try {
      await withRetry('movie:' + tmdbId, () => syncMovieByTmdbId(tmdbId));
      completed++;
      console.log('REBUILD_MOVIE_OK', JSON.stringify({ tmdbId, completed, total: ids.length }));
    } catch (error) {
      failed.push(tmdbId);
      console.error('REBUILD_MOVIE_FAIL', JSON.stringify({
        tmdbId,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  });

  if (failed.length) {
    throw new Error(`Movie rebuild failed for ${failed.length} IDs: ${failed.slice(0, 50).join(',')}`);
  }
}

async function rebuildSeries(ids: number[]) {
  const failed: number[] = [];
  let completed = 0;

  await mapWithConcurrency(ids, SERIES_CONCURRENCY, async (tmdbId) => {
    try {
      await withRetry('series:' + tmdbId, () => syncSeriesByTmdbId(tmdbId));
      completed++;
      console.log('REBUILD_SERIES_OK', JSON.stringify({ tmdbId, completed, total: ids.length }));
    } catch (error) {
      failed.push(tmdbId);
      console.error('REBUILD_SERIES_FAIL', JSON.stringify({
        tmdbId,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  });

  if (failed.length) {
    throw new Error(`Series rebuild failed for ${failed.length} IDs: ${failed.slice(0, 50).join(',')}`);
  }
}

async function verifyCounts(expected: RebuildIds) {
  const [movies, series, seasons, episodes, sources] = await Promise.all([
    adminSupabase.from('movies').select('id', { count: 'exact', head: true }),
    adminSupabase.from('series').select('id', { count: 'exact', head: true }),
    adminSupabase.from('seasons').select('id', { count: 'exact', head: true }),
    adminSupabase.from('episodes').select('id', { count: 'exact', head: true }),
    adminSupabase.from('playback_sources').select('id', { count: 'exact', head: true }),
  ]);

  const errors = [movies, series, seasons, episodes, sources].filter((x) => x.error);
  if (errors.length) throw new Error('Rebuild verification query failed');

  const result = {
    expectedMovies: expected.movies.length,
    rebuiltMovies: movies.count || 0,
    expectedSeries: expected.series.length,
    rebuiltSeries: series.count || 0,
    rebuiltSeasons: seasons.count || 0,
    rebuiltEpisodes: episodes.count || 0,
    playbackSourcesAfterReset: sources.count || 0,
  };

  console.log('FULL_CATALOG_REBUILD_SUMMARY', JSON.stringify(result, null, 2));

  if (result.rebuiltMovies !== result.expectedMovies || result.rebuiltSeries !== result.expectedSeries) {
    throw new Error('Catalog rebuild verification failed: movie/series counts do not match the pre-reset snapshot');
  }

  if (result.rebuiltEpisodes <= 0) {
    throw new Error('Catalog rebuild verification failed: no episodes were rebuilt');
  }

  if (result.playbackSourcesAfterReset !== 0) {
    throw new Error('Catalog rebuild verification failed: playback_sources is not empty after reset');
  }
}

async function main() {
  const snapshot = await loadIds();

  console.log('FULL_CATALOG_REBUILD_START', JSON.stringify({
    movies: snapshot.movies.length,
    series: snapshot.series.length,
    note: 'playback_sources and the full season/episode tree will be deleted before re-import',
  }));

  await clearCatalog();
  await rebuildMovies(snapshot.movies);
  await rebuildSeries(snapshot.series);
  await verifyCounts(snapshot);

  console.log('FULL_CATALOG_REBUILD_DONE', JSON.stringify({
    movies: snapshot.movies.length,
    series: snapshot.series.length,
  }));
}

await main();

import 'dotenv/config';

import { adminSupabase } from '../server/supabase';
import {
  persistEvergreenEpisodeSources,
  persistEvergreenMovieSources,
} from '../server/playback-source-persistence';
import {
  resolveRe3ArabiPlayback,
  resolveRe3ArabiProvider,
  resolveRe3ArabiProviderWithContext,
  resolveRe3ArabiSeriesContext,
  resolveRe3ArabiMovieContext,
} from '../server/providers/re3arabi';

type Lane = 'primary' | 'secondary';
type Job = {
  id: string;
  content_type: 'movie' | 'episode';
  content_id: string;
  provider_lane: Lane;
  attempts: number;
};

const WORKER_ID = `gha-${process.pid}-${Date.now()}`;
const CLAIM_BATCH = Math.min(Math.max(Number(process.env.EVERGREEN_CLAIM_BATCH || 100), 1), 500);
const MAX_JOBS = Math.min(Math.max(Number(process.env.EVERGREEN_MAX_JOBS || 600), 1), 2000);
const CONCURRENCY = Math.min(Math.max(Number(process.env.EVERGREEN_CONCURRENCY || 12), 1), 24);

function providerForLane(lane: Lane, isAnime: boolean): string {
  if (lane === 'primary') return isAnime ? 'anime3rb' : 'aflaam';
  return isAnime ? 'anime4up' : 'cimaclub';
}

function retryDelay(attempts: number) {
  return Math.min(43_200, 300 * (2 ** Math.max(0, Math.min(attempts - 1, 7))));
}

async function loadMovies(ids: string[]) {
  if (!ids.length) return new Map<string, any>();
  const { data, error } = await adminSupabase
    .from('movies')
    .select('id,tmdb_id')
    .in('id', ids);
  if (error) throw new Error('movies load failed: ' + error.message);
  return new Map((data || []).map((row: any) => [String(row.id), row]));
}

async function loadEpisodes(ids: string[]) {
  if (!ids.length) return new Map<string, any>();

  const { data: episodes, error: episodeError } = await adminSupabase
    .from('episodes')
    .select('id,season_id,episode_number,tmdb_id')
    .in('id', ids);
  if (episodeError) throw new Error('episodes load failed: ' + episodeError.message);

  const seasonIds = [...new Set((episodes || []).map((row: any) => String(row.season_id)))];
  const { data: seasons, error: seasonError } = await adminSupabase
    .from('seasons')
    .select('id,series_id,season_number')
    .in('id', seasonIds);
  if (seasonError) throw new Error('seasons load failed: ' + seasonError.message);

  const seriesIds = [...new Set((seasons || []).map((row: any) => String(row.series_id)))];
  const { data: series, error: seriesError } = await adminSupabase
    .from('series')
    .select('id,tmdb_id')
    .in('id', seriesIds);
  if (seriesError) throw new Error('series load failed: ' + seriesError.message);

  const seasonById = new Map((seasons || []).map((row: any) => [String(row.id), row]));
  const seriesById = new Map((series || []).map((row: any) => [String(row.id), row]));

  return new Map((episodes || []).map((episode: any) => {
    const season = seasonById.get(String(episode.season_id));
    const seriesRow = season ? seriesById.get(String(season.series_id)) : null;
    return [
      String(episode.id),
      {
        ...episode,
        seasonNumber: Number(season?.season_number),
        seriesTmdbId: Number(seriesRow?.tmdb_id),
        seriesId: String(seriesRow?.id || ''),
      },
    ];
  }));
}

async function hasFreshProviderSource(
  contentType: 'movie' | 'episode',
  contentId: string,
  providerKeys: string[],
) {
  const { data, error } = await adminSupabase
    .from('playback_sources')
    .select('id,provider_reference,expires_at,last_checked_at')
    .eq('content_type', contentType)
    .eq('content_id', contentId)
    .eq('is_working', true)
    .in('provider_reference', providerKeys)
    .limit(12);

  if (error) throw new Error('source health lookup failed: ' + error.message);

  const freshCutoff = Date.now() - 24 * 60 * 60 * 1000;
  return (data || []).some((row: any) => {
    const checkedAt = row.last_checked_at ? Date.parse(row.last_checked_at) : 0;
    const expiresAt = row.expires_at ? Date.parse(row.expires_at) : Number.POSITIVE_INFINITY;
    return checkedAt >= freshCutoff && expiresAt > Date.now() + 2 * 60 * 60 * 1000;
  });
}

async function processJob(
  job: Job,
  movies: Map<string, any>,
  episodes: Map<string, any>,
  seriesContextCache: Map<string, Promise<any>>,
) {
  try {
    if (job.content_type === 'movie') {
      const movie = movies.get(job.content_id);
      if (!movie?.tmdb_id) {
        await adminSupabase.rpc('mark_playback_source_job_retry', {
          p_job_id: job.id,
          p_error: 'movie record missing or missing tmdb_id',
          p_delay_seconds: retryDelay(job.attempts),
          p_source_count: 0,
        });
        return;
      }

      const context = await resolveRe3ArabiMovieContext(Number(movie.tmdb_id));
      const isAnime = !!context.__isAnime;
      const primaryProvider = providerForLane('primary', isAnime);
      const secondaryProvider = providerForLane('secondary', isAnime);

      const targetProviders = job.provider_lane === 'primary'
        ? [primaryProvider, secondaryProvider]
        : [secondaryProvider];

      const alreadyFresh = await hasFreshProviderSource(
        'movie',
        String(movie.id),
        targetProviders,
      );
      if (alreadyFresh) {
        await adminSupabase.rpc('mark_playback_source_job_success', {
          p_job_id: job.id,
          p_source_count: 1,
          p_next_check_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
          p_details: { worker: WORKER_ID, lane: job.provider_lane, skipped: true },
        });
        return;
      }

      let sources: any[] = [];
      if (job.provider_lane === 'primary') {
        sources = await resolveRe3ArabiPlayback({ type: 'movie', tmdbId: Number(movie.tmdb_id) });
      } else {
        sources = await resolveRe3ArabiProvider(
          { type: 'movie', tmdbId: Number(movie.tmdb_id) },
          secondaryProvider,
        );
      }

      const persisted = await persistEvergreenMovieSources(String(movie.id), sources);

      if (!persisted.persisted) {
        await adminSupabase.rpc('mark_playback_source_job_retry', {
          p_job_id: job.id,
          p_error: `no usable source from ${targetProviders.join(',')}`,
          p_delay_seconds: retryDelay(job.attempts),
          p_source_count: 0,
        });
        return;
      }

      await adminSupabase.rpc('mark_playback_source_job_success', {
        p_job_id: job.id,
        p_source_count: persisted.persisted,
        p_next_check_at: persisted.nextCheckAt,
        p_details: {
          worker: WORKER_ID,
          lane: job.provider_lane,
          providers: targetProviders,
        },
      });
      return;
    }

    const episode = episodes.get(job.content_id);
    if (!episode?.seriesTmdbId || !episode.seasonNumber || !episode.episode_number) {
      await adminSupabase.rpc('mark_playback_source_job_retry', {
        p_job_id: job.id,
        p_error: 'episode/series identity incomplete',
        p_delay_seconds: retryDelay(job.attempts),
        p_source_count: 0,
      });
      return;
    }

    let contextPromise = seriesContextCache.get(episode.seriesId);
    if (!contextPromise) {
      contextPromise = resolveRe3ArabiSeriesContext(Number(episode.seriesTmdbId));
      seriesContextCache.set(episode.seriesId, contextPromise);
      contextPromise.catch(() => seriesContextCache.delete(episode.seriesId));
    }

    const context = await contextPromise;
    const isAnime = !!context.__isAnime;
    const primaryProvider = providerForLane('primary', isAnime);
    const secondaryProvider = providerForLane('secondary', isAnime);
    const targetProviders = job.provider_lane === 'primary'
      ? [primaryProvider, secondaryProvider]
      : [secondaryProvider];

    const alreadyFresh = await hasFreshProviderSource(
      'episode',
      String(episode.id),
      targetProviders,
    );
    if (alreadyFresh) {
      await adminSupabase.rpc('mark_playback_source_job_success', {
        p_job_id: job.id,
        p_source_count: 1,
        p_next_check_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        p_details: { worker: WORKER_ID, lane: job.provider_lane, skipped: true },
      });
      return;
    }

    let sources: any[] = [];
    if (job.provider_lane === 'primary') {
      sources = await resolveRe3ArabiPlaybackWithContext(
        context,
        Number(episode.seasonNumber),
        Number(episode.episode_number),
      );
    } else {
      sources = await resolveRe3ArabiProviderWithContext(
        context,
        Number(episode.seasonNumber),
        Number(episode.episode_number),
        secondaryProvider,
      );
    }

    const persisted = await persistEvergreenEpisodeSources(String(episode.id), sources);

    if (!persisted.persisted) {
      await adminSupabase.rpc('mark_playback_source_job_retry', {
        p_job_id: job.id,
        p_error: `no usable source from ${targetProviders.join(',')}`,
        p_delay_seconds: retryDelay(job.attempts),
        p_source_count: 0,
      });
      return;
    }

    await adminSupabase.rpc('mark_playback_source_job_success', {
      p_job_id: job.id,
      p_source_count: persisted.persisted,
      p_next_check_at: persisted.nextCheckAt,
      p_details: {
        worker: WORKER_ID,
        lane: job.provider_lane,
        providers: targetProviders,
        seriesTmdbId: episode.seriesTmdbId,
        season: episode.seasonNumber,
        episode: episode.episode_number,
      },
    });
  } catch (error) {
    await adminSupabase.rpc('mark_playback_source_job_retry', {
      p_job_id: job.id,
      p_error: error instanceof Error ? error.message : String(error),
      p_delay_seconds: retryDelay(job.attempts),
      p_source_count: 0,
    });
  }
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

async function main() {
  const workerStartedAt = Date.now();
  const requeued = await adminSupabase.rpc('requeue_stale_playback_sources', {
    p_limit: 1000,
  });
  if (requeued.error) throw new Error('maintenance enqueue failed: ' + requeued.error.message);

  const seriesContextCache = new Map<string, Promise<any>>();
  let processed = 0;

  while (processed < MAX_JOBS) {
    const claimCount = Math.min(CLAIM_BATCH, MAX_JOBS - processed);
    const { data: jobs, error } = await adminSupabase.rpc('claim_playback_source_jobs', {
      p_worker_id: WORKER_ID,
      p_limit: claimCount,
    });
    if (error) throw new Error('claim jobs failed: ' + error.message);
    if (!jobs?.length) break;

    const movieIds = jobs.filter((job: Job) => job.content_type === 'movie').map((job: Job) => job.content_id);
    const episodeIds = jobs.filter((job: Job) => job.content_type === 'episode').map((job: Job) => job.content_id);

    const [movies, episodes] = await Promise.all([
      loadMovies([...new Set(movieIds)]),
      loadEpisodes([...new Set(episodeIds)]),
    ]);

    await mapWithConcurrency(
      jobs as Job[],
      CONCURRENCY,
      (job) => processJob(job, movies, episodes, seriesContextCache),
    );

    processed += jobs.length;
  }

  console.log('EVERGREEN_SOURCE_WORKER_SUMMARY', JSON.stringify({
    worker: WORKER_ID,
    requeued: requeued.data || 0,
    processed,
    durationMs: Date.now() - workerStartedAt,
  }));
}

await main();

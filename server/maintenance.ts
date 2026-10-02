import 'dotenv/config';
import { adminSupabase } from './supabase';
import {
  resolveRe3ArabiPlayback,
  resolveRe3ArabiPlaybackWithContext,
  resolveRe3ArabiSeriesContext,
} from './providers/re3arabi';

type PlaybackJob = {
  id: string;
  content_type: 'movie' | 'episode';
  content_id: string;
  provider_lane: 'primary' | 'secondary';
  priority: number;
  attempts: number;
};

type PlaybackSource = {
  url?: string;
  type?: string;
  quality?: string;
  language?: string;
  label?: string;
  labelEn?: string;
  providerKey?: string;
  providerReference?: string;
  expiresAt?: string;
};

const WORKER_ID = `queue-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const CLAIM_LEASE_SECONDS = 300;
const RETRY_AFTER_MS = 30 * 60 * 1000;



function nowIso() {
  return new Date().toISOString();
}

function qualityScore(value: unknown) {
  const q = String(value || '').toLowerCase();
  if (/2160|4k|ultra/.test(q)) return 4000;
  if (/1440/.test(q)) return 3000;
  if (/1080|fhd/.test(q)) return 2000;
  if (/720|hd/.test(q)) return 1500;
  if (/576/.test(q)) return 1200;
  if (/480|sd/.test(q)) return 1000;
  if (/360/.test(q)) return 800;
  return 500;
}

function typeScore(value: unknown) {
  switch (String(value || '').toLowerCase()) {
    case 'hls': return 40;
    case 'dash': return 35;
    case 'mp4': return 30;
    case 'webm': return 25;
    case 'direct': return 10;
    default: return 0;
  }
}

function normalizeSource(source: PlaybackSource) {
  const url = String(source.url || '').trim();
  const type = String(source.type || '').trim().toLowerCase();
  const quality = String(source.quality || '').trim() || 'source';
  const providerKey = String(source.providerKey || source.providerReference || '').trim().toLowerCase();

  if (!/^https:\/\//i.test(url)) return null;
  if (!new Set(['hls', 'mp4', 'dash', 'webm', 'direct']).has(type)) return null;
  if (quality.toLowerCase() === 'auto') return null;
  if (!new Set(['aflaam', 'cimaclub', 'anime4up']).has(providerKey)) return null;
  if (/movyz-api\.sameranede\.workers\.dev/i.test(url)) return null;

  return {
    url,
    type,
    quality,
    language: String(source.language || 'ar'),
    labelAr: String(source.label || providerKey),
    labelEn: String(source.labelEn || source.label || providerKey),
    providerKey,
    expiresAt: source.expiresAt,
  };
}

async function getProviderId() {
  const { data, error } = await adminSupabase
    .from('providers')
    .select('id')
    .eq('key', 're3arabi')
    .maybeSingle();
  if (error) throw new Error('provider lookup failed: ' + error.message);
  return data?.id as string | undefined;
}

async function claimJob(lane?: 'primary' | 'secondary'): Promise<PlaybackJob | null> {
  const { data, error } = await adminSupabase.rpc('claim_playback_source_job', {
    p_worker_id: WORKER_ID,
    p_lease_seconds: CLAIM_LEASE_SECONDS,
    p_provider_lane: lane || null,
  });
  if (error) throw new Error('queue claim failed: ' + error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? row as PlaybackJob : null;
}

async function finishJob(
  job: PlaybackJob,
  patch: {
    status: 'succeeded' | 'pending';
    sourceCount: number;
    error?: string | null;
    retryAfterMs?: number;
  },
) {
  const availableAt = new Date(Date.now() + (patch.retryAfterMs || 0)).toISOString();
  await adminSupabase
    .from('playback_source_jobs')
    .update({
      status: patch.status,
      source_count: patch.sourceCount,
      last_error: patch.error || null,
      last_success_at: patch.status === 'succeeded' ? nowIso() : undefined,
      next_check_at: patch.status === 'succeeded' ? new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() : undefined,
      available_at: availableAt,
      locked_at: null,
      locked_by: null,
      updated_at: nowIso(),
      details: patch.error
        ? { worker: WORKER_ID, error: patch.error }
        : { worker: WORKER_ID, verified: true },
    })
    .eq('id', job.id);
}

async function persistTopSources(
  contentType: 'movie' | 'episode',
  contentId: string,
  rawSources: PlaybackSource[],
) {
  const providerId = await getProviderId();
  if (!providerId) throw new Error('re3arabi provider is missing');

  const normalized = rawSources
    .map(normalizeSource)
    .filter((source): source is NonNullable<ReturnType<typeof normalizeSource>> => Boolean(source));

  const best = [...normalized]
    .sort((a, b) => {
      const qualityDiff = qualityScore(b.quality) - qualityScore(a.quality);
      if (qualityDiff) return qualityDiff;
      const typeDiff = typeScore(b.type) - typeScore(a.type);
      if (typeDiff) return typeDiff;
      const providerOrder = (a.providerKey === 'aflaam' ? 0 : a.providerKey === 'cimaclub' ? 1 : 2)
        - (b.providerKey === 'aflaam' ? 0 : b.providerKey === 'cimaclub' ? 1 : 2);
      return providerOrder;
    })
    .filter((source, index, all) => all.findIndex((item) => item.url === source.url) === index)
    .slice(0, 5);

  await adminSupabase
    .from('playback_sources')
    .delete()
    .eq('provider_id', providerId)
    .eq('content_type', contentType)
    .eq('content_id', contentId);

  if (!best.length) return 0;

  const rows = best.map((source) => ({
    provider_id: providerId,
    content_type: contentType,
    content_id: contentId,
    source_type: source.type,
    url: source.url,
    provider_reference: source.providerKey,
    quality: source.quality,
    language: source.language,
    label_ar: source.labelAr,
    label_en: source.labelEn,
    expires_at: null,
    is_working: true,
    last_checked_at: nowIso(),
    failure_count: 0,
  }));

  const { error } = await adminSupabase
    .from('playback_sources')
    .upsert(rows, { onConflict: 'provider_id,content_type,content_id,url' });

  if (error) throw new Error('source persistence failed: ' + error.message);
  return rows.length;
}

async function loadEpisodeContext(episodeId: string) {
  const { data: episode, error: episodeError } = await adminSupabase
    .from('episodes')
    .select('id,season_id,episode_number')
    .eq('id', episodeId)
    .maybeSingle();
  if (episodeError || !episode) throw new Error('episode not found');

  const { data: season, error: seasonError } = await adminSupabase
    .from('seasons')
    .select('series_id,season_number')
    .eq('id', episode.season_id)
    .maybeSingle();
  if (seasonError || !season) throw new Error('season not found');

  const { data: series, error: seriesError } = await adminSupabase
    .from('series')
    .select('id,tmdb_id,title_en')
    .eq('id', season.series_id)
    .eq('status', 'published')
    .maybeSingle();
  if (seriesError || !series?.tmdb_id) throw new Error('series not found');

  const context = await resolveRe3ArabiSeriesContext(Number(series.tmdb_id));
  return {
    tmdbId: Number(series.tmdb_id),
    season: Number(season.season_number),
    episode: Number(episode.episode_number),
    isAnime: !!context.__isAnime,
    context,
  };
}

async function resolveJob(job: PlaybackJob) {
  if (job.provider_lane !== 'primary') {
    return { skipped: true, sourceCount: 0 };
  }

  if (job.content_type === 'movie') {
    const { data: movie, error } = await adminSupabase
      .from('movies')
      .select('id,tmdb_id,status')
      .eq('id', job.content_id)
      .maybeSingle();

    if (error || !movie?.tmdb_id || movie.status !== 'published') {
      return { skipped: true, sourceCount: 0 };
    }

    const sources = await resolveRe3ArabiPlayback({
      type: 'movie',
      tmdbId: Number(movie.tmdb_id),
    });

    const sourceCount = await persistTopSources('movie', String(movie.id), sources as PlaybackSource[]);
    return { skipped: false, sourceCount };
  }

  const info = await loadEpisodeContext(job.content_id);
  const sources = await resolveRe3ArabiPlaybackWithContext(
    info.context,
    info.season,
    info.episode,
  );

  const sourceCount = await persistTopSources(
    'episode',
    job.content_id,
    sources as PlaybackSource[],
  );

  return { skipped: false, sourceCount };
}

export async function runMaintenanceTick(
  jobKey: 'primary_sources' | 'secondary_sources' | 'repair_sources',
) {
  if (jobKey === 'repair_sources') {
    return runQueueBatch(['primary', 'secondary'], 40);
  }

  return jobKey === 'primary_sources'
    ? runQueueBatch(['primary'], 80)
    : runQueueBatch(['secondary'], 40);
}

async function runQueueBatch(
  lanes: Array<'primary' | 'secondary'>,
  limit: number,
) {
  let claimed = 0;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  const concurrency = Math.min(
    Number(process.env.PLAYBACK_QUEUE_CONCURRENCY || 8),
    limit,
  );

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const slot = claimed++;
      if (slot >= limit) return;

      const lane = lanes.length === 1 ? lanes[0] : undefined;
      const job = await claimJob(lane);
      if (!job) return;

      try {
        const result = await resolveJob(job);
        if (result.skipped) {
          skipped += 1;
          await finishJob(job, { status: 'succeeded', sourceCount: result.sourceCount });
        } else if (result.sourceCount > 0) {
          succeeded += 1;
          await finishJob(job, { status: 'succeeded', sourceCount: result.sourceCount });
        } else {
          failed += 1;
          await finishJob(job, {
            status: 'pending',
            sourceCount: 0,
            error: 'No verified playable source returned',
            retryAfterMs: RETRY_AFTER_MS,
          });
        }
      } catch (error) {
        failed += 1;
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
        await finishJob(job, {
          status: 'pending',
          sourceCount: 0,
          error: message,
          retryAfterMs: RETRY_AFTER_MS,
        });
      }
    }
  });

  await Promise.all(workers);

  const stats = { worker: WORKER_ID, lanes, claimed, succeeded, skipped, failed, concurrency };
  console.log('[movyz-queue-maintenance]', JSON.stringify(stats));
  return { skipped: false, jobKey: lanes.join(','), stats };
}

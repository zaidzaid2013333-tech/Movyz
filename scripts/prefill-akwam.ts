import 'dotenv/config';

import { adminSupabase } from '../server/supabase';

type CineProSource = {
  url?: string;
  type?: string;
  quality?: string | number;
  provider?: { name?: string; id?: string };
  audioTracks?: Array<{ language?: string; label?: string }>;
};

const CINEPRO_BASE_URL = (
  process.env.CINEPRO_BASE_URL ||
  'https://cinepro-core-production-8b58.up.railway.app'
).replace(/\/+$/, '');

const TARGET_TMDB_ID = Number(process.env.TARGET_TMDB_ID || '27205');
const TARGET_MODE = process.env.PREFILL_MODE || 'smoke';

const SUPPORTED_TYPES = new Set(['hls', 'mp4', 'dash', 'webm', 'direct']);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fetchCinePro(tmdbId: number) {
  const url = `${CINEPRO_BASE_URL}/v1/movies/${encodeURIComponent(String(tmdbId))}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Movyz-Akwam-Prefill/1.0',
      },
      signal: controller.signal,
    });

    const body = await response.text();
    let payload: { sources?: CineProSource[]; diagnostics?: unknown[] } = {};

    try {
      payload = JSON.parse(body) as typeof payload;
    } catch {
      throw new Error(`CinePro returned non-JSON (HTTP ${response.status})`);
    }

    if (!response.ok) {
      const details = Array.isArray(payload.diagnostics)
        ? JSON.stringify(payload.diagnostics).slice(0, 1000)
        : body.slice(0, 500);
      throw new Error(`CinePro HTTP ${response.status}: ${details}`);
    }

    return Array.isArray(payload.sources) ? payload.sources : [];
  } finally {
    clearTimeout(timer);
  }
}

async function ensureAkwamProvider() {
  const { data, error } = await adminSupabase
    .from('providers')
    .upsert(
      {
        key: 'akwam',
        name: 'Akwam',
        adapter_name: 'cinepro-akwam',
        enabled: true,
        status: 'healthy',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )
    .select('id,key')
    .single();

  if (error || !data) {
    throw new Error(`Unable to register Akwam provider: ${error?.message || 'no row returned'}`);
  }

  return data.id as string;
}

async function getTargetMovie() {
  const { data, error } = await adminSupabase
    .from('movies')
    .select('id,tmdb_id,title_ar,title_en,original_title')
    .eq('tmdb_id', TARGET_TMDB_ID)
    .maybeSingle();

  if (error) throw new Error(`Movie lookup failed: ${error.message}`);
  if (!data) throw new Error(`Movie TMDB ${TARGET_TMDB_ID} is not present in Supabase`);
  return data;
}

function normalizeSource(source: CineProSource, index: number) {
  const url = String(source.url || '').trim();
  if (!/^https:\/\//i.test(url)) return null;

  const rawType = String(source.type || '').trim().toLowerCase();
  const type = SUPPORTED_TYPES.has(rawType) ? rawType : 'direct';

  const providerKey = String(source.provider?.id || 'akwam').trim().toLowerCase();
  const providerName = String(source.provider?.name || 'Akwam').trim();

  const track = Array.isArray(source.audioTracks) ? source.audioTracks[0] : undefined;
  const language = String(track?.language || 'und').trim() || 'und';

  const rawQuality = String(source.quality ?? '').trim();
  const qualityMatch = rawQuality.match(/(2160|1440|1080|720|576|480|360|240)/);
  const quality = qualityMatch ? qualityMatch[1] + 'p' : 'Auto';

  return {
    source_type: type,
    url,
    provider_reference: `cinepro:${providerKey}`,
    quality,
    language,
    label_ar: `Akwam • ${quality}`,
    label_en: `Akwam • ${quality}`,
    expires_at: null,
    is_working: true,
    last_checked_at: new Date().toISOString(),
    subtitle_url: null,
    subtitle_type: null,
    subtitle_language: null,
    subtitle_label_ar: null,
    subtitle_label_en: null,
    subtitle_default: null,
    _provider_name: providerName,
    _index: index,
  };
}

async function saveMovieSources(providerId: string, movieId: string, sources: CineProSource[]) {
  const normalized = sources
    .map(normalizeSource)
    .filter((source): source is NonNullable<ReturnType<typeof normalizeSource>> => Boolean(source));

  const unique = Array.from(
    new Map(normalized.map((source) => [source.url, source])).values(),
  );

  assert(unique.length > 0, 'No valid HTTPS sources survived the persistence validation');

  const { error: staleError } = await adminSupabase
    .from('playback_sources')
    .update({
      is_working: false,
      last_checked_at: new Date().toISOString(),
    })
    .eq('provider_id', providerId)
    .eq('content_type', 'movie')
    .eq('content_id', movieId);

  if (staleError) throw new Error(`Unable to retire stale Akwam rows: ${staleError.message}`);

  const rows = unique.map(({ _provider_name, _index, ...source }) => ({
    provider_id: providerId,
    content_type: 'movie',
    content_id: movieId,
    ...source,
  }));

  const { error } = await adminSupabase
    .from('playback_sources')
    .upsert(rows, {
      onConflict: 'provider_id,content_type,content_id,url',
    });

  if (error) throw new Error(`Playback source upsert failed: ${error.message}`);

  const { count, error: countError } = await adminSupabase
    .from('playback_sources')
    .select('id', { count: 'exact', head: true })
    .eq('provider_id', providerId)
    .eq('content_type', 'movie')
    .eq('content_id', movieId)
    .eq('is_working', true);

  if (countError) throw new Error(`Playback source verification failed: ${countError.message}`);

  return {
    discovered: sources.length,
    validated: unique.length,
    saved: count ?? 0,
  };
}

async function markQueueSuccess(movieId: string, sourceCount: number) {
  const { data: jobs, error: jobError } = await adminSupabase
    .from('playback_source_jobs')
    .select('id')
    .eq('content_type', 'movie')
    .eq('content_id', movieId)
    .eq('provider_lane', 'primary')
    .limit(1);

  if (jobError) throw new Error(`Queue lookup failed: ${jobError.message}`);
  if (!jobs?.length) return;

  const { error } = await adminSupabase.rpc('mark_playback_source_job_success', {
    p_job_id: jobs[0].id,
    p_source_count: sourceCount,
    p_next_check_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    p_details: {
      provider: 'akwam',
      path: 'cinepro-prefill',
      mode: TARGET_MODE,
    },
  });

  if (error) throw new Error(`Queue success update failed: ${error.message}`);
}

async function main() {
  if (TARGET_MODE !== 'smoke') {
    throw new Error(
      `Bulk mode is intentionally locked in this first rollout. Run only PREFILL_MODE=smoke until the smoke test is reviewed.`,
    );
  }

  const movie = await getTargetMovie();
  const providerId = await ensureAkwamProvider();

  console.log(JSON.stringify({
    stage: 'discover',
    mode: TARGET_MODE,
    tmdbId: TARGET_TMDB_ID,
    movieId: movie.id,
    title: movie.title_en || movie.original_title || movie.title_ar,
    cinepro: CINEPRO_BASE_URL,
  }));

  const sources = await fetchCinePro(TARGET_TMDB_ID);
  const result = await saveMovieSources(providerId, movie.id, sources);

  assert(result.discovered > 0, 'Smoke test failed: discovered=0');
  assert(result.validated > 0, 'Smoke test failed: validated=0');
  assert(result.saved > 0, 'Smoke test failed: saved=0');

  await markQueueSuccess(movie.id, result.saved);

  await adminSupabase
    .from('providers')
    .update({
      status: 'healthy',
      latency_ms: null,
      success_rate: 100,
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', providerId);

  console.log(JSON.stringify({
    stage: 'complete',
    mode: TARGET_MODE,
    tmdbId: TARGET_TMDB_ID,
    movieId: movie.id,
    discovered: result.discovered,
    validated: result.validated,
    saved: result.saved,
    provider: 'akwam',
  }, null, 2));
}

await main();

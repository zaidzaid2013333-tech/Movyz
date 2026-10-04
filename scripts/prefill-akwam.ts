import 'dotenv/config';

import { adminSupabase } from '../server/supabase';

type CineProSource = {
  url?: string;
  type?: string;
  quality?: string | number;
  provider?: { name?: string; id?: string };
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

async function fetchCinePro(tmdbId: number) {
  const url = `${CINEPRO_BASE_URL}/v1/movies/${encodeURIComponent(String(tmdbId))}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    const startedAt = Date.now();
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Movyz-Akwam-Smoke/1.0',
      },
      signal: controller.signal,
    });

    const body = await response.text();
    let payload: {
      sources?: CineProSource[];
      diagnostics?: unknown[];
    } = {};

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

    return {
      latencyMs: Date.now() - startedAt,
      sources: Array.isArray(payload.sources) ? payload.sources : [],
      diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
    };
  } finally {
    clearTimeout(timer);
  }
}

function validateReturnedSources(sources: CineProSource[]) {
  const valid = sources.filter((source) => {
    const url = String(source.url || '').trim();
    const type = String(source.type || '').trim().toLowerCase();
    return /^https:\/\//i.test(url) && (SUPPORTED_TYPES.has(type) || type === '');
  });

  const unique = Array.from(
    new Map(valid.map((source) => [String(source.url).trim(), source])).values(),
  );

  return unique;
}

async function main() {
  if (TARGET_MODE !== 'smoke') {
    throw new Error(
      'Bulk prefill is locked. The current Akwam contract is on-demand and does not permit persistent media URLs.',
    );
  }

  const movie = await getTargetMovie();
  const providerId = await ensureAkwamProvider();
  const startedAt = new Date().toISOString();

  console.log(JSON.stringify({
    stage: 'discover',
    mode: TARGET_MODE,
    tmdbId: TARGET_TMDB_ID,
    movieId: movie.id,
    title: movie.title_en || movie.original_title || movie.title_ar,
    cinepro: CINEPRO_BASE_URL,
  }));

  const response = await fetchCinePro(TARGET_TMDB_ID);
  const validated = validateReturnedSources(response.sources);

  assert(response.sources.length > 0, 'Smoke test failed: discovered=0');
  assert(validated.length > 0, 'Smoke test failed: validated=0');

  const { count: persisted, error: countError } = await adminSupabase
    .from('playback_sources')
    .select('id', { count: 'exact', head: true })
    .eq('provider_id', providerId)
    .eq('content_type', 'movie')
    .eq('content_id', movie.id)
    .eq('is_working', true);

  if (countError) throw new Error(`Playback source verification failed: ${countError.message}`);

  assert(
    persisted === 0,
    `Unexpected persistent Akwam rows detected for smoke target: ${persisted}`,
  );

  const { error: providerError } = await adminSupabase
    .from('providers')
    .update({
      status: 'healthy',
      latency_ms: response.latencyMs,
      success_rate: 100,
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', providerId);

  if (providerError) {
    throw new Error(`Provider health update failed: ${providerError.message}`);
  }

  console.log(JSON.stringify({
    stage: 'complete',
    mode: TARGET_MODE,
    tmdbId: TARGET_TMDB_ID,
    movieId: movie.id,
    discovered: response.sources.length,
    validated: validated.length,
    saved: 0,
    persistence: 'blocked-by-akwam-on-demand-policy',
    latencyMs: response.latencyMs,
    checkedAt: startedAt,
    provider: 'akwam',
    diagnostics: response.diagnostics.slice(0, 3),
  }, null, 2));
}

await main();

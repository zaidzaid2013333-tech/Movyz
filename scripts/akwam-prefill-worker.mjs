const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const cineproBase = (process.env.CINEPRO_BASE_URL || 'https://cinepro-core-production-8b58.up.railway.app').replace(/\/+$/, '');
const workerId = process.env.PREFILL_WORKER_ID || 'akwam-worker';
const maxSources = Math.max(1, Math.min(Number(process.env.MAX_SOURCES_PER_ITEM || 2), 4));

if (!supabaseUrl || !serviceRole) throw new Error('Missing Supabase worker credentials');

const headers = {
  apikey: serviceRole,
  Authorization: 'Bearer ' + serviceRole,
  'Content-Type': 'application/json',
};

async function supabase(path, init = {}) {
  const response = await fetch(supabaseUrl + path, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 1200)}`);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function rpc(name, body) {
  return supabase('/rest/v1/rpc/' + name, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function claim() {
  const rows = await rpc('claim_akwam_prefill_job', {
    p_worker_id: workerId,
    p_lease_seconds: 300,
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function cinepro(job) {
  let endpoint;
  if (job.content_type === 'movie') {
    if (!job.tmdb_id) throw new Error('Movie has no TMDB id');
    endpoint = `${cineproBase}/v1/movies/${job.tmdb_id}`;
  } else {
    if (!job.tmdb_id || !job.season_number || !job.episode_number) {
      throw new Error('Episode is missing series/season/episode identifiers');
    }
    endpoint =
      `${cineproBase}/v1/tv/${job.tmdb_id}/seasons/${job.season_number}/episodes/${job.episode_number}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const started = Date.now();
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Movyz-Akwam-Prefill/2.0',
      },
      signal: controller.signal,
    });
    const text = await response.text();

    let payload = {};
    try { payload = JSON.parse(text); } catch {}

    if (!response.ok) {
      const diagnostics = Array.isArray(payload.diagnostics)
        ? JSON.stringify(payload.diagnostics).slice(0, 1200)
        : text.slice(0, 500);
      throw new Error(`CinePro HTTP ${response.status}: ${diagnostics}`);
    }

    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    const valid = sources
      .filter((source) => /^https:\/\//i.test(String(source?.url || '').trim()))
      .filter((source) => ['hls', 'mp4', 'dash', 'webm', 'direct'].includes(String(source?.type || 'direct').toLowerCase()))
      .map((source) => ({
        url: String(source.url).trim(),
        type: String(source.type || 'direct').toLowerCase(),
        quality: String(source.quality ?? 'Auto'),
        language: String(source.audioTracks?.[0]?.language || 'und').trim() || 'und',
      }));

    const unique = Array.from(new Map(valid.map((source) => [source.url, source])).values());

    return {
      discovered: sources.length,
      validated: unique.length,
      sources: unique.slice(0, maxSources),
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function persist(job, result, providerId) {
  const now = new Date().toISOString();

  if (!result.sources.length) {
    throw new Error(`Akwam returned no validated source for ${job.content_type}:${job.content_id}`);
  }

  await supabase(
    `/rest/v1/playback_sources?provider_id=eq.${encodeURIComponent(providerId)}&content_type=eq.${encodeURIComponent(job.content_type)}&content_id=eq.${encodeURIComponent(job.content_id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ is_working: false, last_checked_at: now }),
      headers: { Prefer: 'return=minimal' },
    },
  );

  const rows = result.sources.map((source, index) => ({
    provider_id: providerId,
    content_type: job.content_type,
    content_id: job.content_id,
    source_type: source.type,
    url: source.url,
    provider_reference: 'akwam',
    quality: source.quality,
    language: source.language,
    label_ar: 'Akwam • ' + source.quality,
    label_en: 'Akwam • ' + source.quality,
    expires_at: null,
    is_working: true,
    last_checked_at: now,
    failure_count: 0,
    subtitle_url: null,
    subtitle_type: null,
    subtitle_language: null,
    subtitle_label_ar: null,
    subtitle_label_en: null,
    subtitle_default: index === 0,
  }));

  await supabase('/rest/v1/playback_sources?on_conflict=provider_id,content_type,content_id,url', {
    method: 'POST',
    body: JSON.stringify(rows),
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });

  await rpc('mark_playback_source_job_success', {
    p_job_id: job.id,
    p_source_count: rows.length,
    p_next_check_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    p_details: {
      provider: 'akwam',
      mode: 'persistent-prefill',
      discovered: result.discovered,
      validated: result.validated,
      stored: rows.length,
      latency_ms: result.latencyMs,
      worker: workerId,
    },
  });

  return rows.length;
}

async function retry(job, error) {
  const attempts = Number(job.attempts || 1);
  const delays = [300, 900, 3600, 21600, 86400];
  const delay = delays[Math.min(Math.max(attempts - 1, 0), delays.length - 1)];
  await rpc('mark_playback_source_job_retry', {
    p_job_id: job.id,
    p_error: String(error).slice(0, 1800),
    p_delay_seconds: delay,
    p_source_count: 0,
  });
  return delay;
}

const providers = await supabase('/rest/v1/providers?select=id,key,enabled&key=eq.akwam&limit=1');
if (!Array.isArray(providers) || !providers[0]) throw new Error('Akwam provider row is missing');
const providerId = providers[0].id;

let processed = 0;
let saved = 0;
let failed = 0;

while (true) {
  const job = await claim();
  if (!job) break;

  try {
    const result = await cinepro(job);
    const count = await persist(job, result, providerId);
    processed++;
    saved += count;
    console.log(JSON.stringify({
      worker: workerId,
      jobId: job.id,
      contentType: job.content_type,
      contentId: job.content_id,
      discovered: result.discovered,
      validated: result.validated,
      saved: count,
      latencyMs: result.latencyMs,
    }));
  } catch (error) {
    failed++;
    const delay = await retry(job, error);
    console.warn(JSON.stringify({
      worker: workerId,
      jobId: job.id,
      contentType: job.content_type,
      contentId: job.content_id,
      error: String(error).slice(0, 1200),
      retryInSeconds: delay,
    }));
  }
}

console.log(JSON.stringify({
  worker: workerId,
  stage: 'drained',
  processed,
  saved,
  failed,
  maxSources,
}));

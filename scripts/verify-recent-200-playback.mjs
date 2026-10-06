#!/usr/bin/env node

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const API_BASE = String(process.env.MOVYZ_API_BASE_URL || 'https://movyz-api.sameranede.workers.dev').replace(/\/+$/, '');
const SHARD_INDEX = Number(process.env.SHARD_INDEX || 0);
const SHARD_COUNT = Number(process.env.SHARD_COUNT || 1);
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.RESOLVER_CONCURRENCY || 4)));
const RETRIES = Math.max(1, Math.min(6, Number(process.env.RESOLVER_RETRIES || 4)));
const TIMEOUT_MS = Math.max(10_000, Number(process.env.RESOLVER_TIMEOUT_MS || 35_000));

if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
if (!Number.isInteger(SHARD_INDEX) || SHARD_INDEX < 0 || SHARD_INDEX >= SHARD_COUNT) {
  throw new Error('Invalid shard configuration');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, init = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      const message = body?.error?.message || body?.message || text.slice(0, 700) || ('HTTP ' + response.status);
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function supabaseJson(url, init = {}, timeoutMs = TIMEOUT_MS) {
  return fetchJson(url, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: 'Bearer ' + SERVICE_ROLE,
      ...(init.headers || {}),
    },
  }, timeoutMs);
}

async function getRows(path, params = {}) {
  const url = new URL(SUPABASE_URL + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return supabaseJson(url.toString(), {}, 30_000);
}

function inFilter(ids) {
  return 'in.(' + ids.join(',') + ')';
}

async function fetchChunked(path, key, ids, extra = {}, chunkSize = 60) {
  const out = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const rows = await getRows(path, {
      [key]: inFilter(chunk),
      ...extra,
    });
    if (Array.isArray(rows)) out.push(...rows);
  }
  return out;
}

function makeTasks(movies, episodes) {
  return [
    ...movies.map((row) => ({
      kind: 'movie',
      id: row.id,
      tmdbId: row.tmdb_id,
      title: row.title_en || row.title_ar || String(row.tmdb_id),
    })),
    ...episodes.map((row) => ({
      kind: 'episode',
      id: row.id,
      tmdbId: row.tmdb_id,
      seasonNumber: row.season_number,
      episodeNumber: row.episode_number,
      seriesTitle: row.series_title,
      title: row.episode_title || ('Episode ' + row.episode_number),
    })),
  ];
}

async function resolveTask(task) {
  const query = new URLSearchParams({
    type: task.kind,
    contentId: task.id,
  });
  if (task.kind === 'episode') {
    query.set('season', String(task.seasonNumber));
    query.set('episode', String(task.episodeNumber));
  }

  const url = API_BASE + '/api/v1/playback/prepare?' + query.toString();
  let last = null;

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const body = await fetchJson(url);
      const data = body?.data;
      if (body?.success !== true || data?.ready !== true || !Array.isArray(data?.sources) || data.sources.length < 1) {
        throw new Error('Resolver returned no playable source');
      }
      const playable = data.sources.some((s) =>
        s && /^https:\/\//i.test(String(s.url || '')) &&
        ['mp4', 'hls', 'dash', 'webm', 'direct'].includes(String(s.type || '').toLowerCase()),
      );
      if (!playable) throw new Error('Resolver returned only non-playable sources');
      return {
        ok: true,
        attempt,
        sourceCount: data.sources.length,
        mode: data.mode || 'unknown',
      };
    } catch (error) {
      last = error;
      if (attempt < RETRIES) {
        const delay = Math.min(12_000, 1000 * 2 ** (attempt - 1));
        await sleep(delay);
      }
    }
  }

  return {
    ok: false,
    error: String(last?.message || last),
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const movieRows = await getRows('/rest/v1/movies', {
  select: 'id,tmdb_id,title_en,title_ar,created_at,status',
  status: 'eq.published',
  order: 'created_at.desc',
  limit: '100',
});

const seriesRows = await getRows('/rest/v1/series', {
  select: 'id,tmdb_id,title_en,title_ar,created_at,status',
  status: 'eq.published',
  order: 'created_at.desc',
  limit: '100',
});

if (!Array.isArray(movieRows) || movieRows.length !== 100) {
  throw new Error('Expected exactly 100 recent movies; got ' + (movieRows?.length || 0));
}
if (!Array.isArray(seriesRows) || seriesRows.length !== 100) {
  throw new Error('Expected exactly 100 recent series; got ' + (seriesRows?.length || 0));
}

const seriesIds = seriesRows.map((x) => x.id);
const seasonRows = await fetchChunked('/rest/v1/seasons', 'series_id', seriesIds, {
  select: 'id,series_id,season_number',
  order: 'season_number.asc',
}, 60);

const seasonIds = seasonRows.map((x) => x.id);
const episodeRaw = [];
for (let i = 0; i < seasonIds.length; i += 60) {
  const chunk = seasonIds.slice(i, i + 60);
  const rows = await getRows('/rest/v1/episodes', {
    select: 'id,season_id,tmdb_id,episode_number,name_en,name_ar',
    season_id: inFilter(chunk),
    order: 'episode_number.asc',
    limit: '10000',
  });
  if (Array.isArray(rows)) episodeRaw.push(...rows);
}

const seriesMap = new Map(seriesRows.map((x) => [x.id, x]));
const seasonMap = new Map(seasonRows.map((x) => [x.id, x]));

const episodes = episodeRaw.map((e) => {
  const season = seasonMap.get(e.season_id);
  const series = season ? seriesMap.get(season.series_id) : null;
  return {
    ...e,
    season_number: Number(season?.season_number || 0),
    series_title: series?.title_en || series?.title_ar || String(series?.tmdb_id || ''),
    episode_title: e.name_en || e.name_ar || '',
  };
}).filter((e) => e.season_number > 0 && Number(e.episode_number) > 0);

if (seasonRows.length === 0) throw new Error('Recent 100 series have no seasons');
if (episodes.length === 0) throw new Error('Recent 100 series have no episodes');

const seriesWithEpisodes = new Set(
  seasonRows.map((s) => s.series_id),
);
if (seriesWithEpisodes.size !== seriesRows.length) {
  const missing = seriesRows.filter((s) => !seriesWithEpisodes.has(s.id))
    .slice(0, 20)
    .map((s) => s.title_en || s.title_ar || String(s.tmdb_id));
  throw new Error('Some recent series have no seasons: ' + missing.join(' | '));
}

const allTasks = makeTasks(movieRows, episodes);
const tasks = allTasks.filter((_, index) => index % SHARD_COUNT === SHARD_INDEX);

console.log(JSON.stringify({
  shard: SHARD_INDEX,
  shards: SHARD_COUNT,
  recent_movies: movieRows.length,
  recent_series: seriesRows.length,
  seasons: seasonRows.length,
  episodes: episodes.length,
  total_tasks: allTasks.length,
  shard_tasks: tasks.length,
  concurrency: CONCURRENCY,
}));

const started = Date.now();
let done = 0;
const failures = [];
const results = await mapLimit(tasks, CONCURRENCY, async (task) => {
  const result = await resolveTask(task);
  done += 1;
  if (done % 25 === 0 || !result.ok) {
    console.log(JSON.stringify({
      progress: done + '/' + tasks.length,
      kind: task.kind,
      id: task.id,
      seriesTitle: task.seriesTitle || null,
      title: task.title,
      season: task.seasonNumber || null,
      episode: task.episodeNumber || null,
      ok: result.ok,
      sourceCount: result.sourceCount || 0,
      error: result.error || null,
    }));
  }
  if (!result.ok) failures.push({ task, error: result.error });
  return result;
});

const successCount = results.filter((x) => x?.ok).length;
const summary = {
  shard: SHARD_INDEX,
  shards: SHARD_COUNT,
  recent_movies: movieRows.length,
  recent_series: seriesRows.length,
  seasons: seasonRows.length,
  episodes: episodes.length,
  total_tasks: tasks.length,
  succeeded: successCount,
  failed: failures.length,
  elapsed_seconds: Math.round((Date.now() - started) / 1000),
  failures: failures.slice(0, 100),
};

console.log('VERIFY_SUMMARY=' + JSON.stringify(summary));

if (failures.length) process.exitCode = 1;

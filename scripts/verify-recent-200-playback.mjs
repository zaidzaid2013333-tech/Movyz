#!/usr/bin/env node

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_ROLE = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const API_BASE = String(process.env.MOVYZ_API_BASE_URL || "https://movyz-api.sameranede.workers.dev").replace(/\/+$/, "");
const SHARD_INDEX = Number(process.env.SHARD_INDEX || 0);
const SHARD_COUNT = Number(process.env.SHARD_COUNT || 1);
const CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.RESOLVER_CONCURRENCY || 2)));
const RETRIES = Math.max(1, Math.min(5, Number(process.env.RESOLVER_RETRIES || 4)));
const TIMEOUT_MS = Math.max(15_000, Number(process.env.RESOLVER_TIMEOUT_MS || 45_000));

if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
if (!Number.isInteger(SHARD_INDEX) || SHARD_INDEX < 0 || SHARD_INDEX >= SHARD_COUNT) {
  throw new Error("Invalid shard configuration");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function supabaseJson(path, params = {}) {
  const url = new URL(SUPABASE_URL + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: "Bearer " + SERVICE_ROLE,
        Accept: "application/json",
      },
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) throw new Error("Supabase " + response.status + ": " + text.slice(0, 700));
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function inFilter(ids) {
  return "in.(" + ids.join(",") + ")";
}

async function fetchChunked(path, key, ids, extra = {}, chunkSize = 60) {
  const out = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const rows = await supabaseJson(path, { [key]: inFilter(chunk), ...extra });
    if (Array.isArray(rows)) out.push(...rows);
  }
  return out;
}

function titleList(row) {
  return Array.from(new Set([
    row?.title_en,
    row?.title_ar,
    row?.original_title,
    ...(Array.isArray(row?.alternative_titles)
      ? row.alternative_titles.map((x) => x?.title).filter(Boolean)
      : []),
  ].filter(Boolean)));
}

function isPlayableSource(source) {
  return Boolean(
    source &&
    /^https:\/\//i.test(String(source.url || "")) &&
    ["mp4", "hls", "dash", "webm", "direct"].includes(String(source.type || "").toLowerCase()),
  );
}

async function requestJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Movyz-Catalog-Audit/1.0",
        "Cache-Control": "no-cache",
      },
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch {}
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
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

function shardFor(index) {
  return index % SHARD_COUNT;
}

async function checkTask(task) {
  let last = "unknown";
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const params = new URLSearchParams({
      type: task.kind,
      contentId: task.id,
    });
    if (task.season != null) params.set("season", String(task.season));
    if (task.episode != null) params.set("episode", String(task.episode));

    try {
      const { status, body } = await requestJson(API_BASE + "/api/v1/playback/prepare?" + params);
      const sources = body?.data?.sources;
      const ok = status === 200 &&
        body?.success === true &&
        Array.isArray(sources) &&
        sources.some(isPlayableSource);

      if (ok) return { ok: true, attempt, sources: sources.length };

      last = "status=" + status + " body=" + JSON.stringify(body).slice(0, 700);
    } catch (error) {
      last = String(error?.message || error);
    }

    if (attempt < RETRIES) await sleep(Math.min(5_000, 700 * 2 ** (attempt - 1)));
  }

  return { ok: false, error: last };
}

const movies = await supabaseJson("/rest/v1/movies", {
  select: "id,tmdb_id,title_en,title_ar,original_title,alternative_titles,release_date",
  status: "eq.published",
  order: "created_at.asc",
  limit: "2000",
});

const series = await supabaseJson("/rest/v1/series", {
  select: "id,tmdb_id,title_en,title_ar,original_title,alternative_titles",
  status: "eq.published",
  order: "created_at.asc",
  limit: "2000",
});

if (!Array.isArray(movies) || !movies.length) throw new Error("No published movies found");
if (!Array.isArray(series) || !series.length) throw new Error("No published series found");

const seriesIds = series.map((row) => row.id);
const seasons = await fetchChunked("/rest/v1/seasons", "series_id", seriesIds, {
  select: "id,series_id,season_number",
  order: "season_number.asc",
});

const seasonIds = seasons.map((row) => row.id);
const episodeRows = await fetchChunked("/rest/v1/episodes", "season_id", seasonIds, {
  select: "id,season_id,episode_number",
  order: "episode_number.asc",
}, 60);

const firstEpisodeBySeason = new Map();
for (const row of episodeRows) {
  const key = String(row.season_id);
  const current = firstEpisodeBySeason.get(key);
  if (!current || Number(row.episode_number || 0) < Number(current.episode_number || 0)) {
    firstEpisodeBySeason.set(key, row);
  }
}

const seasonsBySeries = new Map();
for (const season of seasons) {
  const list = seasonsBySeries.get(String(season.series_id)) || [];
  list.push(season);
  seasonsBySeries.set(String(season.series_id), list);
}

const checks = [];

// Every published movie is checked through the production Playback Broker.
for (const movie of movies) {
  checks.push({
    kind: "movie",
    id: String(movie.id),
    title: movie.title_en || movie.title_ar || String(movie.tmdb_id || ""),
  });
}

// Every published series gets a representative first episode from its first available season.
// This validates the shared series/episode architecture for every show without hammering Akwam
// with all 140k episode rows. Individual episodes still resolve dynamically through the same path.
for (const show of series) {
  const list = [...(seasonsBySeries.get(String(show.id)) || [])].sort(
    (a, b) => Number(a.season_number || 0) - Number(b.season_number || 0),
  );
  const season = list.find((candidate) => firstEpisodeBySeason.has(String(candidate.id)));
  if (!season) continue;
  const episode = firstEpisodeBySeason.get(String(season.id));
  checks.push({
    kind: "episode",
    id: String(episode.id),
    title: show.title_en || show.title_ar || String(show.tmdb_id || ""),
    season: Number(season.season_number || 0),
    episode: Number(episode.episode_number || 0),
  });
}

const tasks = checks.filter((_, index) => shardFor(index) === SHARD_INDEX);

console.log(JSON.stringify({
  shard: SHARD_INDEX,
  shards: SHARD_COUNT,
  published_movies: movies.length,
  published_series: series.length,
  seasons: seasons.length,
  episodes: episodeRows.length,
  checks_total: checks.length,
  shard_tasks: tasks.length,
  concurrency: CONCURRENCY,
  execution: "production-playback-broker",
  architecture: "Cloudflare broker -> Railway resolver -> Akwam.ss -> Cloudflare relay",
}));

let done = 0;
const failures = [];
const startedAt = Date.now();

const results = await mapLimit(tasks, CONCURRENCY, async (task) => {
  const result = await checkTask(task);
  done += 1;

  if (done % 10 === 0 || !result.ok) {
    console.log(JSON.stringify({
      progress: done + "/" + tasks.length,
      kind: task.kind,
      title: task.title,
      season: task.season ?? null,
      episode: task.episode ?? null,
      ok: result.ok,
      sources: result.sources || 0,
      attempt: result.attempt || null,
      error: result.error || null,
    }));
  }

  if (!result.ok) {
    failures.push({
      kind: task.kind,
      id: task.id,
      title: task.title,
      season: task.season ?? null,
      episode: task.episode ?? null,
      error: result.error,
    });
  }
  return result;
});

const succeeded = results.filter((x) => x?.ok).length;
const summary = {
  shard: SHARD_INDEX,
  shards: SHARD_COUNT,
  checks_total: checks.length,
  shard_tasks: tasks.length,
  succeeded,
  failed: failures.length,
  elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
  failures: failures.slice(0, 100),
};

console.log("CATALOG_PLAYBACK_VERIFY_SUMMARY=" + JSON.stringify(summary));
if (failures.length) process.exitCode = 1;

#!/usr/bin/env node

import { resolveAkwamWithContext } from "../workers/akwam-prefill/src/index.ts";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_ROLE = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const AKWAM_BASE_URL = "https://akwam.ss";
const SHARD_INDEX = Number(process.env.SHARD_INDEX || 0);
const SHARD_COUNT = Number(process.env.SHARD_COUNT || 1);
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.RESOLVER_CONCURRENCY || 4)));
const RETRIES = Math.max(1, Math.min(6, Number(process.env.RESOLVER_RETRIES || 3)));
const TIMEOUT_MS = Math.max(15_000, Number(process.env.RESOLVER_TIMEOUT_MS || 45_000));

if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
if (!Number.isInteger(SHARD_INDEX) || SHARD_INDEX < 0 || SHARD_INDEX >= SHARD_COUNT) {
  throw new Error("Invalid shard configuration");
}

const env = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
  AKWAM_BASE_URL,
  MAX_JOBS_PER_RUN: "1",
  PREFILL_CONCURRENCY: "1",
};

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
    if (!response.ok) {
      throw new Error("Supabase " + response.status + ": " + text.slice(0, 700));
    }
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
    const rows = await supabaseJson(path, {
      [key]: inFilter(chunk),
      ...extra,
    });
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

function playableSources(media) {
  return Array.isArray(media) && media.some((source) =>
    source &&
    /^https:\/\//i.test(String(source.url || "")) &&
    ["mp4", "hls", "dash", "webm", "direct"].includes(String(source.type || "").toLowerCase()),
  );
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

async function resolveTask(task) {
  let lastError = null;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const media = await resolveAkwamWithContext(
        env,
        {
          content_type: task.kind,
          content_id: task.id,
          season_number: task.seasonNumber,
          episode_number: task.episodeNumber,
        },
        task.context,
      );
      if (!playableSources(media)) throw new Error("Resolver returned no playable source");
      return { ok: true, attempt, sourceCount: media.length };
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await sleep(Math.min(10_000, 1200 * 2 ** (attempt - 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: String(lastError?.message || lastError) };
}

const movies = await supabaseJson("/rest/v1/movies", {
  select: "id,tmdb_id,title_en,title_ar,original_title,alternative_titles,release_date,created_at,status",
  status: "eq.published",
  order: "created_at.desc",
  limit: "100",
});

const series = await supabaseJson("/rest/v1/series", {
  select: "id,tmdb_id,title_en,title_ar,original_title,alternative_titles,created_at,status",
  status: "eq.published",
  order: "created_at.desc",
  limit: "100",
});

if (!Array.isArray(movies) || movies.length !== 100) {
  throw new Error("Expected 100 recent movies, got " + (movies?.length || 0));
}
if (!Array.isArray(series) || series.length !== 100) {
  throw new Error("Expected 100 recent series, got " + (series?.length || 0));
}

const seriesIds = series.map((row) => row.id);
const seasons = await fetchChunked("/rest/v1/seasons", "series_id", seriesIds, {
  select: "id,series_id,season_number",
  order: "season_number.asc",
});

const seasonIds = seasons.map((row) => row.id);
const episodes = [];
for (let i = 0; i < seasonIds.length; i += 60) {
  const rows = await supabaseJson("/rest/v1/episodes", {
    select: "id,season_id,tmdb_id,episode_number,name_en,name_ar",
    season_id: inFilter(seasonIds.slice(i, i + 60)),
    order: "episode_number.asc",
    limit: "10000",
  });
  if (Array.isArray(rows)) episodes.push(...rows);
}

const seriesMap = new Map(series.map((row) => [row.id, row]));
const seasonMap = new Map(seasons.map((row) => [row.id, row]));

const episodeTasks = episodes.map((episode) => {
  const season = seasonMap.get(episode.season_id);
  const show = season ? seriesMap.get(season.series_id) : null;
  if (!season || !show) return null;
  return {
    kind: "episode",
    id: episode.id,
    seriesId: show.id,
    seriesTitle: show.title_en || show.title_ar || String(show.tmdb_id || ""),
    seasonNumber: Number(season.season_number || 0),
    episodeNumber: Number(episode.episode_number || 0),
    title: episode.name_en || episode.name_ar || ("Episode " + episode.episode_number),
    context: {
      titles: titleList(show),
      seasonNumber: Number(season.season_number || 0),
      episodeNumber: Number(episode.episode_number || 0),
    },
  };
}).filter(Boolean);

const movieTasks = movies.map((movie) => ({
  kind: "movie",
  id: movie.id,
  title: movie.title_en || movie.title_ar || String(movie.tmdb_id || ""),
  context: {
    titles: titleList(movie),
    year: typeof movie.release_date === "string"
      ? Number(movie.release_date.slice(0, 4)) || undefined
      : undefined,
  },
}));

if (episodeTasks.length === 0) throw new Error("No episodes found for the recent 100 series");

const seriesTaskCounts = new Map();
for (const task of episodeTasks) {
  seriesTaskCounts.set(task.seriesId, (seriesTaskCounts.get(task.seriesId) || 0) + 1);
}

const shardLoads = Array.from({ length: SHARD_COUNT }, () => 0);
const seriesShard = new Map();
const seriesByLoad = [...seriesTaskCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [seriesId, count] of seriesByLoad) {
  let target = 0;
  for (let i = 1; i < SHARD_COUNT; i++) {
    if (shardLoads[i] < shardLoads[target]) target = i;
  }
  seriesShard.set(seriesId, target);
  shardLoads[target] += count;
}

const movieShard = (index) => index % SHARD_COUNT;
const tasks = [
  ...movieTasks.filter((_, index) => movieShard(index) === SHARD_INDEX),
  ...episodeTasks.filter((task) => seriesShard.get(task.seriesId) === SHARD_INDEX),
];

console.log(JSON.stringify({
  shard: SHARD_INDEX,
  shards: SHARD_COUNT,
  recent_movies: movies.length,
  recent_series: series.length,
  seasons: seasons.length,
  episodes: episodeTasks.length,
  total_tasks: movieTasks.length + episodeTasks.length,
  shard_tasks: tasks.length,
  concurrency: CONCURRENCY,
  execution: "direct-current-resolver-with-preloaded-context",
  series_grouped: true,
  planned_shard_loads: shardLoads,
}));

let done = 0;
const failures = [];
const startedAt = Date.now();

const results = await mapLimit(tasks, CONCURRENCY, async (task) => {
  const result = await resolveTask(task);
  done += 1;

  if (done % 20 === 0 || !result.ok) {
    console.log(JSON.stringify({
      progress: done + "/" + tasks.length,
      kind: task.kind,
      series: task.seriesTitle || null,
      title: task.title,
      season: task.seasonNumber || null,
      episode: task.episodeNumber || null,
      ok: result.ok,
      sourceCount: result.sourceCount || 0,
      attempt: result.attempt || null,
      error: result.error || null,
    }));
  }

  if (!result.ok) failures.push({
    id: task.id,
    kind: task.kind,
    series: task.seriesTitle || null,
    title: task.title,
    season: task.seasonNumber || null,
    episode: task.episodeNumber || null,
    error: result.error,
  });

  return result;
});

const succeeded = results.filter((result) => result?.ok).length;
const summary = {
  shard: SHARD_INDEX,
  shards: SHARD_COUNT,
  recent_movies: movies.length,
  recent_series: series.length,
  seasons: seasons.length,
  episodes: episodeTasks.length,
  total_tasks: tasks.length,
  succeeded,
  failed: failures.length,
  elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
  failures: failures.slice(0, 100),
};

console.log("VERIFY_SUMMARY=" + JSON.stringify(summary));
if (failures.length) process.exitCode = 1;

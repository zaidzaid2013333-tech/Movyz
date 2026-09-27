/**
 * Movyz Watch API — Cloudflare Worker
 *
 * Public surface:
 *   GET  /health
 *   POST /watch/movie
 *   POST /watch/episode
 *
 * TMDB remains the metadata/catalog source.
 * AbdoBest is used only internally to resolve playable sources.
 */

const ABDOBEST_API_BASES = [
  "https://ogkushhh-abdobest-api.hf.space",
  "https://ogkushhh-abdobest.hf.space",
];
const TIMEOUT_MS = 120_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "Content-Type, Content-Length",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function detectStreamType(url) {
  const value = String(url || '').toLowerCase();
  if (value.includes('.m3u8')) return 'hls';
  if (value.includes('.mpd')) return 'dash';
  if (value.includes('.webm')) return 'webm';
  return 'mp4';
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTitle(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  for (const key of ["results", "items", "data", "movies", "series", "episodes"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  return Object.values(payload).filter((value) => value && typeof value === "object");
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractTmdbId(item) {
  return firstNumber(
    item?.["TMDb ID"],
    item?.tmdb_id,
    item?.tmdbId,
    item?.tmdb,
    item?.themoviedb_id,
    item?.themoviedbId,
  );
}

function extractTitle(item) {
  return firstString(
    item?.Title,
    item?.title,
    item?.name,
    item?.original_title,
    item?.original_name,
  );
}

function extractYear(item) {
  const raw = firstString(
    item?.Year,
    item?.year,
    item?.release_date,
    item?.first_air_date,
  );
  if (!raw) return null;
  const match = raw.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function extractCategory(item) {
  return firstString(
    item?.Category,
    item?.category,
    item?.type,
    item?.content_type,
  ).toLowerCase();
}

function extractSourceUrls(item) {
  const candidates = [];
  const seen = new Set();

  const add = (value, priority = 0) => {
    if (typeof value !== "string") return;
    const url = value.trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    const lower = url.toLowerCase();
    if (/\.(?:jpg|jpeg|png|gif|webp|svg)(?:[?#]|$)/i.test(lower)) return;
    if (/^(?:https?:\/\/)?(?:image\.tmdb\.org|images\.|cdn\.jsdelivr\.net)/i.test(lower)) return;

    // AbdoBest documents Sources[] as pre-scraped server-page URLs
    // (video_player?player_token=...), which should outrank legacy pages.
    let effectivePriority = priority;
  return /player_token=/i.test(String(url || "")) || /video_player(?:\?|\/)/i.test(String(url || ""));
    if (/https?:\/\/[^/]*akwam\.it\/watch\//i.test(lower)) effectivePriority += 180;

    seen.add(url);
    candidates.push({ url, priority: effectivePriority });
  };

  const visit = (value, key = "", depth = 0) => {
    if (depth > 6 || value == null) return;

    if (typeof value === "string") {
      const keyScore = /watch|stream|source|video|player|page|link|url|href/i.test(key) ? 50 : 0;
      add(value, keyScore);
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, key, depth + 1);
      return;
    }

    if (typeof value !== "object") return;

    for (const [childKey, childValue] of Object.entries(value)) {
      visit(childValue, childKey, depth + 1);
    }
  };

  // Prefer AbdoBest's pre-scraped Sources/Links collections first.
  for (const value of [item?.Sources, item?.sources, item?.Links, item?.links]) {
    visit(value, "source", 140);
  }

  // Keep legacy single-source fields as fallbacks.
  for (const key of [
    "Source", "source", "source_url", "SourceUrl", "sourceUrl",
    "URL", "Url", "url", "page_url", "pageUrl", "watch_url", "watchUrl",
    "link", "Link", "href", "player", "player_url", "playerUrl",
  ]) {
    add(item?.[key], 60);
  }

  visit(item, "", 0);

  return [...new Map(
    candidates
      .sort((a, b) => b.priority - a.priority)
      .map((entry) => [entry.url, entry.url]),
  ).values()];
}

function scoreMatch(item, input) {
  const wantedTmdb = Number(input.tmdb_id ?? input.tmdbId);
  const itemTmdb = extractTmdbId(item);

  if (
    Number.isFinite(wantedTmdb) &&
    Number.isFinite(itemTmdb) &&
    wantedTmdb === itemTmdb
  ) {
    return 100;
  }

  const wanted = normalizeTitle(input.title);
  const actual = normalizeTitle(extractTitle(item));
  if (!wanted || !actual) return 0;

  let score = 0;
  if (wanted === actual) score += 70;
  else if (actual.includes(wanted) || wanted.includes(actual)) score += 45;

  const wantedYear = Number(input.year);
  const actualYear = extractYear(item);

  if (Number.isFinite(wantedYear) && Number.isFinite(actualYear)) {
    if (wantedYear === actualYear) score += 20;
    else if (Math.abs(wantedYear - actualYear) <= 1) score += 5;
  }

  return score;
}

function chooseBestResult(payload, input) {
  const candidates = toArray(payload)
    .map((item) => ({ item, score: scoreMatch(item, input) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.item ?? null;
}

function walkObjects(value, visitor, depth = 0) {
  if (depth > 7 || value == null) return false;

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (walkObjects(entry, visitor, depth + 1)) return true;
    }
    return false;
  }

  if (typeof value !== "object") return false;

  if (visitor(value)) return true;

  for (const entry of Object.values(value)) {
    if (walkObjects(entry, visitor, depth + 1)) return true;
  }

  return false;
}

function episodeNumberOf(item) {
  return firstNumber(
    item?.episode_number,
    item?.episodeNumber,
    item?.episode,
    item?.number,
    item?.Episode,
    item?.ep,
  );
}

function seasonNumberOf(item) {
  return firstNumber(
    item?.season_number,
    item?.seasonNumber,
    item?.season,
    item?.Season,
  );
}

function episodeUrls(item) {
  const urls = [];

  for (const value of [
    item?.watch_url,
    item?.video_url,
    item?.stream_url,
    item?.url,
    item?.source,
    item?.page_url,
    item?.link,
  ]) {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      urls.push(value);
    }
  }

  if (Array.isArray(item?.Sources)) {
    for (const value of item.Sources) {
      if (typeof value === "string" && /^https?:\/\//i.test(value)) {
        urls.push(value);
      }
    }
  }

  return [...new Set(urls)];
}

function findEpisode(payload, wantedSeason, wantedEpisode) {
  const matches = [];

  walkObjects(payload, (item) => {
    const ep = episodeNumberOf(item);
    const season = seasonNumberOf(item);

    if (!Number.isFinite(ep) || ep !== wantedEpisode) return false;

    if (
      Number.isFinite(season) &&
      Number.isFinite(wantedSeason) &&
      season !== wantedSeason
    ) {
      return false;
    }

    const urls = episodeUrls(item);
    if (!urls.length && !Array.isArray(item?.sources)) return false;

    matches.push(item);
    return false;
  });

  return matches[0] ?? null;
}

async function upstream(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let lastError = null;

  try {
    const headers = new Headers(init.headers || {});
    headers.set(
      "Accept",
      headers.get("Accept") || "application/json, text/plain, */*",
    );

    for (const base of ABDOBEST_API_BASES) {
      try {
        const response = await fetch(base + path, {
          ...init,
          headers,
          signal: controller.signal,
          redirect: "follow",
        });

        if (response.ok || ![404, 429, 500, 502, 503, 504].includes(response.status)) {
          return response;
        }

        lastError = new Error(
          "AbdoBest upstream " + response.status + " at " + base + path,
        );
      } catch (error) {
        lastError = error instanceof Error
          ? error
          : new Error("AbdoBest upstream request failed");
      }
    }

    if (lastError) throw lastError;
    throw new Error("No AbdoBest upstream is configured");
  } finally {
    clearTimeout(timer);
  }
}

async function upstreamJson(path, init = {}) {
  const response = await upstream(path, init);
  const text = await response.text();

  let body = {};

  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return {
      response,
      body: null,
      raw: text,
      validJson: false,
    };
  }

  return {
    response,
    body,
    raw: text,
    validJson: true,
  };
}

function isPreScrapedPlayerUrl(url) {
  return /player_token=/i.test(String(url || "")) || /video_player(?:\\?|\\/)/i.test(String(url || ""));
}

async function browserExtractStream(pageUrl, env) {
  if (!env?.BROWSER) throw new Error("Browser Run binding unavailable");
  if (!isPreScrapedPlayerUrl(pageUrl)) {
    throw new Error("Browser extraction is only enabled for pre-scraped player URLs");
  }

  const { launch } = await import("@cloudflare/playwright");
  const browser = await launch(env.BROWSER);
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const urls = [];
  const add = (value) => {
    if (typeof value !== "string" || !/\.m3u8(?:$|[?#])/i.test(value)) return;
    if (!urls.includes(value)) urls.push(value);
  };

  page.on("request", (request) => add(request.url()));

  try {
    await page.goto(pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    await page.waitForTimeout(8_000);

    const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 1500);
    if (/turnstile|cloudflare|security check|verify you are human|إجراء التحقق من الأمان/i.test(bodyText)) {
      throw new Error("Pre-scraped player is blocked by a security challenge");
    }

    if (!urls.length) {
      throw new Error(
        "Pre-scraped player returned no HLS playlist; finalUrl=" + page.url(),
      );
    }

    return {
      url: urls[0],
      type: "hls",
      quality: "auto",
      qualities: ["Auto"],
      sources: urls.map((url) => ({
        quality: "auto",
        type: "hls",
        url,
      })),
      cached: false,
      via: "browser-run-pre-scraped",
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function extractStream(pageUrl, env) {
  const result = await upstreamJson("/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: pageUrl }),
  });

  if (!result.validJson) {
    if (isPreScrapedPlayerUrl(pageUrl)) return browserExtractStream(pageUrl, env);
    throw new Error(
      "AbdoBest extraction returned invalid JSON (HTTP " + result.response.status + ")",
    );
  }

  const videoUrl = firstString(
    result.body?.stream_url,
    result.body?.video_url,
    result.body?.url,
  );

  if (!result.response.ok || !videoUrl) {
    if (isPreScrapedPlayerUrl(pageUrl)) return browserExtractStream(pageUrl, env);
    const message =
      result.body?.error ||
      ("AbdoBest extraction failed with HTTP " + result.response.status);
    throw new Error(message);
  }

  const qualities = Array.isArray(result.body?.quality_options)
    ? result.body.quality_options.filter(Boolean)
    : [];

  return {
    url: videoUrl,
    type: detectStreamType(videoUrl),
    quality: qualities[0] || "auto",
    qualities,
    sources: [{
      quality: qualities[0] || "auto",
      type: detectStreamType(videoUrl),
      url: videoUrl,
    }],
    cached: result.body?.cached === true,
  };
}

async function findStoredMovieSources(payload) {
  const endpoints = [
    "/api/movies",
    "/api/dubbed-movies",
    "/api/hindi",
    "/api/asian-movies",
    "/api/sorted/movies",
    "/api/sorted/dubbed-movies",
    "/api/sorted/hindi",
    "/api/sorted/asian-movies",
  ];

  for (const endpoint of endpoints) {
    try {
      const result = await upstreamJson(endpoint);
      if (!result.validJson || !result.response.ok) continue;

      const match = chooseBestResult(result.body, payload);
      if (!match) continue;

      const sources = extractSourceUrls(match);
      if (sources.length) {
        return {
          match,
          sources,
        };
      }
    } catch {}
  }

  return null;
}

async function resolveMovie(payload, env) {
  const directSource = cleanText(payload?.source_url);

  if (directSource) {
    return extractStream(directSource, env);
  }

  const title = cleanText(payload?.title);
  if (!title) {
    throw new Error("title is required when source_url is omitted");
  }

  const search = await upstreamJson(
    "/api/search?q=" + encodeURIComponent(title),
  );

  if (!search.validJson || !search.response.ok) {
    throw new Error(
      search.body?.error ||
        `AbdoBest search failed with HTTP ${search.response?.status ?? 502}`,
    );
  }

  const match = chooseBestResult(search.body, payload);

  if (!match) {
    throw new Error("No AbdoBest source matched this TMDB title");
  }

  let sources = extractSourceUrls(match);

  // The search endpoint may return only {category,id,image,title}.
  // AbdoBest itself also keeps richer Source/Sources fields in /api/sorted/*.
  if (!sources.length) {
    const stored = await findStoredMovieSources(payload);
    if (stored) {
      sources = stored.sources;
    }
  }

  // Last resort: derive the source page from AbdoBest's stored content id.
  if (!sources.length) {
    const matchId = firstString(match?.id, match?.ID);
    const category = extractCategory(match);
    if (matchId && category !== "arabic-movies") {
      sources.push("https://www.fasel-hd.cam/?p=" + encodeURIComponent(matchId));
    }
  }

  if (!sources.length) {
    throw new Error("Matched title has no playable source page");
  }

  let lastError = null;

  for (const source of sources.slice(0, 3)) {
    try {
      const stream = await extractStream(source, env);
      return {
        ...stream,
        matched_title: extractTitle(match),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to resolve a playable movie stream");
}

async function resolveEpisode(payload, env) {
  const title = cleanText(payload?.title);
  const season = Number(payload?.season);
  const episode = Number(payload?.episode);

  if (!title) throw new Error("title is required");
  if (!Number.isInteger(season) || season < 0) {
    throw new Error("season must be a valid integer");
  }
  if (!Number.isInteger(episode) || episode < 1) {
    throw new Error("episode must be a valid integer");
  }

  const search = await upstreamJson(
    "/api/search?q=" + encodeURIComponent(title),
  );

  if (!search.validJson || !search.response.ok) {
    throw new Error(
      search.body?.error ||
        `AbdoBest search failed with HTTP ${search.response?.status ?? 502}`,
    );
  }

  const match = chooseBestResult(search.body, payload);

  if (!match) {
    throw new Error("No AbdoBest series matched this TMDB title");
  }

  const category = extractCategory(match) || "series";
  const id = firstString(match?.id, match?.ID);

  if (!id) {
    throw new Error("Matched series has no source ID");
  }

  const episodicPath =
    category === "arabic-series"
      ? `/api/arabic-series/episodes/${encodeURIComponent(id)}`
      : `/api/episodes/${encodeURIComponent(category)}/${encodeURIComponent(id)}`;

  const episodes = await upstreamJson(episodicPath);

  if (!episodes.validJson || !episodes.response.ok) {
    throw new Error(
      episodes.body?.error ||
        `AbdoBest episode lookup failed with HTTP ${episodes.response?.status ?? 502}`,
    );
  }

  const found = findEpisode(episodes.body, season, episode);

  if (!found) {
    throw new Error(`Episode S${season}E${episode} was not found`);
  }

  // Arabic-series can expose direct quality URLs.
  if (Array.isArray(found.sources) && found.sources.length) {
    const directSources = found.sources
      .map((source) => ({
        quality: firstString(source?.quality),
        url: firstString(
          source?.watch_url,
          source?.video_url,
          source?.stream_url,
        ),
      }))
      .filter((source) => source.url);

    if (directSources.length) {
      return {
        url: directSources[0].url,
        type: detectStreamType(directSources[0].url),
        quality: directSources[0].quality || 'auto',
        qualities: directSources.map((source) => source.quality).filter(Boolean),
        sources: directSources.map((source) => ({
          ...source,
          type: detectStreamType(source.url),
        })),
        cached: true,
        matched_title: extractTitle(match),
      };
    }
  }

  const urls = episodeUrls(found);

  if (!urls.length) {
    throw new Error("Episode has no playable source URL");
  }

  let lastError = null;

  for (const source of urls.slice(0, 3)) {
    try {
      const stream = await extractStream(source, env);
      return {
        ...stream,
        matched_title: extractTitle(match),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to resolve a playable episode stream");
}

async function parseJsonRequest(request) {
  try {
    const payload = await request.json();

    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "JSON object required" };
    }

    return { ok: true, payload };
  } catch {
    return { ok: false, error: "Valid JSON body required" };
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (request.method === "GET" && path === "/") {
        return json({
          api: "Movyz Watch API",
          version: "2.0.0",
          provider: "AbdoBest",
          metadata: "TMDB",
          endpoints: {
            health: "GET /health",
            movie: "POST /watch/movie",
            episode: "POST /watch/episode",
          },
        });
      }

      if (request.method === "GET" && path === "/health") {
        const result = await upstreamJson("/health", { method: "GET" });

        return json(
          {
            ok: result.response.ok,
            provider: "AbdoBest",
            upstream_status: result.response.status,
            ...(result.validJson &&
            result.body &&
            typeof result.body === "object"
              ? result.body
              : {}),
          },
          result.response.ok ? 200 : 502,
        );
      }

      if (request.method === "POST" && path === "/watch/movie") {
        const parsed = await parseJsonRequest(request);
        if (!parsed.ok) return json({ error: parsed.error }, 400);

        const payload = parsed.payload;
        const tmdbId = firstNumber(payload.tmdb_id, payload.tmdbId);
        const stream = await resolveMovie(payload, env);

        return json({
          ok: true,
          type: "movie",
          tmdb_id: Number.isFinite(tmdbId) ? tmdbId : null,
          stream,
        });
      }

      if (request.method === "POST" && path === "/watch/episode") {
        const parsed = await parseJsonRequest(request);
        if (!parsed.ok) return json({ error: parsed.error }, 400);

        const payload = parsed.payload;
        const tmdbId = firstNumber(payload.tmdb_id, payload.tmdbId);
        const season = Number(payload.season);
        const episode = Number(payload.episode);
        const stream = await resolveEpisode(payload, env);

        return json({
          ok: true,
          type: "episode",
          tmdb_id: Number.isFinite(tmdbId) ? tmdbId : null,
          season,
          episode,
          stream,
        });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Watch API error";

      console.error("Movyz Watch API failed", path, message);

      return json(
        {
          ok: false,
          error: message,
          provider: "AbdoBest",
        },
        502,
      );
    }
  },
};

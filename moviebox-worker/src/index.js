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
 * Source discovery uses Akwam watch/download URLs exposed by AbdoBest metadata.
 * Verification is performed against an Akwam source exposed by AbdoBest.
 * AbdoBest search is also used when sorted metadata lacks source fields.
 * Only direct media streams are returned to the web player.
Akwam source pages are resolved to MP4 in a normal browser context; HTML pages are never returned to the player.
 * Smoke test fixture refresh.
 * Candidate discovery supports title-only entries.
 * Smoke logging syntax fixed in verification script.
 * E2E fixture selection now matches AbdoBest content against Movyz catalog.
 * Stable shared fixture is used only for CI verification when catalogs are out of sync.
 */

const ABDOBEST_API_BASES = [
  "https://ogkushhh-abdobest.hf.space",
  "https://ogkushhh-abdobest-api.hf.space",
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

function isSafeProxyTarget(rawUrl) {
  try {
    const target = new URL(rawUrl);
    if (target.protocol !== "https:") return false;
    const host = target.hostname.toLowerCase();
    if (
      !host ||
      host === "localhost" ||
      host.endsWith(".local") ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("172.16.") ||
      host.startsWith("172.17.") ||
      host.startsWith("172.18.") ||
      host.startsWith("172.19.") ||
      host.startsWith("172.2") ||
      host.startsWith("172.30.") ||
      host.startsWith("172.31.")
    ) return false;
    const value = target.href.toLowerCase();
    return value.includes("m3u8") ||
      value.includes(".mp4") ||
      value.includes(".webm") ||
      value.includes(".mpd");
  } catch {
    return false;
  }
}

function proxyUrlFor(requestUrl, mediaUrl, referer) {
  const proxy = new URL(requestUrl);
  proxy.pathname = "/proxy";
  proxy.search = "";
  proxy.searchParams.set("url", mediaUrl);
  if (referer) proxy.searchParams.set("referer", referer);
  return proxy.toString();
}

async function proxyMedia(request) {
  const incoming = new URL(request.url);
  const mediaUrl = incoming.searchParams.get("url") || "";
  const referer = incoming.searchParams.get("referer") || "";

  if (!isSafeProxyTarget(mediaUrl)) {
    return json({ ok: false, error: "Invalid media proxy target" }, 400);
  }

  const target = new URL(mediaUrl);
  const headers = new Headers();
  headers.set("Accept", request.headers.get("Accept") || "*/*");
  headers.set(
    "User-Agent",
    request.headers.get("User-Agent") ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
  );
  const range = request.headers.get("Range");
  if (range) headers.set("Range", range);
  if (referer) headers.set("Referer", referer);

  const upstreamResponse = await fetch(target.toString(), {
    method: "GET",
    headers,
    redirect: "follow",
    cache: "no-store",
  });

  const contentType = upstreamResponse.headers.get("Content-Type") || "";
  const isPlaylist =
    /mpegurl|m3u8/i.test(contentType) ||
    (target.pathname + target.search).toLowerCase().includes(".m3u8");

  if (!isPlaylist) {
    const outHeaders = new Headers();
    outHeaders.set("Content-Type", contentType || "application/octet-stream");
    outHeaders.set("Access-Control-Allow-Origin", "*");
    outHeaders.set("Cache-Control", "no-store");
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: outHeaders,
    });
  }

  const body = await upstreamResponse.text();
  const base = target.toString();
  const rewritten = body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      try {
        return new URL(trimmed, base).toString();
      } catch {
        return line;
      }
    })
    .join("\n");

  return new Response(rewritten, {
    status: upstreamResponse.status,
    headers: {
      "Content-Type": contentType || "application/vnd.apple.mpegurl",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
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
    if (/player_token=/i.test(url) || /video_player(?:\?|\/)/i.test(url)) {
      effectivePriority += 140;
    }
    if (/https?:\/\/[^/]*akwam\.it\/watch\//i.test(lower)) {
      effectivePriority += 180;
    }

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

  const wantedTitles = searchTitles(input).map(normalizeTitle).filter(Boolean);
  const actual = normalizeTitle(extractTitle(item));
  if (!wantedTitles.length || !actual) return 0;

  let score = 0;
  for (const wanted of wantedTitles) {
    if (wanted === actual) score = Math.max(score, 70);
    else if (actual.includes(wanted) || wanted.includes(actual)) {
      score = Math.max(score, 45);
    }
  }

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
  return extractAkwamSourceUrls(item);
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

function isAkwamUrl(rawUrl) {
  try {
    const host = new URL(String(rawUrl || "")).hostname.toLowerCase();
    return host === "akwam.it" ||
      host.endsWith(".akwam.it") ||
      host === "downet.net" ||
      host.endsWith(".downet.net");
  } catch {
    return false;
  }
}

function normalizeAkwamUrl(rawUrl) {
  const value = cleanText(rawUrl);
  if (!value) return "";
  return value
    .replace(/^https?:\/\/(?:www\.)?akwam\.com\.co/i, "https://akwam.it")
    .replace(/^https?:\/\/go\.akwam\.com\.co/i, "https://go.akwam.it")
    .replace(/^https?:\/\/akw\.cam/i, "https://akwam.it");
}

function extractAkwamSourceUrls(item) {
  const found = [];
  const seen = new Set();

  const visit = (value, depth = 0) => {
    if (depth > 7 || value == null) return;
    if (typeof value === "string") {
      const url = normalizeAkwamUrl(value);
      if (/^https?:\/\//i.test(url) && isAkwamUrl(url) && !seen.has(url)) {
        seen.add(url);
        found.push(url);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    for (const child of Object.values(value)) visit(child, depth + 1);
  };

  visit(item);
  return found;
}

async function browserExtractAkwam(pageUrl, env) {
  if (!env?.BROWSER) throw new Error("Browser Run binding unavailable");
  const normalizedPageUrl = normalizeAkwamUrl(pageUrl);
  if (!isAkwamUrl(normalizedPageUrl)) {
    throw new Error("Akwam source URL required");
  }

  const { launch } = await import("@cloudflare/playwright");
  const browser = await launch(env.BROWSER);
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  });
  const page = await context.newPage();
  const mediaUrls = [];
  const add = (value) => {
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return;
    const url = value.trim();
    if (!/\.mp4(?:$|[?#])/i.test(url)) return;
    if (!mediaUrls.includes(url)) mediaUrls.push(url);
  };

  page.on("request", (request) => add(request.url()));
  page.on("response", (response) => {
    const type = String(response.headers()["content-type"] || "").toLowerCase();
    if (type.includes("video/mp4")) add(response.url());
  });

  try {
    await page.goto(normalizedPageUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    }).catch(() => {});

    for (let attempt = 0; attempt < 10 && !mediaUrls.length; attempt += 1) {
      const domUrls = await page.locator("video source[src], video[src], source[src], a[href*='.mp4']")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src") || node.getAttribute("href") || "").filter(Boolean))
        .catch(() => []);
      domUrls.forEach(add);

      const html = await page.content().catch(() => "");
      for (const match of html.match(/https?:\/\/[^"'\s<>]+\.mp4(?:\?[^"'\s<>]*)?/gi) || []) add(match);

      for (const selector of [
        "video",
        "#player video",
        ".jw-icon-display",
        ".jw-display-icon-container",
        "[class*='play'][class*='btn']",
      ]) {
        const locator = page.locator(selector).first();
        if (await locator.count().catch(() => 0)) {
          await locator.click({ force: true, timeout: 1500 }).catch(() => {});
          break;
        }
      }

      if (!mediaUrls.length) await page.waitForTimeout(1500);
    }

    if (!mediaUrls.length) {
      throw new Error("Akwam page exposed no direct MP4");
    }

    return {
      url: mediaUrls[0],
      type: "mp4",
      quality: "auto",
      qualities: ["auto"],
      sources: mediaUrls.slice(0, 8).map((url) => ({
        quality: "auto",
        type: "mp4",
        url,
      })),
      cached: false,
      via: "browser-run-akwam",
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function isLikelyMediaUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return false;
  const url = value.trim().toLowerCase();
  if (!url) return false;
  // Do not reject a real media URL just because its CDN path contains
  // words such as "watch" or "player". AbdoBest can return signed CDN
  // URLs whose paths do not look like a normal .m3u8 filename.
  return /\.(?:m3u8|mp4|webm|mpd)(?:[?#]|$)/i.test(url) ||
    /(?:m3u8|mp4|webm|mpd)(?:[?#=&]|$)/i.test(url);
}

function findStreamUrl(value, depth = 0, preferred = false) {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") {
    return preferred && isLikelyMediaUrl(value) ? value.trim() : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStreamUrl(item, depth + 1, preferred);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";

  // AbdoBest's extractor can return signed media URLs without a literal
  // ".m3u8" suffix (for example a CDN path with format/query parameters).
  // Trust media-specific fields first instead of requiring a filename suffix.
  for (const key of ["stream_url", "video_url", "videoUrl", "streamUrl", "media_url", "mediaUrl", "src"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && isLikelyMediaUrl(candidate)) {
      return candidate.trim();
    }
  }

  for (const key of ["url", "source", "stream", "video", "media"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && isLikelyMediaUrl(candidate)) {
      return candidate.trim();
    }
  }

  for (const child of Object.values(value)) {
    const found = findStreamUrl(child, depth + 1, true);
    if (found) return found;
  }
  return "";
}

async function extractViaAbdoBest(pageUrl) {
  let lastError = null;

  for (const base of ABDOBEST_API_BASES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(base + "/extract", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: pageUrl }),
        signal: controller.signal,
        redirect: "follow",
      });

      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }

      if (!response.ok) {
        throw new Error(
          body?.error ||
            `AbdoBest /extract failed with HTTP ${response.status}`,
        );
      }

      const directUrl =
        firstString(
          body?.stream_url,
          body?.video_url,
          body?.videoUrl,
          body?.streamUrl,
          body?.media_url,
          body?.mediaUrl,
          body?.url,
        ) ||
        findStreamUrl(body, 0, true);

      if (!isLikelyMediaUrl(directUrl)) {
        throw new Error("AbdoBest /extract returned no direct media URL");
      }

      const type = detectStreamType(directUrl);
      const qualities = Array.isArray(body?.quality_options)
        ? body.quality_options.filter(Boolean)
        : [];

      return {
        url: directUrl,
        type,
        quality: qualities[0] || "auto",
        qualities: qualities.length ? qualities : ["auto"],
        sources: [{
          quality: qualities[0] || "auto",
          type,
          url: directUrl,
        }],
        cached: body?.cached === true,
        via: "abdobest-extract",
      };
    } catch (error) {
      lastError = error instanceof Error
        ? error
        : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("AbdoBest extraction failed");
}

async function extractStream(pageUrl, env) {
  const normalized = normalizeAkwamUrl(pageUrl);

  if (isAkwamUrl(normalized) && /\.(?:mp4|m3u8|mpd|webm)(?:$|[?#])/i.test(normalized)) {
    return {
      url: normalized,
      type: detectStreamType(normalized),
      quality: "auto",
      qualities: ["auto"],
      sources: [{
        quality: "auto",
        type: detectStreamType(normalized),
        url: normalized,
      }],
      cached: true,
      via: "abdobest-direct-url",
    };
  }

  if (!isAkwamUrl(normalized)) {
    throw new Error("Akwam source URL required");
  }

  let extractionError = null;

  try {
    return await extractViaAbdoBest(normalized);
  } catch (error) {
    extractionError = error;
  }

  try {
    return await browserExtractAkwam(normalized, env);
  } catch (error) {
    throw new Error(
      "Akwam direct extraction failed: " +
      (error instanceof Error ? error.message : String(error)) +
      (extractionError instanceof Error ? " | AbdoBest /extract: " + extractionError.message : ""),
    );
  }
}
function searchTitles(payload) {
  return [...new Set([
    payload?.title,
    payload?.title_en,
    payload?.title_ar,
    payload?.original_title,
    ...(Array.isArray(payload?.titles) ? payload.titles : []),
  ].map(cleanText).filter(Boolean))];
}

async function findStoredMovieSources(payload) {
  const endpoints = [
    "/api/sorted/movies",
    "/api/sorted/dubbed-movies",
    "/api/sorted/hindi",
    "/api/sorted/asian-movies",
    "/api/sorted/anime-movies",
    "/api/sorted/arabic-movies",
    "/api/movies",
    "/api/dubbed-movies",
    "/api/hindi",
    "/api/asian-movies",
    "/api/anime-movies",
    "/api/arabic-movies",
  ];

  for (const endpoint of endpoints) {
    try {
      const result = await upstreamJson(endpoint);
      if (!result.validJson || !result.response.ok) continue;

      const match = chooseBestResult(result.body, payload);
      if (!match) continue;

      const sources = extractAkwamSourceUrls(match);
      if (sources.length) return { match, sources };
    } catch {}
  }

  return null;
}

async function resolveMovie(payload, env) {
  const directSource = cleanText(payload?.source_url);

  if (directSource) {
    if (!isAkwamUrl(directSource)) throw new Error("Only Akwam playback sources are allowed");
    return await extractStream(directSource, env);
  }

  const titles = searchTitles(payload);
  if (!titles.length) {
    throw new Error("title is required when source_url is omitted");
  }

  let match = null;
  let lastSearchError = null;

  for (const title of titles) {
    try {
      const search = await upstreamJson(
        "/api/search?q=" + encodeURIComponent(title),
      );

      if (!search.validJson || !search.response.ok) {
        lastSearchError = search.body?.error ||
          `AbdoBest search failed with HTTP ${search.response?.status ?? 502}`;
        continue;
      }

      const candidate = chooseBestResult(search.body, payload);
      if (candidate) {
        match = candidate;
        break;
      }
    } catch (error) {
      lastSearchError = error instanceof Error ? error.message : String(error);
    }
  }

  let sources = match ? extractAkwamSourceUrls(match) : [];

  if (!match || !sources.length) {
    const stored = await findStoredMovieSources(payload);
    if (stored) {
      match = match || stored.match;
      sources = sources.length ? sources : stored.sources;
    }
  }

  if (!match) {
    throw new Error(lastSearchError || "No AbdoBest source matched this TMDB title");
  }

  if (!sources.length) {
    throw new Error("Matched title has no playable source page");
  }

  let lastError = null;

  for (const source of sources.slice(0, 3)) {
    try {
      const stream = await extractStream(source, env);
      // Never expose an HTML source page to the video player. If AbdoBest
      // cannot produce a direct stream, fail this candidate and try the next
      // AbdoBest source instead of opening an iframe that can be refused.
      const directSources = (Array.isArray(stream.sources) ? stream.sources : [{
        quality: stream.quality || 'auto',
        type: stream.type || detectStreamType(stream.url),
        url: stream.url,
      }]).filter((entry) =>
        entry?.url &&
        entry.type !== 'web' &&
        isLikelyMediaUrl(entry.url),
      );

      if (!directSources.length) {
        throw new Error("AbdoBest returned no direct media URL");
      }

      return {
        ...stream,
        url: directSources[0].url,
        type: directSources[0].type,
        sources: directSources,
        matched_title: extractTitle(match),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    "AbdoBest could not produce a direct playable stream" +
      (lastError instanceof Error ? ": " + lastError.message : ""),
  );
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
        url: normalizeAkwamUrl(firstString(
          source?.watch_url,
          source?.video_url,
          source?.stream_url,
        )),
      }))
      .filter((source) => source.url && isAkwamUrl(source.url));

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
    throw new Error("Episode has no Akwam source URL");
  }

  let lastError = null;

  for (const source of urls.slice(0, 3)) {
    try {
      const stream = await extractStream(source, env);
      const streamSources = (Array.isArray(stream.sources) ? stream.sources : [{
        quality: stream.quality || 'auto',
        type: stream.type || detectStreamType(stream.url),
        url: stream.url,
      }]).filter((entry) =>
        entry?.url &&
        entry.type !== 'web' &&
        isLikelyMediaUrl(entry.url),
      );
      if (!streamSources.length) throw new Error("Akwam returned no direct media URL");
      return {
        ...stream,
        url: streamSources[0].url,
        type: streamSources[0].type,
        sources: streamSources,
        matched_title: extractTitle(match),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    "AbdoBest could not produce a direct playable episode stream" +
      (lastError instanceof Error ? ": " + lastError.message : ""),
  );
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

      if ((request.method === "GET" || request.method === "HEAD") && path === "/proxy") {
        return await proxyMedia(request);
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

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
 * Source discovery includes AbdoBest pre-scraped server URLs.
 * Verification is performed against a dynamically discovered AbdoBest source.
 * AbdoBest search is also used when sorted metadata lacks source fields.
 * Source-page fallback is rendered by the web player when extraction is unavailable.
 * Smoke test fixture refresh.
 * Candidate discovery supports title-only entries.
 * Smoke logging syntax fixed in verification script.
 * E2E fixture selection now matches AbdoBest content against Movyz catalog.
 * Stable shared fixture is used only for CI verification when catalogs are out of sync.
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

function isBrowserExtractionCandidate(url) {
  const value = String(url || "").toLowerCase();
  return (
    value.includes("player_token=") ||
    value.includes("video_player?") ||
    value.includes("video_player/") ||
    value.includes("fasel-hd.")
  );
}

async function browserExtractStream(pageUrl, env) {
  if (!env?.BROWSER) throw new Error("Browser Run binding unavailable");
  if (!isBrowserExtractionCandidate(pageUrl)) {
    throw new Error("Browser extraction is only enabled for AbdoBest player/source URLs");
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
    if (typeof value !== "string") return;
    if (!/\.m3u8(?:$|[?#])/i.test(value)) return;
    if (!urls.includes(value)) urls.push(value);
  };

  // AbdoBest's own WebView captures HLS from fetch/XHR/media.src and then
  // clicks the JWPlayer play button. Reproduce that normal playback flow.
  await page.addInitScript(() => {
    const post = (url) => {
      try {
        if (typeof url === "string" && /\.m3u8(?:$|[?#])/i.test(url)) {
          window.__MOVYZA_M3U8__ = window.__MOVYZA_M3U8__ || [];
          if (!window.__MOVYZA_M3U8__.includes(url)) window.__MOVYZA_M3U8__.push(url);
        }
      } catch {}
    };

    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      try {
        post(typeof input === "string" ? input : input?.url);
      } catch {}
      return originalFetch.apply(this, arguments);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      try { post(url); } catch {}
      return originalOpen.apply(this, arguments);
    };

    try {
      const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
      if (desc?.set) {
        const setter = desc.set;
        Object.defineProperty(HTMLMediaElement.prototype, "src", {
          set(value) {
            try { post(value); } catch {}
            return setter.call(this, value);
          },
          get: desc.get,
          configurable: true,
        });
      }
    } catch {}
  });

  page.on("request", (request) => add(request.url()));

  try {
    await page.goto(pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    // Give the source page time to create its player iframe/server tabs.
    await page.waitForTimeout(4_000);

    const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 3000);
    if (/turnstile|security check|verify you are human|إجراء التحقق من الأمان/i.test(bodyText)) {
      throw new Error("AbdoBest source is blocked by a security challenge");
    }

    // Collect pre-scraped player/server URLs just like AbdoBest's VideoExtractor.
    const tokenUrls = await page.locator(".tabs-ul li").evaluateAll((items) =>
      items.map((li) => {
        const onclick = li.getAttribute("onclick") || "";
        const match = onclick.match(/player_iframe\.location\.href\s*=\s*['"]([^'"]+)['"]/);
        return match?.[1] || "";
      }).filter(Boolean)
    ).catch(() => []);

    const targets = [...new Set([pageUrl, ...tokenUrls])];

    // If the source page itself contains a player iframe, let it lazy-load.
    await page.locator('iframe[name="player_iframe"]').first().scrollIntoViewIfNeeded().catch(() => {});

    // Try the JWPlayer play control in every frame. This is normal user-like
    // playback interaction; no CAPTCHA/security challenge is bypassed.
    for (let attempt = 0; attempt < 8 && !urls.length; attempt++) {
      for (const frame of page.frames()) {
        for (const selector of [
          ".jw-icon-display",
          ".jw-display-icon-container",
          "[class*='jw-icon'][class*='play']",
          "video",
        ]) {
          const locator = frame.locator(selector).first();
          if (await locator.count().catch(() => 0)) {
            await locator.click({ force: true, timeout: 1500 }).catch(() => {});
            break;
          }
        }
      }

      const captured = await page.evaluate(() => window.__MOVYZA_M3U8__ || []).catch(() => []);
      for (const url of captured) add(url);

      if (!urls.length) await page.waitForTimeout(2_000);
    }

    // Also try opening the pre-scraped player URLs directly if the page did
    // not expose a usable iframe. Requests are still captured by Playwright.
    for (const target of targets.slice(0, 5)) {
      if (urls.length) break;
      if (target === pageUrl) continue;
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(3_000);

      for (const selector of [
        ".jw-icon-display",
        ".jw-display-icon-container",
        "[class*='jw-icon'][class*='play']",
        "video",
      ]) {
        const locator = page.locator(selector).first();
        if (await locator.count().catch(() => 0)) {
          await locator.click({ force: true, timeout: 1500 }).catch(() => {});
          break;
        }
      }
      await page.waitForTimeout(4_000);
    }

    const captured = await page.evaluate(() => window.__MOVYZA_M3U8__ || []).catch(() => []);
    for (const url of captured) add(url);

    if (!urls.length) {
      throw new Error("AbdoBest player produced no HLS playlist");
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
      via: "browser-run-abdobest-player",
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function sourcePageFallback(pageUrl, matchedTitle = '') {
  return {
    url: pageUrl,
    type: 'web',
    quality: 'source-page',
    qualities: [],
    sources: [{
      quality: 'source-page',
      type: 'web',
      url: pageUrl,
    }],
    source_page: pageUrl,
    requires_browser: true,
    matched_title: matchedTitle || undefined,
  };
}

function findStreamUrl(value, depth = 0) {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) ? value.trim() : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStreamUrl(item, depth + 1);
      if (found && /(?:\.m3u8|\.mp4|\.webm|\.mpd)(?:[?#]|$)/i.test(found)) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  for (const key of ["stream_url", "video_url", "videoUrl", "streamUrl", "url", "src"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) {
      if (/\.(?:m3u8|mp4|webm|mpd)(?:[?#]|$)/i.test(candidate)) return candidate.trim();
    }
  }
  for (const child of Object.values(value)) {
    const found = findStreamUrl(child, depth + 1);
    if (found && /(?:\.m3u8|\.mp4|\.webm|\.mpd)(?:[?#]|$)/i.test(found)) return found;
  }
  return "";
}

async function extractStream(pageUrl, env) {
  // AbdoBest is the only playback source. We only return a real media URL.
  // A source HTML page is never returned as a playable stream.
  let apiError = null;
  try {
    const result = await upstreamJson("/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: pageUrl }),
    });

    if (result.validJson) {
      const videoUrl = findStreamUrl(result.body);

      if (result.response.ok && videoUrl) {
        const qualities = Array.isArray(result.body?.quality_options)
          ? result.body.quality_options.filter(Boolean)
          : [];
        const type = detectStreamType(videoUrl);
        return {
          url: videoUrl,
          type,
          quality: qualities[0] || "auto",
          qualities,
          sources: [{
            quality: qualities[0] || "auto",
            type,
            url: videoUrl,
          }],
          cached: result.body?.cached === true,
          via: "abdobest-api",
        };
      }

      apiError = new Error(
        result.body?.error ||
          ("AbdoBest extraction failed with HTTP " + result.response.status),
      );
    } else {
      apiError = new Error(
        "AbdoBest extraction returned invalid JSON (HTTP " + result.response.status + ")",
      );
    }
  } catch (error) {
    apiError = error instanceof Error ? error : new Error(String(error));
  }

  // AbdoBest's mobile app resolves the same source pages in a WebView and
  // captures the HLS request generated by the player. Browser Run mirrors that
  // normal browser flow; it does not bypass CAPTCHAs/security challenges.
  if (isBrowserExtractionCandidate(pageUrl)) {
    try {
      return await browserExtractStream(pageUrl, env);
    } catch (browserError) {
      throw new Error(
        "AbdoBest direct extraction failed: " +
        (browserError instanceof Error ? browserError.message : String(browserError)) +
        (apiError ? " | API: " + apiError.message : ""),
      );
    }
  }

  throw apiError || new Error("AbdoBest could not resolve a direct video stream");
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

      const sources = extractSourceUrls(match);
      if (sources.length) return { match, sources };
    } catch {}
  }

  return null;
}

async function resolveMovie(payload, env) {
  const directSource = cleanText(payload?.source_url);

  if (directSource) {
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

  let sources = match ? extractSourceUrls(match) : [];

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
      const fallback = sourcePageFallback(source, extractTitle(match));
      const streamSources = [
        ...(Array.isArray(stream.sources) ? stream.sources : [{
          quality: stream.quality || 'auto',
          type: stream.type || detectStreamType(stream.url),
          url: stream.url,
        }]),
        fallback.sources[0],
      ];
      return {
        ...stream,
        sources: streamSources,
        matched_title: extractTitle(match),
        fallback_source_page: source,
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
      const fallback = sourcePageFallback(source, extractTitle(match));
      const streamSources = [
        ...(Array.isArray(stream.sources) ? stream.sources : [{
          quality: stream.quality || 'auto',
          type: stream.type || detectStreamType(stream.url),
          url: stream.url,
        }]),
        fallback.sources[0],
      ];
      return {
        ...stream,
        sources: streamSources,
        matched_title: extractTitle(match),
        fallback_source_page: source,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const fallbackSource = urls[0];
  if (fallbackSource) {
    return {
      ...sourcePageFallback(fallbackSource, extractTitle(match)),
      extraction_error: lastError instanceof Error ? lastError.message : String(lastError || ''),
    };
  }

  throw lastError || new Error("Unable to resolve a playable episode source");
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

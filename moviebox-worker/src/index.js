const ABDOBEST_API_BASES = [
  "https://ogkushhh-abdobest.hf.space",
  "https://ogkushhh-abdobest-api.hf.space",
];
const TIMEOUT_MS = 25_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "Content-Type, Content-Length",
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS,
      ...extraHeaders,
    },
  });
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTitle(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function titleOf(item) {
  return firstString(
    item?.Title,
    item?.title,
    item?.name,
    item?.original_title,
    item?.original_name,
  );
}

function yearOf(item) {
  const raw = firstString(
    item?.Year,
    item?.year,
    item?.release_date,
    item?.first_air_date,
  );
  const match = raw.match(/\b(?:19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function tmdbIdOf(item) {
  return firstNumber(
    item?.["TMDb ID"],
    item?.tmdb_id,
    item?.tmdbId,
    item?.themoviedb_id,
    item?.themoviedbId,
  );
}

function categoryOf(item) {
  return firstString(item?.Category, item?.category, item?.type, item?.content_type)
    .toLowerCase();
}

function isAkwamUrl(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return host === "akwam.it" ||
      host.endsWith(".akwam.it") ||
      host === "akwam.ss" ||
      host.endsWith(".akwam.ss") ||
      host === "ak.sv" ||
      host.endsWith(".ak.sv") ||
      host === "akwam.net" ||
      host.endsWith(".akwam.net") ||
      host === "akwam.ee" ||
      host.endsWith(".akwam.ee") ||
      host === "downet.net" ||
      host.endsWith(".downet.net");
  } catch {
    return false;
  }
}

function normalizeAkwamUrl(value) {
  const url = clean(value);
  if (!url) return "";
  return url
    .replace(/^https?:\/\/(?:www\.)?akwam\.com\.co/i, "https://akwam.it")
    .replace(/^https?:\/\/go\.akwam\.com\.co/i, "https://go.akwam.it")
    .replace(/^https?:\/\/akw\.cam/i, "https://akwam.it");
}

function isLikelyMediaUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return false;
  return /\.(?:m3u8|mp4|mpd|webm)(?:[?#]|$)/i.test(value) ||
    /(?:m3u8|mp4|mpd|webm)(?:[?#=&]|$)/i.test(value) ||
    /\/(?:download|file)\//i.test(value);
}

function detectStreamType(url) {
  const value = String(url || "").toLowerCase();
  if (value.includes(".m3u8") || value.includes("m3u8")) return "hls";
  if (value.includes(".mpd") || value.includes("mpd")) return "dash";
  if (value.includes(".webm") || value.includes("webm")) return "webm";
  return "mp4";
}

function walk(value, visitor, depth = 0) {
  if (depth > 7 || value == null) return null;
  if (typeof value === "string") return visitor(value, "");
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = walk(item, visitor, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string") {
      const direct = visitor(child, key);
      if (direct) return direct;
    } else {
      const hit = walk(child, visitor, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function mediaUrlOf(payload) {
  const preferredKeys = [
    "stream_url", "streamUrl", "video_url", "videoUrl",
    "media_url", "mediaUrl", "file", "src", "url",
  ];

  if (payload && typeof payload === "object") {
    for (const key of preferredKeys) {
      if (isLikelyMediaUrl(payload[key])) return payload[key].trim();
    }
  }

  return walk(payload, (value, key) => {
    const lowerKey = String(key || "").toLowerCase();
    if (
      !lowerKey.includes("url") &&
      !lowerKey.includes("stream") &&
      !lowerKey.includes("video") &&
      !lowerKey.includes("media") &&
      lowerKey !== "src" &&
      lowerKey !== "file"
    ) return "";
    return isLikelyMediaUrl(value) ? value.trim() : "";
  }) || "";
}

function sourceUrlsOf(item) {
  const found = [];
  const seen = new Set();

  const visit = (value, depth = 0) => {
    if (depth > 7 || value == null) return;

    if (typeof value === "string") {
      const url = normalizeAkwamUrl(value);
      if (isAkwamUrl(url) && !seen.has(url)) {
        seen.add(url);
        found.push(url);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
      return;
    }

    if (typeof value === "object") {
      for (const child of Object.values(value)) visit(child, depth + 1);
    }
  };

  visit(item);
  return found;
}

function scoreMatch(item, input) {
  const wantedTmdb = Number(input?.tmdb_id ?? input?.tmdbId);
  const itemTmdb = tmdbIdOf(item);
  if (Number.isFinite(wantedTmdb) && Number.isFinite(itemTmdb) && wantedTmdb === itemTmdb) {
    return 1000;
  }

  const wantedTitles = [
    input?.title,
    input?.title_en,
    input?.title_ar,
    input?.original_title,
    input?.originalTitle,
  ].map(normalizeTitle).filter(Boolean);

  const actual = normalizeTitle(titleOf(item));
  let score = 0;

  for (const wanted of wantedTitles) {
    if (!wanted || !actual) continue;
    if (wanted === actual) score = Math.max(score, 700);
    else if (actual.includes(wanted) || wanted.includes(actual)) score = Math.max(score, 450);
  }

  const wantedYear = Number(input?.year);
  const actualYear = yearOf(item);
  if (Number.isFinite(wantedYear) && Number.isFinite(actualYear)) {
    if (wantedYear === actualYear) score += 100;
    else if (Math.abs(wantedYear - actualYear) === 1) score += 20;
  }

  return score;
}

function asArray(payload, depth = 0) {
  if (depth > 5 || payload == null) return [];
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === "object");
  }
  if (typeof payload !== "object") return [];

  for (const key of ["results", "items", "movies", "series", "episodes"]) {
    if (Array.isArray(payload[key])) {
      return payload[key].filter((item) => item && typeof item === "object");
    }
  }

  for (const key of ["data", "response", "payload", "result"]) {
    if (payload[key] && typeof payload[key] === "object") {
      const nested = asArray(payload[key], depth + 1);
      if (nested.length) return nested;
    }
  }

  const nested = [];
  for (const value of Object.values(payload)) {
    if (value && typeof value === "object") {
      nested.push(...asArray(value, depth + 1));
    }
  }
  return nested;
}

async function abdoJson(path, init = {}) {
  let lastError = null;

  for (const base of ABDOBEST_API_BASES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const headers = new Headers(init.headers || {});
      headers.set("Accept", headers.get("Accept") || "application/json");
      const response = await fetch(base + path, {
        ...init,
        headers,
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

      if (response.ok) return { response, body, raw: text };

      lastError = new Error(
        body?.error || `AbdoBest HTTP ${response.status} at ${path}`,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("AbdoBest unavailable");
}

async function abdoExtract(sourceUrl) {
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
        body: JSON.stringify({ url: sourceUrl }),
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
        throw new Error(body?.error || `AbdoBest /extract HTTP ${response.status}`);
      }

      const direct = mediaUrlOf(body);
      if (!direct) throw new Error("AbdoBest /extract returned no direct media URL");

      const type = detectStreamType(direct);
      return {
        url: direct,
        type,
        quality: "auto",
        qualities: ["auto"],
        sources: [{ quality: "auto", type, url: direct }],
        cached: body?.cached === true,
        via: "abdobest-extract",
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("AbdoBest extraction failed");
}

const AKWAM_RESOLVER_URL = "https://movyz-akwam-resolver.sameranede.workers.dev/resolve";

async function resolveViaAkwamResolver(payload, type) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const body = {
      title: payload?.title,
      original_title: payload?.original_title ?? payload?.originalTitle,
      year: payload?.year,
      type,
      // Preserve an Akwam content page (or the title::base64 URL format) so
      // the dedicated resolver can skip search and run the real link chain.
      content_url: payload?.content_url ?? payload?.contentUrl,
      id: payload?.id,
      episode: type === "series" ? Number(payload?.episode) : undefined,
      season: type === "series" ? Number(payload?.season) : undefined,
    };
    const response = await fetch(AKWAM_RESOLVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || `Akwam resolver HTTP ${response.status}`);
    }

    if (isLikelyMediaUrl(data.media_url)) {
      const typeOfStream = ["mp4", "hls", "dash", "webm"].includes(data.type)
        ? data.type
        : detectStreamType(data.media_url);
      return {
        url: data.media_url,
        type: typeOfStream,
        quality: data.quality || "auto",
        qualities: [data.quality || "auto"],
        sources: [{ quality: data.quality || "auto", type: typeOfStream, url: data.media_url }],
        cached: false,
        via: "akwam-browser-resolver",
        source_url: data.source_url || data.page_url || "",
        matched_title: data.title || payload?.title || "",
      };
    }

    if (data.source_url && isAkwamUrl(data.source_url)) {
      const extracted = await abdoExtract(data.source_url);
      return {
        ...extracted,
        via: "akwam-resolver-abdobest-extract",
        source_url: data.source_url,
        matched_title: data.title || payload?.title || "",
      };
    }

    throw new Error("Akwam resolver returned no playable media");
  } finally {
    clearTimeout(timer);
  }
}

async function resolveDiscoveredAkwamContent(payload, type, source) {
  console.warn("AKWAM_DISCOVERY: resolving real Akwam content_url from AbdoBest");
  return await resolveViaAkwamResolver({
    ...payload,
    content_url: source,
  }, type);
}

async function resolveMovie(payload) {
  const directSource = normalizeAkwamUrl(payload?.source_url);
  if (directSource) {
    if (!isAkwamUrl(directSource)) throw new Error("Only Akwam playback sources are allowed");
    try {
      return await resolveViaAkwamResolver({
        ...payload,
        content_url: directSource,
      }, "movie");
    } catch (error) {
      console.warn("Akwam content URL resolver fallback:", error instanceof Error ? error.message : String(error));
      return {
        ...(await abdoExtract(directSource)),
        source_url: directSource,
      };
    }
  }

  const titles = [
    payload?.title,
    payload?.title_en,
    payload?.title_ar,
    payload?.original_title,
    payload?.originalTitle,
  ].map(clean).filter(Boolean);

  if (!titles.length) throw new Error("title is required");

  try {
    return await resolveViaAkwamResolver(payload, "movie");
  } catch (error) {
    console.warn("Akwam resolver movie fallback:", error instanceof Error ? error.message : String(error));
  }

  let best = null;
  let lastError = null;

  for (const title of titles) {
    try {
      const search = await abdoJson("/api/search?q=" + encodeURIComponent(title));
      const ranked = asArray(search.body)
        .map((item) => ({ item, score: scoreMatch(item, payload) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);

      for (const entry of ranked) {
        const urls = sourceUrlsOf(entry.item);
        if (urls.length) {
          best = { item: entry.item, urls };
          break;
        }
      }

      if (best) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!best) {
    throw new Error(lastError || "No Akwam source matched this title");
  }

  let lastErrorExtract = null;
  for (const source of best.urls.slice(0, 3)) {
    try {
      // Akwam can rate-limit title search. AbdoBest's real Akwam page is a
      // discovery fallback only; the dedicated resolver still owns extraction.
      return await resolveDiscoveredAkwamContent(payload, "movie", source);
    } catch (error) {
      console.warn("AKWAM_DISCOVERY resolver fallback:", error instanceof Error ? error.message : String(error));
    }

    try {
      const stream = await abdoExtract(source);
      return {
        ...stream,
        source_url: source,
        matched_title: titleOf(best.item),
      };
    } catch (error) {
      lastErrorExtract = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(
    "AbdoBest could not produce a direct playable stream" +
    (lastErrorExtract ? ": " + lastErrorExtract.message : ""),
  );
}

function episodeNumberOf(item) {
  return firstNumber(item?.episode_number, item?.episodeNumber, item?.episode, item?.number, item?.Episode, item?.ep);
}

function seasonNumberOf(item) {
  return firstNumber(item?.season_number, item?.seasonNumber, item?.season, item?.Season);
}

function findEpisode(payload, season, episode) {
  let result = null;

  walk(payload, (value) => {
    if (!value || typeof value !== "object") return "";
    const ep = episodeNumberOf(value);
    const sn = seasonNumberOf(value);
    if (!Number.isFinite(ep) || ep !== episode) return "";
    if (Number.isFinite(sn) && sn !== season) return "";
    const urls = sourceUrlsOf(value);
    if (!urls.length) return "";
    result = { item: value, urls };
    return "found";
  });

  return result;
}

async function resolveEpisode(payload) {
  try {
    return await resolveViaAkwamResolver(payload, "series");
  } catch (error) {
    console.warn("Akwam resolver episode fallback:", error instanceof Error ? error.message : String(error));
  }


  const title = clean(payload?.title);
  const season = Number(payload?.season);
  const episode = Number(payload?.episode);

  if (!title) throw new Error("title is required");
  if (!Number.isInteger(season) || season < 0) throw new Error("season must be a valid integer");
  if (!Number.isInteger(episode) || episode < 1) throw new Error("episode must be a valid integer");

  const search = await abdoJson("/api/search?q=" + encodeURIComponent(title));
  const ranked = asArray(search.body)
    .map((item) => ({ item, score: scoreMatch(item, payload) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const match = ranked[0]?.item;
  if (!match) throw new Error("No AbdoBest series matched this title");

  const category = categoryOf(match) || "series";
  const id = firstString(match?.id, match?.ID);
  if (!id) throw new Error("Matched series has no source ID");

  const path = category === "arabic-series"
    ? "/api/arabic-series/episodes/" + encodeURIComponent(id)
    : "/api/episodes/" + encodeURIComponent(category) + "/" + encodeURIComponent(id);

  const episodes = await abdoJson(path);
  const found = findEpisode(episodes.body, season, episode);
  if (!found) throw new Error(`Episode S${season}E${episode} was not found`);

  let lastError = null;
  for (const source of found.urls.slice(0, 3)) {
    try {
      return await resolveDiscoveredAkwamContent(payload, "series", source);
    } catch (error) {
      console.warn("AKWAM_DISCOVERY episode resolver fallback:", error instanceof Error ? error.message : String(error));
    }

    try {
      const stream = await abdoExtract(source);
      return {
        ...stream,
        source_url: source,
        matched_title: titleOf(match),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(
    "AbdoBest could not produce a direct playable episode stream" +
    (lastError ? ": " + lastError.message : ""),
  );
}

function isSafeProxyTarget(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    return isLikelyMediaUrl(url.href);
  } catch {
    return false;
  }
}

async function proxyMedia(request) {
  const incoming = new URL(request.url);
  const mediaUrl = incoming.searchParams.get("url") || "";
  const referer = incoming.searchParams.get("referer") || "";

  if (!isSafeProxyTarget(mediaUrl)) {
    return json({ ok: false, error: "Invalid media proxy target" }, 400);
  }

  const headers = new Headers({
    Accept: request.headers.get("Accept") || "*/*",
    "User-Agent": request.headers.get("User-Agent") ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
  });

  const range = request.headers.get("Range");
  if (range) headers.set("Range", range);
  if (referer) headers.set("Referer", referer);

  const response = await fetch(mediaUrl, {
    headers,
    redirect: "follow",
    cache: "no-store",
  });

  const contentType = response.headers.get("Content-Type") || "";
  if (!/mpegurl|m3u8/i.test(contentType) && !mediaUrl.toLowerCase().includes("m3u8")) {
    return new Response(response.body, {
      status: response.status,
      headers: {
        ...CORS,
        "Content-Type": contentType || "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  }

  const body = await response.text();
  const rewritten = body.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    try {
      return new URL(trimmed, mediaUrl).toString();
    } catch {
      return line;
    }
  }).join("\n");

  return new Response(rewritten, {
    status: response.status,
    headers: {
      ...CORS,
      "Content-Type": contentType || "application/vnd.apple.mpegurl",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (request.method === "GET" && path === "/") {
        return json({
          api: "Movyz Watch API",
          version: "3.0.0",
          provider: "AbdoBest",
          metadata: "TMDB",
          mode: "lightweight-abdobest",
          endpoints: {
            health: "GET /health",
            movie: "POST /watch/movie",
            episode: "POST /watch/episode",
            proxy: "GET /proxy?url=...",
          },
        });
      }

      if (request.method === "GET" && path === "/health") {
        try {
          const upstream = await abdoJson("/health", { method: "GET" });
          return json({
            ok: upstream.response.ok,
            provider: "AbdoBest",
            upstream_status: upstream.response.status,
            ...(upstream.body && typeof upstream.body === "object" ? upstream.body : {}),
          }, upstream.response.ok ? 200 : 502);
        } catch (error) {
          return json({
            ok: false,
            provider: "AbdoBest",
            error: error instanceof Error ? error.message : String(error),
          }, 502);
        }
      }

      if (request.method === "GET" && path === "/proxy") {
        return await proxyMedia(request);
      }

      if (request.method === "POST" && path === "/watch/movie") {
        let payload;
        try {
          payload = await request.json();
        } catch {
          return json({ ok: false, error: "Valid JSON body required" }, 400);
        }
        const stream = await resolveMovie(payload || {});
        return json({
          ok: true,
          type: "movie",
          tmdb_id: firstNumber(payload?.tmdb_id, payload?.tmdbId),
          // Keep the direct-media contract explicit for callers which do not
          // consume the legacy nested `stream` object.
          source_url: stream.source_url || clean(payload?.source_url),
          media_url: stream.url,
          media_type: stream.type,
          stream,
        });
      }

      if (request.method === "POST" && path === "/watch/episode") {
        let payload;
        try {
          payload = await request.json();
        } catch {
          return json({ ok: false, error: "Valid JSON body required" }, 400);
        }
        const stream = await resolveEpisode(payload || {});
        return json({
          ok: true,
          type: "episode",
          tmdb_id: firstNumber(payload?.tmdb_id, payload?.tmdbId),
          season: Number(payload?.season),
          episode: Number(payload?.episode),
          source_url: stream.source_url || clean(payload?.source_url),
          media_url: stream.url,
          media_type: stream.type,
          stream,
        });
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Watch API error";
      console.error("Movyz Watch API failed", path, message);
      return json({
        ok: false,
        error: message,
        provider: "AbdoBest",
      }, 502);
    }
  },
};

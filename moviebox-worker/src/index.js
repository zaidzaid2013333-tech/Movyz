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
      host.endsWith(".downet.net") ||
      /^(?:[a-z0-9-]+\\.)*akwam\\.[a-z]{2,}$/i.test(host) ||
      /^ak\\.[a-z]{2,}$/i.test(host);
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

// Episode sources may arrive as escaped strings or mirror-host URLs from AbdoBest.
function sourceUrlsOf(item) {
  const found = [];
  const seen = new Set();

  const visit = (value, depth = 0) => {
    if (depth > 7 || value == null) return;

    if (typeof value === "string") {
      const raw = value
        .replace(/\\\//g, "/")
        .replace(/&amp;/gi, "&")
        .trim();

      const candidates = [raw];

      // AbdoBest may return an episode URL embedded inside JSON/escaped text.
      const embedded = raw.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];
      candidates.push(...embedded);

      for (const candidate of candidates) {
        const url = normalizeAkwamUrl(candidate);
        if (isAkwamUrl(url) && !seen.has(url)) {
          seen.add(url);
          found.push(url);
        }
      }

      try {
        const parsed = JSON.parse(raw);
        visit(parsed, depth + 1);
      } catch {
        // Plain URL/string.
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

async function resolveViaAkwamResolver(payload, type, env) {
  const maxAttempts = 3;
  const retryDelays = [1200, 2500];
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);

    try {
      const body = {
        title: payload?.title,
        title_en: payload?.title_en,
        title_ar: payload?.title_ar,
        titles: Array.isArray(payload?.titles) ? payload.titles : undefined,
        original_title: payload?.original_title ?? payload?.originalTitle,
        year: payload?.year,
        type,
        content_url: payload?.content_url ?? payload?.contentUrl,
        source_url: payload?.source_url,
        id: payload?.id,
        episode: type === "series" ? Number(payload?.episode) : undefined,
        season: type === "series" ? Number(payload?.season) : undefined,
      };

      const resolverInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      };

      const response = env?.AKWAM_RESOLVER?.fetch
        ? await env.AKWAM_RESOLVER.fetch(
            new Request("https://movyz-akwam-resolver.internal/resolve", resolverInit),
          )
        : await fetch(AKWAM_RESOLVER_URL, resolverInit);

      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}

      if (!response.ok || !data?.ok) {
        const error = new Error(
          data?.error || `Akwam resolver HTTP ${response.status}`,
        );
        error.status = response.status;
        throw error;
      }

      const rawSources = Array.isArray(data.sources) && data.sources.length
        ? data.sources
        : typeof data.media_url === "string" && /^https?:\/\//i.test(data.media_url)
          ? [{
              url: data.media_url,
              type: data.type,
              quality: data.quality,
            }]
          : [];

      const sources = rawSources
        .filter((source) => typeof source?.url === "string" && /^https?:\/\//i.test(source.url))
        .map((source) => {
          const typeOfStream = ["mp4", "hls", "dash", "webm"].includes(source.type)
            ? source.type
            : detectStreamType(source.url);
          return {
            url: source.url,
            type: typeOfStream,
            quality: source.quality || "auto",
            iframe_url: data.source_url || data.page_url || "",
          };
        });

      if (sources.length) {
        const primary = sources[0];
        return {
          url: primary.url,
          type: primary.type,
          quality: primary.quality,
          qualities: sources.map((source) => source.quality),
          sources,
          cached: false,
          via: "akwam-browser-resolver",
          source_url: data.source_url || data.page_url || "",
          matched_title: data.title || payload?.title || "",
        };
      }
      throw new Error("Akwam resolver returned no playable media");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const transient =
        lastError.name === "AbortError" ||
        [408, 425, 429, 500, 502, 503, 504].includes(Number(lastError.status));

      if (!transient || attempt === maxAttempts) break;

      const delay = retryDelays[attempt - 1] || 2500;
      console.warn(
        "AKWAM_WATCH_RESOLVER_RETRY",
        "attempt=" + attempt,
        "status=" + (lastError.status ?? "timeout"),
        "delayMs=" + delay,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("Akwam resolver failed");
}

async function resolveDiscoveredAkwamContent(payload, type, source, env) {
  console.warn("AKWAM_DISCOVERY: resolving real Akwam content_url from AbdoBest");
  return await resolveViaAkwamResolver({
    ...payload,
    content_url: source,
  }, type, env);
}


async function resolveAkwamIframeOnly(payload, type, env) {
  const explicitSource = normalizeAkwamUrl(
    payload?.source_url ?? payload?.content_url ?? payload?.contentUrl,
  );

  const build = (source, matchedTitle = "") => ({
    url: source,
    type: "web",
    quality: "auto",
    qualities: ["auto"],
    sources: [{ url: source, type: "web", quality: "auto" }],
    source_url: source,
    iframe_url: source,
    matched_title: matchedTitle || payload?.title || "",
    via: "akwam-iframe-discovery",
  });

  if (explicitSource) {
    if (!isAkwamUrl(explicitSource)) {
      throw new Error("Only Akwam playback sources are allowed");
    }
    return build(explicitSource);
  }

  const title = clean(payload?.title);
  if (!title) throw new Error("title is required");

  // Prefer the dedicated Akwam resolver for series. It searches Akwam directly
  // and can resolve the requested season/episode without depending on AbdoBest.
  let directResolverError = "";
  if (type === "series") {
    try {
      const resolved = await resolveViaAkwamResolver(payload, "series", env);
      const source = normalizeAkwamUrl(
        resolved?.source_url || resolved?.page_url || resolved?.sourceUrl || "",
      );
      if (source && isAkwamUrl(source)) {
        return build(source, resolved?.title || resolved?.matched_title || title);
      }
    } catch (error) {
      directResolverError = error instanceof Error ? error.message : String(error);
      console.warn(
        "AKWAM_IFRAME_DIRECT_RESOLVER_FALLBACK:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  let search;
  try {
    search = await abdoJson("/api/search?q=" + encodeURIComponent(title), { method: "GET" });
  } catch (error) {
    // AbdoBest search is an optional discovery fallback; do not let a 404/5xx
    // prevent the direct Akwam path above from being used.
    console.warn(
      "ABDOBEST_SEARCH_UNAVAILABLE:",
      error instanceof Error ? error.message : String(error),
    );
    throw new Error(
      "Akwam episode discovery failed; direct resolver: " +
      (directResolverError || "unknown") +
      "; AbdoBest search: " +
      (error instanceof Error ? error.message : String(error)),
    );
  }
  const ranked = asArray(search.body)
    .map((item) => ({ item, score: scoreMatch(item, payload) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (type === "movie") {
    for (const entry of ranked) {
      const urls = sourceUrlsOf(entry.item);
      if (urls.length) return build(urls[0], titleOf(entry.item));
    }
    throw new Error("No Akwam movie page matched this title");
  }

  const season = Number(payload?.season);
  const episode = Number(payload?.episode);
  if (!Number.isInteger(season) || season < 0) throw new Error("season must be a valid integer");
  if (!Number.isInteger(episode) || episode < 1) throw new Error("episode must be a valid integer");

  if (!ranked.length) throw new Error("No Akwam series matched this title");

  const candidateErrors = [];
  let lastEpisodeBody = null;

  // Search can return the same title under different AbdoBest categories/IDs.
  // Do not trust only ranked[0]; try the best matching unique candidates until
  // one actually exposes the requested season/episode.
  const tried = new Set();
  for (const entry of ranked.slice(0, 8)) {
    const match = entry.item;
    const category = categoryOf(match) || "series";
    const id = firstString(match?.id, match?.ID);
    if (!id) {
      candidateErrors.push("missing source id for " + titleOf(match));
      continue;
    }

    const candidateKey = category + ":" + id;
    if (tried.has(candidateKey)) continue;
    tried.add(candidateKey);

    const episodePath = category === "arabic-series"
      ? "/api/arabic-series/episodes/" + encodeURIComponent(id)
      : "/api/episodes/" + encodeURIComponent(category) + "/" + encodeURIComponent(id);

    try {
      const episodes = await abdoJson(episodePath);
      lastEpisodeBody = episodes.body;
      const found = findEpisode(episodes.body, season, episode);
      if (found?.urls?.length) {
        return build(found.urls[0], titleOf(match));
      }
      candidateErrors.push(
        "no S" + season + "E" + episode + " match at " + episodePath,
      );
    } catch (error) {
      candidateErrors.push(
        "episode lookup failed at " + episodePath + ": " +
        (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  if (payload?.diagnostic === true) {
    throw new Error(
      "EPISODE_DIAGNOSTIC " +
      JSON.stringify({
        match: {
          title: titleOf(ranked[0]?.item),
          category: categoryOf(ranked[0]?.item),
          id: firstString(ranked[0]?.item?.id, ranked[0]?.item?.ID),
          tmdb_id: tmdbIdOf(ranked[0]?.item),
        },
        ranked: ranked.slice(0, 8).map((entry) => ({
          title: titleOf(entry.item),
          category: categoryOf(entry.item),
          id: firstString(entry.item?.id, entry.item?.ID),
          tmdb_id: tmdbIdOf(entry.item),
          score: entry.score,
        })),
        candidates: candidateErrors,
        catalog: summarizeEpisodePayload(lastEpisodeBody),
        urls: collectEpisodeUrls(lastEpisodeBody),
      }),
    );
  }

  // AbdoBest's episode catalog is a useful fast path, but some series expose
  // episode links in a shape/domain that is not an Akwam page. Fall back to
  // the dedicated Akwam resolver, which searches Akwam directly and already
  // knows how to locate the real episode page before media extraction.
  try {
    const resolved = await resolveViaAkwamResolver(payload, "series", env);
    const source = normalizeAkwamUrl(resolved?.source_url || resolved?.page_url || "");
    if (source && isAkwamUrl(source)) {
      return build(source, resolved?.title || resolved?.matched_title || title);
    }
  } catch (error) {
    console.warn(
      "AKWAM_IFRAME_RESOLVER_FALLBACK:",
      error instanceof Error ? error.message : String(error),
    );
  }

  throw new Error(`Episode S${season}E${episode} has no Akwam page URL` + (candidateErrors.length ? ": " + candidateErrors.slice(0, 4).join(" | ") : ""));
}

async function resolveMovie(payload, env) {
  if (payload?.mode === "iframe") return await resolveAkwamIframeOnly(payload, "movie", env);
  const directSource = normalizeAkwamUrl(
    payload?.source_url ?? payload?.content_url ?? payload?.contentUrl,
  );

  if (directSource) {
    if (!isAkwamUrl(directSource)) {
      throw new Error("Only Akwam playback sources are allowed");
    }

    return await resolveViaAkwamResolver({
      ...payload,
      content_url: directSource,
      source_url: directSource,
    }, "movie", env);
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
    return await resolveViaAkwamResolver(payload, "movie", env);
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
      return await resolveDiscoveredAkwamContent(payload, "movie", source, env);
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

function parseSeasonKey(value) {
  const text = String(value ?? "").trim().toLowerCase();
  const match = text.match(/(\d{1,2})/);
  return match ? Number(match[1]) : null;
}

function asEpisodeUrlCandidate(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";

  const normalized = normalizeAkwamUrl(raw);
  if (isAkwamUrl(normalized)) return normalized;

  const isRelative =
    raw.startsWith("/") ||
    raw.startsWith("./") ||
    raw.startsWith("../") ||
    raw.startsWith("watch/") ||
    raw.startsWith("episode/") ||
    raw.startsWith("episode-") ||
    raw.startsWith("link/") ||
    raw.startsWith("download/");

  if (isRelative) {
    try {
      const absolute = new URL(raw, "https://akwam.it").toString();
      return isAkwamUrl(absolute) ? absolute : "";
    } catch {
      return "";
    }
  }

  if (raw.startsWith("//")) {
    try {
      const absolute = "https:" + raw;
      return isAkwamUrl(absolute) ? absolute : "";
    } catch {
      return "";
    }
  }

  return "";
}

function episodeUrlsOf(item) {
  const found = [];
  const seen = new Set();

  const visit = (value, depth = 0) => {
    if (depth > 8 || value == null) return;

    if (typeof value === "string") {
      const raw = value
        .replace(/\\\//g, "/")
        .replace(/&amp;/gi, "&")
        .trim();

      const candidates = [raw];
      const embedded = raw.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];
      candidates.push(...embedded);

      for (const candidate of candidates) {
        const url = asEpisodeUrlCandidate(candidate);
        if (url && !seen.has(url)) {
          seen.add(url);
          found.push(url);
        }
      }

      try {
        const parsed = JSON.parse(raw);
        visit(parsed, depth + 1);
      } catch {
        // Plain string.
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

function summarizeEpisodePayload(value, depth = 0) {
  if (depth > 4) return { type: Array.isArray(value) ? "array" : typeof value };

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample: value.slice(0, 3).map((item) => (
        typeof item === "string"
          ? item.slice(0, 500)
          : summarizeEpisodePayload(item, depth + 1)
      )),
    };
  }

  if (value && typeof value === "object") {
    const out = { type: "object", keys: Object.keys(value).slice(0, 40) };
    for (const key of ["seasons", "episodes", "data", "response", "payload", "result"]) {
      if (value[key] !== undefined) {
        out[key] = summarizeEpisodePayload(value[key], depth + 1);
      }
    }
    return out;
  }

  return {
    type: typeof value,
    value: typeof value === "string" ? value.slice(0, 500) : value,
  };
}

function collectEpisodeUrls(value, out = [], seen = new Set(), depth = 0) {
  if (depth > 8 || value == null) return out;
  if (typeof value === "string") {
    const raw = value.trim();
    if (/^https?:\/\//i.test(raw) && !seen.has(raw)) {
      seen.add(raw);
      out.push(raw.slice(0, 800));
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) collectEpisodeUrls(item, out, seen, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value).slice(0, 100)) {
      collectEpisodeUrls(child, out, seen, depth + 1);
    }
  }
  return out;
}

function findEpisode(payload, season, episode) {
  const seen = new Set();

  const pickEpisodeFromArray = (episodes, requestedEpisode) => {
    if (!Array.isArray(episodes) || requestedEpisode < 1) return null;
    const candidate = episodes[requestedEpisode - 1];
    if (candidate == null) return null;
    const urls = episodeUrlsOf(candidate);
    return urls.length ? { item: candidate, urls } : null;
  };

  const visit = (value, inheritedSeason = null) => {
    if (value == null) return null;

    if (Array.isArray(value)) {
      const direct = inheritedSeason === season
        ? pickEpisodeFromArray(value, episode)
        : (inheritedSeason == null && season === 1
          ? pickEpisodeFromArray(value, episode)
          : null);
      if (direct) return direct;

      // Structured episode arrays: each element may carry its own season/episode.
      for (const [index, child] of value.entries()) {
        if (child && typeof child === "object") {
          const childSeason = seasonNumberOf(child);
          const childEpisode = episodeNumberOf(child) ?? (index + 1);
          if (
            (childSeason == null || childSeason === season) &&
            Number(childEpisode) === episode
          ) {
            const urls = episodeUrlsOf(child);
            if (urls.length) return { item: child, urls };
          }
        }
      }

      for (const child of value) {
        const match = visit(child, inheritedSeason);
        if (match) return match;
      }
      return null;
    }

    if (typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);

    // Canonical shape:
    // { seasons: { "1": { episodes: [...] }, "2": [...] } }
    const seasons = value.seasons;
    if (seasons && typeof seasons === "object" && !Array.isArray(seasons)) {
      const ordered = Object.entries(seasons)
        .map(([key, child]) => ({ key, seasonNumber: parseSeasonKey(key), child }))
        .filter((entry) => entry.seasonNumber === season);

      for (const entry of ordered) {
        const seasonValue = entry.child;
        const episodes = Array.isArray(seasonValue)
          ? seasonValue
          : seasonValue && typeof seasonValue === "object"
            ? seasonValue.episodes
            : null;
        const direct = pickEpisodeFromArray(episodes, episode);
        if (direct) return direct;

        const nested = visit(seasonValue, season);
        if (nested) return nested;
      }
    }

    // Flat shape:
    // { episodes: [".../episode-1", ".../episode-2"] }
    if (Array.isArray(value.episodes) && season === 1) {
      const direct = pickEpisodeFromArray(value.episodes, episode);
      if (direct) return direct;
    }

    // Top-level season map:
    // { "1": ["url1", "url2"], "2": [...] }
    for (const [key, child] of Object.entries(value)) {
      const childSeason = parseSeasonKey(key);
      if (childSeason === season) {
        const episodes = Array.isArray(child)
          ? child
          : child && typeof child === "object"
            ? child.episodes
            : null;
        const direct = pickEpisodeFromArray(episodes, episode);
        if (direct) return direct;

        const nested = visit(child, season);
        if (nested) return nested;
      }
    }

    // Structured single episode object fallback.
    const ep = episodeNumberOf(value);
    const sn = seasonNumberOf(value);
    if (
      Number.isFinite(ep) &&
      ep === episode &&
      (!Number.isFinite(sn) || sn === season)
    ) {
      const urls = episodeUrlsOf(value);
      if (urls.length) return { item: value, urls };
    }

    // Generic nested response wrappers: data/response/payload/result/etc.
    for (const [key, child] of Object.entries(value)) {
      if (key === "seasons" || key === "episodes") continue;
      if (parseSeasonKey(key) === season) continue;
      const match = visit(child, inheritedSeason);
      if (match) return match;
    }

    return null;
  };

  return visit(payload);
}

async function resolveEpisode(payload, env) {
  if (payload?.mode === "iframe") return await resolveAkwamIframeOnly(payload, "series", env);
  const explicitSource = normalizeAkwamUrl(
    payload?.source_url ?? payload?.content_url ?? payload?.contentUrl,
  );

  if (explicitSource) {
    if (!isAkwamUrl(explicitSource)) {
      throw new Error("Only Akwam playback sources are allowed");
    }

    return await resolveViaAkwamResolver({
      ...payload,
      content_url: explicitSource,
      source_url: explicitSource,
    }, "series", env);
  }

  try {
    return await resolveViaAkwamResolver(payload, "series", env);
  } catch (error) {
    console.warn(
      "Akwam resolver episode fallback:",
      error instanceof Error ? error.message : String(error),
    );
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
      return await resolveDiscoveredAkwamContent(payload, "series", source, env);
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
        const stream = await resolveMovie(payload || {}, env);
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
        const stream = await resolveEpisode(payload || {}, env);
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

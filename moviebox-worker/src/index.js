/**
 * MovieBox API — Cloudflare Worker
 *
 * A complete port of the Python FastAPI to a zero-RAM Cloudflare Worker.
 * All endpoints use the MovieBox backend JSON APIs directly (no HTML scraping).
 * Video streaming pipes ReadableStream straight through — zero buffering.
 *
 * H5 auth note:
 * MovieBox's web H5 API now bootstraps a guest bearer token through the app
 * metadata endpoint. Reusing it avoids the current 429 RESOURCE_EXHAUSTED
 * response seen on unauthenticated H5 subject/search requests.
 */

const SUPABASE_MOVIEBOX_URL =
  "https://btrjguegbmusijsyylwl.supabase.co/functions/v1/movyz-moviebox";

const BASE_URL = "https://moviebox.pk";
const H5_API = "https://h5-api.aoneroom.com";
const DEFAULT_DOMAIN = "https://123movienow.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const H5_TIMEOUT_MS = 12_000;
const H5_AUTH_CACHE_KEY = "https://movyz-moviebox.invalid/__h5_auth_token";

let h5AuthToken = null;
let h5AuthExpiresAt = 0;
let h5AuthPromise = null;

function md5Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const originalLength = bytes.length;
  const bitLength = originalLength * 8;
  const paddedLength = ((originalLength + 8) >> 6 << 6) + 64;
  const message = new Uint8Array(paddedLength);
  message.set(bytes);
  message[originalLength] = 0x80;

  const view = new DataView(message.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const s = [
    7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
    5,9,14,20, 5,9,14,20, 5,9,14,20, 5,9,14,20,
    4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
    6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21,
  ];
  const k = Array.from({length:64}, (_, i) =>
    Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0
  );
  const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

  for (let offset = 0; offset < message.length; offset += 64) {
    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(offset + i * 4, true);

    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const next = d;
      d = c;
      c = b;
      b = (b + rotl((a + f + k[i] + m[g]) >>> 0, s[i])) >>> 0;
      a = next;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const words = [a0,b0,c0,d0];
  let hex = "";
  for (const word of words) {
    for (let i = 0; i < 4; i++) hex += ((word >>> (8 * i)) & 0xff).toString(16).padStart(2, "0");
  }
  return hex;
}

async function generateClientToken() {
  // MovieBox web currently signs the current Unix timestamp in seconds.
  const timestamp = String(Math.floor(Date.now() / 1000));
  const reversed = timestamp.split("").reverse().join("");
  return `${timestamp},${await md5Hex(reversed)}`;
}

function decodeJwtExpSeconds(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded));
    return typeof parsed.exp === "number" ? parsed.exp : null;
  } catch {
    return null;
  }
}

function extractH5AuthToken(response) {
  const raw = response.headers.get("x-user");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.token === "string" && parsed.token ? parsed.token : null;
  } catch {
    return null;
  }
}

async function cacheH5AuthToken(token) {
  const exp = decodeJwtExpSeconds(token) || Math.floor(Date.now() / 1000) + 86_400;
  h5AuthToken = token;
  h5AuthExpiresAt = exp * 1000;
}

async function readCachedH5AuthToken() {
  if (h5AuthToken && Date.now() < h5AuthExpiresAt - 60_000) {
    return h5AuthToken;
  }
  return null;
}

async function bootstrapH5AuthToken() {
  const response = await fetch(
    `${H5_API}/wefeed-h5api-bff/app/get-latest-app-pkgs?appName=moviebox&packageName=com.community.oneroom&channelType=CHANNEL_OWN`,
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json;charset=UTF-8",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
        "User-Agent": UA,
        "X-Client-Info": '{"timezone":"UTC"}',
        "X-Client-Token": await generateClientToken(),
        "X-Request-Lang": "en",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(H5_TIMEOUT_MS),
    },
  );

  const token = extractH5AuthToken(response);
  if (!response.ok || !token) {
    let snippet = "";
    try {
      snippet = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
    } catch {}
    throw new Error(
      `MovieBox H5 auth bootstrap failed: HTTP ${response.status}${snippet ? ` ${snippet}` : ""}`,
    );
  }

  await cacheH5AuthToken(token);
  return token;
}

async function getH5AuthToken() {
  const cached = await readCachedH5AuthToken();
  if (cached) return cached;

  if (!h5AuthPromise) {
    h5AuthPromise = bootstrapH5AuthToken().finally(() => {
      h5AuthPromise = null;
    });
  }

  return h5AuthPromise;
}

function h5Headers(extra = {}, authToken = null) {
  return {
    Accept: "application/json, text/plain, */*",
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
    "User-Agent": UA,
    "X-Client-Info": '{"timezone":"UTC"}',
    "X-Request-Lang": "en",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...extra,
  };
}

async function fetchH5(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), H5_TIMEOUT_MS);

  try {
    const authToken = await getH5AuthToken();
    const response = await fetch(`${H5_API}${path}`, {
      ...init,
      headers: h5Headers(init.headers || {}, authToken),
      signal: controller.signal,
      redirect: "follow",
    });

    const rotatedToken = extractH5AuthToken(response);
    if (rotatedToken && rotatedToken !== authToken) {
      await cacheH5AuthToken(rotatedToken);
    }

    return response;
  } finally {
    clearTimeout(timer);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Stream-Resolution",
};

// ══════════════════════════════════════════════════════════════════
// Router
// ══════════════════════════════════════════════════════════════════

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";

    try {
      // ── Home ──────────────────────────────────────────────
      if (p === "/") return await handleRoot();
      if (p === "/home") return await handleHome();
      if (p === "/home/sections") return await handleHomeSections();
      if (p === "/home/banner") return await handleHomeBanner();
      if (p === "/home/trending") return await handleHomeFilter("trending now", "popular movie");
      if (p === "/home/hot") return await handleHomeFilter("hot");
      if (p === "/home/cinema") return await handleHomeFilter("cinema", "popular series");

      // ── Home section by name ──────────────────────────────
      let m = p.match(/^\/home\/section\/(.+)$/);
      if (m) return await handleHomeSectionByName(decodeURIComponent(m[1]));

      // ── Movies ────────────────────────────────────────────
      if (p === "/movies") return await handleCategory("movie");
      m = p.match(/^\/movies\/sections$/);
      if (m) return await handleCategorySections("movie");
      m = p.match(/^\/movies\/section\/(.+)$/);
      if (m) return await handleCategorySectionByName("movie", decodeURIComponent(m[1]));

      // ── TV Series ─────────────────────────────────────────
      if (p === "/tv-series") return await handleCategory("tv-series");
      m = p.match(/^\/tv-series\/sections$/);
      if (m) return await handleCategorySections("tv-series");
      m = p.match(/^\/tv-series\/section\/(.+)$/);
      if (m) return await handleCategorySectionByName("tv-series", decodeURIComponent(m[1]));

      // ── Animation ─────────────────────────────────────────
      if (p === "/animation") return await handleCategory("animated-series");
      m = p.match(/^\/animation\/sections$/);
      if (m) return await handleCategorySections("animated-series");
      m = p.match(/^\/animation\/section\/(.+)$/);
      if (m) return await handleCategorySectionByName("animated-series", decodeURIComponent(m[1]));

      // ── Ranking ───────────────────────────────────────────
      if (p === "/ranking") return await handleRanking();
      m = p.match(/^\/ranking\/sections$/);
      if (m) return await handleRankingSections();
      m = p.match(/^\/ranking\/section\/(.+)$/);
      if (m) return await handleRankingSectionByName(decodeURIComponent(m[1]));

      // ── Search ────────────────────────────────────────────
      if (p === "/search/suggest") return await handleSearchSuggest(url.searchParams);
      if (p === "/search") return await handleSearch(url.searchParams);

      // ── Detail ────────────────────────────────────────────
      m = p.match(/^\/detail\/(.+)$/);
      if (m) return await handleDetail(decodeURIComponent(m[1]));

      // ── Episodes ──────────────────────────────────────────
      m = p.match(/^\/episodes\/(.+)$/);
      if (m) return await handleEpisodes(decodeURIComponent(m[1]));

      // ── Streaming ─────────────────────────────────────────
      m = p.match(/^\/api\/stream\/(\d+)$/);
      if (m) return await handleStreamApi(m[1], url.searchParams);

      m = p.match(/^\/watch\/(\d+)$/);
      if (m) return await handleWatch(m[1], url.searchParams, request);

      return json({ error: "Not found" }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      console.error("MovieBox Worker request failed", p, message);
      return json({ error: message, stage: "request" }, 502);
    }
  },
};

// ══════════════════════════════════════════════════════════════════
// GET /  — endpoint listing
// ══════════════════════════════════════════════════════════════════

function handleRoot() {
  return json({
    api: "MovieBox API",
    version: "4.0.0",
    runtime: "Cloudflare Worker (zero RAM)",
    endpoints: {
      home: {
        "/home": "Get home page data (banners and sections)",
        "/home/sections": "List section names",
        "/home/section/{name}": "Get a section by name",
        "/home/banner": "Get banner items",
        "/home/trending": "Get trending section",
        "/home/hot": "Get hot section",
        "/home/cinema": "Get cinema section",
      },
      movies: {
        "/movies": "Get all movies",
        "/movies/sections": "List movie sections",
        "/movies/section/{name}": "Get a movie section by name",
      },
      tv_series: {
        "/tv-series": "Get all TV series",
        "/tv-series/sections": "List TV series sections",
        "/tv-series/section/{name}": "Get a TV series section by name",
      },
      animation: {
        "/animation": "Get all animations",
        "/animation/sections": "List animation sections",
        "/animation/section/{name}": "Get an animation section by name",
      },
      ranking: {
        "/ranking": "Get ranking lists",
        "/ranking/sections": "List ranking sections",
        "/ranking/section/{name}": "Get a ranking section by name",
      },
      search: {
        "/search?q={query}": "Search for titles",
        "/search/suggest?q={query}": "Get autocomplete suggestions",
      },
      detail: {
        "/detail/{slug}": "Get full metadata, cast, seasons, streams",
        "/episodes/{slug}": "Get episode list and counts for all seasons",
      },
      streaming: {
        "/api/stream/{subject_id}?detail_path=...": "Get raw stream URLs (JSON)",
        "/watch/{subject_id}?detail_path=...&resolution=480":
          "Stream video directly (zero-buffer proxy). Params: detail_path, se, ep, resolution",
      },
    },
  });
}

// ══════════════════════════════════════════════════════════════════
// GET /home
// ══════════════════════════════════════════════════════════════════

async function fetchHomeData() {
  const resp = await fetchH5(
    "/wefeed-h5api-bff/home?host=moviebox.pk",
  );
  if (!resp.ok) throw new Error(`Home API returned ${resp.status}`);
  const body = await resp.json();
  const ops = body?.data?.operatingList || [];

  const sections = [];
  for (const op of ops) {
    const title = op.title || "";

    // Banner
    if (op.banner) {
      const items = (op.banner.items || [])
        .filter((i) => i.title && !i.title.includes("Communities"))
        .map((i) => ({
          name: i.title,
          poster_url:
            i.image?.url || i.subject?.cover?.url || null,
          url: i.detailPath
            ? `${BASE_URL}/detail/${i.detailPath}`
            : null,
          badge: i.subject?.corner || null,
          slug: i.detailPath || null,
        }));
      sections.push({
        section: "Banner",
        count: items.length,
        movies: items,
        more_url: null,
      });
      continue;
    }

    const subs = op.subjects || [];
    if (!subs.length || !title) continue;

    const movies = subs.map((s) => ({
      name: s.title || s.name,
      poster_url: s.cover?.url || s.thumbnail || null,
      url: s.detailPath ? `${BASE_URL}/detail/${s.detailPath}` : null,
      slug: s.detailPath || null,
      badge: s.corner || null,
      blurhash: s.cover?.blurHash || null,
    }));

    sections.push({
      section: title,
      count: movies.length,
      movies,
      more_url: null,
    });
  }
  return sections;
}

async function handleHome() {
  const sections = await fetchHomeData();
  return json({
    source: `${H5_API}/wefeed-h5api-bff/home`,
    total_sections: sections.length,
    poster_map_size: 0,
    sections,
  });
}

async function handleHomeSections() {
  const sections = await fetchHomeData();
  return json({
    total: sections.length,
    sections: sections.map((s) => ({
      name: s.section,
      count: s.count,
      more_url: s.more_url,
    })),
  });
}

async function handleHomeBanner() {
  const sections = await fetchHomeData();
  const banner = sections.find((s) => s.section === "Banner");
  return json({
    count: banner ? banner.count : 0,
    featured: banner ? banner.movies : [],
  });
}

async function handleHomeFilter(...keywords) {
  const sections = await fetchHomeData();
  const match = sections.find((s) =>
    keywords.some((kw) => s.section.toLowerCase().includes(kw))
  );
  if (!match) return json({ error: "Section not found" }, 404);
  return json(match);
}

async function handleHomeSectionByName(name) {
  const sections = await fetchHomeData();
  const matched = sections.filter((s) =>
    s.section.toLowerCase().includes(name.toLowerCase())
  );
  if (!matched.length) {
    return json(
      {
        message: `No section matching '${name}'`,
        available: sections.map((s) => s.section),
      },
      404
    );
  }
  return json({ results: matched });
}

// ══════════════════════════════════════════════════════════════════
// GET /movies, /tv-series, /animation  (category pages)
// Uses the backend filter API instead of scraping HTML
// ══════════════════════════════════════════════════════════════════

async function fetchCategoryData(category) {
  // Map route names to the backend API filter type
  const typeMap = {
    movie: "movie",
    "tv-series": "tvSeries",
    "animated-series": "anime",
  };
  const filterType = typeMap[category] || category;

  const resp = await fetchH5(
    `/wefeed-h5api-bff/subject/filter?type=${filterType}&page=1&perPage=60`,
  );

  if (!resp.ok) throw new Error(`Category API returned ${resp.status}`);
  const body = await resp.json();
  const items = body?.data?.items || [];

  const movies = items.map((s) => ({
    name: s.title || s.name || "",
    poster_url: s.cover?.url || null,
    url: s.detailPath ? `${BASE_URL}/detail/${s.detailPath}` : null,
    slug: s.detailPath || null,
    badge: s.corner || null,
    blurhash: s.cover?.blurHash || null,
    year: s.releaseDate || null,
    rating: s.imdbRatingValue || null,
  }));

  const sectionName =
    category === "movie"
      ? "All Movies"
      : category === "tv-series"
        ? "All TV Series"
        : "All Animation";

  return [
    {
      section: sectionName,
      more_url: null,
      count: movies.length,
      movies,
    },
  ];
}

async function handleCategory(category) {
  const sections = await fetchCategoryData(category);
  return json({
    source: `${H5_API}/wefeed-h5api-bff/subject/filter`,
    total_sections: sections.length,
    poster_map_size: 0,
    sections,
  });
}

async function handleCategorySections(category) {
  const sections = await fetchCategoryData(category);
  return json({
    total: sections.length,
    sections: sections.map((s) => ({
      name: s.section,
      count: s.count,
      more_url: s.more_url,
    })),
  });
}

async function handleCategorySectionByName(category, name) {
  const sections = await fetchCategoryData(category);
  const matched = sections.filter((s) =>
    s.section.toLowerCase().includes(name.toLowerCase())
  );
  if (!matched.length) {
    return json(
      {
        message: `No section matching '${name}'`,
        available: sections.map((s) => s.section),
      },
      404
    );
  }
  return json({ results: matched });
}

// ══════════════════════════════════════════════════════════════════
// GET /ranking
// ══════════════════════════════════════════════════════════════════

async function fetchRankingData() {
  const resp = await fetchH5("/wefeed-h5api-bff/subject/rank-list");
  if (!resp.ok) throw new Error(`Ranking API returned ${resp.status}`);
  const body = await resp.json();
  const lists = body?.data || [];

  const sections = [];
  for (const list of Array.isArray(lists) ? lists : [lists]) {
    const title = list.title || "Most Watched";
    const items = list.items || list.subjects || [];
    const movies = items.map((s, i) => ({
      name: s.title || s.name || "",
      poster_url: s.cover?.url || null,
      url: s.detailPath ? `${BASE_URL}/detail/${s.detailPath}` : null,
      slug: s.detailPath || null,
      rank: String(i + 1),
      badge: s.corner || null,
    }));
    sections.push({
      section: title,
      more_url: null,
      count: movies.length,
      movies,
    });
  }
  return sections;
}

async function handleRanking() {
  const sections = await fetchRankingData();
  return json({
    source: `${H5_API}/wefeed-h5api-bff/subject/rank-list`,
    total_sections: sections.length,
    poster_map_size: 0,
    sections,
  });
}

async function handleRankingSections() {
  const sections = await fetchRankingData();
  return json({
    total: sections.length,
    sections: sections.map((s) => ({
      name: s.section,
      count: s.count,
      more_url: s.more_url,
    })),
  });
}

async function handleRankingSectionByName(name) {
  const sections = await fetchRankingData();
  const matched = sections.filter((s) =>
    s.section.toLowerCase().includes(name.toLowerCase())
  );
  if (!matched.length) {
    return json(
      {
        message: `No section matching '${name}'`,
        available: sections.map((s) => s.section),
      },
      404
    );
  }
  return json({ results: matched });
}

async function fetchSupabaseMovieBox(path, query = new URLSearchParams()) {
  const target = new URL(path, SUPABASE_MOVIEBOX_URL + "/");
  for (const [key, value] of query.entries()) target.searchParams.set(key, value);

  const response = await fetch(target.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `Supabase MovieBox resolver HTTP ${response.status}: ${raw.replace(/\\s+/g, " ").slice(0, 700)}`,
    );
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Supabase MovieBox resolver returned invalid JSON");
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /search/suggest  and  GET /search
// ══════════════════════════════════════════════════════════════════

async function handleSearchSuggest(params) {
  const q = params.get("q");
  if (!q) return json({ error: "q parameter required" }, 400);

  const resp = await fetchH5("/wefeed-h5api-bff/subject/search-suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword: q, perPage: 10 }),
  });
  if (!resp.ok) return upstreamFailure("search-suggest", resp);
  const body = await resp.json();
  const items = body?.data?.items || body?.items || [];
  return json({ query: q, suggestions: items.map((i) => i.word).filter(Boolean) });
}

async function handleSearch(params) {
  const q = params.get("q");
  if (!q) return json({ error: "q parameter required" }, 400);

  return json(
    await fetchSupabaseMovieBox("/search", new URLSearchParams({ q })),
  );
}

}

// ══════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════
// GET /detail/{slug}  — full metadata from the H5 detail API
// ══════════════════════════════════════════════════════════════════

async function handleDetail(slug) {
  return json(
    await fetchSupabaseMovieBox(`/detail/${encodeURIComponent(String(slug))}`),
  );
}

}

// ══════════════════════════════════════════════════════════════════
// GET /episodes/{slug}  — episode list from detail API
// ══════════════════════════════════════════════════════════════════

async function handleEpisodes(slug) {
  return json(
    await fetchSupabaseMovieBox(`/episodes/${encodeURIComponent(String(slug))}`),
  );
}

}

// ══════════════════════════════════════════════════════════════════
// GET /api/stream/{subject_id}  — raw stream URLs
// ══════════════════════════════════════════════════════════════════

async function handleStreamApi(subjectId, params) {
  const query = new URLSearchParams();
  query.set("detail_path", params.get("detail_path") || subjectId);
  query.set("se", params.get("se") || "0");
  query.set("ep", params.get("ep") || "0");

  return json(
    await fetchSupabaseMovieBox(
      `/api/stream/${encodeURIComponent(String(subjectId))}`,
      query,
    ),
  );
}

}

async function handleWatch(subjectId, params, request) {
  const query = new URLSearchParams();
  query.set("detail_path", params.get("detail_path") || subjectId);
  query.set("se", params.get("se") || "0");
  query.set("ep", params.get("ep") || "0");

  const payload = await fetchSupabaseMovieBox(
    `/api/stream/${encodeURIComponent(String(subjectId))}`,
    query,
  );
  const sources = Array.isArray(payload?.sources) ? payload.sources : [];
  if (!sources.length) return json({ error: "No streams found" }, 404);

  const requestedResolution = Number(params.get("resolution") || "0");
  let source = requestedResolution > 0
    ? sources.find((item) => Number.parseInt(String(item.resolution), 10) === requestedResolution)
    : null;
  if (!source) source = sources[0];

  if (!source?.url) return json({ error: "Stream URL is empty" }, 404);

  const rangeHeader = request.headers.get("Range");
  const headers = {
    Accept: "*/*",
    "User-Agent": UA,
    Referer: "https://moviebox.pk/",
  };
  if (rangeHeader) headers.Range = rangeHeader;

  const video = await fetch(source.url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });

  if (![200, 206, 416].includes(video.status)) {
    const body = await video.text();
    return json(
      {
        error: `CDN returned ${video.status}`,
        detail: body.slice(0, 300),
        stage: "watch",
      },
      502,
    );
  }

  const responseHeaders = new Headers(CORS);
  responseHeaders.set("Accept-Ranges", "bytes");
  responseHeaders.set(
    "Content-Type",
    video.headers.get("Content-Type") || "video/mp4",
  );
  responseHeaders.set("Cache-Control", "no-store");
  for (const name of ["Content-Length", "Content-Range"]) {
    const value = video.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new Response(video.body, {
    status: video.status,
    headers: responseHeaders,
  });
}


// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════

async function upstreamFailure(stage, response) {
  let snippet = "";
  try {
    snippet = (await response.text()).replace(/\\s+/g, " ").slice(0, 500);
  } catch {}
  return json(
    {
      error: `MovieBox upstream request failed`,
      stage,
      upstreamStatus: response.status,
      responseSnippet: snippet || null,
    },
    502,
  );
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

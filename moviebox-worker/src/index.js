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
  const timestamp = String(Date.now());
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

  try {
    const ttl = Math.max(60, Math.floor((h5AuthExpiresAt - Date.now()) / 1000) - 60);
    await caches.default.put(
      H5_AUTH_CACHE_KEY,
      new Response(token, {
        headers: {
          "Cache-Control": `public, max-age=${ttl}`,
          "X-Expires-At": String(exp),
        },
      }),
    );
  } catch (error) {
    console.warn("MovieBox H5 auth cache write failed", error);
  }
}

async function readCachedH5AuthToken() {
  if (h5AuthToken && Date.now() < h5AuthExpiresAt - 60_000) {
    return h5AuthToken;
  }

  try {
    const cached = await caches.default.match(H5_AUTH_CACHE_KEY);
    if (!cached) return null;

    const token = (await cached.text()).trim();
    const expiresAt = Number(cached.headers.get("X-Expires-At") || 0);
    if (!token || !expiresAt || Date.now() >= expiresAt * 1000 - 60_000) {
      return null;
    }

    h5AuthToken = token;
    h5AuthExpiresAt = expiresAt * 1000;
    return token;
  } catch (error) {
    console.warn("MovieBox H5 auth cache read failed", error);
    return null;
  }
}

async function bootstrapH5AuthToken() {
  const response = await fetch(
    `${H5_API}/wefeed-h5api-bff/app/get-latest-app-pkgs?appName=moviebox`,
    {
      headers: {
        Accept: "application/json",
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
    "Content-Length, Content-Range, Accept-Ranges, X-Stream-Resolution",
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
      if (p === "/") return handleRoot();
      if (p === "/home") return handleHome();
      if (p === "/home/sections") return handleHomeSections();
      if (p === "/home/banner") return handleHomeBanner();
      if (p === "/home/trending") return handleHomeFilter("trending now", "popular movie");
      if (p === "/home/hot") return handleHomeFilter("hot");
      if (p === "/home/cinema") return handleHomeFilter("cinema", "popular series");

      // ── Home section by name ──────────────────────────────
      let m = p.match(/^\/home\/section\/(.+)$/);
      if (m) return handleHomeSectionByName(decodeURIComponent(m[1]));

      // ── Movies ────────────────────────────────────────────
      if (p === "/movies") return handleCategory("movie");
      m = p.match(/^\/movies\/sections$/);
      if (m) return handleCategorySections("movie");
      m = p.match(/^\/movies\/section\/(.+)$/);
      if (m) return handleCategorySectionByName("movie", decodeURIComponent(m[1]));

      // ── TV Series ─────────────────────────────────────────
      if (p === "/tv-series") return handleCategory("tv-series");
      m = p.match(/^\/tv-series\/sections$/);
      if (m) return handleCategorySections("tv-series");
      m = p.match(/^\/tv-series\/section\/(.+)$/);
      if (m) return handleCategorySectionByName("tv-series", decodeURIComponent(m[1]));

      // ── Animation ─────────────────────────────────────────
      if (p === "/animation") return handleCategory("animated-series");
      m = p.match(/^\/animation\/sections$/);
      if (m) return handleCategorySections("animated-series");
      m = p.match(/^\/animation\/section\/(.+)$/);
      if (m) return handleCategorySectionByName("animated-series", decodeURIComponent(m[1]));

      // ── Ranking ───────────────────────────────────────────
      if (p === "/ranking") return handleRanking();
      m = p.match(/^\/ranking\/sections$/);
      if (m) return handleRankingSections();
      m = p.match(/^\/ranking\/section\/(.+)$/);
      if (m) return handleRankingSectionByName(decodeURIComponent(m[1]));

      // ── Search ────────────────────────────────────────────
      if (p === "/search/suggest") return handleSearchSuggest(url.searchParams);
      if (p === "/search") return handleSearch(url.searchParams);

      // ── Detail ────────────────────────────────────────────
      m = p.match(/^\/detail\/(.+)$/);
      if (m) return handleDetail(decodeURIComponent(m[1]));

      // ── Episodes ──────────────────────────────────────────
      m = p.match(/^\/episodes\/(.+)$/);
      if (m) return handleEpisodes(decodeURIComponent(m[1]));

      // ── Streaming ─────────────────────────────────────────
      m = p.match(/^\/api\/stream\/(\d+)$/);
      if (m) return handleStreamApi(m[1], url.searchParams);

      m = p.match(/^\/watch\/(\d+)$/);
      if (m) return handleWatch(m[1], url.searchParams, request);

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

  const resp = await fetchH5("/wefeed-h5api-bff/subject/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword: q, perPage: 30, page: 1 }),
  });
  if (!resp.ok) return upstreamFailure("search", resp);

  let body;
  try { body = await resp.json(); } catch { return json({ error: "MovieBox search returned invalid JSON", stage: "search" }, 502); }
  const items = body?.data?.items || body?.data?.subjects || body?.items || [];
  if (!Array.isArray(items)) return json({ error: "MovieBox search returned an unexpected response", stage: "search" }, 502);

  const movies = items.map((s) => ({
    name: s.title || s.name || "",
    year: s.releaseDate || s.year || null,
    poster_url: s.cover?.url || s.poster?.url || null,
    url: s.detailPath ? `${BASE_URL}/detail/${s.detailPath}` : null,
    slug: s.detailPath || s.slug || null,
    badge: s.corner || null,
    blurhash: s.cover?.blurHash || null,
  })).filter((movie) => movie.slug && movie.name);

  return json({ query: q, count: movies.length, movies });
}

// ══════════════════════════════════════════════════════════════════
// GET /detail/{slug}  — full metadata from the H5 detail API
// ══════════════════════════════════════════════════════════════════

async function handleDetail(slug) {
  const resp = await fetchH5(`/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(slug)}`);
  if (!resp.ok) return upstreamFailure("detail", resp);

  let body;
  try { body = await resp.json(); } catch { return json({ error: "MovieBox detail returned invalid JSON", stage: "detail" }, 502); }
  const data = body?.data || {};
  const resource = data.resource || {};
  const subject = data.subject || resource.subject || resource || data;
  const subjectId = subject.subjectId || subject.id || data.subjectId || data.subject_id || resource.id;
  if (!subjectId) return json({ error: "MovieBox detail returned no subject ID", stage: "detail" }, 502);

  return json({
    slug,
    metadata: {
      id: String(subjectId),
      title: subject.title || data.title || "",
      description: subject.description || data.description || null,
      release_date: subject.releaseDate || data.releaseDate || null,
      duration: subject.duration || data.duration || null,
      genre: subject.genre || data.genre || [],
      country: subject.countryName || data.countryName || null,
      imdb_rating: subject.imdbRatingValue || data.imdbRatingValue || null,
      poster: subject.cover?.url || data.cover?.url || null,
      badge: subject.corner || data.corner || null,
      dubs: subject.dubs || data.dubs || [],
      top_cast: data.stars || subject.stars || [],
      seasons: resource.seasons || data.seasons || [],
      user_reviews: [],
    },
  });
}

// ══════════════════════════════════════════════════════════════════
// GET /episodes/{slug}  — episode list from detail API
// ══════════════════════════════════════════════════════════════════

async function handleEpisodes(slug) {
  const resp = await fetchH5(`/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(slug)}`);
  if (!resp.ok) return upstreamFailure("detail", resp);
  const body = await resp.json();
  const data = body?.data || {};
  const resource = data.resource || {};
  const seasonsData = resource.seasons || [];

  // MovieBox API detail returns nested list structures, let's find subjectId in resource or data
  const subjectId = data.subject?.subjectId || data.subjectId || resource.id || null;

  if (!seasonsData.length) {
    return json({
      slug,
      message: "No seasons/episodes found. This might be a movie.",
      seasons: []
    });
  }

  const seasons = seasonsData.map((s) => {
    const epCount = s.maxEp || 0;
    const episodes = [];
    for (let i = 1; i <= epCount; i++) {
      episodes.push({
        name: `Episode ${i}`,
        ep: i,
        se: s.se,
        watch_url: subjectId 
          ? `/watch/${subjectId}?detail_path=${slug}&se=${s.se}&ep=${i}` 
          : null,
        stream_api_url: subjectId 
          ? `/api/stream/${subjectId}?detail_path=${slug}&se=${s.se}&ep=${i}` 
          : null
      });
    }
    return {
      season: s.se,
      episode_count: epCount,
      episodes
    };
  });

  return json({
    slug,
    subject_id: subjectId,
    total_seasons: seasons.length,
    seasons
  });
}

// ══════════════════════════════════════════════════════════════════
// GET /api/stream/{subject_id}  — raw stream URLs
// ══════════════════════════════════════════════════════════════════

async function discoverDomain() {
  try {
    const resp = await fetchH5(
      "/wefeed-h5api-bff/media-player/get-domain",
      { headers: { "X-Client-Type": "h5" } }
    );
    if (resp.ok) {
      const d = await resp.json();
      return (d.data || DEFAULT_DOMAIN).replace(/\/+$/, "");
    }
  } catch {}
  return DEFAULT_DOMAIN;
}

async function fetchStreams(domain, subjectId, detailPath, se, ep) {
  const playUrl = `${domain}/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${detailPath}`;
  const resp = await fetch(playUrl, {
    headers: h5Headers({
      Referer: `${domain}/spa/videoPlayPage/movies/${detailPath}`,
      Origin: domain,
    }),
    redirect: "follow",
  });
  if (!resp.ok) {
    const detail = (await resp.text()).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`MovieBox stream failed: HTTP ${resp.status}${detail ? ` ${detail}` : ""}`);
  }
  let body;
  try { body = await resp.json(); } catch { throw new Error("MovieBox stream returned invalid JSON"); }
  const streams = body?.data?.streams || body?.data?.sources || body?.streams || body?.sources || [];
  if (!Array.isArray(streams)) throw new Error("MovieBox stream returned an unexpected response");
  return streams;
}

async function handleStreamApi(subjectId, params) {
  const detailPath = params.get("detail_path");
  if (!detailPath) return json({ error: "detail_path is required" }, 400);
  const se = params.get("se") || "0";
  const ep = params.get("ep") || "0";

  const domain = await discoverDomain();
  const streams = await fetchStreams(domain, subjectId, detailPath, se, ep);

  if (!streams.length) return json({ error: "No streams found" }, 404);

  const formatted = streams
    .map((s) => ({
      resolution: s.resolutions ? `${s.resolutions}p` : "Unknown",
      format: s.format || null,
      url: s.url,
      size_bytes: s.size || null,
      id: s.id || null,
    }))
    .sort((a, b) => {
      const ra = parseInt(a.resolution) || 0;
      const rb = parseInt(b.resolution) || 0;
      return rb - ra;
    });

  // Fetch subtitles (only EN requested)
  let subtitles = [];
  const streamId = streams[0]?.id;
  if (streamId) {
    try {
      const capUrl = `${H5_API}/wefeed-h5api-bff/subject/caption?subjectId=${subjectId}&id=${streamId}&detailPath=${detailPath}`;
      const capResp = await fetchH5(capUrl.replace(H5_API, ""));
      if (capResp.ok) {
        const capBody = await capResp.json();
        const subs = capBody?.data?.subtitles || [];
        subtitles = subs
          .filter((s) => s.lan === "en" || s.lanName?.toLowerCase().includes("english"))
          .map((s) => ({
            language: s.lanName || "English",
            url: s.url,
          }));
      } else {
        console.error("Caption API error:", await capResp.text());
      }
    } catch (err) {
      console.error("Subtitle fetch failed:", err);
    }
  }

  return json({
    subject_id: subjectId,
    detail_path: detailPath,
    season: parseInt(se),
    episode: parseInt(ep),
    stream_domain: domain,
    count: formatted.length,
    sources: formatted,
    subtitles,
  });
}

// ══════════════════════════════════════════════════════════════════
// GET /watch/{subject_id}  — zero-buffer video streaming
// ══════════════════════════════════════════════════════════════════

async function handleWatch(subjectId, params, request) {
  const detailPath = params.get("detail_path");
  if (!detailPath) return json({ error: "detail_path is required" }, 400);
  const se = params.get("se") || "0";
  const ep = params.get("ep") || "0";
  const resolution = parseInt(params.get("resolution") || "0", 10);

  const domain = await discoverDomain();
  const streams = await fetchStreams(domain, subjectId, detailPath, se, ep);
  if (!streams.length) return json({ error: "No streams found" }, 404);

  // Pick resolution
  let stream;
  if (resolution > 0) {
    stream =
      streams.find((s) => parseInt(s.resolutions) === resolution) ||
      streams[streams.length - 1];
  } else {
    stream = streams.sort(
      (a, b) => parseInt(b.resolutions) - parseInt(a.resolutions)
    )[0];
  }

  const streamUrl = stream.url;
  if (!streamUrl) return json({ error: "Stream URL is empty" }, 404);

  // Build CDN headers
  const cdnHeaders = {
    Referer: `${domain}/`,
    Origin: domain,
    Accept: "*/*",
    "User-Agent": UA,
  };

  // Forward Range header for seeking
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) cdnHeaders["Range"] = rangeHeader;

  const vidResp = await fetch(streamUrl, {
    headers: cdnHeaders,
    redirect: "follow",
  });

  if (vidResp.status !== 200 && vidResp.status !== 206) {
    const errBody = await vidResp.text();
    return json(
      { error: `CDN returned ${vidResp.status}`, detail: errBody.slice(0, 200) },
      vidResp.status
    );
  }

  // Response headers
  const respHeaders = new Headers(CORS);
  respHeaders.set("Accept-Ranges", "bytes");
  respHeaders.set(
    "Content-Type",
    vidResp.headers.get("Content-Type") || "video/mp4"
  );
  respHeaders.set("X-Stream-Resolution", `${stream.resolutions}p`);
  respHeaders.set("Cache-Control", "no-store");

  const cl = vidResp.headers.get("Content-Length");
  if (cl) respHeaders.set("Content-Length", cl);
  const cr = vidResp.headers.get("Content-Range");
  if (cr) respHeaders.set("Content-Range", cr);

  // Pipe ReadableStream straight through — ZERO buffering
  return new Response(vidResp.body, {
    status: vidResp.status,
    headers: respHeaders,
  });
}

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

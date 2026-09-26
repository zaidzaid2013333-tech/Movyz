/**
 * MovieBox API — Cloudflare Worker
 *
 * A complete port of the Python FastAPI to a zero-RAM Cloudflare Worker.
 * All endpoints use the MovieBox backend JSON APIs directly (no HTML scraping).
 * Video streaming pipes ReadableStream straight through — zero buffering.
 */

const BASE_URL = "https://moviebox.ph";
const H5_API = "https://h5-api.aoneroom.com";
const DEFAULT_DOMAIN = "https://123movienow.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
      return json({ error: err.message || "Internal error" }, 500);
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
  const resp = await fetch(
    `${H5_API}/wefeed-h5api-bff/home?host=moviebox.ph`,
    { headers: { "User-Agent": UA } }
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

  const resp = await fetch(
    `${H5_API}/wefeed-h5api-bff/subject/filter?type=${filterType}&page=1&perPage=60`,
    {
      headers: {
        "User-Agent": UA,
        accept: "application/json",
      },
    }
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
  const resp = await fetch(
    `${H5_API}/wefeed-h5api-bff/subject/rank-list`,
    { headers: { "User-Agent": UA, accept: "application/json" } }
  );
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

  const resp = await fetch(
    `${H5_API}/wefeed-h5api-bff/subject/search-suggest`,
    {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: q, perPage: 10 }),
    }
  );
  if (!resp.ok) return json({ error: "Search API failed" }, 502);
  const body = await resp.json();
  const items = body?.data?.items || [];
  return json({
    query: q,
    suggestions: items.map((i) => i.word).filter(Boolean),
  });
}

async function handleSearch(params) {
  const q = params.get("q");
  if (!q) return json({ error: "q parameter required" }, 400);

  const resp = await fetch(
    `${H5_API}/wefeed-h5api-bff/subject/search`,
    {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: q, perPage: 30, page: 1 }),
    }
  );
  if (!resp.ok) return json({ error: "Search API failed" }, 502);
  const body = await resp.json();
  const items = body?.data?.items || [];

  const movies = items.map((s) => ({
    name: s.title || "",
    poster_url: s.cover?.url || null,
    url: s.detailPath ? `${BASE_URL}/detail/${s.detailPath}` : null,
    slug: s.detailPath || null,
    badge: s.corner || null,
    blurhash: s.cover?.blurHash || null,
  }));

  return json({ query: q, count: movies.length, movies });
}

// ══════════════════════════════════════════════════════════════════
// GET /detail/{slug}  — full metadata from NUXT_DATA
// ══════════════════════════════════════════════════════════════════

async function handleDetail(slug) {
  const pageUrl = `${BASE_URL}/detail/${slug}`;
  const resp = await fetch(pageUrl, {
    headers: { "User-Agent": UA },
    redirect: "follow",
  });
  if (!resp.ok) return json({ error: "Movie not found" }, 404);
  const html = await resp.text();

  // Extract __NUXT_DATA__
  const match = html.match(
    /<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) return json({ error: "Could not find NUXT data" }, 500);

  let nuxt;
  try {
    nuxt = JSON.parse(match[1]);
  } catch {
    return json({ error: "Failed to parse NUXT data" }, 500);
  }
  if (!Array.isArray(nuxt)) return json({ error: "Unexpected NUXT format" }, 500);

  // Resolve NUXT references
  function resolve(index) {
    if (typeof index !== "number" || index < 0 || index >= nuxt.length) return index;
    const val = nuxt[index];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const out = {};
      for (const [k, v] of Object.entries(val)) out[k] = resolve(v);
      return out;
    }
    if (Array.isArray(val)) return val.map(resolve);
    return val;
  }

  // Find movie metadata, seasons, cast, reviews
  let movieDict = null;
  let seasons = [];
  let topCast = [];
  let userReviews = [];

  for (let i = 0; i < nuxt.length; i++) {
    const resolved = resolve(i);
    if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) continue;

    if (resolved.subjectId && resolved.title && resolved.duration && !movieDict) {
      movieDict = resolved;
    }
    if (resolved.seasons) seasons = resolved.seasons;
    if (resolved.stars) topCast = resolved.stars;
    if (
      resolved.items &&
      Array.isArray(resolved.items) &&
      resolved.items.some((it) => it && typeof it === "object" && it.content)
    ) {
      userReviews = resolved.items;
    }
  }

  if (!movieDict) return json({ error: "Could not extract movie metadata" }, 404);

  // Collect stream URLs from raw data
  const mp4Urls = nuxt.filter((v) => typeof v === "string" && v.includes(".mp4"));
  const hlsUrls = nuxt.filter(
    (v) => typeof v === "string" && (v.includes(".m3u8") || v.includes("/m3u8/"))
  );

  return json({
    slug,
    source: pageUrl,
    metadata: {
      id: movieDict.subjectId,
      title: movieDict.title,
      description: movieDict.description,
      release_date: movieDict.releaseDate,
      duration: movieDict.duration,
      genre: movieDict.genre,
      country: movieDict.countryName,
      imdb_rating: movieDict.imdbRatingValue,
      poster:
        movieDict.cover && typeof movieDict.cover === "object"
          ? movieDict.cover.url
          : null,
      badge: movieDict.corner,
      dubs: movieDict.dubs || [],
      top_cast: topCast,
      seasons,
      user_reviews: userReviews
        .filter((r) => r && typeof r === "object" && r.content)
        .map((r) => ({
          user: r.user?.nickname || null,
          content: r.content,
          created_at: r.createdAt || null,
        })),
    },
    streams: { mp4: mp4Urls, hls: hlsUrls },
  });
}

// ══════════════════════════════════════════════════════════════════
// GET /episodes/{slug}  — episode list from detail API
// ══════════════════════════════════════════════════════════════════

async function handleEpisodes(slug) {
  const resp = await fetch(
    `${H5_API}/wefeed-h5api-bff/detail?detailPath=${slug}`,
    { headers: { "User-Agent": UA } }
  );
  if (!resp.ok) return json({ error: "Movie/Series not found" }, 404);
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
    const resp = await fetch(
      `${H5_API}/wefeed-h5api-bff/media-player/get-domain`,
      { headers: { "User-Agent": UA, "X-Client-Type": "h5" } }
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
    headers: {
      accept: "application/json",
      referer: `${domain}/spa/videoPlayPage/movies/${detailPath}`,
      "x-client-info": '{"timezone":"Asia/Dhaka"}',
      cookie: "uuid=d8c3539e-2e46-4000-af20-7046a856e30a",
      "User-Agent": UA,
    },
  });
  if (!resp.ok) throw new Error(`Play API returned ${resp.status}`);
  const body = await resp.json();
  return body?.data?.streams || [];
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
      const capResp = await fetch(capUrl, {
        headers: { 
          "User-Agent": UA, 
          accept: "application/json",
          "x-client-info": '{"timezone":"Asia/Dhaka"}',
          cookie: "uuid=d8c3539e-2e46-4000-af20-7046a856e30a"
        },
      });
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

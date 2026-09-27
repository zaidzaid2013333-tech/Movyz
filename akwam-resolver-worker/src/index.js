import { launch } from "@cloudflare/playwright";

const SEARCH_BASES = [
  "https://ak.sv",
  "https://akwam.it",
  "https://akwam.ss",
  "https://akwam.net",
  "https://akwam.ee",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const UA =
  "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function clean(v) {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeTitle(v) {
  return clean(v)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectType(url) {
  const v = String(url || "").toLowerCase();
  if (v.includes("m3u8")) return "hls";
  if (v.includes("mpd")) return "dash";
  if (v.includes("webm")) return "webm";
  return "mp4";
}

function mediaLike(url) {
  return /^https?:\/\//i.test(url || "") &&
    /(?:\.mp4|\.m3u8|\.mpd|\.webm)(?:[?#]|$)|(?:mp4|m3u8|mpd|webm)(?:[?#=&]|$)/i.test(url);
}

function absoluteUrl(value, base) {
  try { return new URL(value, base).toString(); } catch { return ""; }
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\\s\\S]*?<\\/script>/gi, " ")
    .replace(/<style[\\s\\S]*?<\\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\\s+/g, " ")
    .trim();
}

function challengePage(html) {
  const text = String(html || "").toLowerCase();
  return text.includes("just a moment") ||
    text.includes("enable javascript and cookies to continue") ||
    text.includes("cf-chl-") ||
    text.includes("cloudflare ray id");
}

function extractAnchors(html) {
  const out = [];
  const re = /<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi;
  for (const match of html.matchAll(re)) {
    const href = clean(match[1]);
    const text = stripHtml(match[2]);
    if (href) out.push({ href, text });
  }
  return out;
}

async function quickContent(browser, url) {
  const response = await browser.quickAction("content", {
    url,
    gotoOptions: { waitUntil: "domcontentloaded" },
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error("Browser Run content HTTP " + response.status);
  }
  if (challengePage(html)) {
    throw new Error("Akwam returned a bot-protection challenge page");
  }
  return { html, finalUrl: url };
}

function extractMediaCandidates(html, baseUrl) {
  const found = [];
  const seen = new Set();
  const add = (value) => {
    const url = absoluteUrl(clean(value), baseUrl);
    if (!mediaLike(url) || seen.has(url)) return;
    seen.add(url);
    found.push(url);
  };

  for (const match of String(html || "").matchAll(
    /https?:\\/\\/[^"'<>\\s]+\\.(?:mp4|m3u8|mpd|webm)(?:\\?[^"'<>\\s]*)?/gi
  )) add(match[0]);

  for (const match of String(html || "").matchAll(
    /https?:\\/\\/[^"'<>\\s]+\\/(?:download|file)\\/[^"'<>\\s]+/gi
  )) add(match[0]);

  return found;
}

function qualityLinks(html, baseUrl) {
  return extractAnchors(html)
    .filter((item) => /(?:2160p|1080p|720p|480p|360p)/i.test(item.text + " " + item.href))
    .map((item) => ({
      ...item,
      url: absoluteUrl(item.href, baseUrl),
      quality: (item.text.match(/(?:2160|1080|720|480|360)p/i) || [])[0] || "auto",
    }))
    .filter((item) => item.url);
}

function downloadLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();

  for (const item of extractAnchors(html)) {
    const url = absoluteUrl(item.href, baseUrl);
    if (!url || seen.has(url)) continue;
    if (/\\/(?:download|file)\\//i.test(url) || /download/i.test(item.text)) {
      seen.add(url);
      links.push(url);
    }
  }

  for (const match of String(html || "").matchAll(
    /https?:\\/\\/[^"'<>\\s]+\\/(?:download|file)\\/[^"'<>\\s]+/gi
  )) {
    if (!seen.has(match[0])) {
      seen.add(match[0]);
      links.push(match[0]);
    }
  }

  return links;
}

async function pickSearchResult(browser, title, type) {
  const query = encodeURIComponent(title);
  const section = type === "series" ? "series" : "movie";
  let lastError = "";

  for (const base of SEARCH_BASES) {
    const searchUrls = [
      base + "/search?q=" + query + "&section=" + section + "&page=1",
      base + "/search?q=" + query + "&section=" + section,
      base + "/search?q=" + query,
    ];

    for (const searchUrl of searchUrls) {
      try {
        const page = await quickContent(browser, searchUrl);
        const anchors = extractAnchors(page.html);
        const candidates = anchors
          .filter((item) => /\\bbox\\b/i.test(item.href) || /entry-title|entry-box/i.test(item.text))
          .map((item) => {
            const actual = normalizeTitle(item.text);
            const wanted = normalizeTitle(title);
            const score =
              actual === wanted ? 120 :
              actual.includes(wanted) ? 90 :
              wanted.includes(actual) ? 80 : 0;
            return {
              href: absoluteUrl(item.href, page.finalUrl),
              title: item.text,
              score,
            };
          })
          .filter((item) => item.href && item.score > 0)
          .sort((a, b) => b.score - a.score);

        if (candidates[0]) return candidates[0];

        const fallback = anchors
          .map((item) => {
            const actual = normalizeTitle(item.text);
            const wanted = normalizeTitle(title);
            const score =
              actual === wanted ? 100 :
              actual.includes(wanted) ? 75 :
              wanted.includes(actual) ? 60 : 0;
            return {
              href: absoluteUrl(item.href, page.finalUrl),
              title: item.text,
              score,
            };
          })
          .filter((item) => item.href && item.score > 0)
          .sort((a, b) => b.score - a.score);

        if (fallback[0]) return fallback[0];

        lastError = "no matching search result";
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  throw new Error("Akwam search failed: " + lastError);
}

async function extractFromPage(browser, pageUrl, season, episode) {
  let currentUrl = pageUrl;

  if (episode != null) {
    try {
      const page = await quickContent(browser, currentUrl);
      const wanted = Number(episode);
      const episodes = extractAnchors(page.html)
        .map((item) => ({
          ...item,
          url: absoluteUrl(item.href, page.finalUrl),
          n: Number((item.text.match(/(?:حلقة|episode|ep|الحلقة)\\s*[-:#]?\\s*(\\d+)/i) || [])[1] || -1),
        }))
        .filter((item) => item.n === wanted || /\\/episode\\/${wanted}(?:\\/|$)/i.test(item.url || ""));
      if (episodes[0]?.url) currentUrl = episodes[0].url;
    } catch {}
  }

  const first = await quickContent(browser, currentUrl);
  const direct = extractMediaCandidates(first.html, first.finalUrl);
  if (direct.length) {
    return {
      ok: true,
      page_url: first.finalUrl,
      media_url: direct[0],
      type: detectType(direct[0]),
      alternatives: direct.slice(0, 8),
    };
  }

  const qualities = qualityLinks(first.html, first.finalUrl)
    .sort((a, b) => Number(b.quality.replace(/\\D/g, "")) - Number(a.quality.replace(/\\D/g, "")));

  for (const quality of qualities.slice(0, 6)) {
    try {
      const second = await quickContent(browser, quality.url);
      const directSecond = extractMediaCandidates(second.html, second.finalUrl);
      if (directSecond.length) {
        return {
          ok: true,
          page_url: second.finalUrl,
          media_url: directSecond[0],
          type: detectType(directSecond[0]),
          quality: quality.quality,
          alternatives: directSecond.slice(0, 8),
        };
      }

      const downloads = downloadLinks(second.html, second.finalUrl);
      for (const downloadUrl of downloads.slice(0, 4)) {
        try {
          const third = await quickContent(browser, downloadUrl);
          const directThird = extractMediaCandidates(third.html, third.finalUrl);
          if (directThird.length) {
            return {
              ok: true,
              page_url: third.finalUrl,
              media_url: directThird[0],
              type: detectType(directThird[0]),
              quality: quality.quality,
              alternatives: directThird.slice(0, 8),
            };
          }

          const thirdDownloads = downloadLinks(third.html, third.finalUrl);
          for (const finalCandidate of thirdDownloads.slice(0, 2)) {
            if (isLikelyMediaUrl(finalCandidate)) {
              return {
                ok: true,
                page_url: third.finalUrl,
                media_url: finalCandidate,
                type: detectType(finalCandidate),
                quality: quality.quality,
                alternatives: [finalCandidate],
              };
            }
          }
        } catch {}
      }
    } catch {}
  }

  return {
    ok: true,
    page_url: first.finalUrl,
    media_url: null,
    type: null,
  };
}


export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return json({ ok: true, service: "movyz-akwam-resolver", browser: Boolean(env.BROWSER) });
    }

    if (request.method !== "POST" || new URL(request.url).pathname !== "/resolve") {
      return json({ ok: false, error: "Not found" }, 404);
    }

    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Valid JSON body required" }, 400); }

    const title = clean(payload?.title);
    const type = payload?.type === "series" ? "series" : "movie";
    const episode = Number.isInteger(Number(payload?.episode)) ? Number(payload.episode) : null;

    if (!title) return json({ ok: false, error: "title is required" }, 400);
    if (!env.BROWSER) return json({ ok: false, error: "Browser binding unavailable" }, 500);

    let browser;
    try {
      const { launch } = await import("@cloudflare/playwright");
      browser = await launch(env.BROWSER);
      const context = await browser.newContext({ userAgent: UA });
      const searchPage = await context.newPage();

      const result = await pickSearchResult(searchPage, title, type);
      await searchPage.close().catch(() => {});

      const extracted = await extractFromPage(context, result.href, null, episode);
      await context.close().catch(() => {});

      return json({
        ok: true,
        title: result.title,
        source_url: result.href,
        ...extracted,
      });
    } catch (error) {
      return json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, 502);
    } finally {
      await browser?.close().catch(() => {});
    }
  },
};

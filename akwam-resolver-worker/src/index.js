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

function detectType(url) {
  const value = String(url || "").toLowerCase();
  if (value.includes("m3u8")) return "hls";
  if (value.includes("mpd")) return "dash";
  if (value.includes("webm")) return "webm";
  return "mp4";
}

function mediaLike(url) {
  // Akwam's /download and /file routes are HTML redirect pages, not media.
  // Returning one of them as an MP4 made the old resolver look successful
  // while handing the player a document. Only advertise an actual media URL.
  return /^https?:\/\//i.test(url || "") && (
    /\.(?:mp4|m3u8|mpd|webm)(?:[?#]|$)/i.test(url) ||
    /(?:mp4|m3u8|mpd|webm)(?:[?#=&]|$)/i.test(url)
  );
}

function absoluteUrl(value, base) {
  try {
    return new URL(value, base).toString();
  } catch {
    return "";
  }
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
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
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of String(html || "").matchAll(regex)) {
    const href = clean(match[1]);
    const text = stripHtml(match[2]);
    if (href) out.push({ href, text });
  }

  return out;
}

async function quickContent(browser, url) {
  const response = await browser.quickAction("content", {
    url,
    userAgent: UA,
    gotoOptions: {
      waitUntil: "domcontentloaded",
    },
  });

  const html = await response.text();

  if (!response.ok) {
    throw new Error("Browser Run content HTTP " + response.status);
  }

  if (challengePage(html)) {
    throw new Error("Akwam returned a bot-protection challenge page");
  }

  return {
    html,
    // Browser Run returns a standards-compatible Response. `url` is set when
    // the browser followed a redirect; fall back for older Browser Run builds.
    finalUrl: response.url || url,
    contentType: response.headers.get("content-type") || "",
  };
}

function mediaCandidates(html, baseUrl) {
  const found = [];
  const seen = new Set();

  const add = (value) => {
    const url = absoluteUrl(clean(value), baseUrl);
    if (!mediaLike(url) || seen.has(url)) return;
    seen.add(url);
    found.push(url);
  };

  for (const match of String(html || "").matchAll(
    /https?:\/\/[^"'<>\s]+\.(?:mp4|m3u8|mpd|webm)(?:\?[^"'<>\s]*)?/gi
  )) {
    add(match[0]);
  }

  // Player configuration is often JSON encoded inside an inline script.
  for (const match of String(html || "").matchAll(
    /(?:file|src|source|stream)["'\s:=\\]+(https?:\\?\/\\?\/[^"'<>\s,}\\]+)/gi
  )) {
    add(match[1].replace(/\\\//g, "/"));
  }

  for (const node of extractAnchors(html)) {
    const url = absoluteUrl(node.href, baseUrl);
    if (url && /\/(?:download|file)\//i.test(url)) add(url);
  }

  return found;
}

function navigationLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const add = (value) => {
    const url = absoluteUrl(value, baseUrl);
    if (!url || seen.has(url)) return;
    if (!/(?:\/download\/|\/file\/|\/link\/\d+|download|watch|play)/i.test(url)) return;
    seen.add(url);
    links.push(url);
  };

  for (const item of extractAnchors(html)) add(item.href);
  for (const match of String(html || "").matchAll(
    /(?:href|data-(?:url|link)|data-download)=["']([^"']+)["']/gi
  )) add(match[1]);
  return links;
}

function qualityLinks(html, baseUrl) {
  return extractAnchors(html)
    .filter((item) =>
      /(?:2160p|1080p|720p|480p|360p)/i.test(item.text + " " + item.href) ||
      /\/link\/\d+/i.test(item.href)
    )
    .map((item) => ({
      url: absoluteUrl(item.href, baseUrl),
      label: item.text,
      quality:
        (item.text.match(/(?:2160|1080|720|480|360)p/i) || [])[0] ||
        (item.href.match(/(?:2160|1080|720|480|360)p/i) || [])[0] ||
        "auto",
    }))
    .filter((item) => item.url);
}

function downloadLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();

  const add = (value) => {
    const url = absoluteUrl(value, baseUrl);
    if (!url || seen.has(url)) return;
    if (!/\/(?:download|file)\//i.test(url) && !/download/i.test(url)) return;
    seen.add(url);
    links.push(url);
  };

  for (const node of extractAnchors(html)) add(node.href);

  for (const match of String(html || "").matchAll(
    /https?:\/\/[^"'<>\s]+\/(?:download|file)\/[^"'<>\s]+/gi
  )) {
    add(match[0]);
  }

  return links;
}

function bestTitleScore(title, wantedTitle) {
  const actual = normalizeTitle(title);
  const wanted = normalizeTitle(wantedTitle);

  if (!actual || !wanted) return 0;
  if (actual === wanted) return 120;
  if (actual.includes(wanted)) return 90;
  if (wanted.includes(actual)) return 80;
  return 0;
}

async function pickSearchResult(browser, title, type) {
  const query = encodeURIComponent(title);
  const section = type === "series" ? "series" : "movie";
  let lastError = "";

  for (const base of SEARCH_BASES) {
    const searchUrls = [
      base + "/search?q=" + query + "&section=" + section + "s&page=1",
      base + "/search?q=" + query + "&section=" + section + "&page=1",
      base + "/search?q=" + query + "&section=" + section,
      base + "/search?q=" + query,
      base + "/search?keyword=" + query,
    ];

    for (const searchUrl of searchUrls) {
      try {
        const page = await quickContent(browser, searchUrl);
        const anchors = extractAnchors(page.html);

        const preferred = anchors
          .filter((item) =>
            /\bbox\b/i.test(item.href) ||
            /(?:entry-title|entry-box)/i.test(item.text)
          )
          .map((item) => ({
            href: absoluteUrl(item.href, page.finalUrl),
            title: item.text,
            score: bestTitleScore(item.text, title),
          }))
          .filter((item) => item.href && item.score > 0)
          .sort((a, b) => b.score - a.score);

        if (preferred[0]) return preferred[0];

        const fallback = anchors
          .map((item) => ({
            href: absoluteUrl(item.href, page.finalUrl),
            title: item.text,
            score: bestTitleScore(item.text, title),
          }))
          .filter((item) =>
            item.href &&
            item.score > 0 &&
            !/\/(?:search|login|register|category|genre)\b/i.test(item.href)
          )
          .sort((a, b) => b.score - a.score);

        if (fallback[0]) return fallback[0];

        lastError =
          "no matching result at " +
          page.finalUrl +
          " (anchors=" +
          String(anchors.length) +
          ")";
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  throw new Error("Akwam search failed: " + lastError);
}

async function extractFromPage(browser, pageUrl, episode) {
  let currentUrl = pageUrl;

  if (episode != null) {
    try {
      const page = await quickContent(browser, currentUrl);
      const wanted = Number(episode);

      const episodeLink = extractAnchors(page.html)
        .map((item) => {
          const url = absoluteUrl(item.href, page.finalUrl);
          const match = item.text.match(
            /(?:حلقة|episode|ep|الحلقة)\s*[-:#]?\s*(\d+)/i
          );

          return {
            url,
            number: match ? Number(match[1]) : null,
          };
        })
        .find((item) =>
          item.number === wanted ||
          new URL(item.url || "https://example.invalid").pathname.includes(
            "/episode/" + wanted + "/"
          )
        );

      if (episodeLink?.url) currentUrl = episodeLink.url;
    } catch {}
  }

  const first = await quickContent(browser, currentUrl);
  if (mediaLike(first.finalUrl)) {
    return {
      ok: true,
      page_url: currentUrl,
      media_url: first.finalUrl,
      type: detectType(first.finalUrl),
      alternatives: [first.finalUrl],
    };
  }
  const direct = mediaCandidates(first.html, first.finalUrl);

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
    .sort((a, b) =>
      Number(b.quality.replace(/\D/g, "")) -
      Number(a.quality.replace(/\D/g, ""))
    );

  const pagesToFollow = [
    ...qualities.map((item) => ({ ...item, quality: item.quality || "auto" })),
    ...navigationLinks(first.html, first.finalUrl).map((url) => ({ url, quality: "auto" })),
  ].filter((item, index, items) =>
    item.url && items.findIndex((other) => other.url === item.url) === index
  );

  for (const quality of pagesToFollow.slice(0, 12)) {
    try {
      const second = await quickContent(browser, quality.url);

      if (mediaLike(second.finalUrl)) {
        return {
          ok: true,
          page_url: quality.url,
          media_url: second.finalUrl,
          type: detectType(second.finalUrl),
          quality: quality.quality,
          alternatives: [second.finalUrl],
        };
      }

      const secondDirect = mediaCandidates(
        second.html,
        second.finalUrl
      );

      if (secondDirect.length) {
        return {
          ok: true,
          page_url: second.finalUrl,
          media_url: secondDirect[0],
          type: detectType(secondDirect[0]),
          quality: quality.quality,
          alternatives: secondDirect.slice(0, 8),
        };
      }

      for (const downloadUrl of downloadLinks(
        second.html,
        second.finalUrl
      ).slice(0, 5)) {
        try {
          const third = await quickContent(browser, downloadUrl);

          if (mediaLike(third.finalUrl)) {
            return {
              ok: true,
              page_url: downloadUrl,
              media_url: third.finalUrl,
              type: detectType(third.finalUrl),
              quality: quality.quality,
              alternatives: [third.finalUrl],
            };
          }

          const thirdDirect = mediaCandidates(
            third.html,
            third.finalUrl
          );

          if (thirdDirect.length) {
            return {
              ok: true,
              page_url: third.finalUrl,
              media_url: thirdDirect[0],
              type: detectType(thirdDirect[0]),
              quality: quality.quality,
              alternatives: thirdDirect.slice(0, 8),
            };
          }

        } catch {}
      }
    } catch {}
  }

  throw new Error("Akwam result contained no direct mp4, m3u8, or mpd media URL");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS,
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "movyz-akwam-resolver",
        browser: Boolean(env.BROWSER),
        mode: "browser-run-quick-actions",
      });
    }

    if (request.method !== "POST" || url.pathname !== "/resolve") {
      return json({ ok: false, error: "Not found" }, 404);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json(
        { ok: false, error: "Valid JSON body required" },
        400
      );
    }

    const title = clean(payload?.title);
    const type = payload?.type === "series" ? "series" : "movie";
    const episode = Number.isInteger(Number(payload?.episode))
      ? Number(payload.episode)
      : null;

    if (!title) {
      return json({ ok: false, error: "title is required" }, 400);
    }

    if (!env.BROWSER || typeof env.BROWSER.quickAction !== "function") {
      return json(
        { ok: false, error: "Browser Run Quick Actions unavailable" },
        500
      );
    }

    try {
      const result = await pickSearchResult(env.BROWSER, title, type);
      const extracted = await extractFromPage(
        env.BROWSER,
        result.href,
        episode
      );

      return json({
        ok: true,
        title: result.title,
        source_url: result.href,
        ...extracted,
      });
    } catch (error) {
      return json(
        {
          ok: false,
          error:
            error instanceof Error ? error.message : String(error),
        },
        502
      );
    }
  },
};

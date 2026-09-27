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

async function pickSearchResult(page, title, type) {
  const query = encodeURIComponent(title);
  const section = type === "series" ? "series" : "movies";
  for (const base of SEARCH_BASES) {
    try {
      await page.goto(
        base + "/search?q=" + query + "&section=" + section + "&page=1",
        { waitUntil: "domcontentloaded", timeout: 20000 },
      );

      const rows = await page.locator("a.box").evaluateAll((nodes) =>
        nodes.map((node) => ({
          href: node.getAttribute("href") || "",
          title:
            node.querySelector("h3.entry-title")?.textContent?.trim() ||
            node.querySelector(".entry-title")?.textContent?.trim() ||
            node.getAttribute("title") ||
            "",
        })),
      ).catch(() => []);

      const wanted = normalizeTitle(title);
      const candidates = rows
        .map((row) => {
          const actual = normalizeTitle(row.title);
          const score =
            actual === wanted ? 100 :
            actual.includes(wanted) || wanted.includes(actual) ? 70 : 0;
          return {
            href: absoluteUrl(row.href, page.url()),
            title: row.title,
            score,
          };
        })
        .filter((x) => x.href && x.score > 0)
        .sort((a, b) => b.score - a.score);

      if (candidates[0]) return candidates[0];
    } catch {}
  }

  throw new Error("Akwam search returned no matching result");
}

async function extractFromPage(context, pageUrl, season, episode) {
  const page = await context.newPage();
  const media = [];
  const add = (value) => {
    const url = clean(value);
    if (!mediaLike(url) || media.includes(url)) return;
    media.push(url);
  };

  page.on("request", (request) => add(request.url()));
  page.on("response", (response) => {
    const type = String(response.headers()["content-type"] || "").toLowerCase();
    if (type.includes("video/") || type.includes("mpegurl") || type.includes("dash+xml")) {
      add(response.url());
    }
  });

  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});

    if (episode != null) {
      const wanted = Number(episode);
      const epLinks = await page.locator("a[href]").evaluateAll((nodes) =>
        nodes.map((node) => ({
          href: node.getAttribute("href") || "",
          text: node.textContent?.trim() || "",
        }))
      ).catch(() => []);

      const ep = epLinks
        .map((x) => ({
          ...x,
          url: absoluteUrl(x.href, page.url()),
          n: Number((x.text.match(/(?:حلقة|episode|ep|الحلقة)\s*[-:#]?\s*(\d+)/i) || [])[1] || -1),
        }))
        .find((x) => x.n === wanted || new URL(x.url || "https://example.invalid").pathname.includes("/episode/" + wanted + "/"));

      if (ep?.url) {
        await page.goto(ep.url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
      }
    }

    for (let attempt = 0; attempt < 8 && !media.length; attempt++) {
      const dom = await page.locator("video source[src], video[src], source[src], a[href]").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("src") || node.getAttribute("href") || "").filter(Boolean)
      ).catch(() => []);
      dom.forEach(add);

      const html = await page.content().catch(() => "");
      for (const match of html.match(/https?:\/\/[^"'<>\s]+\.(?:mp4|m3u8|mpd|webm)(?:\?[^"'<>\s]*)?/gi) || []) add(match);

      if (!media.length) await page.waitForTimeout(1000);
    }

    if (!media.length) {
      const links = await page.locator("a[href]").evaluateAll((nodes) =>
        nodes.map((node) => ({
          href: node.getAttribute("href") || "",
          text: node.textContent?.trim() || "",
        })).filter((x) => /1080p|720p|480p|download/i.test(x.text + " " + x.href))
      ).catch(() => []);

      for (const link of links.slice(0, 5)) {
        const next = absoluteUrl(link.href, page.url());
        if (!next) continue;
        const child = await context.newPage();
        try {
          await child.goto(next, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
          const childHtml = await child.content().catch(() => "");
          for (const match of childHtml.match(/https?:\/\/[^"'<>\s]+(?:\/download\/[^"'<>\s]+|\.(?:mp4|m3u8|mpd|webm)(?:\?[^"'<>\s]*)?)/gi) || []) add(match);
          const childLinks = await child.locator("a[href],video source[src],video[src]").evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("href") || node.getAttribute("src") || "").filter(Boolean)
          ).catch(() => []);
          childLinks.forEach(add);
          if (media.length) break;
        } finally {
          await child.close().catch(() => {});
        }
      }
    }

    if (!media.length) {
      return {
        ok: true,
        page_url: page.url(),
        media_url: null,
        type: null,
      };
    }

    return {
      ok: true,
      page_url: page.url(),
      media_url: media[0],
      type: detectType(media[0]),
      alternatives: media.slice(0, 8),
    };
  } finally {
    await page.close().catch(() => {});
  }
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

const AKWAM_BASE = "https://ak.sv";
const PAGE_HOSTS = new Set([
  "ak.sv", "www.ak.sv",
  "akwam.it", "www.akwam.it", "go.akwam.it",
  "akwam.ss", "www.akwam.ss",
  "akwam.net", "www.akwam.net",
  "akwam.ee", "www.akwam.ee",
  "akwam.com.co", "www.akwam.com.co", "go.akwam.com.co",
  "downet.net", "www.downet.net",
]);
const QUALITY_ORDER = ["1080p", "720p", "480p"];
const MAX_REDIRECTS = 6;
const SEARCH_BACKOFF_MS = [750, 1_750];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const UA = "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
}
function clean(value) { return typeof value === "string" ? value.trim() : ""; }
function diagnostic(stage, message) { console.log(`[${stage}] ${message}`); }
function normalizeTitle(value) {
  return clean(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function stripHtml(value) {
  return String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
}
function absoluteUrl(value, base) { try { return new URL(clean(value), base).toString(); } catch { return ""; } }
function isPrivateHost(host) {
  const value = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!value || value === "localhost" || value.endsWith(".localhost") || value === "::1" || value === "0.0.0.0") return true;
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value) || /^169\.254\./.test(value)) return true;
  const match = value.match(/^172\.(\d+)\./); return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}
function isAllowedPageHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (PAGE_HOSTS.has(host)) return true;
  return [...PAGE_HOSTS].some((base) => base.startsWith("www.") ? false : host.endsWith("." + base));
}
function safeUrl(value, base, { pageOnly = false } = {}) {
  const href = absoluteUrl(value, base);
  try {
    const url = new URL(href);
    if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) return "";
    if (pageOnly && !isAllowedPageHost(url.hostname)) return "";
    return url.toString();
  } catch { return ""; }
}
function challengePage(html) {
  const text = String(html || "").toLowerCase();
  return text.includes("just a moment") || text.includes("enable javascript and cookies") || text.includes("cf-chl-") || text.includes("cloudflare ray id");
}
function mediaTypeFromUrl(url) {
  const value = String(url).toLowerCase();
  if (/\.m3u8(?:[?#]|$)|m3u8(?:[?#=&]|$)/.test(value)) return "hls";
  if (/\.mpd(?:[?#]|$)|mpd(?:[?#=&]|$)/.test(value)) return "dash";
  return "mp4";
}
function looksLikeMediaUrl(url) { return /\.(?:mp4|m3u8|mpd|webm)(?:[?#]|$)|(?:mp4|m3u8|mpd|webm)(?:[?#=&]|$)/i.test(url); }
function decodeContentUrl(payload) {
  const raw = clean(payload?.content_url || payload?.source_url || payload?.id);
  if (!raw) return "";
  const candidate = raw.includes("::") ? raw.slice(raw.lastIndexOf("::") + 2) : raw;
  const direct = safeUrl(candidate, AKWAM_BASE, { pageOnly: true });
  if (direct) return direct;
  try {
    const decoded = atob(candidate.replace(/-/g, "+").replace(/_/g, "/"));
    return safeUrl(decoded, AKWAM_BASE, { pageOnly: true });
  } catch { return ""; }
}

async function getContentPage(browser, url, stage) {
  const pageUrl = safeUrl(url, AKWAM_BASE, { pageOnly: true });
  if (!pageUrl) throw new Error(`${stage}: rejected unsafe or non-Akwam URL`);
  diagnostic(stage, pageUrl);
  const response = await browser.quickAction("content", { url: pageUrl, userAgent: UA, gotoOptions: { waitUntil: "domcontentloaded", timeout: 30_000 } });
  const html = await response.text();
  if (!response.ok) {
    const error = new Error(`${stage}: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (challengePage(html)) { diagnostic("AKWAM_CLOUDFLARE", pageUrl); throw new Error(`${stage}: Cloudflare challenge detected`); }
  return { url: safeUrl(response.url || pageUrl, AKWAM_BASE, { pageOnly: true }) || pageUrl, html };
}

function entryBlocks(html) { return [...String(html).matchAll(/<[^>]*class=["'][^"']*\bentry-box\b[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi)].map((m) => m[0]); }
function searchEntries(html, base) {
  const source = String(html);
  const cardMatches = [...source.matchAll(/<div[^>]*class=["'][^"']*\bentry-box\b[^"']*["'][^>]*>/gi)];
  const entries = [];
  for (let i = 0; i < cardMatches.length; i += 1) {
    const start = cardMatches[i].index ?? 0;
    const end = cardMatches[i + 1]?.index ?? source.length;
    const fragment = source.slice(start, end);
    const title =
      stripHtml(fragment.match(/<h3[^>]*class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "") ||
      stripHtml(fragment.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i)?.[1] || "");
    const href =
      fragment.match(/<a[^>]*class=["'][^"']*\bbox\b[^"']*["'][^>]*href=["']([^"']+)/i)?.[1] ||
      fragment.match(/<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\bbox\b/i)?.[1] ||
      fragment.match(/<a[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];
    const url = safeUrl(href, base, { pageOnly: true });
    const year = Number((stripHtml(fragment).match(/\b(19|20)\d{2}\b/) || [])[0]) || null;
    if (title && url && !entries.some((entry) => entry.url === url)) entries.push({ title, url, year });
  }
  return entries;
}
function scoreEntry(entry, payload) {
  const wanted = [payload?.title, payload?.original_title, payload?.title_en, payload?.title_ar].map(normalizeTitle).filter(Boolean);
  const title = normalizeTitle(entry.title); let score = 0;
  for (const value of wanted) { if (title === value) score = Math.max(score, 1000); else if (title.includes(value) || value.includes(title)) score = Math.max(score, 700); }
  const year = Number(payload?.year); if (year && entry.year) score += year === entry.year ? 100 : Math.abs(year - entry.year) === 1 ? 10 : 0;
  return score;
}
async function searchAkwam(browser, payload) {
  const query = encodeURIComponent(clean(payload?.title)); const section = payload?.type === "series" ? "series" : "movie";
  if (!query) throw new Error("AKWAM_SEARCH: title is required");
  const searchUrl = `${AKWAM_BASE}/search?q=${query}&section=${section}&page=1`;

  for (let attempt = 0; attempt <= SEARCH_BACKOFF_MS.length; attempt += 1) {
    try {
      const page = await getContentPage(browser, searchUrl, "AKWAM_SEARCH");
      diagnostic("AKWAM_SEARCH", `host=${new URL(page.url).hostname} bytes=${page.html.length}`);
      const result = searchEntries(page.html, page.url).map((entry) => ({ ...entry, score: scoreEntry(entry, payload) })).sort((a, b) => b.score - a.score)[0];
      if (!result || result.score <= 0) throw new Error("AKWAM_SEARCH: no matching entry in widget-body.row.flex-wrap");
      return result;
    } catch (error) {
      if (error?.status !== 429) throw error;
      const delay = SEARCH_BACKOFF_MS[attempt];
      diagnostic("AKWAM_RATE_LIMIT", `search HTTP 429 (attempt ${attempt + 1}/${SEARCH_BACKOFF_MS.length + 1})`);
      if (delay == null) {
        throw new Error("AKWAM_RATE_LIMIT: Akwam search HTTP 429 after bounded backoff; a real content_url is required");
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
function extractQualities(html, base) {
  const out = []; const seen = new Set();
  for (const match of String(html).matchAll(/<a\b([^>]*)href=["']([^"']*\/link\/\d+[^"']*)["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const label = stripHtml(match[4] + " " + match[1] + " " + match[3]).match(/\b(1080p|720p|480p)\b/i)?.[1]?.toLowerCase();
    const url = safeUrl(match[2], base, { pageOnly: true });
    if (label && url && !seen.has(url)) { seen.add(url); out.push({ quality: label, url }); }
  }
  return out.sort((a, b) => QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality));
}
function extractEpisode(html, base, episode) {
  const candidates = [...String(html).matchAll(/<div[^>]*class=["'][^"']*\bbg-primary2\b[^"']*["'][^>]*>[\s\S]*?<h2[^>]*class=["'][^"']*\bfont-size-18\b[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const match of candidates) {
    const text = stripHtml(match[2]); const path = safeUrl(match[1], base, { pageOnly: true });
    const number = Number((text.match(/(?:حلقة|الحلقة|episode|ep)\s*[-:#]?\s*(\d+)/i) || path.match(/\/episode\/(\d+)/i) || [])[1]);
    if (number === Number(episode) && path) return path;
  }
  return "";
}
function extractDownloadUrl(html, base) {
  const match = String(html).match(/https?:\/\/[^"'<>\s]+\/download\/[^"'<>\s]*/i) ||
    String(html).match(/(?:href|data-(?:url|link))=["']([^"']*\/download\/[^"']*)["']/i);
  return safeUrl(match?.[1] || match?.[0], base, { pageOnly: true });
}
function extractFinalMediaUrl(html, base) {
  const matches = String(html).matchAll(/https?:\\?\/\\?\/[^"'<>\s]+/gi);
  for (const match of matches) {
    const url = safeUrl(match[0].replace(/\\\//g, "/"), base);
    // Akwam can put the final download route in script state without a file
    // extension. It is only accepted after validateMediaUrl verifies bytes and
    // MIME; /link pages never qualify as a final candidate.
    if (url && !/\/link\/\d+(?:[/?#]|$)/i.test(url) &&
        (looksLikeMediaUrl(url) || /\/download\//i.test(url))) return url;
  }
  return "";
}
async function validateMediaUrl(initialUrl) {
  let url = safeUrl(initialUrl, AKWAM_BASE); if (!url) throw new Error("AKWAM_FINAL_MEDIA: unsafe URL");
  for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
    diagnostic("AKWAM_FINAL_MEDIA", url);
    const response = await fetch(url, { headers: { Accept: "*/*", Range: "bytes=0-1023", "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { const next = safeUrl(response.headers.get("location"), url); if (!next) throw new Error("AKWAM_FINAL_MEDIA: unsafe redirect"); url = next; continue; }
    if (!response.ok) throw new Error(`AKWAM_FINAL_MEDIA: HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const sample = await response.text();
    if (challengePage(sample) || /text\/html|application\/xhtml/.test(contentType) || /<\s*(?:!doctype\s+html|html)\b/i.test(sample.slice(0, 512))) throw new Error("AKWAM_FINAL_MEDIA: HTML/challenge response");
    const type = /mpegurl|m3u8/.test(contentType) ? "hls" : /dash\+xml|mpd/.test(contentType) ? "dash" : mediaTypeFromUrl(url);
    if (!looksLikeMediaUrl(url) && !/^video\//.test(contentType) && !/mpegurl|dash\+xml/.test(contentType)) throw new Error("AKWAM_FINAL_MEDIA: response is not recognized media");
    return { media_url: url, type, content_type: contentType };
  }
  throw new Error("AKWAM_FINAL_MEDIA: redirect limit exceeded");
}
async function resolveQuality(browser, quality) {
  const link = await getContentPage(browser, quality.url, "AKWAM_LINK");
  const downloadUrl = extractDownloadUrl(link.html, link.url);
  if (!downloadUrl) throw new Error("AKWAM_DOWNLOAD: no download URL on quality page");
  diagnostic("AKWAM_DOWNLOAD", downloadUrl);
  const download = await getContentPage(browser, downloadUrl, "AKWAM_DOWNLOAD");
  const finalUrl = extractFinalMediaUrl(download.html, download.url);
  if (!finalUrl) throw new Error("AKWAM_FINAL_MEDIA: no media URL on download page");
  return { ...(await validateMediaUrl(finalUrl)), quality: quality.quality };
}
async function resolveAkwam(browser, payload) {
  const directContent = decodeContentUrl(payload);
  const entry = directContent ? { title: clean(payload?.title), url: directContent } : await searchAkwam(browser, payload);
  const content = await getContentPage(browser, entry.url, "AKWAM_CONTENT");
  const episodeUrl = payload?.type === "series" && payload?.episode ? extractEpisode(content.html, content.url, payload.episode) : "";
  const mediaPage = episodeUrl ? await getContentPage(browser, episodeUrl, "AKWAM_CONTENT") : content;
  const qualities = extractQualities(mediaPage.html, mediaPage.url);
  diagnostic("AKWAM_QUALITY", qualities.map((item) => item.quality).join(",") || "none");
  if (!qualities.length) throw new Error("AKWAM_QUALITY: no 1080p/720p/480p links");
  let lastError;
  for (const wanted of QUALITY_ORDER) {
    const quality = qualities.find((item) => item.quality === wanted); if (!quality) continue;
    try { return { title: entry.title, source_url: mediaPage.url, ...(await resolveQuality(browser, quality)) }; }
    catch (error) { lastError = error; diagnostic("AKWAM_QUALITY", `${wanted} failed: ${error.message}`); }
  }
  throw lastError || new Error("AKWAM_QUALITY: no usable quality");
}

export default { async fetch(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "movyz-akwam-resolver", browser: Boolean(env.BROWSER), mode: "direct-akwam-pipeline" });
  if (request.method !== "POST" || url.pathname !== "/resolve") return json({ ok: false, error: "Not found" }, 404);
  let payload; try { payload = await request.json(); } catch { return json({ ok: false, error: "Valid JSON body required" }, 400); }
  if (!clean(payload?.title) && !decodeContentUrl(payload)) return json({ ok: false, error: "title or Akwam content_url is required" }, 400);
  if (!env.BROWSER?.quickAction) return json({ ok: false, error: "Browser Run Quick Actions unavailable" }, 500);
  try { return json({ ok: true, ...(await resolveAkwam(env.BROWSER, { ...payload, type: payload?.type === "series" ? "series" : "movie" })) }); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); diagnostic("AKWAM_FAILED", message); return json({ ok: false, error: message }, 502); }
} };

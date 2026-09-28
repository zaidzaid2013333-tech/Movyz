const AKWAM_BASE = "https://akwam.it";
const AKWAM_SEARCH_BASES = [
  "https://akwam.it",
  "https://go.akwam.it",
  "https://akwam.ss",
  "https://akwam.ee",
  "https://akwam.com.co",
  "https://go.akwam.com.co",
  "https://ak.sv",
];
const PAGE_HOSTS = new Set([
  "ak.sv", "www.ak.sv",
  "akwam.it", "www.akwam.it", "go.akwam.it",
  "akwam.ss", "www.akwam.ss",
  "akwam.net", "www.akwam.net",
  "akwam.ee", "www.akwam.ee",
  "akwam.com.co", "www.akwam.com.co", "go.akwam.com.co",
  "go.ak.sv",
  "downet.net", "www.downet.net",
]);
const QUALITY_ORDER = ["1080p", "720p", "480p"];
const MAX_REDIRECTS = 6;
const SEARCH_BACKOFF_MS = [750, 1_750];
const PLAYBACK_CACHE_TTL_MS = 90_000;
const playbackCache = new Map();
const playbackInflight = new Map();
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

function unwrapBrowserPayload(rawValue) {
  let current = String(rawValue ?? "").replace(/^\uFEFF/, "").trim();

  for (let depth = 0; depth < 3; depth += 1) {
    try {
      const parsed = JSON.parse(current);

      if (typeof parsed === "string") {
        current = parsed.trim();
        continue;
      }

      if (parsed && typeof parsed.result === "string") {
        current = parsed.result.trim();
        continue;
      }

      if (parsed && typeof parsed.html === "string") {
        current = parsed.html.trim();
        continue;
      }

      if (parsed && parsed.result && typeof parsed.result.html === "string") {
        current = parsed.result.html.trim();
        continue;
      }
    } catch {}

    const resultMatch = current.match(/"result"\s*:\s*"((?:\\.|[^"\\])*)"/s);
    if (resultMatch) {
      try {
        current = JSON.parse('"' + resultMatch[1] + '"').trim();
        continue;
      } catch {}
    }

    break;
  }

  return current;
}

async function getBrowserHtml(response) {
  const raw = await response.text();
  return unwrapBrowserPayload(raw);
}

async function getContentPageDirect(url, stage) {
  const pageUrl = safeUrl(url, AKWAM_BASE, { pageOnly: true });
  if (!pageUrl) throw new Error(`${stage}: rejected unsafe or non-Akwam URL`);
  const response = await fetch(pageUrl, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ar,en-US;q=0.8,en;q=0.5",
      Referer: new URL(pageUrl).origin + "/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const html = await response.text();
  if (!response.ok) {
    const error = new Error(`${stage}: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (challengePage(html)) throw new Error(`${stage}: Cloudflare challenge detected`);
  return {
    url: safeUrl(response.url || pageUrl, AKWAM_BASE, { pageOnly: true }) || pageUrl,
    html,
  };
}

async function getContentPage(browser, url, stage) {
  const pageUrl = safeUrl(url, AKWAM_BASE, { pageOnly: true });
  if (!pageUrl) throw new Error(`${stage}: rejected unsafe or non-Akwam URL`);
  diagnostic(stage, pageUrl);
  const response = await browser.quickAction("content", { url: pageUrl, userAgent: UA, gotoOptions: { waitUntil: "networkidle2", timeout: 45_000 } });
  const html = await getBrowserHtml(response);
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
function mirrorPageUrls(rawUrl) {
  const original = new URL(rawUrl);
  const host = original.hostname.toLowerCase();

  // go.ak.sv is a dedicated playback router. Rewriting its path onto
  // search/content mirrors produces unrelated routes (for example
  // /watch/7057 on akwam.it), so keep the original host intact.
  if (host === "go.ak.sv") return [original.toString()];

  const urls = [];
  for (const base of AKWAM_SEARCH_BASES) {
    const baseUrl = new URL(base);
    const candidate = new URL(original.toString());
    candidate.protocol = baseUrl.protocol;
    candidate.hostname = baseUrl.hostname;
    candidate.port = baseUrl.port;
    const value = candidate.toString();
    if (!urls.includes(value)) urls.push(value);
  }
  return urls;
}

async function getContentPageResilient(browser, url, stage) {
  let lastError = null;
  const candidates = mirrorPageUrls(url);

  for (const candidate of candidates) {
    try {
      return await getContentPage(browser, candidate, stage);
    } catch (error) {
      lastError = error;
      if (error?.status !== 429) throw error;
      diagnostic("AKWAM_RATE_LIMIT", stage + " Browser Run 429 on " + candidate + "; trying direct fetch");
      try {
        return await getContentPageDirect(candidate, stage);
      } catch (directError) {
        lastError = directError;
        if (directError?.status !== 429) throw directError;
        diagnostic("AKWAM_RATE_LIMIT", stage + " direct fetch 429 on " + candidate + "; trying mirror");
      }
    }
  }

  throw lastError || new Error(stage + ": no usable Akwam mirror");
}

async function searchAkwam(browser, payload) {
  const query = encodeURIComponent(clean(payload?.title));
  const section = payload?.type === "series" ? "series" : "movie";
  if (!query) throw new Error("AKWAM_SEARCH: title is required");

  let lastError = null;

  for (const base of AKWAM_SEARCH_BASES) {
    const searchUrl = `${base}/search?q=${query}&section=${section}&page=1`;

    for (let attempt = 0; attempt <= SEARCH_BACKOFF_MS.length; attempt += 1) {
      try {
        const page = await getContentPage(browser, searchUrl, "AKWAM_SEARCH");
        const entries = searchEntries(page.html, page.url);
        const ranked = entries
          .map((entry) => ({ ...entry, score: scoreEntry(entry, payload) }))
          .sort((a, b) => b.score - a.score);

        diagnostic("AKWAM_SEARCH", `base=${base} host=${new URL(page.url).hostname} bytes=${page.html.length} entries=${entries.length}`);

        if (!ranked[0] || ranked[0].score <= 0) {
          const entryBoxCount = (page.html.match(/\bentry-box\b/gi) || []).length;
          const titleCount = (page.html.match(/\bentry-title\b/gi) || []).length;
          const topTitles = ranked.slice(0, 5).map((item) => item.title).filter(Boolean);
          diagnostic("AKWAM_SEARCH", `entryBox=${entryBoxCount} entryTitle=${titleCount} topTitles=${JSON.stringify(topTitles)}`);
          throw new Error(`AKWAM_SEARCH: no matching entry on ${new URL(page.url).hostname}`);
        }

        return ranked[0];
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (lastError.status !== 429) {
          break;
        }

        const delay = SEARCH_BACKOFF_MS[attempt];
        diagnostic("AKWAM_RATE_LIMIT", `search 429 base=${base} attempt=${attempt + 1}`);

        if (delay == null) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("AKWAM_SEARCH: no matching entry");
}
function extractQualities(html, base) {
  const source = String(html);
  const out = [];
  const seen = new Set();
  const add = (quality, rawUrl, kind) => {
    const normalized = String(quality || "").toLowerCase().trim();
    if (!QUALITY_ORDER.includes(normalized)) return;
    const url = safeUrl(rawUrl, base, { pageOnly: true });
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ quality: normalized, url, kind });
  };

  // Akwam's current movie page renders three quality tabs, followed by
  // playback actions in the same order: 1080p, 720p, 480p. The action
  // targets are currently go.ak.sv/watch/<id> (and matching download routes).
  // Parse the tab labels independently, then pair watch/download targets by
  // index instead of assuming /link/<id>.
  const qualitySequence = [];
  for (const match of source.matchAll(
    /<a\b[^>]*href=["']#tab-\d+["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const label = stripHtml(match[1]).match(/\b(1080p|720p|480p)\b/i)?.[1]?.toLowerCase();
    if (label && !qualitySequence.includes(label)) qualitySequence.push(label);
  }

  const watchUrls = [];
  const downloadUrls = [];
  const seenWatch = new Set();
  const seenDownload = new Set();

  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;

    const normalized = safeUrl(href, base, { pageOnly: true });
    if (!normalized) continue;

    if (/\/watch\/\d+(?:[/?#]|$)/i.test(normalized)) {
      if (!seenWatch.has(normalized)) {
        seenWatch.add(normalized);
        watchUrls.push(normalized);
      }
      continue;
    }

    if (/\/download\/[^/?#]+/i.test(normalized)) {
      if (!seenDownload.has(normalized)) {
        seenDownload.add(normalized);
        downloadUrls.push(normalized);
      }
    }
  }

  const labels = qualitySequence.length ? qualitySequence : QUALITY_ORDER;
  const max = Math.min(labels.length, Math.max(watchUrls.length, downloadUrls.length));

  for (let i = 0; i < max; i += 1) {
    const quality = labels[i];
    if (watchUrls[i]) add(quality, watchUrls[i], "watch");
    if (downloadUrls[i]) add(quality, downloadUrls[i], "download");
  }

  // Fallback for older pages where the quality label appears beside the
  // action itself rather than in tab navigation.
  if (!out.length) {
    for (const match of source.matchAll(
      /<a\b([^>]*)href=["']([^"']+\/watch\/\d+(?:[/?#][^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      const context = stripHtml(
        source.slice(Math.max(0, (match.index ?? 0) - 1200), Math.min(source.length, (match.index ?? 0) + 1200)),
      );
      const quality = context.match(/\b(1080p|720p|480p)\b/i)?.[1]?.toLowerCase();
      add(quality, match[2], "watch");
    }
  }

  diagnostic(
    "AKWAM_QUALITY",
    "tabQualities=" + JSON.stringify(qualitySequence) +
      " watch=" + watchUrls.length +
      " download=" + downloadUrls.length +
      " extracted=" + JSON.stringify(out),
  );

  return out.sort((a, b) =>
    QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality),
  );
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
function normalizeFinalCandidate(rawValue, base) {
  let value = String(rawValue || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2f;|&#47;/gi, "/")
    .replace(/\\\//g, "/")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (!value || /^(?:javascript:|data:|blob:)/i.test(value)) return "";
  if (value.startsWith("//")) value = "https:" + value;
  return safeUrl(value, base);
}

function extractFinalMediaUrl(html, base) {
  const source = String(html);
  const found = [];
  const seen = new Set();

  const add = (raw) => {
    const url = normalizeFinalCandidate(raw, base);
    if (!url || seen.has(url)) return;

    const isAkwamPage = (() => {
      try {
        const u = new URL(url);
        return isAllowedPageHost(u.hostname);
      } catch {
        return false;
      }
    })();

    // Akwam page routes are intermediate targets, not final media. Keep
    // download routes discoverable, but never promote /watch or /link pages
    // to the media contract.
    if (isAkwamPage && !/\/download\//i.test(url) && !looksLikeMediaUrl(url)) {
      return;
    }

    seen.add(url);
    found.push(url);
  };

  // HTML5 / player attributes.
  for (const match of source.matchAll(
    /<(?:video|source)\b[^>]*(?:src|data-src|data-file|data-url)=["']([^"']+)["']/gi,
  )) add(match[1]);

  // Common player configuration objects (JWPlayer, Plyr, custom players).
  for (const match of source.matchAll(
    /(?:file|src|source|hls|dash|url)\s*[:=]\s*["']([^"']+)["']/gi,
  )) add(match[1]);

  for (const match of source.matchAll(
    /(?:file|src|source|url)\s*[:=]\s*["']((?:\\\/|[^"'])+)["']/gi,
  )) add(String(match[1]).replace(/\\\//g, "/"));

  // Redirect/navigation code used by lightweight Akwam player pages.
  for (const match of source.matchAll(
    /(?:window\.open|location(?:\.href)?|window\.location(?:\.href)?)\s*(?:\(|=)\s*["']([^"']+)["']/gi,
  )) add(match[1]);

  // Meta refresh / direct anchors are secondary fallbacks.
  for (const match of source.matchAll(
    /<meta\b[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)["']/gi,
  )) add(match[1]);

  for (const match of source.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi,
  )) {
    const candidate = String(match[1]);
    if (looksLikeMediaUrl(candidate) || /\/download\//i.test(candidate)) add(candidate);
  }

  found.sort((a, b) => {
    const score = (url) =>
      (looksLikeMediaUrl(url) ? 100 : 0) +
      (/\/(?:download)\//i.test(url) ? 60 : 0) +
      (/^https:\/\/[^/]+\//i.test(url) ? 5 : 0);
    return score(b) - score(a);
  });

  return found[0] || "";
}

function hasMp4Signature(bytes) {
  return bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70;
}

function inferMediaType(url, contentType, contentDisposition, sample, bytes) {
  const ct = String(contentType || "").toLowerCase();
  const value = String(url || "").toLowerCase();
  const cd = String(contentDisposition || "").toLowerCase();
  if (/mpegurl|vnd\.apple\.mpegurl/.test(ct) || /#extm3u/i.test(sample)) return "hls";
  if (/dash\+xml|application\/dash/.test(ct) || /<\s*mpd\b/i.test(sample)) return "dash";
  if (/^video\//.test(ct) ||
      /\.(?:mp4|m4v|webm)(?:[?#]|$)/.test(value) ||
      /\.(?:mp4|m4v|webm)(?:[?#]|$)/.test(cd) ||
      hasMp4Signature(bytes)) return "mp4";
  return "";
}

async function readProbeBytes(response, limit = 65_536) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < limit) {
      const part = await reader.read();
      if (part.done) break;
      if (!part.value || !part.value.byteLength) continue;
      const remaining = limit - total;
      const chunk = part.value.slice(0, remaining);
      chunks.push(chunk);
      total += chunk.byteLength;
      if (chunk.byteLength < part.value.byteLength) break;
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function validateMediaUrl(initialUrl, referer = "") {
  let url = safeUrl(initialUrl, AKWAM_BASE);
  if (!url) throw new Error("AKWAM_FINAL_MEDIA: unsafe URL");

  for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
    diagnostic("AKWAM_FINAL_MEDIA", url);
    const headers = {
      Accept: "*/*",
      Range: "bytes=0-65535",
      "User-Agent": UA,
      ...(referer ? { Referer: referer } : {}),
    };

    const response = await fetch(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = safeUrl(response.headers.get("location"), url);
      if (!next) throw new Error("AKWAM_FINAL_MEDIA: unsafe redirect");
      url = next;
      continue;
    }

    if (!response.ok) throw new Error("AKWAM_FINAL_MEDIA: HTTP " + response.status);

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const contentDisposition = response.headers.get("content-disposition") || "";
    const bytes = await readProbeBytes(response);
    const sample = new TextDecoder().decode(bytes.slice(0, 4096));

    if (!bytes.byteLength) throw new Error("AKWAM_FINAL_MEDIA: media response is empty");
    if (challengePage(sample) ||
        /text\/html|application\/xhtml/.test(contentType) ||
        /<\s*(?:!doctype\s+html|html)\b/i.test(sample.slice(0, 512))) {
      throw new Error("AKWAM_FINAL_MEDIA: HTML/challenge response");
    }

    const type = inferMediaType(url, contentType, contentDisposition, sample, bytes);
    diagnostic(
      "AKWAM_FINAL_MEDIA",
      "status=" + response.status +
      " type=" + (type || "unknown") +
      " contentType=" + contentType +
      " bytes=" + bytes.byteLength
    );

    if (!type) throw new Error("AKWAM_FINAL_MEDIA: response is not recognized media");
    return { media_url: url, type, content_type: contentType };
  }

  throw new Error("AKWAM_FINAL_MEDIA: redirect limit exceeded");
}
function isMediaResponse(contentType, contentDisposition, url, bytes) {
  const ct = String(contentType || "").toLowerCase();
  const cd = String(contentDisposition || "").toLowerCase();
  const value = String(url || "").toLowerCase();
  return /^video\//.test(ct) ||
    /mpegurl|vnd\.apple\.mpegurl/.test(ct) ||
    /dash\+xml|application\/dash/.test(ct) ||
    /filename\s*=.*\.(?:mp4|m4v|webm|m3u8|mpd)/i.test(cd) ||
    /\.(?:mp4|m4v|webm|m3u8|mpd)(?:[?#]|$)/.test(value) ||
    hasMp4Signature(bytes);
}

async function fetchDownloadTarget(initialUrl, referer = "") {
  const candidates = mirrorPageUrls(initialUrl);
  let lastError = null;

  for (const candidate of candidates) {
    let url = safeUrl(candidate, AKWAM_BASE, { pageOnly: true });
    if (!url) continue;

    try {
      for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
        diagnostic("AKWAM_DOWNLOAD", url);

        const headers = {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,video/*;q=0.8,*/*;q=0.5",
          Range: "bytes=0-65535",
          "User-Agent": UA,
          ...(referer ? { Referer: referer } : {}),
        };

        const response = await fetch(url, {
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(30_000),
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const next = safeUrl(response.headers.get("location"), url);
          if (!next) throw new Error("AKWAM_DOWNLOAD: unsafe redirect");
          url = next;
          continue;
        }

        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        const contentDisposition = response.headers.get("content-disposition") || "";

        // Never consume a potentially large media response. Return the URL
        // after proving the response is media by headers/first bounded probe.
        if (isMediaResponse(contentType, contentDisposition, url, new Uint8Array())) {
          return { kind: "media", url, content_type: contentType };
        }

        const bytes = await readProbeBytes(response, 524_288);
        const sample = new TextDecoder().decode(bytes.slice(0, 64_000));

        if (!response.ok) {
          const error = new Error("AKWAM_DOWNLOAD: HTTP " + response.status);
          error.status = response.status;
          throw error;
        }

        if (challengePage(sample) ||
            /text\/html|application\/xhtml/.test(contentType) ||
            /<\s*(?:!doctype\s+html|html)\b/i.test(sample.slice(0, 1024))) {
          return { kind: "page", url, html: sample, content_type: contentType };
        }

        if (isMediaResponse(contentType, contentDisposition, url, bytes)) {
          return { kind: "media", url, content_type: contentType };
        }

        throw new Error("AKWAM_DOWNLOAD: response is neither an HTML page nor recognized media");
      }

      throw new Error("AKWAM_DOWNLOAD: redirect limit exceeded");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.status !== 429 && lastError.status !== 403) break;
    }
  }

  throw lastError || new Error("AKWAM_DOWNLOAD: no usable download target");
}

async function resolveQuality(browser, quality) {
  const qualityUrl = quality.url;

  // Current Akwam playback buttons point to go.ak.sv/watch/<id>. Treat the
  // watch page as an intermediate player document and extract its real media
  // source before returning anything to the caller.
  const targetPage = await getContentPageResilient(
    browser,
    qualityUrl,
    /\/watch\//i.test(qualityUrl) ? "AKWAM_WATCH" : "AKWAM_LINK",
  );

  const directFromPage = extractFinalMediaUrl(targetPage.html, targetPage.url);
  if (directFromPage) {
    return {
      ...(await validateMediaUrl(directFromPage, targetPage.url)),
      quality: quality.quality,
    };
  }

  const downloadUrl = extractDownloadUrl(targetPage.html, targetPage.url);
  if (downloadUrl) {
    const target = await fetchDownloadTarget(downloadUrl, targetPage.url);
    if (target.kind === "media") {
      return {
        ...(await validateMediaUrl(target.url, targetPage.url)),
        quality: quality.quality,
      };
    }

    const finalUrl = extractFinalMediaUrl(target.html, target.url);
    if (finalUrl) {
      return {
        ...(await validateMediaUrl(finalUrl, target.url)),
        quality: quality.quality,
      };
    }
  }

  throw new Error(
    "AKWAM_FINAL_MEDIA: player/download page contained no direct media target; url=" +
      targetPage.url,
  );
}
async function resolveAkwamCached(browser, payload) {
  const key = JSON.stringify({
    content_url: clean(payload?.content_url || payload?.contentUrl),
    title: normalizeTitle(payload?.title),
    year: Number(payload?.year) || 0,
    type: payload?.type === "series" ? "series" : "movie",
    season: Number(payload?.season) || 0,
    episode: Number(payload?.episode) || 0,
  });
  const cached = playbackCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const inflight = playbackInflight.get(key);
  if (inflight) return await inflight;
  const task = (async () => {
    const value = await resolveAkwam(browser, payload);
    playbackCache.set(key, { value, expiresAt: Date.now() + PLAYBACK_CACHE_TTL_MS });
    return value;
  })();
  playbackInflight.set(key, task);
  try {
    return await task;
  } finally {
    playbackInflight.delete(key);
  }
}

async function resolveAkwam(browser, payload) {
  const directContent = decodeContentUrl(payload);
  const entry = directContent ? { title: clean(payload?.title), url: directContent } : await searchAkwam(browser, payload);
  const content = await getContentPageResilient(browser, entry.url, "AKWAM_CONTENT");
  const episodeUrl = payload?.type === "series" && payload?.episode ? extractEpisode(content.html, content.url, payload.episode) : "";
  const mediaPage = episodeUrl ? await getContentPage(browser, episodeUrl, "AKWAM_CONTENT") : content;
  const qualities = extractQualities(mediaPage.html, mediaPage.url);
  diagnostic("AKWAM_QUALITY", qualities.map((item) => item.quality).join(",") || "none");
  if (!qualities.length) {
    const hrefs = [...String(mediaPage.html).matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)]
      .map((match) => match[1])
      .filter(Boolean)
      .slice(0, 20);
    const linkHrefs = hrefs.filter((value) => /\/link\/\d+/i.test(value)).slice(0, 12);
    const qualityMentions = String(mediaPage.html).match(/\b(?:1080p|720p|480p|1080|720|480)\b/gi) || [];
    const titleMatch = String(mediaPage.html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = stripHtml(titleMatch ? titleMatch[1] : "");
    const firstLinkIndex = String(mediaPage.html).search(/\/link\/\d+/i);
    const snippet = firstLinkIndex >= 0
      ? stripHtml(String(mediaPage.html).slice(Math.max(0, firstLinkIndex - 1200), firstLinkIndex + 1800))
      : stripHtml(String(mediaPage.html)).slice(0, 3000);
    throw new Error(
      "AKWAM_QUALITY: no quality links; page=" + mediaPage.url +
      "; bytes=" + mediaPage.html.length +
      "; linkCount=" + (String(mediaPage.html).match(/\/link\/\d+/gi) || []).length +
      "; linkHrefs=" + JSON.stringify(linkHrefs) +
      "; qualityMentions=" + JSON.stringify(qualityMentions.slice(0, 30)) +
      "; title=" + pageTitle +
      "; snippet=" + snippet
    );
  }
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
  try { return json({ ok: true, ...(await resolveAkwamCached(env.BROWSER, { ...payload, type: payload?.type === "series" ? "series" : "movie" })) }); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); diagnostic("AKWAM_FAILED", message); return json({ ok: false, error: message }, 502); }
} };

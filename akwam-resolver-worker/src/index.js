const AKWAM_BASE = "https://akwam.it";
const AKWAM_SEARCH_BASES = [
  "https://akwam.ss",
  "https://akwam.it",
  "https://go.akwam.it",
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
const QUALITY_ORDER = ["2160p", "1440p", "1080p", "900p", "720p", "576p", "540p", "480p", "360p", "240p"];
const QUALITY_PATTERN = /\b(2160|1440|1080|900|720|576|540|480|360|240)p?\b/i;
function normalizeQuality(value) {
  const match = String(value || "").match(QUALITY_PATTERN);
  return match ? match[1] + "p" : "";
}
function qualityRank(value) {
  const index = QUALITY_ORDER.indexOf(normalizeQuality(value));
  return index >= 0 ? index : QUALITY_ORDER.length;
}
const MAX_REDIRECTS = 6;
const SEARCH_BACKOFF_MS = [750, 1_750];
const PLAYBACK_CACHE_TTL_MS = 5 * 60_000;
const playbackCache = new Map();
const qualityCache = new Map();
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
    signal: AbortSignal.timeout(15_000),
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
  const response = await browser.quickAction("content", { url: pageUrl, userAgent: UA, gotoOptions: { waitUntil: "domcontentloaded", timeout: 20_000 } });
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
  const entries = [];
  const seen = new Set();

  const add = (title, href) => {
    const cleanTitle = stripHtml(title);
    const url = safeUrl(href, base, { pageOnly: true });
    if (!cleanTitle || !url || seen.has(url)) return;
    seen.add(url);
    const year = Number((cleanTitle.match(/\b(?:19|20)\d{2}\b/) || [])[0]) || null;
    entries.push({ title: cleanTitle, url, year });
  };

  // Current/legacy card markup.
  const cardMatches = [...source.matchAll(
    /<div[^>]*class=["'][^"']*\bentry-box\b[^"']*["'][^>]*>/gi,
  )];
  for (let i = 0; i < cardMatches.length; i += 1) {
    const start = cardMatches[i].index ?? 0;
    const end = cardMatches[i + 1]?.index ?? source.length;
    const fragment = source.slice(start, end);
    const title =
      fragment.match(/<h3[^>]*class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] ||
      fragment.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i)?.[1] ||
      "";
    const href =
      fragment.match(/<a[^>]*class=["'][^"']*\bbox\b[^"']*["'][^>]*href=["']([^"']+)/i)?.[1] ||
      fragment.match(/<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\bbox\b/i)?.[1] ||
      fragment.match(/<a[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];
    add(title, href);
  }

  // Fallback for newer Akwam search markup: discover content links directly.
  for (const match of source.matchAll(
    /<a\b[^>]*href=["']([^"']*\/(?:series|movie)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    add(match[2], match[1]);
  }

  // Some cards keep the title in a heading adjacent to the content link.
  for (const match of source.matchAll(
    /<(?:h2|h3|h4)\b[^>]*>([\s\S]*?)<\/(?:h2|h3|h4)>[\s\S]{0,800}?<a\b[^>]*href=["']([^"']*\/(?:series|movie)\/[^"']+)["']/gi,
  )) {
    add(match[1], match[2]);
  }

  return entries;
}
function parseSeriesSeason(value) {
  const text = normalizeTitle(value);
  const numeric = text.match(/\b(?:season|الموسم)\s*#?\s*(\d{1,2})\b/i);
  if (numeric) return Number(numeric[1]);
  const ordinals = {
    الاول: 1, الأول: 1, الثاني: 2, الثالث: 3, الرابع: 4, الخامس: 5,
    السادس: 6, السابع: 7, الثامن: 8, التاسع: 9, العاشر: 10,
    "الحادي عشر": 11, "الثاني عشر": 12,
  };
  const arabic = text.match(/الموسم\s+(الاول|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|الحادي عشر|الثاني عشر)/i);
  return arabic ? (ordinals[arabic[1]] || null) : null;
}

function scoreEntry(entry, payload) {
  const wanted = [payload?.title, payload?.original_title, payload?.title_en, payload?.title_ar].map(normalizeTitle).filter(Boolean);
  const title = normalizeTitle(entry.title);
  let score = 0;

  for (const value of wanted) {
    if (title === value) score = Math.max(score, 1000);
    else if (title.includes(value) || value.includes(title)) score = Math.max(score, 700);
  }

  if (payload?.type === "series" && Number(payload?.season) > 0) {
    const requestedSeason = Number(payload.season);
    const detectedSeason = parseSeriesSeason(entry.title);
    if (Number.isInteger(detectedSeason) && detectedSeason !== requestedSeason) return 0;
    if (detectedSeason === requestedSeason) score += 300;
  }

  const year = Number(payload?.year);
  if (year && entry.year) score += year === entry.year ? 100 : Math.abs(year - entry.year) === 1 ? 10 : 0;
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
      const status = Number(error?.status || 0);
      const message = String(error?.message || error || "");
      const shouldDirectFallback = status === 429 || /timeout|timed out|aborted|navigation/i.test(message);

      if (!shouldDirectFallback) throw error;

      diagnostic(
        status === 429 ? "AKWAM_RATE_LIMIT" : "AKWAM_BROWSER_FALLBACK",
        stage + " Browser Run fallback on " + candidate + (message ? ": " + message : ""),
      );

      try {
        return await getContentPageDirect(candidate, stage);
      } catch (directError) {
        lastError = directError;
        const directMessage = String(directError?.message || directError || "");
        if (directError?.status !== 429 && !/timeout|timed out|aborted|navigation/i.test(directMessage)) {
          throw directError;
        }
      }
    }
  }

  throw lastError || new Error(stage + ": no usable Akwam mirror");
}
async function getContentPageDirectFirst(browser, url, stage) {
  try {
    return await getContentPageDirect(url, stage);
  } catch (directError) {
    diagnostic("AKWAM_DIRECT_FIRST_FALLBACK", stage + ": " + String(directError?.message || directError || "direct fetch failed"));
    return await getContentPageResilient(browser, url, stage);
  }
}
function seasonSearchLabel(season) {
  const labels = {
    1: "الموسم الاول",
    2: "الموسم الثاني",
    3: "الموسم الثالث",
    4: "الموسم الرابع",
    5: "الموسم الخامس",
    6: "الموسم السادس",
    7: "الموسم السابع",
    8: "الموسم الثامن",
    9: "الموسم التاسع",
    10: "الموسم العاشر",
    11: "الموسم الحادي عشر",
    12: "الموسم الثاني عشر",
  };
  return labels[Number(season)] || ("season " + Number(season));
}

async function searchAkwam(browser, payload) {
  const section = payload?.type === "series" ? "series" : "movie";
  const baseCandidates = [
    payload?.title,
    payload?.title_en,
    payload?.original_title,
    payload?.title_ar,
    ...(Array.isArray(payload?.titles) ? payload.titles : []),
  ].map(clean).filter(Boolean);

  const candidates = [];
  if (section === "series" && Number(payload?.season) > 0) {
    const requestedSeason = Number(payload.season);
    const seasonLabel = seasonSearchLabel(requestedSeason);
    for (const value of baseCandidates) {
      candidates.push(value + " " + seasonLabel);
      candidates.push(value + " S" + requestedSeason);
    }
  }
  candidates.push(...baseCandidates);
  const uniqueCandidates = candidates
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  if (!uniqueCandidates.length) throw new Error("AKWAM_SEARCH: title is required");

  let lastError = null;
  let best = null;

  // The current Akwam index is consistently available on akwam.ss.
  // Prefer it for series so episode discovery does not waste the resolver
  // timeout walking mirrors that are currently slow/offline.
  const searchBases = section === "series"
    ? ["https://akwam.ss", "https://akwam.it"]
    : AKWAM_SEARCH_BASES;

  for (const candidateTitle of uniqueCandidates.slice(0, 8)) {
    const query = encodeURIComponent(candidateTitle);

    for (const base of searchBases) {
      const searchUrl = `${base}/search?q=${query}&section=${section}&page=1`;

      for (let attempt = 0; attempt <= SEARCH_BACKOFF_MS.length; attempt += 1) {
        try {
          let page = await getContentPageDirectFirst(browser, searchUrl, "AKWAM_SEARCH");
          let entries = searchEntries(page.html, page.url);

          // Akwam search can return a non-challenge HTML shell without the
          // rendered result cards. Force a Browser Run fetch when direct parsing
          // is empty or cannot produce a season-compatible match.
          let ranked = entries
            .map((entry) => ({ ...entry, score: scoreEntry(entry, payload) }))
            .sort((a, b) => b.score - a.score);

          const needsBrowserSearch =
            entries.length === 0 ||
            !ranked.some((entry) => entry.score > 0);

          if (needsBrowserSearch) {
            try {
              const browserPage = await getContentPage(browser, searchUrl, "AKWAM_SEARCH_BROWSER");
              const browserEntries = searchEntries(browserPage.html, browserPage.url);
              if (browserEntries.length) {
                page = browserPage;
                entries = browserEntries;
                ranked = entries
                  .map((entry) => ({ ...entry, score: scoreEntry(entry, payload) }))
                  .sort((a, b) => b.score - a.score);
              }
            } catch (browserError) {
              diagnostic(
                "AKWAM_SEARCH_BROWSER_FAILED",
                String(browserError?.message || browserError || "browser search failed"),
              );
            }
          }

          diagnostic("AKWAM_SEARCH", "query=" + candidateTitle + " base=" + base + " entries=" + entries.length);

          if (ranked[0] && ranked[0].score > 0) {
            if (!best || ranked[0].score > best.score) best = ranked[0];
            if (ranked[0].score >= 1000) return ranked[0];
          }
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (lastError.status !== 429) break;

          const delay = SEARCH_BACKOFF_MS[attempt];
          diagnostic("AKWAM_RATE_LIMIT", "search 429 query=" + candidateTitle + " base=" + base + " attempt=" + (attempt + 1));
          if (delay == null) break;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
  }

  if (best) return best;
  throw lastError || new Error("AKWAM_SEARCH: no matching entry");
}
function extractQualities(html, base) {
  const source = String(html);
  const out = [];
  const seen = new Set();
  const add = (quality, rawUrl, kind) => {
    const normalized = normalizeQuality(quality);
    if (!normalized) return;
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
    const label = stripHtml(match[1]).match(QUALITY_PATTERN)?.[0];
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

  const labels = qualitySequence.length ? qualitySequence.map(normalizeQuality).filter(Boolean) : QUALITY_ORDER;
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
      const quality = context.match(QUALITY_PATTERN)?.[0];
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

  return out.sort((a, b) => qualityRank(a.quality) - qualityRank(b.quality));
}
function extractEpisode(html, base, season, episode) {
  const requestedSeason = Number(season);
  const requestedEpisode = Number(episode);
  if (!Number.isInteger(requestedEpisode) || requestedEpisode < 1) return "";

  const ordinalSeasons = {
    "الاول": 1, "الأول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4, "الخامس": 5,
    "السادس": 6, "السابع": 7, "الثامن": 8, "التاسع": 9, "العاشر": 10,
    "الحادي عشر": 11, "الثاني عشر": 12,
  };

  const decode = (value) => {
    try { return decodeURIComponent(String(value || "")); } catch { return String(value || ""); }
  };

  const seasonFromText = (value) => {
    const text = decode(value).toLowerCase().replace(/[_-]+/g, " ");
    const numeric =
      text.match(/\b(?:season|الموسم)\s*#?\s*(\d{1,2})\b/i) ||
      text.match(/\bs(\d{1,2})\b[^a-z0-9]?/i);
    if (numeric) return Number(numeric[1]);
    const arabic = text.match(/الموسم\s*(الاول|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|الحادي عشر|الثاني عشر)/i);
    if (arabic) return ordinalSeasons[arabic[1]] || null;
    return null;
  };

  const episodeFromText = (value) => {
    const text = decode(value);
    const patterns = [
      /(?:الحلقة|حلقة|episode|ep)\s*[-:#]?\s*(\d{1,3})\b/i,
      /(?:episode|ep)[-_ ]?(\d{1,3})\b/i,
      /(?:s\d{1,2})e(\d{1,3})\b/i,
      /\/episode[-_ ](\d{1,3})(?:\b|\/)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return Number(match[1]);
    }
    return null;
  };

  const links = [];
  for (const match of String(html).matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const path = safeUrl(match[1], base, { pageOnly: true });
    if (!path) continue;
    const label = stripHtml(match[2]);
    const decoded = decode(path);
    const seasonNumber = seasonFromText(label + " " + decoded);
    const episodeNumber = episodeFromText(label) ?? episodeFromText(decoded);
    links.push({ path, label, decoded, seasonNumber, episodeNumber, index: links.length });
  }

  // Primary: explicit SxxEyy / episode-number links.
  const explicit = links
    .filter((item) => item.episodeNumber === requestedEpisode)
    .map((item) => ({
      ...item,
      score:
        (Number.isInteger(requestedSeason) && item.seasonNumber === requestedSeason ? 100 : 0) +
        (Number.isInteger(requestedSeason) && item.seasonNumber == null ? 20 : 0) +
        (/\/episode\//i.test(item.path) ? 30 : 0) +
        (/(?:episode|ep)[-_ ]?\d+/i.test(item.decoded + " " + item.label) ? 10 : 0),
    }))
    .filter((item) => !Number.isInteger(requestedSeason) || item.seasonNumber == null || item.seasonNumber === requestedSeason)
    .sort((a, b) => b.score - a.score);

  if (explicit[0]) return explicit[0].path;

  // Fallback: some Akwam series pages expose a plain ordered list of episode
  // links without the episode number in either the label or URL. Restrict the
  // candidates to episode-like routes and use their 1-based DOM order.
  const episodeLike = links.filter((item) =>
    /\/(?:episode|episodes)(?:\/|[-_])/i.test(item.path) ||
    /(?:episode|episodes|الحلقة|حلقة)/i.test(item.label + " " + item.decoded)
  );

  if (episodeLike.length >= requestedEpisode) {
    const seasonFiltered = Number.isInteger(requestedSeason)
      ? episodeLike.filter((item) => item.seasonNumber == null || item.seasonNumber === requestedSeason)
      : episodeLike;
    const pool = seasonFiltered.length >= requestedEpisode ? seasonFiltered : episodeLike;
    return pool[requestedEpisode - 1]?.path || "";
  }

  // Last-resort fallback for pages that use opaque numeric episode routes:
  // exclude navigation/player/download links and select the requested item from
  // links whose href stays on the same Akwam host.
  const opaque = links.filter((item) =>
    !/\/(?:watch|download|link|search|login|register)(?:\/|[?#]|$)/i.test(item.path) &&
    /\/(?:\d+|e\d+|ep\d+)(?:[/?#]|$)/i.test(new URL(item.path).pathname)
  );
  if (opaque.length >= requestedEpisode) {
    return opaque[requestedEpisode - 1]?.path || "";
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
    const response = await fetch(url, {
      headers: {
        Accept: "*/*",
        Range: "bytes=0-0",
        "User-Agent": UA,
        ...(referer ? { Referer: referer } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = safeUrl(response.headers.get("location"), url);
      try { response.body?.cancel(); } catch {}
      if (!next) throw new Error("AKWAM_FINAL_MEDIA: unsafe redirect");
      url = next;
      continue;
    }

    if (!response.ok) {
      try { response.body?.cancel(); } catch {}
      throw new Error("AKWAM_FINAL_MEDIA: HTTP " + response.status);
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const contentDisposition = response.headers.get("content-disposition") || "";
    const obviousMedia =
      /^video\//.test(contentType) ||
      /mpegurl|vnd\.apple\.mpegurl|dash\+xml|application\/dash/.test(contentType) ||
      /filename\s*=.*\.(?:mp4|m4v|webm|m3u8|mpd)/i.test(contentDisposition) ||
      /\.(?:mp4|m4v|webm|m3u8|mpd)(?:[?#]|$)/i.test(url);

    if (obviousMedia) {
      try { response.body?.cancel(); } catch {}
      const type = inferMediaType(url, contentType, contentDisposition, "", new Uint8Array());
      if (!type) throw new Error("AKWAM_FINAL_MEDIA: response is not recognized media");
      diagnostic("AKWAM_FINAL_MEDIA", "header-fast type=" + type + " contentType=" + contentType);
      return { media_url: url, type, content_type: contentType };
    }

    // Only ambiguous responses get a tiny bounded probe.
    const bytes = await readProbeBytes(response, 4096);
    const sample = new TextDecoder().decode(bytes.slice(0, 4096));
    if (challengePage(sample) ||
        /text\/html|application\/xhtml/.test(contentType) ||
        /<\s*(?:!doctype\s+html|html)\b/i.test(sample.slice(0, 512))) {
      throw new Error("AKWAM_FINAL_MEDIA: HTML/challenge response");
    }

    const type = inferMediaType(url, contentType, contentDisposition, sample, bytes);
    if (!type) throw new Error("AKWAM_FINAL_MEDIA: response is not recognized media");
    try { response.body?.cancel(); } catch {}
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
  const cacheKey = qualityUrl;
  const cached = qualityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, quality: quality.quality };
  }

  const targetPage = await getContentPageDirectFirst(
    browser,
    qualityUrl,
    /\/watch\//i.test(qualityUrl) ? "AKWAM_WATCH" : "AKWAM_LINK",
  );

  const directFromPage = extractFinalMediaUrl(targetPage.html, targetPage.url);
  if (directFromPage) {
    const directUrl = safeUrl(directFromPage, targetPage.url);
    if (directUrl) {
      let isAkwamPage = false;
      try {
        isAkwamPage = isAllowedPageHost(new URL(directUrl).hostname);
      } catch {}

      // Real media URLs are already extracted from the player document.
      // Do not issue a second network request just to probe them; that probe
      // was the largest fixed cost multiplied by every quality.
      if (!isAkwamPage || looksLikeMediaUrl(directUrl)) {
        const value = {
          media_url: directUrl,
          type: mediaTypeFromUrl(directUrl),
          quality: quality.quality,
        };
        qualityCache.set(cacheKey, { value, expiresAt: Date.now() + PLAYBACK_CACHE_TTL_MS });
        return value;
      }
    }
  }

  const downloadUrl = extractDownloadUrl(targetPage.html, targetPage.url);
  if (downloadUrl) {
    const target = await fetchDownloadTarget(downloadUrl, targetPage.url);
    if (target.kind === "media") {
      const value = {
        media_url: target.url,
        type: mediaTypeFromUrl(target.url),
        quality: quality.quality,
      };
      qualityCache.set(cacheKey, { value, expiresAt: Date.now() + PLAYBACK_CACHE_TTL_MS });
      return value;
    }

    const finalUrl = extractFinalMediaUrl(target.html, target.url);
    if (finalUrl) {
      const finalDirect = safeUrl(finalUrl, target.url);
      if (finalDirect) {
        const value = {
          ...(await validateMediaUrl(finalDirect, target.url)),
          quality: quality.quality,
        };
        qualityCache.set(cacheKey, { value, expiresAt: Date.now() + PLAYBACK_CACHE_TTL_MS });
        return value;
      }
    }
  }

  throw new Error(
    "AKWAM_FINAL_MEDIA: player/download page contained no direct media target; url=" +
      targetPage.url,
  );
}

function extractAkwamEpisodeLinksFromSearch(html) {
  const source = String(html || "");
  const out = [];
  const seen = new Set();

  const add = (raw) => {
    let value = String(raw || "")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'");

    for (let i = 0; i < 3; i += 1) {
      try {
        const decoded = decodeURIComponent(value);
        if (decoded === value) break;
        value = decoded;
      } catch {
        break;
      }
    }

    const values = [value];
    try {
      const wrapped = new URL(value, "https://search.local");
      for (const key of ["q", "url", "u", "uddg", "target"]) {
        const candidate = wrapped.searchParams.get(key);
        if (candidate) values.push(candidate);
      }
    } catch {}

    for (const candidate of values) {
      try {
        const url = new URL(candidate);
        if (!PAGE_HOSTS.has(url.hostname.toLowerCase())) continue;
        if (!/\/episode\//i.test(url.pathname)) continue;
        if (seen.has(url.href)) continue;
        seen.add(url.href);
        out.push(url.href);
      } catch {}
    }
  };

  const direct = /https?:\/\/(?:www\.)?(?:akwam\.ss|akwam\.it|akwam\.ee|akwam\.net|ak\.sv|akwam\.com\.co|go\.akwam\.com\.co|akw\.cam)\/episode\/[^"'<>\\s&]+/gi;
  for (const match of source.matchAll(direct)) add(match[0]);

  const anchors = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  for (const match of source.matchAll(anchors)) add(match[1]);

  return out;
}

function scoreBrowserSearchEpisode(url, payload) {
  let text = url;
  try { text = decodeURIComponent(url); } catch {}
  const normalized = normalizeTitle(text);
  const wanted = [
    payload?.title,
    payload?.title_en,
    payload?.original_title,
    payload?.title_ar,
  ].map(normalizeTitle).filter(Boolean);

  let score = 0;
  if (wanted.some((value) => normalized.includes(value))) score += 700;

  const season = Number(payload?.season);
  const episode = Number(payload?.episode);
  const seasonLabel = normalizeTitle(seasonSearchLabel(season));

  if (seasonLabel && normalized.includes(seasonLabel)) score += 300;
  if (new RegExp("(?:الحلقة|episode|ep)[-_\\s:#]*0*" + episode + "\\b", "i").test(text)) score += 300;
  return score;
}

async function searchAkwamEpisodeWithBrowser(browser, payload) {
  const title = clean(payload?.title) ||
    clean(payload?.title_en) ||
    clean(payload?.original_title) ||
    clean(payload?.title_ar);
  const season = Number(payload?.season);
  const episode = Number(payload?.episode);

  if (
    !title ||
    !Number.isInteger(season) ||
    season < 1 ||
    !Number.isInteger(episode) ||
    episode < 1
  ) return "";

  const seasonLabel = seasonSearchLabel(season);
  const queries = [
    'site:akwam.ss/episode "' + title + '" "' + seasonLabel + '" "الحلقة ' + episode + '"',
    'site:akwam.it/episode "' + title + '" "' + seasonLabel + '" "الحلقة ' + episode + '"',
    '"' + title + '" "' + seasonLabel + '" "الحلقة ' + episode + '" "akwam.ss/episode"',
  ];

  const engines = [
    (q) => "https://www.google.com/search?hl=en&q=" + encodeURIComponent(q),
    (q) => "https://www.bing.com/search?q=" + encodeURIComponent(q),
  ];

  let best = "";
  let bestScore = 0;
  let lastError = null;

  for (const engine of engines) {
    for (const query of queries) {
      try {
        const response = await browser.quickAction("content", {
          url: engine(query),
          userAgent: UA,
          gotoOptions: {
            waitUntil: "domcontentloaded",
            timeout: 20_000,
          },
        });
        const html = await getBrowserHtml(response);
        if (!response.ok) {
          lastError = new Error("browser search HTTP " + response.status);
          continue;
        }

        const links = extractAkwamEpisodeLinksFromSearch(html);
        for (const link of links) {
          const score = scoreBrowserSearchEpisode(link, payload);
          if (score > bestScore) {
            best = link;
            bestScore = score;
          }
        }

        if (bestScore >= 1300) {
          diagnostic("AKWAM_BROWSER_SEARCH_EPISODE", best);
          return best;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  if (best && bestScore >= 1000) {
    diagnostic("AKWAM_BROWSER_SEARCH_EPISODE", best + " score=" + bestScore);
    return best;
  }
  if (lastError) {
    diagnostic("AKWAM_BROWSER_SEARCH_EPISODE_FAILED", lastError.message);
  }
  return "";
}

async function resolveAkwamIframe(browser, payload) {
  const directContent = decodeContentUrl(payload);

  let entry = directContent
    ? { title: clean(payload?.title), url: directContent }
    : null;

  if (!entry) {
    try {
      // Direct HTTP search is the fast path. Browser Run is now only a fallback
      // when the ordinary Akwam index cannot expose a matching entry.
      entry = await searchAkwam(browser, payload);
    } catch (searchError) {
      if (payload?.type !== "series" || Number(payload?.episode) < 1) throw searchError;

      const searchedEpisode = await searchAkwamEpisodeWithBrowser(browser, payload);
      if (!searchedEpisode) throw searchError;

      entry = {
        title: clean(payload?.title) || "",
        url: searchedEpisode,
      };
    }
  }

  let sourceUrl = entry.url;

  if (payload?.type === "series" && Number(payload?.episode) > 0) {
    const existingEpisode = /\/episode\//i.test(sourceUrl);
    if (!existingEpisode) {
      let content;
      try {
        content = await getContentPageDirectFirst(browser, sourceUrl, "AKWAM_IFRAME_CONTENT");
      } catch (contentError) {
        const searchedEpisode = await searchAkwamEpisodeWithBrowser(browser, payload);
        if (!searchedEpisode) throw contentError;
        sourceUrl = searchedEpisode;
        content = null;
      }

      if (content) {
        const episodeUrl = extractEpisode(
          content.html,
          content.url,
          Number(payload?.season),
          Number(payload?.episode),
        );
        if (episodeUrl) {
          sourceUrl = episodeUrl;
        } else {
          const searchedEpisode = await searchAkwamEpisodeWithBrowser(browser, payload);
          if (!searchedEpisode) {
            throw new Error(
              "AKWAM_IFRAME_EPISODE: no matching S" +
                Number(payload?.season) +
                "E" +
                Number(payload?.episode) +
                " link on " +
                content.url,
            );
          }
          sourceUrl = searchedEpisode;
        }
      }
    }
  }

  const safeSource = safeUrl(sourceUrl, AKWAM_BASE, { pageOnly: true });
  if (!safeSource) {
    throw new Error("AKWAM_IFRAME: invalid Akwam page URL");
  }

  // Prefer Akwam's dedicated /watch/<id> playback route when the content page
  // exposes one. Embedding the content page itself renders the whole Akwam site;
  // /watch/<id> is the player route we actually want inside Movyz.
  let playerUrl = "";
  try {
    const content = await getContentPageDirectFirst(
      browser,
      safeSource,
      "AKWAM_IFRAME_PLAYER",
    );
    for (const match of String(content.html || "").matchAll(
      /<a\b[^>]*href=["']([^"']*\/watch\/\d+(?:[/?#][^"']*)?)["'][^>]*>/gi,
    )) {
      const candidate = safeUrl(match[1], content.url, { pageOnly: true });
      if (candidate && /\/watch\/\d+(?:[/?#]|$)/i.test(candidate)) {
        playerUrl = candidate;
        break;
      }
    }

    if (!playerUrl) {
      const rawWatch = String(content.html || "").match(
        /https?:\/\/(?:go\.)?ak(?:wam\.it|\.sv)[^"'<>\\s]*\/watch\/\d+(?:[/?#][^"'<>\\s]*)?/i,
      )?.[0];
      if (rawWatch) {
        const candidate = safeUrl(rawWatch, content.url, { pageOnly: true });
        if (candidate && /\/watch\/\d+(?:[/?#]|$)/i.test(candidate)) {
          playerUrl = candidate;
        }
      }
    }
  } catch (error) {
    diagnostic(
      "AKWAM_IFRAME_PLAYER_FALLBACK",
      error instanceof Error ? error.message : String(error),
    );
  }

  const iframeTarget = playerUrl || safeSource;

  diagnostic(
    "AKWAM_IFRAME",
    "type=" + (payload?.type || "movie") +
      " source=" + safeSource +
      " target=" + iframeTarget,
  );

  return {
    title: entry.title || clean(payload?.title) || "",
    source_url: safeSource,
    media_url: safeSource,
    type: "web",
    quality: "auto",
    qualities: ["auto"],
    sources: [{
      quality: "auto",
      type: "web",
      url: iframeTarget,
    }],
    iframe_url: iframeTarget,
    player_url: playerUrl || undefined,
  };
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
    playbackCache.set(key, {
      value,
      expiresAt: Date.now() + PLAYBACK_CACHE_TTL_MS,
    });
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
  const entry = directContent
    ? { title: clean(payload?.title), url: directContent }
    : await searchAkwam(browser, payload);

  const content = await getContentPageDirectFirst(browser, entry.url, "AKWAM_CONTENT");
  const episodeUrl =
    payload?.type === "series" && payload?.episode
      ? extractEpisode(content.html, content.url, payload?.season, payload.episode)
      : "";
  const mediaPage = episodeUrl
    ? await getContentPageDirectFirst(browser, episodeUrl, "AKWAM_CONTENT")
    : content;

  const qualities = extractQualities(mediaPage.html, mediaPage.url);
  diagnostic("AKWAM_QUALITY", qualities.map((item) => item.quality).join(",") || "none");

  if (!qualities.length) {
    throw new Error(
      "AKWAM_QUALITY: no quality links; page=" +
        mediaPage.url +
        "; bytes=" +
        mediaPage.html.length,
    );
  }

  const orderedQualities = qualities.sort(
    (a, b) => qualityRank(a.quality) - qualityRank(b.quality),
  );

  const buildResult = (resolved) => {
    const sources = resolved
      .filter(Boolean)
      .map((item) => ({
        quality: item.quality || "auto",
        type: item.type || mediaTypeFromUrl(item.media_url || item.url),
        url: item.media_url || item.url,
      }));

    const primary = sources[0];
    return {
      title: entry.title,
      source_url: mediaPage.url,
      media_url: primary?.url || "",
      type: primary?.type || mediaTypeFromUrl(primary?.url || ""),
      quality: primary?.quality || "auto",
      qualities: sources.map((item) => item.quality),
      sources,
    };
  };

  // Resolve all available qualities concurrently. Each quality now skips
  // the redundant media probe when a real media URL is already present, so
  // returning the complete quality set is fast again.
  const resolvedResults = await Promise.allSettled(
    orderedQualities.map(async (quality) => {
      const stream = await resolveQuality(browser, quality);
      diagnostic("AKWAM_QUALITY", quality.quality + " resolved");
      return stream;
    }),
  );

  const resolved = resolvedResults
    .filter((item) => item.status === "fulfilled")
    .map((item) => item.value);

  const lastError = resolvedResults
    .filter((item) => item.status === "rejected")
    .map((item) => item.reason)
    .at(-1);

  if (!resolved.length) {
    throw lastError || new Error("AKWAM_QUALITY: no usable quality");
  }

  const sources = resolved
    .sort((a, b) => qualityRank(a.quality) - qualityRank(b.quality))
    .map((item) => ({
      quality: item.quality || "auto",
      type: item.type || mediaTypeFromUrl(item.media_url || item.url),
      url: item.media_url || item.url,
    }));
  return {
    title: entry.title,
    source_url: mediaPage.url,
    media_url: sources[0]?.url || "",
    type: sources[0]?.type || mediaTypeFromUrl(sources[0]?.url || ""),
    quality: sources[0]?.quality || "auto",
    qualities: sources.map((item) => item.quality),
    sources,
  };
}

export default { async fetch(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "movyz-akwam-resolver", browser: Boolean(env.BROWSER), mode: "direct-akwam-pipeline" });

  if (request.method === "POST" && url.pathname === "/resolve-iframe") {
    let payload;
    try { payload = await request.json(); } catch {
      return json({ ok: false, error: "Valid JSON body required" }, 400);
    }

    if (!clean(payload?.title) && !decodeContentUrl(payload)) {
      return json({ ok: false, error: "title or Akwam content_url is required" }, 400);
    }
    if (!env.BROWSER?.quickAction) {
      return json({ ok: false, error: "Browser Run Quick Actions unavailable" }, 500);
    }

    try {
      return json({
        ok: true,
        ...(await resolveAkwamIframe(env.BROWSER, {
          ...payload,
          type: payload?.type === "series" ? "series" : "movie",
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostic("AKWAM_IFRAME_FAILED", message);
      return json({ ok: false, error: message }, 502);
    }
  }

  if (request.method !== "POST" || url.pathname !== "/resolve") return json({ ok: false, error: "Not found" }, 404);
  let payload; try { payload = await request.json(); } catch { return json({ ok: false, error: "Valid JSON body required" }, 400); }
  if (!clean(payload?.title) && !decodeContentUrl(payload)) return json({ ok: false, error: "title or Akwam content_url is required" }, 400);
  if (!env.BROWSER?.quickAction) return json({ ok: false, error: "Browser Run Quick Actions unavailable" }, 500);
  try { return json({ ok: true, ...(await resolveAkwamCached(env.BROWSER, { ...payload, type: payload?.type === "series" ? "series" : "movie" })) }); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); diagnostic("AKWAM_FAILED", message); return json({ ok: false, error: message }, 502); }
} };

// Akwam prep: staged discovery + exact episode-to-watch resolution.
type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void;
};
type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  AKWAM_BASE_URL: string;
  MAX_JOBS_PER_RUN: string;
  PREFILL_CONCURRENCY?: string;
  PREFILL_FANOUT?: string;
};

type Job = {
  id: string;
  content_type: "movie" | "episode";
  content_id: string;
  tmdb_id: number | null;
  season_number: number | null;
  episode_number: number | null;
  attempts: number;
};

type Candidate = {
  url: string;
  title: string;
  year?: number;
  kind: "movie" | "series" | "episode" | "watch" | "other";
};
type Media = {
  url: string;
  type: "hls" | "mp4" | "dash" | "webm" | "direct";
  quality?: string;
  referer?: string;
  trustedExternal?: boolean;
};

type RequestBudget = {
  used: number;
  max: number;
};

function consumeRequest(budget?: RequestBudget) {
  if (!budget) return;
  budget.used += 1;
  if (budget.used > budget.max) {
    throw new Error(`AKWAM_SUBREQUEST_BUDGET_EXCEEDED used=${budget.used} max=${budget.max}`);
  }
}

const AKWAM_HOSTS = new Set(["akwam.ss", "www.akwam.ss"]);

function isAkwamUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && AKWAM_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function base(env: Env) {
  return "https://akwam.ss";
}

function headers(env: Env) {
  const b = base(env);
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en;q=0.9",
    Referer: b,
  };
}

async function sb(env: Env, path: string, init: RequestInit = {}) {
  const response = await fetch(env.SUPABASE_URL.replace(/\/+$/, "") + path, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 700)}`);
  return text ? JSON.parse(text) : null;
}

async function claim(env: Env, workerId: string): Promise<Job | null> {
  const rows = await sb(env, "/rest/v1/rpc/claim_akwam_prefill_job", {
    method: "POST",
    body: JSON.stringify({ p_worker_id: workerId, p_lease_seconds: 300 }),
  });
  return Array.isArray(rows) && rows[0] ? (rows[0] as Job) : null;
}

async function fetchText(env: Env, url: string, diagnostics?: string[], referer?: string, budget?: RequestBudget): Promise<string | null> {
  try {
    consumeRequest(budget);
    const response = await fetch(url, {
      headers: {
        ...headers(env),
        ...(referer ? { Referer: referer } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) {
      diagnostics?.push(new URL(url).hostname + ":" + response.status);
      return null;
    }
    return await response.text();
  } catch (error) {
    diagnostics?.push(new URL(url).hostname + ":ERR");
    return null;
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u003f/gi, "?")
    .replaceAll("\\/","/");
}

function normalize(value: string) {
  return decodeHtml(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function overlap(a: string, b: string) {
  const x = new Set(a.split(" ").filter(Boolean));
  const y = new Set(b.split(" ").filter(Boolean));
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const t of x) if (y.has(t)) common++;
  return common / Math.max(x.size, y.size);
}

function candidateKind(pathname: string): Candidate["kind"] {
  const path = pathname.toLowerCase();
  if (/^\/old(?:\/|$)/i.test(path)) return "other";
  if (/^\/(?:series|shows?)\//i.test(path)) return "series";
  if (/^\/movie\//i.test(path)) return "movie";
  if (/^\/(?:episode|show\/episode)\//i.test(path)) return "episode";
  if (/^\/watch\//i.test(path)) return "watch";
  return "other";
}

function decodeUrlPath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function candidateSignals(c: Candidate) {
  try {
    const pathname = decodeUrlPath(decodeHtml(new URL(c.url).pathname));
    const parts = pathname.split("/").filter(Boolean);
    const slug = parts.at(-1) || "";
    return [c.title, slug.replace(/[-_]+/g, " ")].filter(Boolean);
  } catch {
    return [c.title];
  }
}

function explicitSeason(value: string): number | undefined {
  const text = normalize(decodeUrlPath(value));
  const digit = text.match(/(?:season|الموسم)\s*([0-9]+)/i);
  if (digit?.[1]) return Number(digit[1]);
  const words: Record<string, number> = {
    "الاول": 1, "الاولي": 1,
    "الثاني": 2, "الثانيه": 2, "الثانية": 2,
    "الثالث": 3, "الثالثه": 3, "الثالثة": 3,
    "الرابع": 4, "الرابعه": 4, "الرابعة": 4,
    "الخامس": 5, "الخامسه": 5, "الخامسة": 5,
    "السادس": 6, "السادسه": 6, "السادسة": 6,
    "السابع": 7, "السابعة": 7, "السابعـة": 7,
    "الثامن": 8, "الثامنة": 8,
    "التاسع": 9, "التاسعة": 9,
    "العاشر": 10, "العاشرة": 10,
  };
  for (const [word, n] of Object.entries(words)) {
    if (text.includes("الموسم " + word)) return n;
  }
  const s = text.match(/\bs0*([0-9]{1,2})\b/i);
  return s?.[1] ? Number(s[1]) : undefined;
}

function score(c: Candidate, titles: string[], year?: number, expected?: "movie" | "series" | "episode", expectedSeason?: number) {
  if (c.kind === "other" || c.kind === "watch") return -1000;
  if (expected === "movie" && c.kind !== "movie") return -1000;
  if (expected === "series" && c.kind !== "series") return -1000;
  if (expected === "episode" && c.kind !== "series" && c.kind !== "episode") return -1000;

  if (expected === "series" && expectedSeason) {
    const declared = explicitSeason(c.title + " " + c.url);
    if (declared !== undefined && declared !== expectedSeason) return -1000;
  }

  let bestTitleScore = 0;
  for (const rawCandidate of candidateSignals(c)) {
    const ct = normalize(rawCandidate);
    if (!ct) continue;
    for (const raw of titles) {
      const t = normalize(raw);
      if (!t) continue;
      if (ct === t) bestTitleScore = Math.max(bestTitleScore, 110);
      else if (ct.includes(t) || t.includes(ct)) bestTitleScore = Math.max(bestTitleScore, 88);
      else {
        const ov = overlap(ct, t);
        if (ov >= 0.45) bestTitleScore = Math.max(bestTitleScore, 55 + ov * 35);
      }
    }
  }

  if (bestTitleScore < 80) return -1000;

  let out = bestTitleScore;
  if (expected === c.kind) out += 18;
  if (year && c.year) {
    if (year === c.year) out += 24;
    else if (Math.abs(year - c.year) === 1) out += 6;
    else return -1000;
  }
  if (expected === "series" && expectedSeason) {
    const declared = explicitSeason(c.title + " " + c.url);
    if (declared !== undefined) {
      if (declared !== expectedSeason) return -1000;
      out += 28;
    }
  }
  return Math.min(160, out);
}

function rawTextFromAnchor(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCandidates(html: string, env: Env, allowLegacy = false): Candidate[] {
  const out: Candidate[] = [];
  const re = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html))) {
    const href = m[1].trim();
    let u: URL;
    try {
      u = new URL(href, base(env));
    } catch {
      continue;
    }

    if (!isAkwamUrl(u.href)) continue;

    let kind = candidateKind(u.pathname);
    if (allowLegacy && kind === "other" && /^\/old\//i.test(u.pathname)) {
      kind = /(?:فيلم|movie)/i.test(rawTextFromAnchor(m[2])) ? "movie" : /(?:مسلسل|series|show)/i.test(rawTextFromAnchor(m[2])) ? "series" : "other";
    }
    if (kind === "other" || kind === "watch") continue;

    const rawText = m[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();

    const parts = u.pathname.split("/").filter(Boolean);
    const slug = decodeUrlPath(parts[parts.length - 1] || "").replace(/[-_]+/g, " ");
    const title = [rawText, slug].filter(Boolean).join(" || ");

    const yearMatch = (rawText.match(/(?:19|20)[0-9]{2}/) || [])[0];

    const item: Candidate = {
      url: u.href,
      title,
      kind,
      year: yearMatch ? Number(yearMatch) : undefined,
    };

    if (!out.some((x) => x.url === item.url)) out.push(item);
  }

  return out;
}

async function findCandidate(
  env: Env,
  titles: string[],
  year?: number,
  expected: "movie" | "series" | "episode" = "movie",
  expectedSeason?: number,
  budget?: RequestBudget,
) {
  const hosts = [base(env)];

  let best: { item: Candidate; score: number } | null = null;
  const diagnostics: string[] = [];
  const seeds = titles.filter(Boolean).map((x) => x.trim()).filter(Boolean).slice(0, 3);
  const variants = Array.from(new Set([
    ...seeds,
    year && seeds[0] ? `${seeds[0]} ${year}` : "",
    expectedSeason && seeds[0] ? `${seeds[0]} season ${expectedSeason}` : "",
    expectedSeason && seeds[0] ? `${seeds[0]} الموسم ${expectedSeason}` : "",
    expectedSeason && seeds[0] ? `${seeds[0]} S${String(expectedSeason).padStart(2, "0")}` : "",
  ].filter(Boolean))).slice(0, 4);

  for (const host of hosts) {
    for (const title of variants) {
      const section =
        expected === "movie"
          ? "movie"
          : expected === "series" || expected === "episode"
            ? "series"
            : "movie";
      // Akwam's currently verified route is /search?q=... . Some revisions
      // return 404 when section/page query parameters are appended, so probe the
      // canonical route first and apply our own movie/series scoring client-side.
      const urls = [
        host + "/search?q=" + encodeURIComponent(title),
        host + "/search?q=" + encodeURIComponent(title) +
          "&section=" + encodeURIComponent(section) + "&page=1",
      ];

      for (const url of urls) {
        const html = await fetchText(env, url, diagnostics, undefined, budget);
        if (!html) continue;

        for (const item of parseCandidates(html, env)) {
          const itemScore = score(item, titles, year, expected, expectedSeason);
          if (!best || itemScore > best.score) best = { item, score: itemScore };
        }

        if (best && best.score >= 128) return best.item;
      }
    }

    // The current search form has changed across Akwam revisions. Keep the
    // primary /search?q= route first, then try only a small set of bounded
    // fallback routes before touching the legacy archive.
    const fallbackRoutes =
      expected === "movie"
        ? [
            host + "/movies?search=" + encodeURIComponent(seeds[0] || ""),
            host + "/movies?query=" + encodeURIComponent(seeds[0] || ""),
            host + "/search/" + encodeURIComponent(seeds[0] || ""),
          ]
        : expected === "series"
          ? [
              host + "/series?search=" + encodeURIComponent(seeds[0] || ""),
              host + "/series?query=" + encodeURIComponent(seeds[0] || ""),
              host + "/search/" + encodeURIComponent(seeds[0] || ""),
            ]
          : [];

    for (const url of fallbackRoutes) {
      if (!url.endsWith("=")) {
        const html = await fetchText(env, url, diagnostics);
        if (!html) continue;
        for (const item of parseCandidates(html, env)) {
          const itemScore = score(item, titles, year, expected, expectedSeason);
          if (!best || itemScore > best.score) best = { item, score: itemScore };
        }
        if (best && best.score >= 128) return best.item;
      }
    }

    // Legacy search is allowed only on the single verified host, as a last resort.
    // Old result pages use /old/... URLs, so parse them explicitly instead of
    // discarding every legacy candidate as "other".
    if (host === base(env)) {
      for (const title of variants.slice(0, 1)) {
        const html = await fetchText(env, host + "/old/search/" + encodeURIComponent(title), diagnostics, undefined, budget);
        if (!html) continue;
        for (const item of parseCandidates(html, env, true)) {
          const itemScore = score(item, titles, year, expected, expectedSeason);
          if (!best || itemScore > best.score) best = { item, score: itemScore };
        }
        if (best && best.score >= 128) return best.item;
      }
    }
  }

  const winner = best as { item: Candidate; score: number } | null;
  if (winner && winner.score >= 80) return winner.item;
  throw new Error("AKWAM_SEARCH_EMPTY probes=" + diagnostics.slice(0, 12).join(","));
}



function extractMediaLikeUrls(text: string) {
  const decoded = decodeHtml(text);
  return Array.from(new Set(
    decoded.match(/https?:\/\/[^\s"'<>]+/gi) || [],
  ));
}

function inferQuality(text: string) {
  return (decodeHtml(text).match(/(?:^|\D)(2160|1440|1080|720|576|480|360|240)(?:p)?(?:\D|$)/i) || [])[1];
}

function mediaTypeFromUrl(url: string): Media["type"] {
  if (/\.m3u8(?:\?|$)/i.test(url)) return "hls";
  if (/\.mpd(?:\?|$)/i.test(url)) return "dash";
  if (/\.webm(?:\?|$)/i.test(url)) return "webm";
  if (/\.mp4(?:\?|$)/i.test(url)) return "mp4";
  return "direct";
}

function absoluteUrl(raw: string, baseUrl: string) {
  try {
    const decoded = decodeHtml(raw).trim();
    const url = new URL(decoded, baseUrl);
    if (url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function isLikelyNavigationUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (!AKWAM_HOSTS.has(parsed.hostname.toLowerCase())) return false;
    const path = parsed.pathname.toLowerCase();
    return /^\/(?:download|link|watch|episode|show\/episode|movie|series)\//i.test(path);
  } catch {
    return false;
  }
}

function addUrlCandidate(
  out: Array<{ url: string; score: number; quality?: string; referer?: string }>,
  seen: Set<string>,
  raw: string,
  baseUrl: string,
  score: number,
  qualityText = "",
) {
  const url = absoluteUrl(raw, baseUrl);
  if (!url || seen.has(url)) return;
  seen.add(url);
  out.push({
    url,
    score,
    quality: inferQuality(qualityText),
    referer: isAkwamUrl(baseUrl) ? baseUrl : undefined,
  });
}

function extractMediaCandidates(text: string, baseUrl: string) {
  const out: Array<{ url: string; score: number; quality?: string; referer?: string }> = [];
  const seen = new Set<string>();
  const decoded = decodeHtml(text);

  for (const url of extractMediaLikeUrls(decoded)) {
    const nav = isLikelyNavigationUrl(url);
    addUrlCandidate(out, seen, url, baseUrl, nav ? 20 : 180, decoded);
  }

  const attrs = /(?:href|src|data-src|data-url|data-file|data-video|data-href|data-link|data-stream|data-playlist)=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = attrs.exec(decoded))) {
    const raw = match[1];
    const url = absoluteUrl(raw, baseUrl);
    if (!url || isLikelyNavigationUrl(url)) continue;
    const nearby = decoded.slice(Math.max(0, match.index - 1200), match.index + 1800);
    const score = /(?:m3u8|mp4|mpd|webm|stream|playlist|manifest|videoUrl|video_url|data-file|data-video|data-stream)/i.test(
      nearby + " " + raw,
    ) ? 160 : 110;
    addUrlCandidate(out, seen, url, baseUrl, score, nearby + " " + raw);
  }

  const keyValue = /(?:file|source|src|videoUrl|video_url|stream|streamUrl|playlist|manifest|hls|dash|mediaUrl|media_url|playbackUrl|playback_url|url)\s*[:=]\s*["']([^"']+)["']/gi;
  while ((match = keyValue.exec(decoded))) {
    const url = absoluteUrl(match[1], baseUrl);
    if (!url || isLikelyNavigationUrl(url)) continue;
    const nearby = decoded.slice(Math.max(0, match.index - 900), match.index + 1400);
    addUrlCandidate(out, seen, url, baseUrl, 150, nearby);
  }

  const quotedAbsolute = /["'](https?:\/\/[^"'<>]+)["']/gi;
  while ((match = quotedAbsolute.exec(decoded))) {
    const raw = match[1];
    if (isLikelyNavigationUrl(raw)) continue;
    addUrlCandidate(out, seen, raw, baseUrl, 90, decoded.slice(Math.max(0, match.index - 700), match.index + 1100));
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 16);
}

function mediaFromUrl(url: string, referer?: string, qualityText = ""): Media {
  // External media extracted from an Akwam page inherits the same page
  // attestation as the dedicated download-button resolver. This is needed
  // for Akwam CDNs that return TLS 526 to strict Cloudflare subrequests.
  let trustedExternal = false;
  try {
    trustedExternal = Boolean(
      referer &&
      isAkwamUrl(referer) &&
      new URL(url).hostname.toLowerCase() !== new URL(referer).hostname.toLowerCase(),
    );
  } catch {}

  return {
    url,
    type: mediaTypeFromUrl(url),
    quality: inferQuality(qualityText),
    referer,
    trustedExternal,
  };
}

function extractMedia(text: string, baseUrl: string): Media | null {
  const candidate = extractMediaCandidates(text, baseUrl)[0];
  return candidate ? mediaFromUrl(candidate.url, candidate.referer, text) : null;
}

function cleanHtmlText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPageLinks(html: string, baseUrl: string) {
  const out: Array<{ url: string; text: string }> = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = absoluteUrl(m[1], baseUrl);
    if (!url || !isAkwamUrl(url)) continue;
    out.push({ url, text: cleanHtmlText(m[2]) });
  }
  return out;
}

function extractEpisodeTarget(html: string, baseUrl: string, season: number, episode: number) {
  const links = extractPageLinks(html, baseUrl);
  let best: { url: string; score: number } | null = null;

  for (const link of links) {
    let rawPath = "";
    try { rawPath = decodeURIComponent(new URL(link.url).pathname); } catch { rawPath = link.url; }
    if (/^\/old(?:\/|$)/i.test(rawPath)) continue;

    const hay = decodeUrlPath(decodeHtml(link.text + " " + rawPath));
    const declaredSeason = explicitSeason(hay);
    if (declaredSeason !== undefined && declaredSeason !== season) continue;

    const looksLikeEpisode =
      /(?:حلقة|الحلقه|episode|epis(?:ode)?|s\d+e\d+)/i.test(hay) ||
      /\/(?:episode|show\/episode|watch)\//i.test(rawPath);
    if (!looksLikeEpisode) continue;

    let scoreValue = 0;
    const exactEpisode =
      new RegExp("(?:الحلقة|الحلقه|episode|ep(?:isode)?)[-_\\s]*(?:رقم[-_\\s]*)?0*" + episode + "(?![0-9.])", "i").test(hay) ||
      new RegExp("(?:^|[^0-9.])0*" + episode + "(?:$|[^0-9.])", "i").test(rawPath);
    const exactSeasonEpisode =
      new RegExp("s0*" + season + "e0*" + episode + "(?![0-9])", "i").test(hay + " " + rawPath) ||
      new RegExp("(?:season|الموسم)[-_\\s]*0*" + season + "[^0-9]*(?:episode|ep|الحلقة|الحلقه)[-_\\s]*0*" + episode + "(?![0-9])", "i").test(hay);
    const seasonMatch =
      new RegExp("(?:season|الموسم)[-_\\s]*0*" + season + "(?:\\D|$)", "i").test(hay) ||
      new RegExp("(?:s)0*" + season + "(?:\\D|$)", "i").test(rawPath);

    if (exactSeasonEpisode) scoreValue += 260;
    if (exactEpisode) scoreValue += 210;
    if (seasonMatch) scoreValue += 55;
    if (/\/(?:episode|show\/episode)\//i.test(rawPath)) scoreValue += 35;
    if (/\/watch\//i.test(rawPath)) scoreValue += 20;

    if (scoreValue > 0 && (!best || scoreValue > best.score)) {
      best = { url: link.url, score: scoreValue };
    }
  }

  return best?.url || null;
}

function targetResolutionScore(raw: string) {
  try {
    const path = new URL(raw).pathname.toLowerCase();
    if (/(?:\.m3u8|\.mp4|\.mpd|\.webm)(?:\?|$)/i.test(path)) return 260;
    if (/^\/(?:download|link)\//i.test(path)) return 220;
    if (/^\/watch\//i.test(path)) return 170;
    if (/^\/(?:episode|show\/episode)\//i.test(path)) return 150;
    return 10;
  } catch {
    return 0;
  }
}

function usefulResolutionTargets(targets: string[], limit = 6) {
  return Array.from(new Set(targets))
    .filter((url) => targetResolutionScore(url) > 10)
    .sort((a, b) => targetResolutionScore(b) - targetResolutionScore(a))
    .slice(0, limit);
}

function extractTargets(html: string, baseUrl: string) {
  const ranked: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();

  const add = (raw: string, scoreValue: number) => {
    const url = absoluteUrl(raw, baseUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    ranked.push({ url, score: scoreValue });
  };

  const addLinkAsDownload = (href: string, text: string) => {
    const observedUrl = absoluteUrl(href, baseUrl);
    if (!observedUrl || !isAkwamUrl(observedUrl)) return;

    try {
      const observed = new URL(observedUrl);
      if (/^\/download\//i.test(observed.pathname)) {
        add(observed.href, 220);
        return;
      }

      const marker = observed.pathname.indexOf("/link");
      if (marker >= 0) {
        const contentPath = new URL(baseUrl).pathname.replace(/\/$/, "");
        const suffixMatch = contentPath.match(/\/(?:movie|episode|shows|show\/episode)(\/.*)?$/i);
        const contentSuffix = suffixMatch?.[1] || "";
        const linkSuffix = observed.pathname.slice(marker + "/link".length);
        add(new URL(observed.origin + "/download" + linkSuffix + contentSuffix).href, 190);
        return;
      }

      if (/(?:تحميل|download)/i.test(text)) add(observed.href, 180);
      else if (/^\/watch\//i.test(observed.pathname)) add(observed.href, 120);
      else if (/\/episode\//i.test(observed.pathname)) add(observed.href, 40);
    } catch {}
  };

  const anchors = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchors.exec(html))) {
    addLinkAsDownload(m[1], cleanHtmlText(decodeHtml(m[2])));
  }

  for (const candidate of extractMediaCandidates(html, baseUrl)) {
    add(candidate.url, candidate.score);
  }

  return ranked.sort((a, b) => b.score - a.score).map((x) => x.url).slice(0, 16);
}


function extractDownloadButtonMedia(html: string, baseUrl: string): Media | null {
  // Akwam's current download page sets the final CDN URL from JavaScript:
  // $('a.download').attr('href', 'https://.../file.mp4');
  const scriptMedia = /(?:\.attr\s*\(\s*["'](?:href|src)["']\s*,|(?:file|source|media|url)\s*[:=]\s*)\s*["'](https?:\/\/[^"'<>]+\.(?:m3u8|mp4|mpd|webm)(?:\?[^"'<>]*)?)["']/gi;
  const scriptMatch = scriptMedia.exec(html);
  if (scriptMatch?.[1]) {
    const url = absoluteUrl(scriptMatch[1], baseUrl);
    if (url) {
      return {
        url,
        type: mediaTypeFromUrl(url),
        quality: inferQuality(html),
        referer: isAkwamUrl(baseUrl) ? baseUrl : undefined,
        trustedExternal: isAkwamUrl(baseUrl) && !isAkwamUrl(url),
      };
    }
  }

  const patterns = [
    /<[^>]*class=["'][^"']*btn-loader[^"']*["'][^>]*>[\s\S]{0,8000}?<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi,
    /<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*btn-loader[^"']*["'][^>]*>/gi,
    /<a\b[^>]*class=["'][^"']*btn-loader[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?(?:تحميل|Download|تحميل الآن)[\s\S]*?<\/a>/gi,
  ];

  for (const re of patterns) {
    const match = re.exec(html);
    if (!match?.[1]) continue;
    const url = absoluteUrl(match[1], baseUrl);
    if (!url) continue;
    return {
      url,
      type: mediaTypeFromUrl(url),
      quality: inferQuality(match[0] + " " + html.slice(Math.max(0, match.index - 1200), match.index + 1800)),
      referer: isAkwamUrl(baseUrl) ? baseUrl : undefined,
      trustedExternal: isAkwamUrl(baseUrl) && !isAkwamUrl(url),
    };
  }

  const attrs = /(?:href|src|data-src|data-file|data-video|data-url|data-href|data-link|data-stream)=["']([^"']+)["']/gi;
  let attr: RegExpExecArray | null;
  while ((attr = attrs.exec(html))) {
    const raw = decodeHtml(attr[1]);
    if (!/(?:\.m3u8|\.mp4|\.mpd|\.webm)(?:\?|$)/i.test(raw)) continue;
    const url = absoluteUrl(raw, baseUrl);
    if (!url) continue;
    return {
      url,
      type: mediaTypeFromUrl(url),
      quality: inferQuality(html.slice(Math.max(0, attr.index - 1000), attr.index + 1000)),
      referer: isAkwamUrl(baseUrl) ? baseUrl : undefined,
      trustedExternal: isAkwamUrl(baseUrl) && !isAkwamUrl(url),
    };
  }

  return null;
}

async function readPrefix(response: Response, maxBytes = 8192) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value?.length) {
        const remaining = maxBytes - total;
        const chunk = next.value.length > remaining ? next.value.slice(0, remaining) : next.value;
        chunks.push(chunk);
        total += chunk.length;
      }
    }
  } finally { try { await reader.cancel(); } catch {} }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}

async function validateMedia(env: Env, media: Media, budget?: RequestBudget) {
  try {
    if (!/^https:\/\//i.test(media.url)) return false;

    consumeRequest(budget);
    const response = await fetch(media.url, {
      method: "GET",
      headers: {
        ...headers(env),
        Accept: "*/*",
        Range: "bytes=0-8191",
        ...(media.referer ? { Referer: media.referer } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 526 && media.trustedExternal) {
      // Akwam itself attests this external URL as the playable media source,
      // but Cloudflare Workers use strict TLS for external subrequests and
      // cannot validate this CDN's broken/incomplete certificate chain.
      return true;
    }

    if (!response.ok && response.status !== 206) return false;

    const ct = response.headers.get("content-type")?.toLowerCase() || "";
    const body = await readPrefix(response);
    if (!body.length) return false;

    const sample = new TextDecoder().decode(body.slice(0, 8192)).trim();
    if (/<html[\s>]|<!doctype|captcha|cloudflare/i.test(sample)) return false;

    if (/#EXTM3U/i.test(sample) || /(?:mpegurl|vnd\.apple\.mpegurl)/i.test(ct)) return true;
    if (/<MPD[\s>]|<\?xml[^>]*>\s*<MPD/i.test(sample) || /dash\+xml/i.test(ct)) return true;
    if (ct.startsWith("video/")) return true;
    if (ct.includes("webm") || (body[0] === 0x1a && body[1] === 0x45 && body[2] === 0xdf && body[3] === 0xa3)) return true;

    // Some Akwam CDN download links return HTTP 200 with a generic content type.
    // For an explicit MP4 URL, accept a real binary prefix after rejecting HTML/challenges.
    if (
      response.status === 200 &&
      media.type === "mp4" &&
      body.length >= 4096 &&
      !/^(?:text\/|application\/json|application\/javascript|text\/html)/i.test(ct)
    ) return true;

    // Akwam's direct video endpoints can legitimately return 206 + octet-stream
    // without a recognizable container signature in the first bytes. Some download
    // endpoints also return 200 + octet-stream for a large attachment after redirect.
    // Accept these forms only after rejecting HTML/captcha and requiring strong
    // range/size/attachment evidence.
    if (ct.includes("octet-stream") || ct.includes("binary/octet-stream")) {
      const contentRange = response.headers.get("content-range") || "";
      const contentLength = Number(response.headers.get("content-length") || 0);
      const disposition = response.headers.get("content-disposition") || "";

      if (
        response.status === 206 &&
        body.length >= 1024 &&
        Boolean(contentRange)
      ) return true;

      if (
        response.status === 200 &&
        body.length >= 8192 &&
        (contentLength >= 1024 * 1024 || /attachment/i.test(disposition))
      ) return true;
    }

    for (let i = 0; i + 3 < Math.min(body.length, 1024); i++) {
      if (body[i] === 0x66 && body[i + 1] === 0x74 && body[i + 2] === 0x79 && body[i + 3] === 0x70) return true;
    }

    return false;
  } catch (error) {
    if (
      media.trustedExternal &&
      /(?:certificate|cert_|unable to verify|self[- ]signed|local issuer|tls)/i.test(String(error))
    ) {
      return true;
    }
    return false;
  }
}

async function resolveTarget(
  env: Env,
  target: string,
  referer?: string,
  budget?: RequestBudget,
): Promise<Media | null> {
  const queue: Array<{ url: string; referer?: string; depth: number }> = [
    { url: target, referer, depth: 0 },
  ];
  const seen = new Set<string>();

  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current.url) || current.depth > 2) continue;
    seen.add(current.url);

    const navigation = isLikelyNavigationUrl(current.url);
    const direct = mediaFromUrl(current.url, current.referer);
    if (!navigation && await validateMedia(env, direct, budget)) return direct;

    const html = await fetchText(env, current.url, undefined, current.referer, budget);
    if (!html) continue;

    const buttonMedia = extractDownloadButtonMedia(html, current.url);
    if (buttonMedia && await validateMedia(env, buttonMedia, budget)) {
      return buttonMedia;
    }

    if (buttonMedia && current.depth < 2) {
      try {
        const buttonUrl = new URL(buttonMedia.url);
        if (buttonUrl.protocol === "https:" && !seen.has(buttonUrl.href)) {
          queue.push({
            url: buttonUrl.href,
            referer: current.url,
            depth: current.depth + 1,
          });
        }
      } catch {}
    }

    const mediaCandidates = extractMediaCandidates(html, current.url);
    for (const candidate of mediaCandidates.slice(0, 2)) {
      const media = mediaFromUrl(
        candidate.url,
        candidate.referer || current.url,
        html,
      );
      if (await validateMedia(env, media, budget)) return media;
    }

    if (current.depth >= 2) continue;
    const nestedTargets = usefulResolutionTargets(
      extractTargets(html, current.url),
      1,
    );
    for (const nested of nestedTargets) {
      if (seen.has(nested)) continue;
      queue.push({
        url: nested,
        referer: current.url,
        depth: current.depth + 1,
      });
    }
  }

  return null;
}


async function getContext(env: Env, job: Job) {
  const rows = await sb(env, "/rest/v1/rpc/get_akwam_prefill_context", {
    method: "POST",
    body: JSON.stringify({ p_job_id: job.id }),
  });
  const ctx = rows?.[0];
  if (!ctx) throw new Error("AKWAM_CONTEXT_NOT_FOUND");

  return {
    titles: Array.isArray(ctx.titles) ? (ctx.titles.filter(Boolean) as string[]) : [],
    year: ctx.year ? Number(ctx.year) : undefined,
    episodeNumber: ctx.episode_number ? Number(ctx.episode_number) : undefined,
    seasonNumber: ctx.season_number ? Number(ctx.season_number) : undefined,
  };
}

async function discover(env: Env, job: Job, ctx: any, budget: RequestBudget) {
  const expected = job.content_type === "episode" ? "series" : "movie";
  const candidate = await findCandidate(
    env,
    ctx.titles,
    ctx.year,
    expected,
    job.content_type === "episode" ? (ctx.seasonNumber || job.season_number || 1) : undefined,
    budget,
  );
  if (!candidate) throw new Error("AKWAM_NOT_FOUND");

  const detail = await fetchText(env, candidate.url, undefined, undefined, budget);
  if (!detail) throw new Error("AKWAM_DETAIL_FETCH_FAILED");

  let targets: string[] = [];
  if (job.content_type === "episode") {
    const ep = ctx.episodeNumber || job.episode_number || 1;
    const season = ctx.seasonNumber || job.season_number || 1;

    if (!/^\/series\//i.test(new URL(candidate.url).pathname)) {
      throw new Error("AKWAM_SERIES_CANDIDATE_INVALID candidate=" + candidate.url);
    }

    const exactEpisode = extractEpisodeTarget(detail, candidate.url, season, ep);
    if (!exactEpisode) {
      throw new Error("AKWAM_EPISODE_NOT_INDEXED candidate=" + candidate.url + " season=" + season + " episode=" + ep);
    }

    const episodeHtml = await fetchText(env, exactEpisode, undefined, candidate.url, budget);
    if (!episodeHtml) throw new Error("AKWAM_EPISODE_FETCH_FAILED");

    targets = extractTargets(episodeHtml, exactEpisode);
    if (!targets.length) throw new Error("AKWAM_EPISODE_LINKS_EMPTY episode=" + new URL(exactEpisode).pathname);
  } else {
    targets = extractTargets(detail, candidate.url);
  }

  const medias: Media[] = [];
  const sourceReferer = candidate.url;
  const resolutionTargets = usefulResolutionTargets(targets, 2);
  for (const target of resolutionTargets) {
    const media = await resolveTarget(env, target, sourceReferer, budget);
    if (!media) continue;
    if (!medias.some((x) => x.url === media.url)) medias.push(media);
    if (medias.length >= 3) break;
  }

  if (!medias.length) {
    const summary = targets.slice(0, 10).map((url) => {
      try { return new URL(url).pathname; } catch { return "invalid"; }
    }).join(",");
    throw new Error("AKWAM_NO_PLAYABLE_SOURCE candidate=" + candidate.url + " targets=" + summary);
  }
  return medias;
}

async function providerId(env: Env) {
  const rows = await sb(env, "/rest/v1/providers?select=id&key=eq.akwam&limit=1");
  if (rows?.[0]?.id) return rows[0].id as string;
  const created = await sb(env, "/rest/v1/providers?on_conflict=key&select=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      key: "akwam",
      name: "Akwam",
      adapter_name: "akwam-db-prefill",
      enabled: true,
      status: "healthy",
      updated_at: new Date().toISOString(),
    }),
  });
  if (!created?.[0]?.id) throw new Error("Akwam provider row missing");
  return created[0].id as string;
}

async function persist(env: Env, job: Job, sources: Media[], provider: string, workerId: string) {
  const rows = sources.map((s, i) => ({
    source_type: s.type,
    content_id: job.content_id,
    url: s.url,
    provider_reference: "akwam",
    quality: s.quality || "Auto",
    language: "und",
    label_ar: `Akwam • ${s.quality || "Auto"}`,
    label_en: `Akwam • ${s.quality || "Auto"}`,
    expires_at: null,
    is_working: true,
    failure_count: 0,
    subtitle_url: null,
    subtitle_type: null,
    subtitle_language: null,
    subtitle_label_ar: null,
    subtitle_label_en: null,
    subtitle_default: i === 0,
  }));

  const result = await sb(env, "/rest/v1/rpc/persist_akwam_prefill_job", {
    method: "POST",
    body: JSON.stringify({
      p_job_id: job.id,
      p_provider_id: provider,
      p_sources: rows,
      p_worker_id: workerId,
    }),
  });

  // PostgREST returns scalar RPC results as a JSON number, not a row array.
  // Accept the scalar shape and keep compatibility with row/object-shaped responses.
  const stored = Number(
    typeof result === "number"
      ? result
      : result?.persist_akwam_prefill_job ?? result?.[0]?.persist_akwam_prefill_job ?? 0,
  );
  if (!Number.isFinite(stored) || stored !== rows.length) {
    throw new Error(`AKWAM_PERSIST_VERIFY_FAILED expected=${rows.length} stored=${stored}`);
  }
  return stored;
}

async function fail(env: Env, job: Job, error: unknown, workerId: string) {
  const message = String(error).slice(0, 1800);
  const episodeNotIndexed = /AKWAM_EPISODE_NOT_INDEXED/.test(message);
  const searchEmpty = /AKWAM_SEARCH_EMPTY/.test(message);
  const noPlayable = /AKWAM_NO_PLAYABLE_SOURCE/.test(message);
  const baseDelay = episodeNotIndexed ? 900 : searchEmpty ? 300 : noPlayable ? 600 : 120;
  const delaySeconds = Math.min(21600, baseDelay * Math.pow(2, Math.min(6, Math.max(0, job.attempts - 1))));
  const now = new Date().toISOString();
  const next = new Date(Date.now() + delaySeconds * 1000).toISOString();

  await sb(env, `/rest/v1/playback_source_jobs?id=eq.${job.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "pending",
      source_count: 0,
      locked_at: null,
      locked_by: null,
      last_error: message,
      available_at: next,
      updated_at: now,
      details: {
        provider: "akwam",
        mode: "db-only-prefill",
        worker: workerId,
        retryable: true,
        delay_seconds: delaySeconds,
        error_class: episodeNotIndexed ? "episode_not_indexed" : searchEmpty ? "search_empty" : noPlayable ? "no_playable_source" : "transient",
      },
    }),
  });
}

async function processJob(env: Env, job: Job, workerId: string, provider: string) {
  try {
    const budget: RequestBudget = { used: 0, max: 50 };
    const context = await getContext(env, job);
    const sources = await discover(env, job, context, budget);
    const count = await persist(env, job, sources, provider, workerId);
    return { ok: true, count };
  } catch (error) {
    await fail(env, job, error, workerId);
    return { ok: false, error: String(error) };
  }
}
async function run(env: Env, workerId: string, targetOverride?: number) {
  const requested = targetOverride ?? Number(env.MAX_JOBS_PER_RUN || 1);
  const target = Math.max(1, Math.min(100, requested));

  let provider: string;
  try {
    provider = await providerId(env);
  } catch (error) {
    throw new Error("AKWAM_PROVIDER_INIT_FAILED: " + String(error).slice(0, 1200));
  }

  const results: Array<{ ok: boolean; count?: number; error?: string }> = [];
  const concurrency = Math.max(1, Math.min(12, Number(env.PREFILL_CONCURRENCY || 1)));

  while (results.length < target) {
    const slots = Math.min(concurrency, target - results.length);
    const batch = await Promise.all(
      Array.from({ length: slots }, () => claim(env, workerId))
    );
    const jobs = batch.filter((job): job is Job => Boolean(job));
    if (!jobs.length) break;

    const batchResults = await Promise.all(
      jobs.map((job) => processJob(env, job, workerId, provider))
    );
    results.push(...batchResults);
  }

  return {
    workerId,
    processed: results.length,
    saved: results.reduce((sum, r) => sum + (r.ok ? (r.count || 0) : 0), 0),
    failed: results.filter((r) => !r.ok).length,
  };
}

async function runFleet(env: Env, fleetSize = 4) {
  const size = Math.max(1, Math.min(6, fleetSize));
  const workers = await Promise.all(
    Array.from({ length: size }, async (_, index) => {
      const workerId = `cf-fleet-${Date.now()}-${index}-${crypto.randomUUID().slice(0, 8)}`;
      try {
        return await run(env, workerId, 2);
      } catch (error) {
        return {
          workerId,
          processed: 0,
          saved: 0,
          failed: 0,
          fatal: String(error).slice(0, 1200),
        };
      }
    }),
  );

  return {
    workers,
    processed: workers.reduce((n, w) => n + w.processed, 0),
    saved: workers.reduce((n, w) => n + w.saved, 0),
    failed: workers.reduce((n, w) => n + w.failed, 0),
    fatal: workers.filter((w) => "fatal" in w).length,
  };
}

async function acquireCronLease(env: Env) {
  const rows = await sb(env, "/rest/v1/rpc/acquire_akwam_cron_lease", {
    method: "POST",
    body: JSON.stringify({ p_lease_seconds: 90 }),
  });
  return rows === true || rows?.acquire_akwam_cron_lease === true || rows?.[0]?.acquire_akwam_cron_lease === true;
}

async function releaseCronLease(env: Env) {
  try {
    await sb(env, "/rest/v1/rpc/release_akwam_cron_lease", {
      method: "POST",
      body: "{}",
    });
  } catch (error) {
    console.error("[akwam-cron-lease-release]", String(error));
  }
}

const CRON_STATE_KEY = "akwam-cloudflare-cron";

async function writeCronState(
  env: Env,
  patch: Record<string, unknown>,
) {
  try {
    await sb(env, "/rest/v1/maintenance_state?on_conflict=job_key", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        job_key: CRON_STATE_KEY,
        updated_at: new Date().toISOString(),
        ...patch,
      }),
    });
  } catch (error) {
    console.error("[akwam-cron-state]", String(error));
  }
}


export default {
  async fetch(request: Request, env: Env) {
    try {
      const pathname = new URL(request.url).pathname;

      if (request.method === "POST" && request.headers.get("x-movyz-prefill-key") === env.SUPABASE_SERVICE_ROLE_KEY) {
        const mode = request.headers.get("x-movyz-prefill-mode") || "batch";
        const workerId = `cf-prefill-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const result = await run(env, workerId);
        return Response.json({ ok: true, executor: "cloudflare-worker", trigger: mode, ...result });
      }

      return Response.json({
        ok: true,
        service: "movyz-akwam-prefill",
        mode: "db-only",
        executor: "cloudflare-worker",
        max_jobs_per_request: Number(env.MAX_JOBS_PER_RUN || 1),
        akwam_host: "akwam.ss",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[akwam-prefill]", message);
      return Response.json(
        { ok: false, service: "movyz-akwam-prefill", error: message.slice(0, 1800) },
        { status: 500 }
      );
    }
  },

  async scheduled(_event: unknown, env: Env, ctx: ExecutionContextLike) {
    ctx.waitUntil((async () => {
      let acquired = false;
      try {
        acquired = await acquireCronLease(env);
        if (!acquired) return;

        const startedAt = new Date().toISOString();
        await writeCronState(env, {
          last_run_at: startedAt,
          stats: {
            state: "started",
            executor: "cloudflare-cron",
            worker: "movyz-akwam-prefill",
            at: startedAt,
          },
        });

        const result = await runFleet(env, 4);
        const finishedAt = new Date().toISOString();

        await writeCronState(env, {
          last_run_at: startedAt,
          last_success_at: result.failed === 0 && result.fatal === 0 ? finishedAt : null,
          last_error:
            result.failed === 0 && result.fatal === 0
              ? null
              : `processed=${result.processed} saved=${result.saved} failed=${result.failed} fatal=${result.fatal}`,
          stats: {
            state: result.failed === 0 && result.fatal === 0 ? "success" : "degraded",
            executor: "cloudflare-cron-fleet",
            fleet_size: 4,
            workers: result.workers,
            processed: result.processed,
            saved: result.saved,
            failed: result.failed,
            fatal: result.fatal,
            at: finishedAt,
          },
        });
      } catch (error) {
        const finishedAt = new Date().toISOString();
        await writeCronState(env, {
          last_success_at: null,
          last_error: String(error).slice(0, 1800),
          stats: {
            state: "failed",
            executor: "cloudflare-cron",
            at: finishedAt,
          },
        });
        console.error("[akwam-prefill]", String(error));
      } finally {
        if (acquired) await releaseCronLease(env);
      }
    })());
  }
};

export { run };

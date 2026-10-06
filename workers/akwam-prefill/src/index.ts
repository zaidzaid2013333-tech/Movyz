// Universal Akwam adapter: content identity drives discovery; route shape does not.
// One bounded pipeline is shared by movies, series, and episodes.
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

type AkwamSession = {
  cookies: Map<string, string>;
};

function consumeRequest(budget?: RequestBudget) {
  if (!budget) return;
  budget.used += 1;
  if (budget.used > budget.max) {
    throw new Error(`AKWAM_SUBREQUEST_BUDGET_EXCEEDED used=${budget.used} max=${budget.max}`);
  }
}


const AKWAM_HOSTS = new Set(["akwam.ss", "www.akwam.ss"]);

const SERIES_CANDIDATE_TTL_MS = 10 * 60 * 1000;
const SERIES_DETAIL_TTL_MS = 5 * 60 * 1000;
const SERIES_CACHE_MAX_KEYS = 256;

const seriesCandidateMemory = new Map<string, { candidate: Candidate; cachedAt: number }>();
const seriesDetailMemory = new Map<string, { html: string; cachedAt: number }>();
const movieCandidateMemory = new Map<string, { candidate: Candidate; cachedAt: number }>();
const movieDetailMemory = new Map<string, { html: string; cachedAt: number }>();

const MOVIE_CANDIDATE_TTL_MS = 10 * 60 * 1000;
const MOVIE_DETAIL_TTL_MS = 5 * 60 * 1000;

function trimSeriesCaches() {
  while (seriesCandidateMemory.size > SERIES_CACHE_MAX_KEYS) {
    const first = seriesCandidateMemory.keys().next().value;
    if (!first) break;
    seriesCandidateMemory.delete(first);
  }
  while (seriesDetailMemory.size > SERIES_CACHE_MAX_KEYS) {
    const first = seriesDetailMemory.keys().next().value;
    if (!first) break;
    seriesDetailMemory.delete(first);
  }
  while (movieCandidateMemory.size > SERIES_CACHE_MAX_KEYS) {
    const first = movieCandidateMemory.keys().next().value;
    if (!first) break;
    movieCandidateMemory.delete(first);
  }
  while (movieDetailMemory.size > SERIES_CACHE_MAX_KEYS) {
    const first = movieDetailMemory.keys().next().value;
    if (!first) break;
    movieDetailMemory.delete(first);
  }
}

function movieCacheKey(titles: string[], year?: number) {
  return normalize(titles.filter(Boolean).slice(0, 4).join(" | ")) + "|y" + (year || "");
}

async function findMovieCandidateCached(
  env: Env,
  titles: string[],
  year?: number,
  budget?: RequestBudget,
  session?: AkwamSession,
) {
  const key = movieCacheKey(titles, year);
  const now = Date.now();
  const hit = movieCandidateMemory.get(key);
  if (hit && hit.cachedAt + MOVIE_CANDIDATE_TTL_MS > now) return hit.candidate;
  if (hit) movieCandidateMemory.delete(key);

  const candidate = await findCandidate(env, titles, year, "movie", undefined, budget, session);
  movieCandidateMemory.set(key, { candidate, cachedAt: now });
  trimSeriesCaches();
  return candidate;
}

function seriesCacheKey(titles: string[], season: number) {
  return normalize(titles.filter(Boolean).slice(0, 3).join(" | ")) + "|s" + season;
}

async function findSeriesCandidateCached(
  env: Env,
  titles: string[],
  season: number,
  budget?: RequestBudget,
  session?: AkwamSession,
) {
  const key = seriesCacheKey(titles, season);
  const now = Date.now();
  const hit = seriesCandidateMemory.get(key);
  if (hit && hit.cachedAt + SERIES_CANDIDATE_TTL_MS > now) return hit.candidate;
  if (hit) seriesCandidateMemory.delete(key);

  const candidate = await findCandidate(env, titles, undefined, "series", season, budget, session);
  seriesCandidateMemory.set(key, { candidate, cachedAt: now });
  trimSeriesCaches();
  return candidate;
}

async function fetchSeriesDetailCached(
  env: Env,
  candidate: Candidate,
  budget?: RequestBudget,
  session?: AkwamSession,
) {
  const key = candidate.url;
  const now = Date.now();
  const hit = seriesDetailMemory.get(key);
  if (hit && hit.cachedAt + SERIES_DETAIL_TTL_MS > now) return hit.html;
  if (hit) seriesDetailMemory.delete(key);

  const html = await fetchText(env, candidate.url, undefined, undefined, budget, session);
  if (!html) return null;
  seriesDetailMemory.set(key, { html, cachedAt: now });
  trimSeriesCaches();
  return html;
}

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

function sessionCookieHeader(session?: AkwamSession) {
  if (!session?.cookies.size) return "";
  return Array.from(session.cookies.entries())
    .map(([name, value]) => name + "=" + value)
    .join("; ");
}

function absorbSetCookie(session: AkwamSession | undefined, response: Response) {
  if (!session) return;
  const raw = response.headers.get("set-cookie") || "";
  if (!raw) return;

  const re = /(?:^|,\s*)([^=;,\s]+)=([^;,]*)(?:;|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const name = match[1]?.trim();
    if (!name) continue;
    session.cookies.set(name, match[2] ?? "");
  }
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

function markdownToSyntheticHtml(markdown: string) {
  let value = String(markdown || "")
    .replace(/\\([\\[\\]_*])/g, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  value = value.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi,
    (_match, label, href) => '<a href="' + href + '">' + label + "</a>",
  );

  value = value.replace(
    /(^|[\s>])(https?:\/\/akwam\.ss\/[\s\S]*?)(?=[\s<)])/gi,
    (_match, prefix, href) => prefix + '<a href="' + href + '">' + href + "</a>",
  );

  return value.replace(/\n{2,}/g, "\n").replace(/\n/g, "<br>");
}

async function fetchText(
  env: Env,
  url: string,
  diagnostics?: string[],
  referer?: string,
  budget?: RequestBudget,
  session?: AkwamSession,
): Promise<string | null> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      consumeRequest(budget);
      const cookie = sessionCookieHeader(session);
      const response = await fetch(url, {
        headers: {
          ...headers(env),
          ...(referer ? { Referer: referer } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        redirect: "follow",
        signal: AbortSignal.timeout(4000),
      });
      absorbSetCookie(session, response);

      if (response.ok) {
        const text = await response.text();
        if (text.trim()) return text;
      } else {
        diagnostics?.push(new URL(url).hostname + ":" + response.status);
        if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          continue;
        }
      }
    } catch {
      try {
        diagnostics?.push(new URL(url).hostname + ":ERR");
      } catch {
        diagnostics?.push("fetch:ERR");
      }
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        continue;
      }
    }
    break;
  }

  return null;
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

async function discoverAkwamUrlsViaSearch(
  env: Env,
  query: string,
  expected: "movie" | "series",
  expectedSeason?: number,
): Promise<Candidate[]> {
  const q = [
    "site:akwam.ss",
    query,
    expectedSeason ? "season " + expectedSeason : "",
  ].filter(Boolean).join(" ");
  try {
    const response = await fetch(
      "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q),
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "ar,en;q=0.8",
        },
        signal: AbortSignal.timeout(7000),
      },
    );
    if (!response.ok) return [];
    const html = await response.text();
    const output: Array<Candidate & { rank: number }> = [];
    const seen = new Set<string>();
    for (const match of html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const raw = decodeHtml(match[1] || "");
      const text = rawTextFromAnchor(match[2] || "");
      let url = raw;
      try {
        const parsed = new URL(raw, "https://html.duckduckgo.com");
        const target = parsed.searchParams.get("uddg");
        url = target ? decodeURIComponent(target) : raw;
      } catch {}
      if (!/^https:\/\/akwam\.ss\//i.test(url) || seen.has(url)) continue;
      const path = (() => {
        try { return new URL(url).pathname.toLowerCase(); } catch { return ""; }
      })();
      const inferredKind = inferCandidateKind(path, text);
      if (inferredKind === "other") continue;
      const candidateScore = score(
        {
          url,
          title: text,
          kind: inferredKind,
        },
        [query],
        undefined,
        expected,
        expectedSeason,
      );
      if (candidateScore < 30) continue;
      seen.add(url);
      output.push({
        url,
        title: text,
        kind: inferredKind,
        rank: candidateScore + 50,
      });
    }
    return output.sort((a, b) => b.rank - a.rank).slice(0, 5).map(({ rank: _rank, ...candidate }) => candidate);
  } catch {
    return [];
  }
}

function searchQueryVariant(value: string) {
  return decodeHtml(value)
    .replace(/[()[\]{}:;!?/\\'"\`]+/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function movieSearchVariants(value: string) {
  const raw = decodeHtml(value).trim();
  const out = new Set<string>();
  if (raw) out.add(raw);
  const compact = raw
    .replace(/\s*[:\-|]\s*(?:the\s+)?movie\b/gi, "")
    .replace(/\s+(?:the\s+)?movie\b/gi, "")
    .replace(/\s*[:\-|]\s*part\s+\d+\b/gi, "")
    .replace(/\s+part\s+\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (compact && compact !== raw) out.add(compact);
  const beforeColon = raw.split(/\s*:\s*/)[0].trim();
  if (beforeColon && beforeColon !== raw) out.add(beforeColon);
  const normalized = searchQueryVariant(raw);
  if (normalized) out.add(normalized);
  const normalizedCompact = searchQueryVariant(compact);
  if (normalizedCompact) out.add(normalizedCompact);
  return Array.from(out).filter(Boolean).slice(0, 5);
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
  if (/^\/(?:series|shows?|tv|season|seasons)\//i.test(path)) return "series";
  if (/^\/(?:movie|movies|film|films)\//i.test(path)) return "movie";
  if (/^\/(?:episode|episodes|show\/episode|tv\/episode)\//i.test(path)) return "episode";
  if (/^\/(?:watch|play)\//i.test(path)) return "watch";
  return "other";
}

function inferCandidateKind(pathname: string, anchorText: string): Candidate["kind"] {
  const direct = candidateKind(pathname);
  const hay = normalize(anchorText + " " + pathname);

  if (direct === "watch") {
    if (/(?:الحلقة|الحلقه|episode|epis(?:ode)?|s\d+e\d+)/i.test(hay)) return "episode";
    if (/(?:مسلسل|مسلسلات|series|show|season|موسم)/i.test(hay)) return "series";
    if (/(?:فيلم|فلم|افلام|أفلام|movie|film)/i.test(hay)) return "movie";
    return "watch";
  }

  if (direct !== "other") return direct;
  if (/(?:الحلقة|الحلقه|episode|epis(?:ode)?|s\d+e\d+)/i.test(hay)) return "episode";
  if (/(?:مسلسل|مسلسلات|series|show|season|موسم)/i.test(hay)) return "series";
  if (/(?:فيلم|فلم|افلام|أفلام|movie|film)/i.test(hay)) return "movie";
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
  if (c.kind === "other") return -1000;
  const kind = String(c.kind);
  const compatible =
    expected === "movie"
      ? kind === "movie" || kind === "watch"
      : expected === "series"
        ? kind === "series" || kind === "watch" || kind === "episode"
        : kind === "series" || kind === "episode" || kind === "watch";
  if (!compatible) return -1000;

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

    const anchorText = rawTextFromAnchor(m[2]);
    let kind = inferCandidateKind(u.pathname, anchorText);
    if (allowLegacy && kind === "other" && /^\/old\//i.test(u.pathname)) {
      kind = /(?:فيلم|فلم|افلام|أفلام|movie|film)/i.test(anchorText)
        ? "movie"
        : /(?:مسلسل|series|show|موسم|season)/i.test(anchorText)
          ? "series"
          : "other";
    }
    if (kind === "other") continue;

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
  session?: AkwamSession,
) {
  const host = base(env);
  let best: { item: Candidate; score: number } | null = null;
  const diagnostics: string[] = [];
  const seeds = titles.filter(Boolean).map((x) => x.trim()).filter(Boolean).slice(0, 3);

  const variants = expected === "movie"
    ? Array.from(new Set([
        ...seeds.flatMap(movieSearchVariants),
        year && seeds[0] ? seeds[0] + " " + year : "",
      ].filter(Boolean))).slice(0, 2)
    : Array.from(new Set([
        ...seeds,
        year && seeds[0] ? seeds[0] + " " + year : "",
        expectedSeason && seeds[0] ? seeds[0] + " S" + String(expectedSeason).padStart(2, "0") : "",
      ].filter(Boolean))).slice(0, 3);

  const scoreHtml = (html: string, allowLegacy: boolean) => {
  const readBest = () => best;
    for (const item of parseCandidates(html, env, allowLegacy)) {
      const itemScore = score(item, titles, year, expected, expectedSeason);
      if (!best || itemScore > best.score) best = { item, score: itemScore };
    }
  };

  const fetchSearchSet = async (urls: string[], allowLegacy = false) => {
    const responses = await Promise.all(
      urls.map(async (url) => {
        const html = await fetchText(env, url, diagnostics, undefined, budget, session);
        return html ? { url, html } : null;
      }),
    );
    for (const response of responses) {
      if (response) scoreHtml(response.html, allowLegacy);
    }
  };

  const readBest = (): { item: Candidate; score: number } | null => best;

  if (expected === "movie" || expected === "series") {
    // Run section-aware and generic search in the same request wave. Different
    // Akwam catalog generations expose one or the other, and there is no reason
    // to pay the full latency of two sequential rounds.
    const searchSets = [
      variants.map((title) =>
        host + "/search?q=" + encodeURIComponent(title) +
        "&section=" + encodeURIComponent(expected) + "&page=1",
      ),
      variants.map((title) =>
        host + "/search?q=" + encodeURIComponent(title) + "&page=1",
      ),
    ];

    const responses = await Promise.all(
      searchSets.flat().map(async (url) => {
        const html = await fetchText(env, url, diagnostics, undefined, budget, session);
        return html ? { url, html } : null;
      }),
    );

    for (const response of responses) {
      if (response) scoreHtml(response.html, false);
    }

    const fastWinner = readBest();
    if (fastWinner && fastWinner.score >= 100) return fastWinner.item;
  }

  const finalWinner = readBest();
  if (finalWinner && finalWinner.score >= 80) return finalWinner.item;

  // Adaptive fallback for catalog generations whose URL shape is not exposed
  // by Akwam's own search parser. It reuses the same candidate scorer.
  if (expected === "movie" || expected === "series") {
    const external = await Promise.all(
      variants.slice(0, 2).map((query) =>
        discoverAkwamUrlsViaSearch(env, query, expected, expectedSeason).catch(() => []),
      ),
    );
    for (const candidates of external) {
      for (const item of candidates) {
        const itemScore = score(item, titles, year, expected, expectedSeason);
        if (!best || itemScore > best.score) best = { item, score: itemScore };
      }
    }
  }

  const adaptiveWinner = readBest();
  if (adaptiveWinner && adaptiveWinner.score >= 80) return adaptiveWinner.item;
  throw new Error("AKWAM_SEARCH_EMPTY probes=" + diagnostics.slice(0, 12).join(","));
}



function extractMediaLikeUrls(text: string) {
  const decoded = decodeHtml(text);
  return Array.from(new Set(
    decoded.match(/https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4|mpd|webm)(?:\?[^\s"'<>]*)?/gi) || []
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
    if (/(?:\.m3u8|\.mp4|\.mpd|\.webm)(?:$|\?)/i.test(path)) return false;
    return true;
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

  const attrs = /(?:href|src|data-src|data-url|data-file|data-video|data-href|data-link|data-stream|data-playlist|formaction|data-playlist-url)=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = attrs.exec(decoded))) {
    const raw = match[1];
    const url = absoluteUrl(raw, baseUrl);
    if (!url) continue;
    const nearby = decoded.slice(Math.max(0, match.index - 1200), match.index + 1800);
    const navigation = isLikelyNavigationUrl(url);
    const score = /(?:m3u8|mp4|mpd|webm|stream|playlist|manifest|videoUrl|video_url|data-file|data-video|data-stream)/i.test(
      nearby + " " + raw,
    ) ? 160 : navigation ? 80 : 110;
    addUrlCandidate(out, seen, url, baseUrl, score, nearby + " " + raw);
  }

  const keyValue = /(?:file|source|src|videoUrl|video_url|stream|streamUrl|playlist|manifest|hls|dash|mediaUrl|media_url|playbackUrl|playback_url|url)\s*[:=]\s*["']([^"']+)["']/gi;
  while ((match = keyValue.exec(decoded))) {
    const url = absoluteUrl(match[1], baseUrl);
    if (!url) continue;
    const nearby = decoded.slice(Math.max(0, match.index - 900), match.index + 1400);
    addUrlCandidate(
      out,
      seen,
      url,
      baseUrl,
      isLikelyNavigationUrl(url) ? 85 : 150,
      nearby,
    );
  }

  const quotedAbsolute = /["'](https?:\/\/[^"'<>]+)["']/gi;
  while ((match = quotedAbsolute.exec(decoded))) {
    const raw = match[1];
    addUrlCandidate(
      out,
      seen,
      raw,
      baseUrl,
      isLikelyNavigationUrl(raw) ? 70 : 90,
      decoded.slice(Math.max(0, match.index - 700), match.index + 1100),
    );
  }

  // Akwam often stores escaped media URLs inside JSON/inline scripts (https:\/\/...).
  // Decode those without introducing a title-specific extractor.
  const escapedAbsolute = /["'](https?:\\\\\/\\\\\/[^"'<>]+)["']/gi;
  while ((match = escapedAbsolute.exec(decoded))) {
    const raw = match[1].replaceAll("\\\\/","/");
    addUrlCandidate(
      out,
      seen,
      raw,
      baseUrl,
      isLikelyNavigationUrl(raw) ? 75 : 165,
      decoded.slice(Math.max(0, match.index - 900), match.index + 1400),
    );
  }

  // Common metadata-based player hints.
  const metaVideo = /<meta[^>]+(?:property|name)=["'](?:og:video|og:video:url|twitter:player:stream)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  while ((match = metaVideo.exec(decoded))) {
    addUrlCandidate(out, seen, match[1], baseUrl, 175, "meta video");
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
  const decoded = decodeHtml(text);
  const direct = extractMediaLikeUrls(decoded)[0];
  if (direct) {
    return {
      url: direct,
      type: mediaTypeFromUrl(direct),
      quality: inferQuality(decoded),
      referer: isAkwamUrl(baseUrl) ? baseUrl : undefined,
      trustedExternal: isAkwamUrl(baseUrl) && !isAkwamUrl(direct),
    };
  }

  const embedded = decoded.match(/<(?:video|source)\b[^>]+(?:src|data-src)=["']([^"']+)["']/i)?.[1];
  if (embedded) {
    try {
      const url = new URL(decodeHtml(embedded), baseUrl).href;
      return {
        url,
        type: mediaTypeFromUrl(url),
        quality: inferQuality(decoded),
        referer: isAkwamUrl(baseUrl) ? baseUrl : undefined,
        trustedExternal: isAkwamUrl(baseUrl) && !isAkwamUrl(url),
      };
    } catch {}
  }

  const file = decoded.match(/(?:file|source|src|videoUrl|video_url|stream|streamUrl|playlist|manifest)\s*[:=]\s*["']([^"']+)["']/i)?.[1];
  if (file) {
    try {
      const url = new URL(decodeHtml(file), baseUrl).href;
      return {
        url,
        type: mediaTypeFromUrl(url),
        quality: inferQuality(decoded),
        referer: isAkwamUrl(baseUrl) ? baseUrl : undefined,
        trustedExternal: isAkwamUrl(baseUrl) && !isAkwamUrl(url),
      };
    } catch {}
  }
  return null;
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

    const hay = decodeUrlPath(decodeHtml(link.text + " " + rawPath));
    // Reject any explicit SxxEyy declaration that conflicts with the requested
    // episode before scoring by episode number. Without this guard, S11E01 could
    // win for an S01E01 request because the episode number matches.
    const explicitPair = hay.match(/\bs0*(\d{1,3})[^a-z0-9]{0,8}(?:e|ep)0*(\d{1,3})\b/i);
    if (explicitPair) {
      const declaredPairSeason = Number(explicitPair[1]);
      const declaredPairEpisode = Number(explicitPair[2]);
      if (declaredPairSeason !== season || declaredPairEpisode !== episode) continue;
    }
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

async function findEpisodeTargetBySearch(
  env: Env,
  titles: string[],
  season: number,
  episode: number,
  budget?: RequestBudget,
  session?: AkwamSession,
) {
  const host = base(env);
  const seeds = titles.filter(Boolean).map((x) => x.trim()).filter(Boolean).slice(0, 3);
  const variants = Array.from(new Set([
    ...seeds.map((title) => searchQueryVariant(title)).filter(Boolean),
    ...(seeds[0] ? [
      seeds[0] + " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0"),
      seeds[0] + " season " + season + " episode " + episode,
      seeds[0] + " الموسم " + season + " الحلقة " + episode,
      seeds[0] + " الحلقة " + episode,
    ] : []),
  ].filter((value): value is string => Boolean(value)))).slice(0, 4);

  const results = await Promise.all(variants.map(async (variant) => {
    const url = host + "/search?q=" + encodeURIComponent(variant) + "&page=1";
    const html = await fetchText(env, url, undefined, undefined, budget, session);
    return html ? { variant, html } : null;
  }));

  let best: { url: string; score: number } | null = null;
  for (const result of results) {
    if (!result) continue;
    for (const link of extractPageLinks(result.html, host)) {
      let rawPath = "";
      try { rawPath = decodeURIComponent(new URL(link.url).pathname); } catch { rawPath = link.url; }
      const hay = decodeUrlPath(decodeHtml(link.text + " " + rawPath));
      const normalizedHay = normalize(hay);
      if (!normalizedHay) continue;

      const explicitPair = hay.match(/\bs0*(\d{1,3})[^a-z0-9]{0,8}(?:e|ep)0*(\d{1,3})\b/i);
      if (explicitPair && (Number(explicitPair[1]) !== season || Number(explicitPair[2]) !== episode)) continue;
      const declaredSeason = explicitSeason(hay);
      if (declaredSeason !== undefined && declaredSeason !== season) continue;

      const looksLikeEpisode = /(?:حلقة|الحلقه|episode|epis(?:ode)?|s\d+e\d+)/i.test(hay) || /\/(?:episode|show\/episode|watch)\//i.test(rawPath);
      if (!looksLikeEpisode) continue;

      let titleRelevance = 0;
      for (const title of titles) {
        const normalizedTitle = normalize(title);
        if (!normalizedTitle) continue;
        if (normalizedHay.includes(normalizedTitle)) titleRelevance = Math.max(titleRelevance, 100);
        else titleRelevance = Math.max(titleRelevance, overlap(normalizedHay, normalizedTitle) * 100);
      }
      const exactPair = new RegExp("s0*" + season + "e0*" + episode + "(?![0-9])", "i").test(hay + " " + rawPath);
      const exactEpisode =
        new RegExp("(?:الحلقة|الحلقه|episode|ep(?:isode)?)[-_\\s]*(?:رقم[-_\\s]*)?0*" + episode + "(?![0-9.])", "i").test(hay) ||
        new RegExp("(?:^|[^0-9.])0*" + episode + "(?:$|[^0-9.])", "i").test(rawPath);
      if (titleRelevance < 28 && !exactPair && !(/\/(?:episode|show\/episode)\//i.test(rawPath) && exactEpisode)) continue;

      let scoreValue = titleRelevance;
      if (exactPair) scoreValue += 320;
      else if (declaredSeason === season) scoreValue += 70;
      if (exactEpisode) scoreValue += 180;
      if (/\/episode\//i.test(rawPath)) scoreValue += 80;
      if (/\/show\/episode\//i.test(rawPath)) scoreValue += 60;

      if (!best || scoreValue > best.score) best = { url: link.url, score: scoreValue };
    }
  }

  if (best && best.score >= 250) return best.url;

  // Generic route-agnostic fallback: some Akwam catalog generations expose
  // the series page first, then a season/episode navigation page. Follow only
  // a small bounded set of Akwam navigation candidates before external search.
  const navigationCandidates = Array.from(new Set(
    results
      .filter(Boolean)
      .flatMap((result) => {
        if (!result) return [];
        return extractTargets(result.html, host);
      })
      .filter((url) => isAkwamUrl(url))
      .filter((url) => {
        try {
          const path = new URL(url).pathname.toLowerCase();
          const blocked = [
            "/download/","/link/","/stream/","/file/","/get/",
            "/source/","/media/","/video/",
          ].some((segment) => path.includes(segment));
          const mediaPath = /\.(?:m3u8|mp4|mpd|webm)(?:$|\?)/i.test(path);
          return /(?:season|seasons|episode|episodes|show|series|tv|watch)/i.test(path) &&
            !blocked &&
            !mediaPath;
        } catch {
          return false;
        }
      })
  )).slice(0, 6);

  const navigationPages = await Promise.all(
    navigationCandidates.map(async (url) => {
      const html = await fetchText(env, url, undefined, host, budget, session);
      return html ? { url, html } : null;
    }),
  );

  for (const page of navigationPages) {
    if (!page) continue;
    const target = extractEpisodeTarget(page.html, page.url, season, episode);
    if (target) return target;
  }

  // Final generic fallback for Akwam layouts that are not exposed by its own
  // search parser. The same candidate scoring is used; no title-specific code.
  const external = await Promise.all(
    variants.slice(0, 2).map((variant) =>
      discoverAkwamUrlsViaSearch(env, variant, "series", season).catch(() => []),
    ),
  );

  let externalBest: { url: string; score: number } | null = null;
  for (const candidates of external) {
    for (const candidate of candidates) {
      if (!candidate || !isAkwamUrl(candidate.url)) continue;
      const hay = normalize(decodeUrlPath(decodeHtml(candidate.title + " " + candidate.url)));
      const explicitPair = hay.match(/\\bs0*(\\d{1,3})[^a-z0-9]{0,8}(?:e|ep)0*(\\d{1,3})\\b/i);
      if (explicitPair && (Number(explicitPair[1]) !== season || Number(explicitPair[2]) !== episode)) continue;
      const declaredSeason = explicitSeason(hay);
      if (declaredSeason !== undefined && declaredSeason !== season) continue;

      let scoreValue = 0;
      if (candidate.kind === "episode") scoreValue += 180;
      else if (candidate.kind === "watch") scoreValue += 120;
      else if (candidate.kind === "series") scoreValue += 40;

      const exactPair = new RegExp("s0*" + season + "e0*" + episode + "(?![0-9])", "i").test(hay);
      const exactEpisode =
        new RegExp("(?:الحلقة|الحلقه|episode|ep(?:isode)?)[-_\\s]*(?:رقم[-_\\s]*)?0*" + episode + "(?![0-9.])", "i").test(hay) ||
        new RegExp("(?:^|[^0-9.])0*" + episode + "(?:$|[^0-9.])", "i").test(hay);
      if (exactPair) scoreValue += 260;
      else if (declaredSeason === season) scoreValue += 55;
      if (exactEpisode) scoreValue += 170;

      const relevance = titleRelevanceForEpisode(candidate, titles);
      if (relevance >= 20) scoreValue += Math.round(relevance);

      if (!externalBest || scoreValue > externalBest.score) {
        externalBest = { url: candidate.url, score: scoreValue };
      }
    }
  }

  return externalBest && externalBest.score >= 280 ? externalBest.url : null;
}

function titleRelevanceForEpisode(candidate: Candidate, titles: string[]) {
  const hay = normalize(decodeUrlPath(decodeHtml(candidate.title + " " + candidate.url)));
  let best = 0;
  for (const title of titles) {
    const normalizedTitle = normalize(title);
    if (!normalizedTitle) continue;
    if (hay.includes(normalizedTitle)) best = Math.max(best, 100);
    else best = Math.max(best, overlap(hay, normalizedTitle) * 100);
  }
  return best;
}
 
function targetResolutionScore(raw: string) {
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname.toLowerCase();
    if (/(?:\.m3u8|\.mp4|\.mpd|\.webm)(?:\?|$)/i.test(path)) return 260;
    if (!isAkwamUrl(parsed.href)) return 10;
    if (/^\/old\/(?:download|link|watch|episode|player|embed|stream|file|get|source|media|video)\//i.test(path)) return 170;
    if (/^\/(?:download|link|watch|play|player|embed|stream|file|get|source|media|video|episode|show\/episode)\//i.test(path)) return 175;
    if (/^\/(?:movie|movies|series|shows?)\//i.test(path)) return 120;
    if (/^\/(?:search|category|categories|genre|genres|login|register|home|contact|privacy|terms|tag|tags)(?:\/|$)/i.test(path)) return 10;
    return 90;
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

function qualityScore(value: string) {
  const text = decodeHtml(value);
  const match = text.match(/(?:^|\D)(2160|1440|1080|720|576|480|360|240)(?:\s*p)?(?:\D|$)/i);
  const quality = match?.[1] ? Number(match[1]) : 0;
  if (!quality) return 0;
  if (quality >= 2160) return 360;
  if (quality >= 1440) return 340;
  if (quality >= 1080) return 320;
  if (quality >= 720) return 285;
  if (quality >= 576) return 245;
  if (quality >= 480) return 220;
  if (quality >= 360) return 190;
  return 170;
}

function extractTargets(html: string, baseUrl: string) {
  const ranked: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();

  const add = (raw: string, scoreValue: number) => {
    try {
      const url = new URL(decodeHtml(raw), baseUrl).href;
      if (!url.startsWith("https://") || seen.has(url)) return;
      seen.add(url);
      ranked.push({ url, score: scoreValue });
    } catch {}
  };

  const addLinkTarget = (href: string, text: string) => {
    try {
      const observed = new URL(decodeHtml(href), baseUrl);
      if (!isAkwamUrl(observed.href)) return;

      const q = qualityScore(text + " " + observed.href);

      if (/^\/download\//i.test(observed.pathname) || /^\/old\/download\//i.test(observed.pathname)) {
        add(observed.href, 220 + q);
        return;
      }

      // Current Akwam uses /watch/<token>/<content-id>/... as a dedicated
      // playback page. Follow that exact URL before trying to infer anything.
      if (/^\/watch\//i.test(observed.pathname) || /^\/old\/watch\//i.test(observed.pathname)) {
        add(observed.href, 210 + q);
        return;
      }

      // /link/... is itself a navigation hop. Preserve it as the primary
      // target; retain the old derived /download form only as fallback.
      if (/^\/link\//i.test(observed.pathname) || /^\/old\/link\//i.test(observed.pathname)) {
        add(observed.href, 195 + q);
        const marker = observed.pathname.indexOf("/link");
        if (marker >= 0) {
          const contentPath = new URL(baseUrl).pathname.replace(/\/$/, "");
          const suffix = observed.pathname.slice(marker + "/link".length);
          const download = new URL(new URL(baseUrl).origin + "/download" + suffix + contentPath);
          add(download.href, 160 + q);
        }
        return;
      }

       if (/^\/(?:episode|show\/episode)\//i.test(observed.pathname)) {
         add(observed.href, 50 + q);
         return;
       }

       if (isAkwamUrl(observed.href) && !/(?:\.m3u8|\.mp4|\.mpd|\.webm)(?:$|\?)/i.test(observed.pathname)) {
         add(observed.href, 95 + q);
       }
    } catch {}
  };

  const anchors = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchors.exec(html))) {
    const text = cleanHtmlText(decodeHtml(m[2]));
    addLinkTarget(m[1], text);
    const q = qualityScore(text + " " + m[1]);
    if (q) {
      try {
        add(new URL(decodeHtml(m[1]), baseUrl).href, q);
      } catch {}
    }
  }

  const interactive = /<(?:a|button|form|div|span)[^>]*(?:href|action|formaction|data-href|data-url|data-link|data-file|data-video|data-src|data-stream|data-playlist-url)=["']([^"']+)["'][^>]*>/gi;
  while ((m = interactive.exec(html))) {
    const raw = decodeHtml(m[1]);
    try {
      const url = new URL(raw, baseUrl).href;
      const nearby = cleanHtmlText(html.slice(Math.max(0, m.index - 400), m.index + m[0].length + 400));
      if (isAkwamUrl(url)) {
        addLinkTarget(url, nearby);
      } else if (/(?:\.m3u8|\.mp4|\.mpd|\.webm)(?:$|\?)/i.test(new URL(url).pathname)) {
        add(url, 220 + qualityScore(nearby + " " + url));
      }
    } catch {}
  }


  // Some Akwam page generations build playback/navigation URLs inside inline JavaScript instead of href/data-* attributes.
  // Treat them as ordinary route candidates without knowing anything about a specific title.
  const embeddedRoutes = /(?:["'])(https:\/\/akwam\.ss|\/)(?:old\/)?(?:download|link|watch|play|episode|show\/episode|series|shows?|movie|movies|stream|file|get|source|media|video)\/[^"'<>\\s]+(?:["'])/gi;
  while ((m = embeddedRoutes.exec(html))) {
    try {
      const raw = decodeHtml(m[0].slice(1, -1)).replaceAll("\\/", "/");
      const url = new URL(raw, baseUrl).href;
      if (!isAkwamUrl(url)) continue;
      const nearby = cleanHtmlText(html.slice(Math.max(0, m.index - 600), m.index + m[0].length + 900));
      addLinkTarget(url, nearby);
    } catch {}
  }

  // Also catch escaped absolute media URLs embedded in JSON/config.
  const escapedAbsoluteUrls = new RegExp(String.raw`["'](https:\\/\\/[^"'<>\\s]+)["']`, "gi");
  while ((m = escapedAbsoluteUrls.exec(html))) {
    const raw = decodeHtml(m[1]).replaceAll("\\/", "/");
    try {
      const url = new URL(raw, baseUrl).href;
      const nearby = cleanHtmlText(html.slice(Math.max(0, m.index - 600), m.index + m[0].length + 900));
      if (isAkwamUrl(url)) addLinkTarget(url, nearby);
      else if (/(?:\.m3u8|\.mp4|\.mpd|\.webm)(?:$|\?)/i.test(new URL(url).pathname)) {
        add(url, 250 + qualityScore(nearby + " " + url));
      }
    } catch {}
  }
  const mediaTags = /<(?:video|source)\b[^>]*(?:src|data-src|data-url)=["']([^"']+)["'][^>]*>/gi;
  while ((m = mediaTags.exec(html))) add(m[1], 140);

  for (const u of extractMediaLikeUrls(html)) add(u, 260);

  // Ignore fragment-only UI tabs such as #tab-5. They are quality labels,
  // not resolution targets, and can consume the bounded resolution budget.
  const useful = ranked
    .filter((item) => targetResolutionScore(item.url) > 10)
    .sort((x, y) => y.score - x.score);

  return useful.map((x) => x.url).slice(0, 16);
}

function extractDownloadButtonMedia(html: string, baseUrl: string): Media | null {
  const build = (raw: string, context: string) => {
    try {
      const url = new URL(decodeHtml(raw), baseUrl).href;
      return {
        url,
        type: mediaTypeFromUrl(url),
        quality: inferQuality(context),
        referer: isAkwamUrl(baseUrl) ? baseUrl : undefined,
        trustedExternal: isAkwamUrl(baseUrl) && !isAkwamUrl(url),
      } as Media;
    } catch {
      return null;
    }
  };

  const tagRe = /<(?:a|button|div|span)[^>]*class=["'][^"']*btn-loader[^"']*["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    const target = match[0].match(
      /(?:href|data-url|data-href|data-link|data-file|data-video|data-src)=["']([^"']+)["']/i,
    )?.[1];
    if (!target) continue;
    const media = build(target, match[0] + " " + html.slice(Math.max(0, match.index - 900), match.index + 1200));
    if (media) return media;
  }

  const attrFirst = /<(?:a|button|div|span)[^>]*(?:href|data-url|data-href|data-link|data-file|data-video|data-src)=["']([^"']+)["'][^>]*class=["'][^"']*btn-loader[^"']*["'][^>]*>/gi;
  while ((match = attrFirst.exec(html))) {
    const media = build(match[1], match[0]);
    if (media) return media;
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

function extractSessionCookie(response: Response) {
  const raw = response.headers.get("set-cookie") || "";
  const match = raw.match(/(?:^|,\s*)(prefixakoam_session=[^;]+)/i);
  return match?.[1] || "";
}

async function resolveLegacyAkwamDownload(
  env: Env,
  target: string,
  referer?: string,
  budget?: RequestBudget,
  session?: AkwamSession,
): Promise<Media | null> {
  try {
    consumeRequest(budget);
    const page = await fetch(target, {
      headers: {
        ...headers(env),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(referer ? { Referer: referer } : {}),
        ...((sessionCookieHeader(session)) ? { Cookie: sessionCookieHeader(session) } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(7000),
    });
    if (!page.ok) return null;

    // The legacy resolver uses the session cookie created by the initial GET.
    absorbSetCookie(session, page);
    const sessionCookie = extractSessionCookie(page) || sessionCookieHeader(session);
    if (!sessionCookie) return null;

    consumeRequest(budget);
    const resolver = await fetch(target, {
      method: "POST",
      headers: {
        ...headers(env),
        Accept: "application/json, text/javascript, */*;q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        Origin: base(env),
        Referer: target,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: sessionCookie,
      },
      body: "",
      redirect: "follow",
      signal: AbortSignal.timeout(7000),
    });
    if (!resolver.ok) return null;

    const raw = await resolver.text();
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }

    const directLink =
      typeof payload?.direct_link === "string"
        ? payload.direct_link.replace(/^http:\/\//i, "https://").trim()
        : "";
    if (!directLink || !/^https:\/\//i.test(directLink)) return null;

    const media = mediaFromUrl(directLink, target);
    if (!isAkwamUrl(media.url)) return media;
    if (await validateMedia(env, media, budget)) return media;
    return null;
  } catch {
    return null;
  }
}


async function resolveTarget(
  env: Env,
  initialTarget: string,
  referer?: string,
  budget?: RequestBudget,
  session?: AkwamSession,
): Promise<Media | null> {
  type Node = { url: string; referer?: string; depth: number };
  const queue: Node[] = [{ url: initialTarget, referer, depth: 0 }];
  const visited = new Set<string>();
  // One content-agnostic resolution graph. Akwam navigation is fetched as HTML;
  // actual media is probed once. No title-specific extraction branches exist.
  const maxNodes = 12;
  const maxDepth = 4;

  while (queue.length && visited.size < maxNodes) {
    const node = queue.shift()!;
    if (!node.url || visited.has(node.url)) continue;
    visited.add(node.url);

    const akwamNavigation = isAkwamUrl(node.url) && isLikelyNavigationUrl(node.url);

    // Probe direct media only once. If an external media candidate fails,
    // do not fetch its binary body again as if it were an HTML navigation page.
    if (!akwamNavigation) {
      const direct = mediaFromUrl(node.url, node.referer);
      if (await validateMedia(env, direct, budget)) return direct;

      if (!isAkwamUrl(node.url)) continue;
    }

    // Current and legacy Akwam download endpoints are handled as generic
    // route patterns, not as title-specific logic.
    if (/^https:\/\/akwam\.ss\/old\/download\//i.test(node.url)) {
      const legacyMedia = await resolveLegacyAkwamDownload(
        env,
        node.url,
        node.referer,
        budget,
        session,
      );
      if (legacyMedia) return legacyMedia;
    }

    const html = await fetchText(env, node.url, undefined, node.referer, budget, session);
    if (!html) continue;

    const buttonMedia = extractDownloadButtonMedia(html, node.url);
    if (buttonMedia && await validateMedia(env, buttonMedia, budget)) return buttonMedia;

    const embeddedMedia = extractMedia(html, node.url);
    if (embeddedMedia && await validateMedia(env, embeddedMedia, budget)) return embeddedMedia;

    for (const candidate of extractMediaCandidates(html, node.url).slice(0, 8)) {
      const media = mediaFromUrl(candidate.url, node.url, candidate.quality || html);
      if (await validateMedia(env, media, budget)) return media;
    }

    if (node.depth >= maxDepth) continue;

    // Navigation candidates are queued, never pre-probed. This removes the
    // old validation+fetch double-hit that made some titles appear much slower.
    for (const next of extractTargets(html, node.url).slice(0, 5)) {
      if (!next || visited.has(next)) continue;
      queue.push({ url: next, referer: node.url, depth: node.depth + 1 });
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

  const table = job.content_type === "episode" ? "series" : "movies";
  const selectFields =
    job.content_type === "episode"
      ? "title_ar,title_en,original_title,alternative_titles"
      : "title_ar,title_en,original_title,alternative_titles,release_date";
  const extraRows = await sb(
    env,
    `/rest/v1/${table}?select=${selectFields}&id=eq.${encodeURIComponent(job.content_id)}&limit=1`,
  );
  const extra = Array.isArray(extraRows) ? extraRows[0] : null;
  const extraTitles = [
    extra?.title_ar,
    extra?.title_en,
    extra?.original_title,
    ...(Array.isArray(extra?.alternative_titles)
      ? extra.alternative_titles.map((x: any) => x?.title).filter(Boolean)
      : []),
  ].filter(Boolean);

  // Prefer the DB release year when the job RPC does not provide one. This is
  // critical for disambiguating same/similar movie titles (e.g. remakes).
  const dbReleaseYear =
    job.content_type === "movie" && typeof extra?.release_date === "string"
      ? Number(extra.release_date.slice(0, 4))
      : undefined;

  return {
    titles: Array.from(new Set([
      ...(Array.isArray(ctx.titles) ? ctx.titles.filter(Boolean) : []),
      ...extraTitles,
    ])) as string[],
    year: ctx.year ? Number(ctx.year) : dbReleaseYear,
    episodeNumber: ctx.episode_number ? Number(ctx.episode_number) : undefined,
    seasonNumber: ctx.season_number ? Number(ctx.season_number) : undefined,
  };
}

async function discover(env: Env, job: Job, ctx: any, budget: RequestBudget) {
  const isEpisode = job.content_type === "episode";
  const season = ctx.seasonNumber || job.season_number || 1;
  const episode = ctx.episodeNumber || job.episode_number || 1;
  const session: AkwamSession = { cookies: new Map() };

  let candidate: Candidate | null = null;
  let episodeTarget: string | null = null;
  let targets: string[] = [];

  if (isEpisode) {
    candidate = await findSeriesCandidateCached(env, ctx.titles, season, budget, session);

    if (candidate) {
      if (candidate.kind === "episode" || candidate.kind === "watch") {
        episodeTarget = candidate.url;
        const episodeHtml = await fetchText(env, episodeTarget, undefined, base(env), budget, session);
        if (episodeHtml) targets = extractTargets(episodeHtml, episodeTarget);
      } else {
        const seriesUrl = candidate.url;
        const detail = await fetchSeriesDetailCached(env, candidate, budget, session);
        if (detail) {
          const exactEpisode = extractEpisodeTarget(detail, candidate.url, season, episode);
          if (exactEpisode) {
            episodeTarget = exactEpisode;
            const episodeHtml = await fetchText(env, exactEpisode, undefined, candidate.url, budget, session);
            if (episodeHtml) targets = extractTargets(episodeHtml, exactEpisode);
          } else {
            // Generic second-level traversal: some Akwam catalog generations
            // expose the series -> season -> episode relationship through
            // navigation pages rather than explicit episode links on the detail.
            // Follow only a bounded set of Akwam navigation targets, then reuse
            // the exact same episode matcher. No title-specific routes.
            const navigationTargets = Array.from(new Set(
              extractTargets(detail, seriesUrl)
                .filter((url) => isAkwamUrl(url))
                .filter((url) => {
                  try {
                    const path = new URL(url).pathname.toLowerCase();
                    const blocked = [
                      "/download/","/link/","/stream/","/file/","/get/",
                      "/source/","/media/","/video/",
                    ].some((segment) => path.includes(segment));
                    const mediaPath = /\.(?:m3u8|mp4|mpd|webm)(?:$|\?)/i.test(path);
                    return !blocked && !mediaPath &&
                      /(?:season|seasons|episode|episodes|show|series|tv|watch)/i.test(path);
                  } catch {
                    return false;
                  }
                }),
            )).slice(0, 4);

            const pages = await Promise.all(
              navigationTargets.map(async (url) => {
                const html = await fetchText(env, url, undefined, seriesUrl, budget, session);
                return html ? { url, html } : null;
              }),
            );

            for (const page of pages) {
              if (!page || episodeTarget) continue;
              const nestedEpisode = extractEpisodeTarget(page.html, page.url, season, episode);
              if (!nestedEpisode) continue;
              episodeTarget = nestedEpisode;
              const nestedHtml = await fetchText(
                env,
                nestedEpisode,
                undefined,
                page.url,
                budget,
                session,
              );
              if (nestedHtml) targets = extractTargets(nestedHtml, nestedEpisode);
            }
          }
        }
      }
    }

    if (!targets.length) {
      episodeTarget = await findEpisodeTargetBySearch(env, ctx.titles, season, episode, budget, session);
      if (episodeTarget) {
        const episodeHtml = await fetchText(env, episodeTarget, undefined, base(env), budget, session);
        if (episodeHtml) targets = extractTargets(episodeHtml, episodeTarget);
      }
    }

    if (!targets.length) {
      if (!candidate) throw new Error("AKWAM_NOT_FOUND");
      throw new Error(
        "AKWAM_EPISODE_NOT_INDEXED candidate=" +
        candidate.url +
        " season=" +
        season +
        " episode=" +
        episode,
      );
    }

  } else {
    candidate = await findMovieCandidateCached(env, ctx.titles, ctx.year, budget, session);
    if (!candidate) throw new Error("AKWAM_NOT_FOUND");

    const detailKey = candidate.url;
    const now = Date.now();
    const cachedDetail = movieDetailMemory.get(detailKey);
    let detail = cachedDetail && cachedDetail.cachedAt + MOVIE_DETAIL_TTL_MS > now
      ? cachedDetail.html
      : null;

    if (!detail) {
      detail = await fetchText(env, candidate.url, undefined, undefined, budget, session);
      if (!detail) throw new Error("AKWAM_DETAIL_FETCH_FAILED");
      movieDetailMemory.set(detailKey, { html: detail, cachedAt: now });
      trimSeriesCaches();
    }

    targets = usefulResolutionTargets(extractTargets(detail, candidate.url), 8);
  }

  const medias: Media[] = [];
  const sourceReferer = episodeTarget || candidate?.url || base(env);

  // Keep enough ranked targets for Akwam's fallback variants, but do not wait
  // for every target. Return the first playable hand-off and only spend a short
  // grace window collecting additional sources.
  const rankedTargets = usefulResolutionTargets(targets, isEpisode ? 2 : 1);
  type TargetResult = { index: number; media: Media | null };
  const pendingTargets: Array<{ index: number; promise: Promise<TargetResult> }> = rankedTargets.map((target, index) => ({
    index,
    promise: resolveTarget(env, target, sourceReferer, budget, session)
      .then((media) => ({ index, media }))
      .catch(() => ({ index, media: null })),
  }));

  const firstSourceDeadline = Date.now() + (isEpisode ? 10000 : 8000);
  let firstSourceFoundAt: number | null = null;

  while (pendingTargets.length && medias.length < 1) {
    const deadline = firstSourceFoundAt === null
      ? firstSourceDeadline
      : firstSourceFoundAt + 300;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), remainingMs);
    });

    const result = await Promise.race<TargetResult | null>([
      ...pendingTargets.map((entry) => entry.promise),
      timeout,
    ]);

    if (result === null) break;

    const position = pendingTargets.findIndex((entry) => entry.index === result.index);
    if (position >= 0) pendingTargets.splice(position, 1);

    if (result.media && !medias.some((item) => item.url === result.media!.url)) {
      medias.push(result.media);
      if (firstSourceFoundAt === null) firstSourceFoundAt = Date.now();
    }
  }

  if (!medias.length) {
    const summary = targets.slice(0, 10).map((url) => {
      try { return new URL(url).pathname; } catch { return "invalid"; }
    }).join(",");
    throw new Error(
      "AKWAM_NO_PLAYABLE_SOURCE candidate=" +
      (candidate?.url || episodeTarget || "search") +
      " targets=" +
      summary,
    );
  }

  return medias;
}

/**
 * On-demand resolver for the playback broker.
 * It resolves Akwam for one content item without claiming a prefill job
 * and without persisting playback URLs to playback_sources.
 */
export async function resolveAkwamNow(
  env: Env,
  input: {
    content_type: "movie" | "episode";
    content_id: string;
    season_number?: number;
    episode_number?: number;
  },
) {
  let ctx: {
    titles: string[];
    year?: number;
    episodeNumber?: number;
    seasonNumber?: number;
  };

  const rawId = String(input.content_id || "").trim();
  const numericId = /^\d+$/.test(rawId);

  if (input.content_type === "movie") {
    const rows = await sb(
      env,
      numericId
        ? `/rest/v1/movies?select=id,title_ar,title_en,original_title,alternative_titles,release_date&tmdb_id=eq.${encodeURIComponent(rawId)}&limit=1`
        : `/rest/v1/movies?select=id,title_ar,title_en,original_title,alternative_titles,release_date&id=eq.${encodeURIComponent(rawId)}&limit=1`,
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) throw new Error("AKWAM_CONTENT_NOT_FOUND");

    ctx = {
      titles: Array.from(new Set([
        row.title_ar,
        row.title_en,
        row.original_title,
        ...(Array.isArray(row.alternative_titles)
          ? row.alternative_titles.map((x: any) => x?.title).filter(Boolean)
          : []),
      ].filter(Boolean))),
      year:
        typeof row.release_date === "string"
          ? Number(row.release_date.slice(0, 4)) || undefined
          : undefined,
    };
  } else {
    let season: any = null;
    let series: any = null;

    if (numericId) {
      const seriesRows = await sb(
        env,
        `/rest/v1/series?select=id,title_ar,title_en,original_title,alternative_titles&tmdb_id=eq.${encodeURIComponent(rawId)}&limit=1`,
      );
      series = Array.isArray(seriesRows) ? seriesRows[0] : null;
      if (!series?.id) throw new Error("AKWAM_SERIES_NOT_FOUND");
    } else {
      // Episode IDs remain supported, but the same endpoint also accepts a
      // series UUID. This removes the old "wait for metadata, then discover
      // episode UUID" architecture from the watch page.
      const episodeRows = await sb(
        env,
        `/rest/v1/episodes?select=episode_number,season_id&id=eq.${encodeURIComponent(rawId)}&limit=1`,
      );
      const episode = Array.isArray(episodeRows) ? episodeRows[0] : null;

      if (episode?.season_id) {
        const seasonRows = await sb(
          env,
          `/rest/v1/seasons?select=series_id,season_number&id=eq.${encodeURIComponent(String(episode.season_id))}&limit=1`,
        );
        season = Array.isArray(seasonRows) ? seasonRows[0] : null;
        if (!season?.series_id) throw new Error("AKWAM_SEASON_NOT_FOUND");

        const seriesRows = await sb(
          env,
          `/rest/v1/series?select=title_ar,title_en,original_title,alternative_titles&id=eq.${encodeURIComponent(String(season.series_id))}&limit=1`,
        );
        series = Array.isArray(seriesRows) ? seriesRows[0] : null;
        if (!series) throw new Error("AKWAM_SERIES_NOT_FOUND");

        ctx = {
          titles: Array.from(new Set([
            series.title_ar,
            series.title_en,
            series.original_title,
            ...(Array.isArray(series.alternative_titles)
              ? series.alternative_titles.map((x: any) => x?.title).filter(Boolean)
              : []),
          ].filter(Boolean))),
          seasonNumber: Number(input.season_number || season.season_number || 1),
          episodeNumber: Number(input.episode_number || episode.episode_number || 1),
        };
        return resolveAkwamWithContext(env, input, ctx);
      }

      const seriesRows = await sb(
        env,
        `/rest/v1/series?select=id,title_ar,title_en,original_title,alternative_titles&id=eq.${encodeURIComponent(rawId)}&limit=1`,
      );
      series = Array.isArray(seriesRows) ? seriesRows[0] : null;
      if (!series?.id) throw new Error("AKWAM_CONTENT_NOT_FOUND");
    }

    const wantedSeason = Number(input.season_number || 1);
    const wantedEpisode = Number(input.episode_number || 1);
    const seasonRows = await sb(
      env,
      `/rest/v1/seasons?select=id,series_id,season_number&series_id=eq.${encodeURIComponent(String(series.id))}&season_number=eq.${wantedSeason}&limit=1`,
    );
    season = Array.isArray(seasonRows) ? seasonRows[0] : null;
    if (!season?.id) throw new Error("AKWAM_SEASON_NOT_FOUND");

    const episodeRows = await sb(
      env,
      `/rest/v1/episodes?select=id,episode_number,season_id&season_id=eq.${encodeURIComponent(String(season.id))}&episode_number=eq.${wantedEpisode}&limit=1`,
    );
    const episode = Array.isArray(episodeRows) ? episodeRows[0] : null;
    if (!episode?.id) throw new Error("AKWAM_EPISODE_NOT_FOUND");

    ctx = {
      titles: Array.from(new Set([
        series.title_ar,
        series.title_en,
        series.original_title,
        ...(Array.isArray(series.alternative_titles)
          ? series.alternative_titles.map((x: any) => x?.title).filter(Boolean)
          : []),
      ].filter(Boolean))),
      seasonNumber: Number(input.season_number || season.season_number || 1),
      episodeNumber: Number(input.episode_number || episode.episode_number || 1),
    };
  }

  return resolveAkwamWithContext(env, input, ctx);
}

export async function resolveAkwamWithContext(
  env: Env,
  input: {
    content_type: "movie" | "episode";
    content_id: string;
    season_number?: number;
    episode_number?: number;
  },
  ctx: {
    titles: string[];
    year?: number;
    episodeNumber?: number;
    seasonNumber?: number;
  },
) {
  const job: Job = {
    id: "on-demand-" + crypto.randomUUID(),
    content_type: input.content_type,
    content_id: input.content_id,
    tmdb_id: null,
    season_number: ctx.seasonNumber ?? null,
    episode_number: ctx.episodeNumber ?? null,
    attempts: 1,
  };

  const budget: RequestBudget = { used: 0, max: 24 };
  return discover(env, job, ctx, budget);
}

async function fail(env: Env, job: Job, error: unknown, workerId: string) {
  const message = String(error).slice(0, 1800);
  const episodeNotIndexed = /AKWAM_EPISODE_NOT_INDEXED/.test(message);
  const searchEmpty = /AKWAM_SEARCH_EMPTY/.test(message);
  const noPlayable = /AKWAM_NO_PLAYABLE_SOURCE/.test(message);
  const baseDelay =
    episodeNotIndexed
      ? 900
      : searchEmpty
        ? job.content_type === "episode"
          ? 1800
          : 300
        : noPlayable
          ? 600
          : 120;
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
        mode: "live-playback-broker-only",
        worker: workerId,
        retryable: true,
        delay_seconds: delaySeconds,
        error_class: episodeNotIndexed ? "episode_not_indexed" : searchEmpty ? "search_empty" : noPlayable ? "no_playable_source" : "transient",
      },
    }),
  });
}

async function run(env: Env, workerId: string, _targetOverride?: number) {
  // Persistent prefill has been retired. Playback is resolved on demand by
  // the Playback Broker and cached only for a short period at the edge.
  return {
    workerId,
    processed: 0,
    saved: 0,
    failed: 0,
    disabled: true,
    reason: "live-playback-broker-only",
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
    body: JSON.stringify({ p_lease_seconds: 900 }),
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
        mode: "live-playback-broker-only",
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

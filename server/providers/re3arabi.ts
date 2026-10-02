import { fetchJsonOrText, fetchWithTimeout, inferPlaybackType } from './http';
import type { ProviderContext, NormalizedPlaybackSource } from './types';

export type Re3ArabiPlaybackRequest = {
  type: 'movie' | 'series';
  tmdbId: number;
  season?: number;
  episode?: number;
};

type SearchHit = {
  title: string;
  url: string;
  year?: number;
};

type ResolverContext = ProviderContext & { __isAnime: boolean };

type Candidate = NormalizedPlaybackSource & {
  providerKey: string;
  sourceUrl: string;
};

type SiteKind = 'general' | 'anime';

type SiteConfig = {
  key: string;
  name: string;
  base: string;
  kind: SiteKind;
  searchUrls: (query: string) => string[];
};

const CACHE_TTL_MS = 120_000;
const PAGE_CACHE_TTL_MS = 15 * 60_000;
const cache = new Map<string, { expiresAt: number; promise: Promise<Candidate[]> }>();
const pageCache = new Map<string, { expiresAt: number; promise: Promise<string> }>();

const PROVIDERS: readonly SiteConfig[] = [
  {
    key: 'aflaam',
    name: 'Aflam',
    base: 'https://aflaam.com',
    kind: 'general',
    searchUrls: (q) => [
      `https://aflaam.com/search?q=${q}`,
      `https://aflaam.com/?s=${q}`,
    ],
  },
  {
    key: 'cimaclub',
    name: 'CimaClub',
    base: 'https://w.cimacub.com',
    kind: 'general',
    searchUrls: (q) => [
      `https://w.cimacub.com/?s=${q}`,
      `https://w.cimacub.com/search?q=${q}`,
      `https://cimacub.com/?s=${q}`,
      `https://www.cimacub.com/?s=${q}`,
    ],
  },
  {
    key: 'anime3rb',
    name: 'Anime3rb',
    base: 'https://anime3rb.com',
    kind: 'anime',
    searchUrls: (q) => [
      `https://anime3rb.com/?s=${q}`,
      `https://anime3rb.com/search?q=${q}`,
      `https://anime3rb.com/search?query=${q}`,
    ],
  },
  {
    key: 'anime4up',
    name: 'Anime4Up',
    base: 'https://anime4upp.cam',
    kind: 'anime',
    searchUrls: (q) => [
      `https://anime4upp.cam/?s=${q}`,
      `https://anime4upp.cam/search?q=${q}`,
      `https://w1.anime4up.rest/?s=${q}`,
      `https://w1.anime4up.rest/search?q=${q}`,
    ],
  },
] as const;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function absolute(base: string, raw: string) {
  if (!raw?.trim()) return null;
  try {
    const value = decodeHtml(raw.trim());
    const url = new URL(value, base);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/');
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseMarkdownLinks(text: string, baseUrl: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const markdownRe = /\[([^\]]+)\]\((https?:\/\/[^)]+|\/[^)]+)\)/gi;
  let match: RegExpExecArray | null;

  while ((match = markdownRe.exec(text))) {
    const title = stripTags(decodeHtml(match[1] || '')).trim();
    const url = absolute(baseUrl, match[2]);
    if (!url || !title || seen.has(url) || isNavigationLink(url, title)) continue;
    seen.add(url);
    hits.push({ title, url, year: extractYear(title) });
  }

  return hits;
}



function normalizeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value)
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[^0-9]/g, " ")
    .trim();
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function parseJsonLdObjects(html: string): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  const scriptRe = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  const visit = (value: unknown, depth = 0) => {
    if (depth > 5 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    output.push(object);
    for (const nested of Object.values(object)) {
      if (nested && typeof nested === "object") visit(nested, depth + 1);
    }
  };
  while ((match = scriptRe.exec(html))) {
    try { visit(JSON.parse(match[1]) as unknown); } catch {}
  }
  return output;
}

function parseSeasonEpisode(value: string): { season?: number; episode?: number } {
  const text = String(value || "");
  const compact =
    text.match(/(?:^|[^a-z])s(?:eason)?[\s._-]*(\d{1,3})[\s._-]*e(?:pisode)?[\s._-]*(\d{1,3})(?:[^0-9]|$)/i) ||
    text.match(/(?:season|الموسم)[\s._-]*(\d{1,3})[\s._-]*(?:episode|ep|الحلقة|حلقه)[^0-9]*(\d{1,3})/i);
  if (compact) return { season: Number(compact[1]), episode: Number(compact[2]) };

  const season = normalizeNumber(text.match(/(?:season|الموسم)[^0-9٠-٩]*(\d+)/i)?.[1]);
  const episode = normalizeNumber(text.match(/(?:episode|ep|الحلقة|حلقه)[^0-9٠-٩]*(\d+)/i)?.[1]);
  return { season, episode };
}

type JsonLdEpisode = { url: string; number?: number; position?: number; season?: number };

function extractJsonLdEpisodes(html: string, pageUrl: string): JsonLdEpisode[] {
  const output: JsonLdEpisode[] = [];
  const seen = new Set<string>();

  const add = (value: unknown, fallbackPosition?: number) => {
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    const rawUrl =
      typeof item.url === 'string' ? item.url :
      typeof item.contentUrl === 'string' ? item.contentUrl :
      typeof item.embedUrl === 'string' ? item.embedUrl : "";
    const url = absolute(pageUrl, rawUrl);
    if (!url || seen.has(url)) return;

    const name = typeof item.name === 'string' ? item.name : "";
    const partOfSeason =
      item.partOfSeason && typeof item.partOfSeason === 'object'
        ? item.partOfSeason as Record<string, unknown>
        : null;
    const parsed = parseSeasonEpisode([name, rawUrl].join(' '));
    const number = normalizeNumber(item.episodeNumber) ?? parsed.episode;
    const season = normalizeNumber(item.seasonNumber) ?? normalizeNumber(partOfSeason?.seasonNumber) ?? parsed.season;
    const position = normalizeNumber(item.position) ?? fallbackPosition;

    seen.add(url);
    output.push({ url, number, position, season });
  };

  for (const node of parseJsonLdObjects(html)) {
    const rawType = node["@type"];
    const types = Array.isArray(rawType) ? rawType.map(String) : [typeof rawType === "string" ? rawType : ""];
    if (types.some((type) => /episode/i.test(type))) add(node);
    const episodes = node.episode;
    if (Array.isArray(episodes)) episodes.forEach((episode, index) => add(episode, index + 1));
    else if (episodes && typeof episodes === 'object') add(episodes, 1);
  }
  return output;
}

function extractYear(value: string) {
  const match = value.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function qualityValue(quality: string) {
  const match = quality.match(/(2160|1440|1080|720|576|480|360|240)/);
  return match ? Number(match[1]) : 0;
}

function qualityFromText(...values: unknown[]) {
  const text = values
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .join(' ');
  const match = text.match(/(?:^|[^0-9])(2160|1440|1080|720|576|480|360|240)\s*p?(?:\b|[^0-9])/i);
  if (match) return `${match[1]}p`;
  if (/\b(?:4k|uhd)\b/i.test(text)) return '2160p';
  if (/\b(?:2k|qhd)\b/i.test(text)) return '1440p';
  if (/\bfhd\b/i.test(text)) return '1080p';
  if (/\b(?:hd)\b/i.test(text)) return '720p';
  if (/\bsd\b/i.test(text)) return '480p';
  return '';
}

function labelForQuality(provider: SiteConfig, quality: string) {
  if (quality === 'adaptive') return `${provider.name} Adaptive`;
  if (quality === 'source') return `${provider.name} Source`;
  return `${provider.name} ${quality}`;
}

const PLAYABLE_TYPES = new Set(['hls', 'mp4', 'dash', 'webm', 'direct']);

function isLikelyEpisodeLink(url: string, text: string) {
  return /(?:episode|ep|الحلقة|حلقه|الحلقات|s\d+e\d+)/i.test(url) ||
    /(?:episode|ep|الحلقة|حلقه)/i.test(text);
}

function isNavigationLink(url: string, text: string) {
  const n = normalize(text);
  if (!n || n.length < 2 || n.length > 220) return true;
  if (/^(home|login|register|search|menu|privacy|contact|facebook|twitter|telegram)$/i.test(n)) return true;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (/\.(jpg|jpeg|png|gif|svg|webp|css|js)$/i.test(pathname)) return true;
  } catch {}
  return false;
}

async function getText(url: string, timeoutMs: number, referer?: string) {
  const key = `GET|${url}|${referer || ''}`;
  const cached = pageCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = (async () => {
    try {
      const payload = await fetchJsonOrText(url, timeoutMs, {
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8',
        'Accept-Language': 'ar,en;q=0.9',
        Referer: referer || url,
        'User-Agent': 'Mozilla/5.0 (compatible; Movyz/1.0; +https://movyza.app)',
      });
      return typeof payload === 'string' ? payload : JSON.stringify(payload);
    } catch (directError) {
      // Source discovery only: when the runner/Worker cannot reach a provider
      // host directly, use Jina Reader to retrieve the provider HTML. Media
      // bytes are never requested through Jina.
      const jinaUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`;
      try {
        const fallback = await fetchJsonOrText(jinaUrl, Math.min(timeoutMs + 2_000, 12_000), {
          Accept: 'text/plain,text/html;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (compatible; Movyz-Discovery/1.0)',
        });
        return typeof fallback === 'string' ? fallback : JSON.stringify(fallback);
      } catch {
        throw directError;
      }
    }
  })();

  pageCache.set(key, { expiresAt: Date.now() + PAGE_CACHE_TTL_MS, promise });
  promise.catch(() => {
    if (pageCache.get(key)?.promise === promise) pageCache.delete(key);
  });

  return promise;
}

async function postText(url: string, timeoutMs: number, referer?: string) {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    timeoutMs,
    redirect: 'follow',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8',
      'Accept-Language': 'ar,en;q=0.9',
      Referer: referer || url,
      Origin: new URL(url).origin,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (compatible; Movyz/1.0; +https://movyza.app)',
    },
    body: 'watch=1',
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Provider HTTP ${response.status} from ${new URL(url).hostname}`);
  return text;
}

function parseSearchHits(html: string, base: string, allowEpisodeLinks = false): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html))) {
    const url = absolute(base, match[1]);
    const windowHtml = html.slice(match.index, Math.min(html.length, match.index + 2600));
    const title = stripTags(match[2]) ||
      stripTags(/<h3\b[^>]*class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i.exec(windowHtml)?.[1] || '') ||
      stripTags(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(windowHtml)?.[1] || '');
    if (!url || !title || isNavigationLink(url, title) || seen.has(url)) continue;
    if (!allowEpisodeLinks && isLikelyEpisodeLink(url, title)) continue;
    seen.add(url);
    hits.push({ title, url, year: extractYear(title) });
  }

  return hits;
}

async function resolveCimaClubRestSearch(
  terms: string[],
  timeoutMs: number,
): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  const bases = ['https://cimacub.com', 'https://w.cimacub.com'];
  const seen = new Set<string>();
  const addHits = (items: SearchHit[]) => {
    for (const hit of items) {
      if (!seen.has(hit.url)) {
        seen.add(hit.url);
        hits.push(hit);
      }
    }
  };

  for (const base of bases) {
    for (const term of terms.slice(0, 2)) {
      const q = encodeURIComponent(term);

      const endpoints = [
        `${base}/wp-json/wp/v2/search?search=${q}&per_page=20`,
        `${base}/wp-json/wp/v2/search?search=${q}&per_page=20&subtype=post`,
        `${base}/wp-json/wp/v2/posts?search=${q}&per_page=20`,
      ];

      for (const endpoint of endpoints) {
        try {
          const payload = await getText(endpoint, Math.min(timeoutMs, 5_000), base);
          addHits(parseJsonSearchHits(payload, base));
        } catch {}
      }

      // Some CimaClub installs expose movies/series as custom WordPress post
      // types. Discover their REST bases and search them without hardcoding a
      // specific custom post type name.
      try {
        const typesPayload = await getText(`${base}/wp-json/wp/v2/types`, Math.min(timeoutMs, 5_000), base);
        const types = JSON.parse(typesPayload);
        if (types && typeof types === 'object') {
          const restBases = Object.values(types)
            .map((value: any) => String(value?.rest_base || '').trim())
            .filter((value) =>
              value &&
              !['attachment', 'nav_menu_item', 'wp_block', 'wp_template', 'wp_template_part'].includes(value),
            )
            .slice(0, 12);

          for (const restBase of restBases) {
            try {
              const payload = await getText(
                `${base}/wp-json/wp/v2/${encodeURIComponent(restBase)}?search=${q}&per_page=20`,
                Math.min(timeoutMs, 5_000),
                base,
              );
              addHits(parseJsonSearchHits(payload, base));
            } catch {}
          }
        }
      } catch {}

      if (hits.length) return hits;
    }
  }

  return hits;
}

function parseJsonSearchHits(payload: string, base: string): SearchHit[] {
  const hits: SearchHit[] = [];
  try {
    const value = JSON.parse(payload);
    if (!Array.isArray(value)) return hits;
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const titleValue = (item as any).title;
      const title = typeof titleValue === 'string'
        ? stripTags(titleValue)
        : titleValue && typeof titleValue === 'object' && typeof titleValue.rendered === 'string'
          ? stripTags(titleValue.rendered)
          : '';
      const rawUrl = typeof (item as any).url === 'string'
        ? (item as any).url
        : typeof (item as any).link === 'string'
          ? (item as any).link
          : '';
      const url = absolute(base, rawUrl);
      if (!url || !title || isNavigationLink(url, title)) continue;
      hits.push({ title, url, year: extractYear(title) });
    }
  } catch {}
  return hits;
}

async function resolveCimaClubSitemapSearch(
  terms: string[],
  year: number | undefined,
  context: ResolverContext,
  timeoutMs: number,
): Promise<SearchHit[]> {
  const bases = ['https://w.cimacub.com', 'https://cimacub.com'];
  const sitemapSeeds = [
    '/wp-sitemap.xml',
    '/sitemap_index.xml',
    '/sitemap.xml',
  ];
  const sitemapUrls = new Set<string>();
  const directUrls = new Set<string>();

  const collectLocs = (text: string) => {
    for (const match of text.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gis)) {
      const value = decodeHtml(String(match[1] || '').trim());
      if (/^https?:\/\//i.test(value)) sitemapUrls.add(value);
    }
  };

  for (const base of bases) {
    for (const seed of sitemapSeeds) {
      try {
        const xml = await getText(new URL(seed, base).toString(), Math.min(timeoutMs, 4_000), base);
        collectLocs(xml);
      } catch {}
    }
  }

  const firstLevel = [...sitemapUrls].slice(0, 12);
  for (const url of firstLevel) {
    if (/\.xml(?:$|[?#])/i.test(url)) {
      try {
        const xml = await getText(url, Math.min(timeoutMs, 4_000), url);
        collectLocs(xml);
      } catch {}
    } else {
      directUrls.add(url);
    }
  }

  // Avoid exploding the request count. Keep a representative slice of URL
  // entries from the discovered sitemap sets and score the paths locally.
  for (const url of sitemapUrls) {
    if (!/\.xml(?:$|[?#])/i.test(url)) directUrls.add(url);
  }

  const wanted = terms.map(normalize).filter(Boolean);
  const scored: SearchHit[] = [];

  for (const url of [...directUrls].slice(0, 6000)) {
    let pathText = url;
    try {
      pathText = decodeURIComponent(new URL(url).pathname);
    } catch {}

    const normalizedPath = normalize(pathText);
    const tokenMatches = wanted.map((title) => {
      const parts = title.split(' ').filter((part) => part.length > 2);
      if (!parts.length) return 0;
      return parts.filter((part) => normalizedPath.includes(part)).length / parts.length;
    });

    const bestTokenScore = Math.max(0, ...tokenMatches);
    if (bestTokenScore < 0.45) continue;

    const yearMatch = year !== undefined && normalizedPath.includes(String(year));
    const episodeMatch = context.episodeNumber !== undefined
      ? new RegExp('(?:episode|الحلقه|الحلقة)[- _]?' + context.episodeNumber + '(?:\\D|$)', 'i').test(pathText)
      : false;
    const seasonMatch = context.seasonNumber !== undefined
      ? new RegExp('(?:season|الموسم|الجزء)[- _]?(?:' + context.seasonNumber + '|الاول|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)', 'i').test(pathText)
      : false;

    const score =
      bestTokenScore * 1000 +
      (yearMatch ? 180 : 0) +
      (episodeMatch ? 260 : 0) +
      (seasonMatch ? 180 : 0);

    scored.push({
      title: pathText.replace(/[\/_-]+/g, ' ').trim(),
      url,
      year: yearMatch ? year : undefined,
    });

    (scored[scored.length - 1] as any).__score = score;
  }

  return scored
    .sort((a: any, b: any) => Number(b.__score || 0) - Number(a.__score || 0))
    .slice(0, 12)
    .map((item: any) => {
      const clean = { title: item.title, url: item.url, year: item.year };
      return clean;
    });
}

function parseAflamSearchHits(html: string, base: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  const patterns = [
    /<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\bbox\b[^"']*["'][^>]*>[\s\S]*?<h3\b[^>]*>([\s\S]*?)<\/h3>/gi,
    /<a\b[^>]*class=["'][^"']*\bbox\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<h3\b[^>]*>([\s\S]*?)<\/h3>/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const url = absolute(base, match[1]);
      const title = stripTags(match[2] || '');
      if (!url || !title || seen.has(url) || isNavigationLink(url, title)) continue;
      seen.add(url);
      hits.push({ title, url, year: extractYear(title) });
    }
  }

  return hits;
}

function parseCimaClubSearchHits(html: string, base: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  const patterns = [
    /<div\b[^>]*class=["'][^"']*\bSmall--Box\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<h2\b[^>]*>([\s\S]*?)<\/h2>/gi,
    /<div\b[^>]*class=["'][^"']*\bSmall--Box\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<h3\b[^>]*>([\s\S]*?)<\/h3>/gi,
    /<div\b[^>]*class=["'][^"']*\bSmall--Box\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<h1\b[^>]*>([\s\S]*?)<\/h1>/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const url = absolute(base, match[1]);
      const title = stripTags(match[2] || '');
      if (!url || !title || seen.has(url) || isNavigationLink(url, title)) continue;
      seen.add(url);
      hits.push({ title, url, year: extractYear(title) });
    }
  }

  return hits;
}

function rankHits(hits: SearchHit[], titles: string[], year?: number) {
  const wanted = titles.map(normalize).filter(Boolean);
  return [...hits]
    .map((hit, index) => {
      const n = normalize(hit.title);
      const exact = wanted.some((t) => n === t);
      const partial = wanted.some((t) => n.includes(t) || t.includes(n));
      const tokens = wanted.some((t) => {
        const parts = t.split(' ').filter((x) => x.length > 2);
        const matched = parts.filter((part) => n.includes(part)).length;
        return parts.length > 1 && matched / parts.length >= 0.6;
      });
      const yearMatch = year !== undefined && hit.year === year;
      const score =
        (exact ? 1000 : partial ? 600 : tokens ? 320 : 0) +
        (yearMatch ? 160 : 0) -
        index;
      return { hit, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.hit)
    .slice(0, 6);
}

function classifyUrl(rawUrl: string, hint = '', allowGenericDirect = false): { type: NormalizedPlaybackSource['type']; quality: string } | null {
  const value = rawUrl.toLowerCase();
  const quality = qualityFromText(hint, rawUrl) || (value.includes('.m3u8') ? 'adaptive' : 'source');

  if (/\.m3u8(?:[?#]|$)/i.test(value)) return { type: 'hls', quality };
  if (/\.(?:mp4|m4v)(?:[?#]|$)/i.test(value)) return { type: 'mp4', quality };
  if (/\.(?:webm)(?:[?#]|$)/i.test(value)) return { type: 'webm', quality };
  if (/\.mpd(?:[?#]|$)/i.test(value)) return { type: 'dash', quality };
  if (/\.(?:m4v|mov|mkv|avi|mpeg|mpg|ogg|ogv|ts|m2ts|flv|3gp|3g2)(?:[?#]|$)/i.test(value)) return { type: 'direct', quality };

  // Ignore static assets when a provider page contains many ordinary absolute
  // URLs such as quality icons, logos, CSS, JS, fonts, thumbnails, etc.
  if (/\.(?:png|jpe?g|gif|svg|webp|ico|css|js|json|xml|woff2?|ttf|eot)(?:[?#]|$)/i.test(value)) {
    return null;
  }

  // Selected providers frequently expose playable servers through download/file
  // paths without a conventional media extension. Only accept those patterns
  // when generic-direct mode is explicitly enabled.
  if (allowGenericDirect && /\/(?:download|file|stream|video|media)(?:\/|$)/i.test(value)) {
    return { type: 'direct', quality };
  }

  if (/\/embed(?:\/|$)|\/watch(?:\/|$)|\/e\/|player|stream|megabox|share4max|data-watch/i.test(value)) {
    return { type: 'embed', quality };
  }

  return null;
}

function parseQualitySources(html: string, pageUrl: string, provider: SiteConfig): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const add = (rawUrl: string, qualityHint: string, allowGenericDirect = false) => {
    const url = absolute(pageUrl, rawUrl);
    if (!url || seen.has(url)) return;
    const classified = classifyUrl(url, qualityHint, allowGenericDirect);
    if (!classified) return;
    seen.add(url);
    candidates.push({
      provider: provider.name,
      providerKey: provider.key,
      type: classified.type,
      url,
      providerReference: provider.key,
      quality: classified.quality,
      language: 'ar',
      label: labelForQuality(provider, classified.quality),
      expiresAt: undefined,
      sourceUrl: pageUrl,
    });
  };

  // Native HTML video.
  const sourceRe = /<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = sourceRe.exec(html))) {
    const tag = match[0];
    const hint = /\b(?:size|label|data-quality|data-resolution)=["']([^"']+)["']/i.exec(tag)?.[1] || '';
    add(match[1], hint, true);
  }

  const videoRe = /<video\b[\s\S]*?<\/video>/gi;
  while ((match = videoRe.exec(html))) {
    const block = match[0];
    const src = /\bsrc=["']([^"']+)["']/i.exec(block)?.[1];
    if (src) add(src, /\b(?:size|label|data-quality)=["']([^"']+)["']/i.exec(block)?.[1] || '');
  }

  // Server/watch/embed URLs.
  const attributeRe = /<(?:a|iframe|li|div)[^>]*(?:href|src|data-watch|data-url|data-src)=["']([^"']+)["'][^>]*>/gi;
  while ((match = attributeRe.exec(html))) {
    const tag = match[0];
    const hint =
      /\b(?:size|label|quality|data-quality|data-resolution)=["']([^"']+)["']/i.exec(tag)?.[1] ||
      stripTags(tag);
    add(match[1], hint);
  }

  // JSON-embedded URLs and common absolute URL attributes.
  const urlRe = /https?:\\?\/\\?\/[^"'\\s<>]+/g;
  for (const raw of html.match(urlRe) || []) {
    add(raw.replace(/\\/g, ''), '');
  }

  return candidates;
}

const PACK_B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function intToBase62(value: number) {
  if (value === 0) return '0';
  let output = '';
  let n = value;
  while (n > 0) {
    output = PACK_B62[n % 62] + output;
    n = Math.floor(n / 62);
  }
  return output;
}

function unpackPackedScript(html: string): Array<{ url: string; quality: string }> {
  const match = html.match(
    /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\((['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split/
  );
  if (!match) return [];

  const payload = match[2].replace(/\\'/g, "'");
  const radix = Math.min(Number(match[3]) || 62, 62);
  const count = Number(match[4]) || 0;
  const dictionary = match[6].length ? match[6].split('|') : [];

  const unpacked = payload.replace(/[0-9A-Za-z]+/g, (token) => {
    const index = parseInt(token, radix);
    if (!Number.isFinite(index) || index < 0 || index >= count) return token;
    return dictionary[index] ?? token;
  });

  const files = [...unpacked.matchAll(/file\s*:\s*["'](https?:\/\/[^"']+)["']/gi)]
    .map((entry) => entry[1]);
  const labels = [...unpacked.matchAll(/label\s*:\s*["']([^"']+)["']/gi)]
    .map((entry) => entry[1]);

  return files
    .map((url, index) => ({
      url,
      quality: qualityFromText(labels[index], url) || 'source',
    }))
    .filter((entry) =>
      /\.(?:m3u8|mp4|m4v|webm)(?:[?#]|$)/i.test(entry.url) ||
      /\/hls\d?\//i.test(entry.url),
    );
}

function parsePackedPlaybackSources(
  html: string,
  pageUrl: string,
  provider: SiteConfig,
): Candidate[] {
  return unpackPackedScript(html).flatMap((entry) => {
    const url = absolute(pageUrl, entry.url);
    if (!url || entry.quality === 'source') return [];

    const classified = classifyUrl(url, entry.quality, true);
    if (!classified || !PLAYABLE_TYPES.has(classified.type)) return [];

    return [{
      provider: provider.name,
      providerKey: provider.key,
      type: classified.type,
      url,
      providerReference: provider.key,
      quality: entry.quality,
      language: 'ar',
      label: labelForQuality(provider, entry.quality),
      expiresAt: undefined,
      sourceUrl: pageUrl,
    }];
  });
}

function parseDirectMediaSources(
  html: string,
  pageUrl: string,
  provider: SiteConfig,
  inheritedQuality = 'source',
): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const add = (rawUrl: string, hint = '', allowGenericDirect = false) => {
    const url = absolute(pageUrl, rawUrl);
    if (!url || seen.has(url)) return;

    const classified = classifyUrl(url, hint, allowGenericDirect);
    if (!classified || !PLAYABLE_TYPES.has(classified.type)) return;

    const quality =
      qualityFromText(hint, rawUrl, inheritedQuality) ||
      (classified.type === 'hls' ? 'adaptive' : 'source');

    seen.add(url);
    candidates.push({
      provider: provider.name,
      providerKey: provider.key,
      type: classified.type,
      url,
      providerReference: provider.key,
      quality,
      language: 'ar',
      label: labelForQuality(provider, quality),
      expiresAt: undefined,
      sourceUrl: pageUrl,
    });
  };

  const sourceRe = /<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = sourceRe.exec(html))) {
    const tag = match[0];
    const hint =
      /\b(?:size|label|quality|data-quality|data-resolution)=["']([^"']+)["']/i.exec(tag)?.[1] ||
      stripTags(tag);
    add(match[1], hint, true);
  }

  const videoRe = /<video\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  while ((match = videoRe.exec(html))) {
    add(match[1], 'video', true);
  }

  const videosBlocks = [
    ...html.matchAll(/(?:var|let|const)\s+videos\s*=\s*\[([\s\S]*?)\];/gi),
    ...html.matchAll(/videos\s*:\s*\[([\s\S]*?)\]/gi),
  ];

  for (const block of videosBlocks) {
    const body = block[1] || '';
    const objectRe = /(?:src|file|url)\s*:\s*["']([^"']+)["'][^}]*?(?:label|quality|name)\s*:\s*["']([^"']*)["']/gi;
    let objectMatch: RegExpExecArray | null;
    while ((objectMatch = objectRe.exec(body))) {
      add(objectMatch[1], objectMatch[2], true);
    }

    const reverseRe = /(?:label|quality|name)\s*:\s*["']([^"']*)["'][^}]*?(?:src|file|url)\s*:\s*["']([^"']+)["']/gi;
    while ((objectMatch = reverseRe.exec(body))) {
      add(objectMatch[2], objectMatch[1], true);
    }
  }

  // Fallback for provider pages that embed playable URLs directly inside
  // scripts, JSON blobs, or reader-generated text instead of <video>/<source>.
  // Only URLs that classify as real media are accepted; ordinary watch/embed
  // pages are ignored by classifyUrl/PLAYABLE_TYPES.
  const rawUrlPattern = /https?:\/\/[^\s"'<>]+/gi;

  for (const match of html.matchAll(rawUrlPattern)) {
    const raw = String(match[0])
      .replace(/\\\//g, '/')
      .replace(/[),.;]+$/g, '');
    add(raw, inheritedQuality, false);
  }

  return candidates;
}

async function resolveNestedPlaybackLinks(
  links: Array<{ url: string; quality?: string; referer?: string }>,
  provider: SiteConfig,
  timeoutMs: number,
): Promise<Candidate[]> {
  const output: Candidate[] = [];
  const seenMedia = new Set<string>();
  const seenPages = new Set<string>();
  let queue = links.slice(0, 6);

  const addMedia = (source: Candidate) => {
    if (!source.url || seenMedia.has(source.url)) return;
    seenMedia.add(source.url);
    output.push(source);
  };

  for (let depth = 0; depth < 2 && queue.length; depth += 1) {
    const batch = queue.splice(0, 6);
    const results = await Promise.all(batch.map(async (item) => {
      const direct = classifyUrl(item.url, item.quality || '', false);
      const downloadLike = /\/download(?:\/|$)|[?&](?:download|file)=/i.test(item.url);

      if (downloadLike || (direct && PLAYABLE_TYPES.has(direct.type))) {
        const quality =
          qualityFromText(item.quality, item.url) ||
          (direct?.type === 'hls' ? 'adaptive' : item.quality || 'source');
        return {
          media: [{
            provider: provider.name,
            providerKey: provider.key,
            type: direct?.type || 'direct',
            url: item.url,
            providerReference: provider.key,
            quality,
            language: 'ar',
            label: labelForQuality(provider, quality),
            expiresAt: undefined,
            sourceUrl: item.referer || item.url,
          } as Candidate],
          next: [] as Array<{ url: string; quality?: string; referer?: string }>,
        };
      }

      if (seenPages.has(item.url)) {
        return { media: [] as Candidate[], next: [] as Array<{ url: string; quality?: string; referer?: string }> };
      }
      seenPages.add(item.url);

      try {
        const html = await getText(item.url, timeoutMs, item.referer || provider.base);
        const media = [
          ...parsePackedPlaybackSources(html, item.url, provider),
          ...parseDirectMediaSources(html, item.url, provider, item.quality || 'source'),
        ];

        const next: Array<{ url: string; quality?: string; referer?: string }> = [];
        const nestedRe = /<(?:iframe|source|video|li)\b[^>]*(?:src|data-watch|data-player|data-src|data-url)=["']([^"']+)["'][^>]*>/gi;
        let match: RegExpExecArray | null;
        while ((match = nestedRe.exec(html))) {
          const tag = match[0];
          const nestedUrl = absolute(item.url, match[1]);
          if (!nestedUrl) continue;
          const hint =
            qualityFromText(
              /\b(?:size|label|quality|data-quality|data-resolution)=["']([^"']+)["']/i.exec(tag)?.[1],
              stripTags(tag),
              item.quality,
            ) || item.quality || 'source';
          next.push({ url: nestedUrl, quality: hint, referer: item.url });
        }

        return { media, next };
      } catch {
        return { media: [] as Candidate[], next: [] as Array<{ url: string; quality?: string; referer?: string }> };
      }
    }));

    const next: Array<{ url: string; quality?: string; referer?: string }> = [];
    for (const result of results) {
      for (const source of result.media) addMedia(source);
      next.push(...result.next);
    }
    queue = next.slice(0, 6);
  }

  return output.sort((a, b) => {
    const diff = qualityValue(b.quality) - qualityValue(a.quality);
    if (diff) return diff;
    return a.type === 'embed' ? 1 : -1;
  });
}

async function resolveAflamQualitySources(
  html: string,
  pageUrl: string,
  provider: SiteConfig,
  timeoutMs: number,
): Promise<Candidate[]> {
  const watchLinks: Array<{ url: string; quality?: string; referer?: string }> = [];

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = match[0];
    const href = match[1];
    const bodyText = stripTags(tag);
    const classValue =
      /\bclass=["']([^"']*)["']/i.exec(tag)?.[1] ||
      /\bclass=([^\s>]+)/i.exec(tag)?.[1] ||
      '';

    // Current Aflam episode pages expose watch buttons directly as
    // /watch/... links. Older builds used the link-show class.
    if (
      !/\blink-show\b/i.test(classValue) &&
      !/\/watch\//i.test(href) &&
      !/مشاهدة/i.test(bodyText)
    ) continue;

    const url = absolute(pageUrl, href);
    if (!url) continue;

    watchLinks.push({
      url,
      quality: qualityFromText(
        /\b(?:size|label|quality|data-quality|data-resolution)=["']([^"']+)["']/i.exec(tag)?.[1],
        bodyText,
        href,
      ) || 'source',
      referer: pageUrl,
    });
  }

  if (!watchLinks.length) {
    watchLinks.push(
      ...parseMarkdownLinks(html, pageUrl)
        .filter((hit) => /\/(?:watch|download)\//i.test(hit.url))
        .map((hit) => ({
          url: hit.url,
          quality: qualityFromText(hit.title, hit.url) || 'source',
          referer: pageUrl,
        }))
        .slice(0, 8),
    );
  }

  const nested = await resolveNestedPlaybackLinks(watchLinks.slice(0, 8), provider, timeoutMs);
  if (nested.length) return nested;

  return parseDirectMediaSources(html, pageUrl, provider);
}

async function resolveCimaClubSources(
  targetUrl: string,
  provider: SiteConfig,
  timeoutMs: number,
): Promise<Candidate[]> {
  let html = '';
  // Current CimaClub's player route exposes server links after POST watch=1.
  // Prefer that path, then fall back to the regular GET page for mirrors that
  // still render their server list without the POST.
  try {
    html = await postText(targetUrl, Math.min(timeoutMs, 6_000), targetUrl);
  } catch {
    try {
      html = await getText(targetUrl, Math.min(timeoutMs, 6_000), provider.base);
    } catch {
      return [];
    }
  }

  const links: Array<{ url: string; quality?: string; referer?: string }> = [];

  for (const match of html.matchAll(/<li\b[^>]*data-watch=["']([^"']+)["'][^>]*>[\s\S]*?<\/li>/gi)) {
    const tag = match[0];
    const url = absolute(targetUrl, match[1]);
    if (!url) continue;
    links.push({
      url,
      quality: qualityFromText(
        /\b(?:quality|resolution|data-quality|data-resolution)=["']([^"']+)["']/i.exec(tag)?.[1],
        stripTags(tag),
        match[1],
      ) || 'source',
      referer: targetUrl,
    });
  }

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = match[0];
    const rawHref = match[1];
    const text = stripTags(tag);
    if (
      !/ServersList|Download|download/i.test(tag) &&
      !/مشاهدة|Watch|Play|Player/i.test(text) &&
      !/\/(?:watch|player|embed|download)(?:\/|$)/i.test(rawHref)
    ) continue;

    const url = absolute(targetUrl, rawHref);
    if (!url) continue;
    links.push({
      url,
      quality: qualityFromText(
        /\b(?:quality|resolution|data-quality|data-resolution)=["']([^"']+)["']/i.exec(tag)?.[1],
        text,
        rawHref,
      ) || 'source',
      referer: targetUrl,
    });
  }

  if (!links.length) {
    links.push(
      ...parseMarkdownLinks(html, targetUrl)
        .filter((hit) => /\/(?:watch|download|player|embed)\//i.test(hit.url) || /(?:m3u8|mp4|mpd|webm)(?:[?#]|$)/i.test(hit.url))
        .map((hit) => ({
          url: hit.url,
          quality: qualityFromText(hit.title, hit.url) || 'source',
          referer: targetUrl,
        }))
        .slice(0, 12),
    );
  }

  const inline = parseDirectMediaSources(html, targetUrl, provider);
  const nested = await resolveNestedPlaybackLinks(links.slice(0, 12), provider, timeoutMs);

  const merged = [...inline, ...nested];
  const unique = merged.filter((source, index, all) =>
    all.findIndex((item) => item.url === source.url) === index,
  );

  return unique.sort((a, b) => qualityValue(b.quality) - qualityValue(a.quality));
}

function extractEpisodeCandidates(html: string, baseUrl: string) {
  const items: Array<{ url: string; number?: number; season?: number; text: string }> = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html))) {
    const rawHref = decodeHtml(match[1]);
    const text = stripTags(match[2]);
    const url = absolute(baseUrl, rawHref);
    if (!url || seen.has(url) || isNavigationLink(url, text)) continue;

    const parsed = parseSeasonEpisode([rawHref, text].join(' '));
    const number =
      parsed.episode ??
      normalizeNumber(text.match(/(?:episode|ep|الحلقة|حلقه)[^0-9٠-٩]*(\d+)/i)?.[1]) ??
      normalizeNumber(rawHref.match(/(?:episode|ep)[^0-9٠-٩]*(\d+)/i)?.[1]);

    if (!isLikelyEpisodeLink(rawHref, text) && number === undefined) continue;
    seen.add(url);
    items.push({ url, number, season: parsed.season, text });
  }

  const liRe = /<li\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/li>/gi;
  while ((match = liRe.exec(html))) {
    const rawHref = decodeHtml(match[1]);
    const url = absolute(baseUrl, rawHref);
    const text = stripTags(match[2]);
    if (!url || seen.has(url)) continue;

    const parsed = parseSeasonEpisode([rawHref, text].join(' '));
    const number = parsed.episode ?? normalizeNumber(text.match(/(?:episode|ep|الحلقة|حلقه)[^0-9٠-٩]*(\d+)/i)?.[1]);
    if (number === undefined) continue;

    seen.add(url);
    items.push({ url, number, season: parsed.season, text });
  }

  return items;
}

async function resolveCimaClubEpisodeUrl(
  html: string,
  pageUrl: string,
  season?: number,
  episode?: number,
  timeoutMs = 6_000,
): Promise<string | null> {
  if (episode === undefined) return null;

  const seasonSection = /<section\b[^>]*class=["'][^"']*allseasonss[^"']*["'][^>]*>([\s\S]*?)<\/section>/i.exec(html)?.[1] || '';
  const seasonCandidates: Array<{ url: string; season: number }> = [];

  for (const match of seasonSection.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const url = absolute(pageUrl, match[1]);
    const body = match[0];
    if (!url) continue;

    const text = stripTags(body);
    const seasonNumber =
      normalizeNumber(
        /class=["'][^"']*epnum[^"']*["'][^>]*>[\s\S]*?<span[^>]*>[\s\S]*?<\/span>\s*([^<]+)/i.exec(body)?.[1],
      ) ??
      normalizeNumber(/(?:season|الموسم)[^0-9٠-٩]*(\d+)/i.exec(text)?.[1]) ??
      [...text.matchAll(/\b(\d{1,3})\b/g)].map((x) => Number(x[1])).find((n) => n >= 1 && n <= 100);

    if (seasonNumber === undefined) continue;
    if (season !== undefined && seasonNumber !== season) continue;
    seasonCandidates.push({ url, season: seasonNumber });
  }

  const candidates = seasonCandidates.length
    ? seasonCandidates.slice(0, 2)
    : [{ url: pageUrl, season: season ?? 1 }];

  for (const candidate of candidates) {
    const pageHtml = candidate.url === pageUrl
      ? html
      : await getText(candidate.url, timeoutMs, pageUrl).catch(() => '');

    if (!pageHtml) continue;

    const episodeSection =
      /<section\b[^>]*class=["'][^"']*allepcont[^"']*["'][^>]*>([\s\S]*?)<\/section>/i.exec(pageHtml)?.[1] || '';

    for (const match of episodeSection.matchAll(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      const body = match[0];
      const url = absolute(candidate.url, match[1]);
      if (!url) continue;

      const number =
        normalizeNumber(
          /class=["'][^"']*epnum[^"']*["'][^>]*>\s*([0-9٠-٩]+)/i.exec(body)?.[1],
        ) ??
        parseSeasonEpisode(stripTags(body)).episode;

      if (number !== episode) continue;
      return url;
    }
  }

  return null;
}

function resolveAflamEpisodeUrl(
  html: string,
  pageUrl: string,
  season?: number,
  episode?: number,
): string | null {
  if (episode === undefined) return null;

  const episodeSection =
    /<div\b[^>]*id=["']movie-tab-1["'][^>]*>([\s\S]*?)<\/div>\s*(?:<div|<section|$)/i.exec(html)?.[1] || html;

  for (const match of episodeSection.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const body = match[0];
    if (!/entry-title|font-size-50/i.test(body)) continue;

    const url = absolute(pageUrl, match[1]);
    if (!url) continue;

    const number =
      normalizeNumber(
        /class=["'][^"']*font-size-50[^"']*["'][^>]*>\s*([0-9٠-٩]+)/i.exec(body)?.[1],
      ) ??
      parseSeasonEpisode(stripTags(body)).episode;

    if (number !== episode) continue;

    const identity = parseSeasonEpisode([match[1], stripTags(body)].join(' '));
    if (season !== undefined && identity.season !== undefined && identity.season !== season) continue;
    if (season !== undefined && identity.season === undefined && season !== 1) continue;

    return url;
  }

  return null;
}

function findEpisodeUrl(html: string, pageUrl: string, season?: number, episode?: number) {
  if (episode === undefined) return null;

  const pageIdentity = parseSeasonEpisode(pageUrl);
  const requestedSeason = season ?? pageIdentity.season;

  const matchesRequested = (item: { number?: number; season?: number }) =>
    item.number === episode &&
    (
      requestedSeason === undefined ||
      item.season === requestedSeason ||
      (item.season === undefined && pageIdentity.season === requestedSeason)
    );

  const jsonEpisodes = extractJsonLdEpisodes(html, pageUrl);
  const exactJson = jsonEpisodes.find(matchesRequested);
  if (exactJson) return exactJson.url;

  const positionJson = jsonEpisodes.find((item) =>
    item.position === episode &&
    (
      requestedSeason === undefined ||
      item.season === requestedSeason ||
      (item.season === undefined && pageIdentity.season === requestedSeason)
    ),
  );
  if (positionJson) return positionJson.url;

  const items = extractEpisodeCandidates(html, pageUrl);
  const exact = items.find(matchesRequested);
  if (exact) return exact.url;

  // Never choose "episode N" from an unscoped multi-season page. The old
  // fallback could attach S05E01 to S01E01 on Breaking Bad.
  return null;
}


async function resolveAnime3rbSources(
  html: string,
  pageUrl: string,
  provider: SiteConfig,
  timeoutMs: number,
): Promise<Candidate[]> {
  const direct = parseDirectMediaSources(html, pageUrl, provider);
  const output = [...direct];

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*\/download\/[^"']+)["'][^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = match[0];
    const url = absolute(pageUrl, match[1]);
    if (!url) continue;

    const quality =
      qualityFromText(
        /\b(?:quality|resolution|data-quality|data-resolution)=["']([^"']+)["']/i.exec(tag)?.[1],
        stripTags(tag),
        match[1],
      ) || 'source';

    output.push({
      provider: provider.name,
      providerKey: provider.key,
      type: 'direct',
      url,
      providerReference: provider.key,
      quality,
      language: 'ar',
      label: labelForQuality(provider, quality),
      expiresAt: undefined,
      sourceUrl: pageUrl,
    });
  }

  const videoSource =
    /data-video-source=["']([^"']+)["']/i.exec(html)?.[1] ||
    /data-video-source=([^\s>]+)/i.exec(html)?.[1];

  if (videoSource) {
    let embedUrl = absolute(pageUrl, videoSource.replace(/&amp;/g, '&'));
    if (embedUrl) {
      try {
        const url = new URL(embedUrl);
        const cinema = /url\.searchParams\.append\(\s*['"]cinema['"]\s*,\s*(\d+)\s*\)/i.exec(html)?.[1];
        const last = /url\.searchParams\.append\(\s*['"]last['"]\s*,\s*(\d+)\s*\)/i.exec(html)?.[1];
        if (cinema) url.searchParams.set('cinema', cinema);
        if (last) url.searchParams.set('last', last);
        url.searchParams.set('next-image', 'undefined');
        embedUrl = url.toString();
      } catch {}

      const nested = await resolveNestedPlaybackLinks(
        [{ url: embedUrl, quality: qualityFromText(html) || 'source', referer: pageUrl }],
        provider,
        timeoutMs,
      );
      output.push(...nested);
    }
  }

  const unique = output.filter((source, index, all) =>
    PLAYABLE_TYPES.has(source.type) &&
    all.findIndex((item) => item.url === source.url) === index,
  );

  return unique.sort((a, b) => qualityValue(b.quality) - qualityValue(a.quality));
}

async function resolveAnime4upSources(
  html: string,
  pageUrl: string,
  provider: SiteConfig,
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const add = (rawUrl: string, hint = '') => {
    const url = absolute(pageUrl, rawUrl);
    if (!url || seen.has(url) || !/^https:\/\//i.test(url)) return;

    const quality = qualityFromText(hint, rawUrl);
    if (!quality) return;

    const type = classifyUrl(url, hint, true)?.type;
    if (!type || type === 'embed' || !PLAYABLE_TYPES.has(type)) return;

    seen.add(url);
    candidates.push({
      provider: provider.name,
      providerKey: provider.key,
      type,
      url,
      providerReference: provider.key,
      quality,
      language: 'ar',
      label: labelForQuality(provider, quality),
      expiresAt: undefined,
      sourceUrl: pageUrl,
    });
  };

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = match[0];
    const href = match[1];
    const text = stripTags(tag);
    if (!/\b(?:تحميل|download)\b/i.test(text) && !/\/download(?:\/|\?|$)/i.test(href)) continue;
    add(href, text);
  }

  for (const match of html.matchAll(/<(?:a|li|div|source|video)\b[^>]*(?:href|src|data-url|data-src)=["']([^"']+)["'][^>]*>/gi)) {
    const tag = match[0];
    const hint = stripTags(tag);
    if (!/1080|720|480|fhd|hd|sd/i.test(hint)) continue;
    add(match[1], hint);
  }

  return candidates.sort((a, b) => qualityValue(b.quality) - qualityValue(a.quality));
}

function cimaSeasonWord(season: number): string {
  const words = [
    '', 'الاول', 'الثاني', 'الثالث', 'الرابع', 'الخامس',
    'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
    'الحادي-عشر', 'الثاني-عشر', 'الثالث-عشر', 'الرابع-عشر',
    'الخامس-عشر', 'السادس-عشر', 'السابع-عشر', 'الثامن-عشر',
    'التاسع-عشر', 'العشرون',
  ];
  return words[season] || String(season);
}

async function resolveCanonicalCimaClubMovie(
  titles: string[],
  context: ProviderContext,
  provider: SiteConfig,
  timeoutMs: number,
): Promise<Candidate[]> {
  if (provider.key !== 'cimaclub') return [];

  const year = context.releaseYear;
  const base = 'https://cimacub.com';
  const attempts: string[] = [];

  for (const term of titles.slice(0, 2)) {
    const slug = normalize(term).replace(/\s+/g, '-');
    if (!slug) continue;

    const yearParts = year ? [String(year), ''] : [''];
    for (const yearPart of yearParts) {
      const suffix = yearPart ? `-${yearPart}` : '';
      const paths = [
        `/مشاهدة-مشاهدة-فيلم-${slug}${suffix}-مترجم/`,
        `/مشاهدة-فيلم-${slug}${suffix}-مترجم/`,
        `/فيلم-${slug}${suffix}-مترجم/`,
        `/مشاهدة-فيلم-${slug}${suffix}/`,
      ];
      for (const path of paths) attempts.push(new URL(path, base).toString());
    }
  }

  const results = await Promise.allSettled(
    [...new Set(attempts)].slice(0, 8).map(async (url) => {
      const sources = await resolveCimaClubSources(
        url,
        provider,
        Math.min(Math.max(timeoutMs, 3_000), 4_500),
      );
      return sources.filter((source) =>
        PLAYABLE_TYPES.has(source.type) &&
        source.quality !== 'auto' &&
        source.quality !== 'source',
      );
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.length) return result.value;
  }

  return [];
}

async function resolveCanonicalCimaClubEpisode(
  titles: string[],
  context: ProviderContext,
  provider: SiteConfig,
  timeoutMs: number,
): Promise<Candidate[]> {
  if (provider.key !== 'cimaclub' || context.episodeNumber === undefined) return [];

  const season = context.seasonNumber ?? 1;
  const episode = context.episodeNumber;
  const bases = ['https://w.cimacub.com', 'https://cimacub.com'];

  const attempts = titles.slice(0, 2).flatMap((term) => {
    const slug = normalize(term).replace(/\s+/g, '-');
    if (!slug) return [];

    const seasonWord = cimaSeasonWord(season);
    const paths = [
      `/مشاهدة-مشاهدة-مسلسل-${slug}-الجزء-${seasonWord}-الحلقة-${episode}-مترجمة/`,
      `/مشاهدة-مشاهدة-مسلسل-${slug}-الجزء-${seasonWord}-الحلقة-${episode}-مدبلجة/`,
      `/مشاهدة-مسلسل-${slug}-الجزء-${seasonWord}-الحلقة-${episode}-مترجمة/`,
      `/مسلسل-${slug}-الجزء-${seasonWord}-الحلقة-${episode}-مترجمة/`,
      `/مسلسل-${slug}-الجزء-${seasonWord}-الحلقة-${episode}-مدبلجة/`,
      `/مسلسل-${slug}-الجزء-${seasonWord}-الحلقة-${episode}/`,
      `/مشاهدة-مشاهدة-مسلسل-${slug}-الموسم-${seasonWord}-الحلقة-${episode}-مترجمة/`,
      `/مشاهدة-مسلسل-${slug}-الموسم-${seasonWord}-الحلقة-${episode}-مترجمة/`,
      `/مسلسل-${slug}-الموسم-${seasonWord}-الحلقة-${episode}-مترجمة/`,
      `/مسلسل-${slug}-الموسم-${season}-الحلقة-${episode}/`,
    ];

    return bases.flatMap((base) => paths.map((path) => new URL(path, base).toString()));
  });

  const results = await Promise.allSettled(
    [...new Set(attempts)].map(async (url) => {
      const sources = await resolveCimaClubSources(
        url,
        provider,
        Math.min(Math.max(timeoutMs, 3_000), 5_000),
      );
      return sources.filter((source) =>
        PLAYABLE_TYPES.has(source.type) &&
        source.quality !== 'auto' &&
        source.quality !== 'source',
      );
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.length) return result.value;
  }

  return [];
}



async function resolveCanonicalAnime3rbEpisode(
  titles: string[],
  context: ProviderContext,
  provider: SiteConfig,
  timeoutMs: number,
): Promise<Candidate[]> {
  if (provider.key !== 'anime3rb' || context.episodeNumber === undefined) return [];

  // The canonical episode route is deterministic for first-season episodes.
  // For later seasons, keep the stricter title-page episode matching below so
  // we never guess a season from an opaque episode number.
  if (context.seasonNumber !== undefined && context.seasonNumber !== 1) return [];

  const attempts = await Promise.allSettled(
    titles.slice(0, 2).map(async (term) => {
      const slug = normalize(term).replace(/\s+/g, '-');
      if (!slug) return [];
      const episodeUrl = `https://anime3rb.com/episode/${slug}/${context.episodeNumber}`;
      const html = await getText(episodeUrl, timeoutMs, provider.base);
      return resolveAnime3rbSources(html, episodeUrl, provider, timeoutMs);
    }),
  );

  for (const attempt of attempts) {
    if (attempt.status === 'fulfilled' && attempt.value.length) return attempt.value;
  }

  return [];
}

async function resolveProvider(
  provider: SiteConfig,
  context: ProviderContext,
  timeoutMs: number,
): Promise<Candidate[]> {
  const baseTitles = [...new Set([
    context.title,
    context.originalTitle,
    ...(context.alternateTitles || []),
  ].filter((x): x is string => !!x?.trim()).map((x) => x.trim()))];

  const searchTerms = [...new Set(
    baseTitles.flatMap((value) => {
      const clean = value.trim();
      const variants = [clean];
      if (/^the\s+/i.test(clean)) variants.push(clean.replace(/^the\s+/i, ''));
      if (/\s+the$/i.test(clean)) variants.push(clean.replace(/\s+the$/i, ''));
      return variants;
    }),
  )];

  const titles = searchTerms;

  if (!titles.length) return [];

  // CimaClub has deterministic season/episode routes. Try those before
  // expensive title searches so exact episode prewarming does not depend on
  // search ranking or a slow mirror.
  if (provider.key === 'cimaclub' && context.episodeNumber !== undefined) {
    const canonicalSources = await resolveCanonicalCimaClubEpisode(titles, context, provider, timeoutMs);
    if (canonicalSources.length) return canonicalSources;
  }

  if (provider.key === 'cimaclub' && context.episodeNumber === undefined) {
    const canonicalSources = await resolveCanonicalCimaClubMovie(titles, context, provider, timeoutMs);
    if (canonicalSources.length) return canonicalSources;
  }

  if (provider.key === 'anime3rb' && context.episodeNumber !== undefined) {
    const canonicalSources = await resolveCanonicalAnime3rbEpisode(titles, context, provider, timeoutMs);
    if (canonicalSources.length) return canonicalSources;
  }

  const searchResults: SearchHit[] = [];

  // Anime3rb has stable canonical title pages; prefer them before generic search.
  if (provider.key === 'anime3rb') {
    const titleResults = await Promise.allSettled(
      titles.slice(0, 2).map(async (term) => {
        const titleSlug = normalize(term).replace(/\s+/g, '-');
        const titleUrl = `https://anime3rb.com/titles/${titleSlug}`;
        const titleHtml = await getText(titleUrl, timeoutMs, provider.base);
        const marker = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(titleHtml)?.[1];
        return {
          title: stripTags(marker || term).replace(/\s*[-|].*$/, '').trim() || term,
          url: titleUrl,
          year: extractYear(titleHtml.slice(0, 5000)),
        };
      }),
    );
    for (const result of titleResults) {
      if (result.status === 'fulfilled') searchResults.push(result.value);
    }
  }

  // Search all configured URL variants concurrently. Slow/dead hosts no longer
  // serialize the provider's entire discovery phase.
  const searchJobs = searchTerms
    .slice(0, 2)
    .flatMap((term) =>
      provider.searchUrls(encodeURIComponent(term)).map((searchUrl) => ({ searchUrl })),
    );

  const searchResponses = await Promise.allSettled(
    searchJobs.map(({ searchUrl }) => getText(searchUrl, timeoutMs, provider.base)),
  );

  for (const result of searchResponses) {
    if (result.status !== 'fulfilled') continue;
    const html = result.value;
    if (provider.key === 'aflaam') searchResults.push(...parseAflamSearchHits(html, provider.base));
    if (provider.key === 'cimaclub') searchResults.push(...parseCimaClubSearchHits(html, provider.base));
    searchResults.push(...parseSearchHits(html, provider.base, context.episodeNumber !== undefined));
    searchResults.push(...parseMarkdownLinks(html, provider.base));
  }

  if (!searchResults.length && provider.key === 'cimaclub') {
    searchResults.push(...await resolveCimaClubRestSearch(searchTerms, timeoutMs));
  }

  if (!searchResults.length && provider.key === 'cimaclub') {
    searchResults.push(
      ...await resolveCimaClubSitemapSearch(
        searchTerms,
        context.releaseYear,
        context,
        timeoutMs,
      ),
    );
  }

  const hits = rankHits(searchResults, titles, context.releaseYear);
  if (!hits.length) {
    if (context.episodeNumber !== undefined && provider.key === 'cimaclub') {
      const canonicalSources = await resolveCanonicalCimaClubEpisode(titles, context, provider, timeoutMs);
      if (canonicalSources.length) return canonicalSources;
    }
    return [];
  }

  for (const hit of hits) {
    try {
      const detail = await getText(hit.url, timeoutMs, provider.base);
      let targetUrl = hit.url;

      if (context.episodeNumber !== undefined) {
        const hitIdentity = parseSeasonEpisode([hit.url, hit.title].join(' '));
        const explicitEpisode =
          hitIdentity.episode === context.episodeNumber &&
          (
            context.seasonNumber === undefined ||
            hitIdentity.season === context.seasonNumber ||
            (context.seasonNumber === 1 && hitIdentity.season === undefined)
          );

        if (explicitEpisode) {
          targetUrl = hit.url;
        } else if (provider.key === 'cimaclub') {
          targetUrl = await resolveCimaClubEpisodeUrl(
            detail,
            hit.url,
            context.seasonNumber,
            context.episodeNumber,
            Math.min(timeoutMs, 6_000),
          ) || '';
        } else if (provider.key === 'aflaam') {
          targetUrl = resolveAflamEpisodeUrl(
            detail,
            hit.url,
            context.seasonNumber,
            context.episodeNumber,
          ) || '';
        } else {
          targetUrl = findEpisodeUrl(detail, hit.url, context.seasonNumber, context.episodeNumber) || '';
        }

        // Anime3rb exposes a stable canonical episode route even when the
        // title page omits the episode anchors from the initial HTML.
        if (!targetUrl && provider.key === 'anime3rb') {
          try {
            const titleSlug = new URL(hit.url).pathname.match(/^\/titles\/([^/]+)/i)?.[1];
            if (titleSlug) {
              const episodeUrl = `https://anime3rb.com/episode/${titleSlug}/${context.episodeNumber}`;
              const episodeHtml = await getText(episodeUrl, timeoutMs, hit.url);
              if (/(?:الحلقة|episode)/i.test(episodeHtml.slice(0, 12000))) {
                targetUrl = episodeUrl;
              }
            }
          } catch {}
        }

        if (!targetUrl) {
          // Some pages link the first episode from a separate panel; resolve
          // that page once and look for the requested episode there.
          const firstEpisode = extractEpisodeCandidates(detail, hit.url)[0];
          if (firstEpisode?.url) {
            try {
              const episodePage = await getText(firstEpisode.url, timeoutMs, hit.url);
              targetUrl =
                findEpisodeUrl(episodePage, firstEpisode.url, context.seasonNumber, context.episodeNumber) ||
                (firstEpisode.number === context.episodeNumber ? firstEpisode.url : '');
            } catch {}
          }
        }
      }

      if (!targetUrl) continue;

      let sources: Candidate[] = [];

      if (provider.key === 'aflaam') {
        const sourcePageHtml = targetUrl === hit.url ? detail : await getText(targetUrl, timeoutMs, hit.url);
        sources = await resolveAflamQualitySources(sourcePageHtml, targetUrl, provider, timeoutMs);
        if (!sources.length) sources = parseQualitySources(sourcePageHtml, targetUrl, provider);
      } else if (provider.key === 'cimaclub') {
        const watchTarget = context.episodeNumber !== undefined
          ? targetUrl
          : (targetUrl.endsWith('/') ? `${targetUrl}watch/` : `${targetUrl}/watch/`);
        try {
          sources = await resolveCimaClubSources(watchTarget, provider, timeoutMs);
        } catch {}
        if (!sources.length) {
          const sourcePageHtml = targetUrl === hit.url ? detail : await getText(targetUrl, timeoutMs, hit.url);
          sources = parseQualitySources(sourcePageHtml, targetUrl, provider);
        }
      } else if (provider.key === 'anime3rb') {
        const watchHtml = targetUrl === hit.url
          ? detail
          : await getText(targetUrl, timeoutMs, hit.url);
        sources = await resolveAnime3rbSources(watchHtml, targetUrl, provider, timeoutMs);
      } else if (provider.key === 'anime4up') {
        const watchHtml = targetUrl === hit.url
          ? detail
          : await getText(targetUrl, timeoutMs, hit.url);
        sources = await resolveAnime4upSources(watchHtml, targetUrl, provider);
      } else {
        const watchHtml = targetUrl === hit.url
          ? detail
          : await getText(targetUrl, timeoutMs, hit.url);
        sources = parseQualitySources(watchHtml, targetUrl, provider);
      }

      sources = (sources || []).filter((source) =>
        PLAYABLE_TYPES.has(source.type) &&
        source.quality !== 'auto' &&
        source.quality !== 'source',
      );

      if (sources.length && context.episodeNumber !== undefined && context.seasonNumber !== undefined) {
        const tagged = sources.filter((source) => {
          const identities = [source.url || '', source.sourceUrl || '']
            .map(parseSeasonEpisode)
            .filter((identity) => identity.season !== undefined || identity.episode !== undefined);

          // Explicitly tagged media URLs must agree with the requested
          // season/episode. Opaque URLs are accepted when the episode page was
          // resolved unambiguously by findEpisodeUrl above.
          if (!identities.length) return true;
          return identities.some((identity) =>
            identity.season === context.seasonNumber &&
            identity.episode === context.episodeNumber,
          );
        });
        if (tagged.length) return tagged;
        continue;
      }

      if (sources.length) {
        return sources;
      }
    } catch {
      // Continue with the next ranked result.
    }
  }

  return [];
}

function groupScore(sources: Candidate[]) {
  const distinctQualities = new Set(sources.map((source) => source.quality));
  const maxQuality = Math.max(0, ...sources.map((source) => qualityValue(source.quality)));
  const directCount = sources.filter((source) => ['mp4', 'hls', 'dash', 'webm'].includes(source.type)).length;
  const embedCount = sources.filter((source) => source.type === 'embed').length;
  return (distinctQualities.size * 800) + (maxQuality * 3) + (directCount * 220) + (embedCount * 20);
}

async function resolveUncached(context: ResolverContext, timeoutMs: number) {
  const eligibleKind: SiteKind = context.__isAnime ? 'anime' : 'general';
  const providers = PROVIDERS.filter((provider) => provider.kind === eligibleKind);

  // Resolve both eligible sites in parallel and retain each non-empty
  // provider group separately; qualities are never mixed across sites.
  const providerBudgetMs = Math.min(Math.max(timeoutMs + 3_000, 10_000), 18_000);
  const groups = await Promise.all(
    providers.map(async (provider) => {
      try {
        const sources = await withTimeout(
          resolveProvider(provider, context, Math.min(timeoutMs, 12_000)),
          providerBudgetMs,
          `Provider ${provider.key} exceeded resolver budget`,
        );
        return { provider, sources };
      } catch {
        return { provider, sources: [] as Candidate[] };
      }
    }),
  );

  const usable = groups
    .filter((group) => group.sources.length > 0)
    .sort((a, b) => groupScore(b.sources) - groupScore(a.sources));

  if (!usable.length) {
    throw new Error(`No ${eligibleKind} playback source returned by the selected sites`);
  }

  // Keep both selected provider groups when available. Each group is kept
  // internally intact so the UI can show:
  //   Aflam -> 1080p / 720p / 480p
  //   CimaClub -> quality list
  // without mixing sources across sites.
  const merged: Candidate[] = [];
  for (const group of usable) {
    const ordered = [...group.sources].sort((a, b) => {
      const qualityDiff = qualityValue(b.quality) - qualityValue(a.quality);
      if (qualityDiff) return qualityDiff;
      return a.type === 'embed' ? 1 : -1;
    });

    const unique = ordered.filter((source, index, all) =>
      all.findIndex((item) => item.url === source.url) === index,
    );

    // Maximum six qualities/servers per provider group prevents noisy result
    // sets while preserving all normal 1080p/720p/480p variants.
    merged.push(...unique.slice(0, 6));
  }

  return merged;
}

async function resolveContext(request: Re3ArabiPlaybackRequest): Promise<ResolverContext> {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('TMDB_API_READ_ACCESS_TOKEN is not configured');

  const path = request.type === 'movie' ? `/movie/${request.tmdbId}` : `/tv/${request.tmdbId}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const [payload, arabicPayload] = await Promise.all([
    fetchJsonOrText(`https://api.themoviedb.org/3${path}`, 8_000, headers) as Promise<Record<string, unknown>>,
    fetchJsonOrText(`https://api.themoviedb.org/3${path}?language=ar`, 8_000, headers) as Promise<Record<string, unknown>>,
  ]);

  const title = request.type === 'movie' ? payload.title : payload.name;
  const originalTitle = request.type === 'movie' ? payload.original_title : payload.original_name;
  const arabicTitle = request.type === 'movie' ? arabicPayload.title : arabicPayload.name;
  const date = request.type === 'movie' ? payload.release_date : payload.first_air_date;

  const genres = Array.isArray(payload.genres) ? payload.genres as Array<Record<string, unknown>> : [];
  const animation = genres.some((genre) => Number(genre.id) === 16);
  const originalLanguage = typeof payload.original_language === 'string' ? payload.original_language : '';
  const originCountry = Array.isArray(payload.origin_country)
    ? payload.origin_country.filter((x): x is string => typeof x === 'string')
    : [];

  // Prefer the dedicated anime providers for Japanese animation; normal
  // animated western titles continue through Aflam/CimaClub.
  const isAnime = animation && (originalLanguage === 'ja' || originCountry.includes('JP'));

  return {
    tmdbId: request.tmdbId,
    title: typeof title === 'string' ? title : undefined,
    originalTitle: typeof originalTitle === 'string' ? originalTitle : undefined,
    alternateTitles: typeof arabicTitle === 'string' ? [arabicTitle] : [],
    releaseYear: typeof date === 'string' && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined,
    seasonNumber: request.season,
    episodeNumber: request.episode,
    __isAnime: isAnime,
  };
}

export async function diagnoseRe3ArabiPlayback(request: Re3ArabiPlaybackRequest): Promise<{
  resolver: 'selected-sites';
  request: Re3ArabiPlaybackRequest;
  providers: Array<{ key: string; success: boolean; sourceCount: number; qualities: string[]; types: string[]; error?: string }>;
}> {
  const context = await resolveContext(request);
  const eligibleKind: SiteKind = context.__isAnime ? 'anime' : 'general';
  const providers = PROVIDERS.filter((provider) => provider.kind === eligibleKind);
  const timeoutMs = Math.max(3_000, Number(process.env.RE3ARABI_TIMEOUT_MS || 8_000));

  const results = await Promise.all(providers.map(async (provider) => {
    try {
      const sources = await withTimeout(
        resolveProvider(provider, context, Math.min(timeoutMs, 8_000)),
        Math.min(timeoutMs + 4_000, 12_000),
        `Provider ${provider.key} exceeded diagnostic budget`,
      );
      return {
        key: provider.key,
        success: sources.length > 0,
        sourceCount: sources.length,
        qualities: [...new Set(sources.map((source) => source.quality))],
        types: [...new Set(sources.map((source) => source.type))],
      };
    } catch (error) {
      return {
        key: provider.key,
        success: false,
        sourceCount: 0,
        qualities: [],
        types: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));

  return {
    resolver: 'selected-sites',
    request,
    providers: results,
  };
}

export async function resolveRe3ArabiSeriesContext(tmdbId: number): Promise<ResolverContext> {
  return resolveContext({ type: 'series', tmdbId });
}

export async function resolveRe3ArabiProvider(
  request: Re3ArabiPlaybackRequest,
  providerKey: string,
): Promise<Candidate[]> {
  // The full selected-sites resolver is the proven path for exact episodes.
  // Filter its results here instead of maintaining a second divergent
  // provider-specific discovery implementation.
  const sources = await resolveRe3ArabiPlayback(request);
  return sources.filter((source) =>
    String(source.providerKey || source.providerReference || '').trim().toLowerCase() === providerKey.toLowerCase(),
  );
}

export async function resolveRe3ArabiProviderWithContext(
  context: ResolverContext,
  season: number,
  episode: number,
  providerKey: string,
): Promise<Candidate[]> {
  const resolvedContext: ResolverContext = {
    ...context,
    seasonNumber: season,
    episodeNumber: episode,
  };

  // Use the same combined resolver path that is proven to return exact
  // episode sources, then keep only the requested provider group. This avoids
  // maintaining a second provider-specific discovery path that previously
  // returned zero sources for every episode.
  const timeoutMs = Math.max(8_000, Number(process.env.RE3ARABI_TIMEOUT_MS || 8_000));
  const sources = await withTimeout(
    resolveUncached(resolvedContext, timeoutMs),
    Math.min(timeoutMs + 3_000, 18_000),
    `Provider ${providerKey} exceeded resolver budget`,
  );

  return sources.filter((source) =>
    String(source.providerKey || source.providerReference || '').trim().toLowerCase() === providerKey.toLowerCase(),
  );
}

export async function resolveRe3ArabiPlaybackWithContext(
  context: ResolverContext,
  season: number,
  episode: number,
): Promise<Candidate[]> {
  const resolvedContext: ResolverContext = {
    ...context,
    seasonNumber: season,
    episodeNumber: episode,
  };

  const key = JSON.stringify({
    type: 'series',
    tmdbId: resolvedContext.tmdbId,
    season,
    episode,
  });
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const timeoutMs = Math.max(3_000, Number(process.env.RE3ARABI_TIMEOUT_MS || 8_000));
  const promise = resolveUncached(resolvedContext, timeoutMs);
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

export async function resolveRe3ArabiMovieContext(tmdbId: number): Promise<ResolverContext> {
  return resolveContext({ type: 'movie', tmdbId });
}

export async function resolveRe3ArabiPlayback(
  request: Re3ArabiPlaybackRequest,
): Promise<Candidate[]> {
  const key = JSON.stringify(request);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const timeoutMs = Math.max(3_000, Number(process.env.RE3ARABI_TIMEOUT_MS || 8_000));
  const promise = resolveContext(request).then((context) => resolveUncached(context, timeoutMs));

  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

export function createRe3ArabiAdapter() {
  return {
    key: 're3arabi',
    name: 'Aflam / CimaClub / Anime3rb / Anime4Up',
    enabled: true,
    async resolveMovie(context: ProviderContext) {
      return resolveRe3ArabiPlayback({
        type: 'movie',
        tmdbId: context.tmdbId || 0,
      });
    },
    async resolveEpisode(context: ProviderContext) {
      return resolveRe3ArabiPlayback({
        type: 'series',
        tmdbId: context.tmdbId || 0,
        season: context.seasonNumber,
        episode: context.episodeNumber,
      });
    },
    async health() {
      const started = Date.now();
      const results = await Promise.allSettled(
        PROVIDERS.map((provider) => getText(provider.base, 3_000).then(() => provider.key)),
      );
      const healthy = results.filter((result) => result.status === 'fulfilled').map((result) =>
        result.status === 'fulfilled' ? result.value : '',
      );
      return {
        status: healthy.length >= 2 ? 'healthy' as const : healthy.length ? 'degraded' as const : 'offline' as const,
        latencyMs: Date.now() - started,
        message: healthy.length ? `Reachable: ${healthy.join(', ')}` : 'No selected playback site is reachable',
      };
    },
  };
}

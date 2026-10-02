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
      `https://cimacub.com/?s=${q}`,
    ],
  },
  {
    key: 'anime4up',
    name: 'Anime4Up',
    base: 'https://w1.anime4up.rest',
    kind: 'anime',
    searchUrls: (q) => [
      `https://w1.anime4up.rest/?s=${q}`,
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

  // Aflam uses deterministic series slugs such as:
  // /series/55/breaking-bad-5-1 -> season 5, episode 1.
  const aflaamSeriesSlug = text.match(
    /\/series\/[^/]+\/[^/?#]*-(\d+)-(\d+)(?:[/?#]|$)/i,
  );
  if (aflaamSeriesSlug) {
    return {
      season: Number(aflaamSeriesSlug[1]),
      episode: Number(aflaamSeriesSlug[2]),
    };
  }

  const season =
    normalizeNumber(text.match(/(?:season|الموسم)[^0-9٠-٩]*(\d+)/i)?.[1]) ??
    normalizeNumber(text.match(/\/series\/[^/]+\/[^/?#]*-(\d+)(?:[/?#]|$)/i)?.[1]);
  const episode =
    normalizeNumber(text.match(/(?:episode|ep|الحلقة|حلقه)[^0-9٠-٩]*(\d+)/i)?.[1]) ??
    normalizeNumber(text.match(/(?:\/|-)الحلقة[-_ ]*(\d+)(?:[/?#]|$)/i)?.[1]);
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

async function resolveAflamSitemapSearch(
  terms: string[],
  context: ProviderContext,
  provider: SiteConfig,
  timeoutMs: number,
): Promise<SearchHit[]> {
  const sitemapUrls = new Set<string>();
  const directUrls = new Set<string>();
  const seeds = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap-index.xml'];

  const collectLocs = (xml: string) => {
    for (const match of xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gis)) {
      const url = decodeHtml(String(match[1] || '').trim());
      if (/^https?:\/\//i.test(url)) sitemapUrls.add(url);
    }
  };

  for (const seed of seeds) {
    try {
      const xml = await getText(new URL(seed, provider.base).toString(), Math.min(timeoutMs, 3_500), provider.base);
      collectLocs(xml);
    } catch {}
  }

  for (const url of [...sitemapUrls].slice(0, 16)) {
    if (!/\.xml(?:$|[?#])/i.test(url)) {
      directUrls.add(url);
      continue;
    }

    try {
      const xml = await getText(url, Math.min(timeoutMs, 3_500), url);
      collectLocs(xml);
    } catch {}
  }

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
    const tokenScore = Math.max(
      0,
      ...wanted.map((title) => {
        const parts = title.split(' ').filter((part) => part.length > 2);
        if (!parts.length) return 0;
        return parts.filter((part) => normalizedPath.includes(part)).length / parts.length;
      }),
    );

    if (tokenScore < 0.45) continue;

    const identity = parseSeasonEpisode(pathText);
    const episodeMatch =
      context.episodeNumber !== undefined &&
      (
        identity.episode === context.episodeNumber ||
        new RegExp(
          `(?:episode|ep|الحلقة|حلقه|الحلقه)[-_ /]?${context.episodeNumber}(?:\\D|$)`,
          'i',
        ).test(pathText)
      );
    const seasonMatch =
      context.seasonNumber !== undefined &&
      (
        identity.season === context.seasonNumber ||
        new RegExp(
          `(?:season|الموسم|الموسم رقم)[-_ /]?${context.seasonNumber}(?:\\D|$)`,
          'i',
        ).test(pathText)
      );

    const yearMatch =
      context.releaseYear !== undefined &&
      normalizedPath.includes(String(context.releaseYear));

    const score =
      tokenScore * 1000 +
      (episodeMatch ? 420 : 0) +
      (seasonMatch ? 320 : 0) +
      (yearMatch ? 120 : 0);

    scored.push({
      title: pathText.replace(/[\/_-]+/g, ' ').trim(),
      url,
      year: yearMatch ? context.releaseYear : undefined,
      ...(score ? { __score: score } as any : {}),
    } as SearchHit & { __score?: number });
  }

  return scored
    .sort((a: any, b: any) => Number(b.__score || 0) - Number(a.__score || 0))
    .slice(0, 12)
    .map((item: any) => ({
      title: item.title,
      url: item.url,
      year: item.year,
    }));
}

function rankHits(hits: SearchHit[], titles: string[], year?: number, requestedSeason?: number) {
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
      const hitIdentity = parseSeasonEpisode([hit.url, hit.title].join(' '));
      const seasonMatch = requestedSeason !== undefined && hitIdentity.season === requestedSeason;
      const seasonMismatch =
        requestedSeason !== undefined &&
        hitIdentity.season !== undefined &&
        hitIdentity.season !== requestedSeason;
      const score =
        (exact ? 1000 : partial ? 600 : tokens ? 320 : 0) +
        (yearMatch ? 160 : 0) +
        (seasonMatch ? 260 : 0) -
        (seasonMismatch ? 420 : 0) -
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
  // Handle both normal https:// URLs and JSON-escaped https:\/\/ URLs.
  const rawUrlPattern = /https?:\\\/\\\/[^\s"'<>\\]+|https?:\/\/[^\s"'<>]+/gi;

  for (const match of html.matchAll(rawUrlPattern)) {
    const raw = String(match[0])
      .replace(/\\\\\//g, '/')
      .replace(/[),.;}]+$/g, '');
    add(raw, inheritedQuality, false);
  }

  // Common player JSON shape: {file:"...", src:"...", url:"..."}.
  // This catches escaped media URLs even when they are not present in a
  // videos=[...] array or a native <source> element.
  const jsonMediaPattern = /(?:file|src|url|source)\\s*:\\s*["'](https?:\\\/\\\/[^"']+|https?:\/\/[^"']+)["']/gi;
  for (const match of html.matchAll(jsonMediaPattern)) {
    const raw = String(match[1] || '').replace(/\\\\\//g, '/');
    add(raw, inheritedQuality, true);
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
      !/\/(?:watch|download)\//i.test(href) &&
      !/(?:مشاهدة|تحميل)/i.test(bodyText)
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

function resolveAflamEpisodeUrl(
  html: string,
  pageUrl: string,
  season?: number,
  episode?: number,
): string | null {
  if (episode === undefined) return null;

  // Aflam has used several episode-list templates. Scan every anchor
  // instead of relying on one wrapper div that can truncate the list.
  const candidates: Array<{ url: string; season?: number; score: number }> = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const tag = match[0];
    const href = decodeHtml(match[1]);
    const text = stripTags(match[2]);
    const url = absolute(pageUrl, href);
    if (!url || seen.has(url)) continue;

    const contextWindowStart = Math.max(0, match.index - 1400);
    const contextWindowEnd = Math.min(html.length, match.index + match[0].length + 1400);
    const contextWindow = stripTags(html.slice(contextWindowStart, contextWindowEnd));

    const identity = parseSeasonEpisode([href, text, contextWindow].join(' '));
    const classNumber = normalizeNumber(
      /class=["'][^"']*(?:font-size-50|entry-title|episode-number|ep-number)[^"']*["'][^>]*>\s*([0-9٠-٩]+)/i.exec(tag)?.[1],
    );
    const dataEpisode = normalizeNumber(
      /(?:data-episode|data-ep|data-number)=["']([0-9٠-٩]+)["']/i.exec(tag)?.[1],
    );
    const textEpisode = normalizeNumber(
      text.match(/(?:episode|ep|الحلقة|حلقه|حلقة)[^0-9٠-٩]*([0-9٠-٩]+)/i)?.[1],
    );
    const numberFromHref = normalizeNumber(
      href.match(/(?:episode|ep|الحلقة|حلقه|e)[-_./ ]*([0-9٠-٩]{1,3})(?:\D|$)/i)?.[1],
    );
    const bareNumber = normalizeNumber(text);
    const hasEpisodeMarker = /(?:episode|ep|الحلقة|حلقه|حلقة|season|الموسم|s\d+e\d+)/i.test(
      href + ' ' + tag + ' ' + text + ' ' + contextWindow,
    );
    const number =
      identity.episode ??
      dataEpisode ??
      textEpisode ??
      numberFromHref ??
      classNumber ??
      (hasEpisodeMarker ? bareNumber : undefined);

    if (number !== episode) continue;

    const explicitSeason = identity.season ?? normalizeNumber(
      /(?:data-season|data-season-number)=["']([0-9٠-٩]+)["']/i.exec(tag)?.[1],
    ) ?? normalizeNumber(
      contextWindow.match(/(?:season|الموسم|الموسم رقم)[^0-9٠-٩]*([0-9٠-٩]{1,3})/i)?.[1],
    );
    if (season !== undefined && explicitSeason !== undefined && explicitSeason !== season) continue;

    let score = 100;
    if (/font-size-50|entry-title|episode-number|ep-number|data-episode|data-ep/i.test(tag)) score += 80;
    if (/(?:episode|ep|الحلقة|حلقه|حلقة)/i.test(href + ' ' + text)) score += 40;
    if (numberFromHref === episode) score += 35;
    if (bareNumber === episode) score += 15;
    if (season !== undefined && explicitSeason === season) score += 90;
    if (season !== undefined && explicitSeason !== undefined && explicitSeason !== season) score -= 500;
    if (season === 1 && explicitSeason === undefined) score += 20;

    candidates.push({ url, season: explicitSeason, score });
    seen.add(url);
  }

  return candidates.sort((a, b) => b.score - a.score)[0]?.url || null;
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

async function resolveAnime4upMegabox(
  url: string,
  referer: string,
  provider: SiteConfig,
  timeoutMs: number,
): Promise<Candidate[]> {
  try {
    const html = await getText(url, timeoutMs, referer);
    const appJson = html.match(/<script[^>]*data-page=["']app["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
    if (!appJson) return [];
    let page: any;
    try { page = JSON.parse(appJson); } catch { return []; }
    const version = typeof page?.version === 'string' ? page.version : '';
    if (!version) return [];

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      timeoutMs,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/137 Safari/537.36',
        Referer: referer,
        'X-Inertia': 'true',
        'X-Inertia-Partial-Component': 'files/mirror/video',
        'X-Inertia-Partial-Data': 'streams',
        'X-Inertia-Version': version,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    if (!response.ok) return [];
    const payload = await response.json() as any;
    const mirrors = payload?.props?.streams?.data || [];
    const links: Array<{url:string; quality?:string; referer?:string}> = [];
    for (const level of Array.isArray(mirrors) ? mirrors : []) {
      const quality = String(level?.label || '');
      for (const mirror of Array.isArray(level?.mirrors) ? level.mirrors : []) {
        const link = typeof mirror?.link === 'string' ? mirror.link : '';
        if (link) links.push({ url: link.startsWith('//') ? `https:${link}` : link, quality, referer: url });
      }
    }
    return resolveNestedPlaybackLinks(links.slice(0, 8), provider, timeoutMs);
  } catch {
    return [];
  }
}

async function resolveAnime4upSources(
  html: string,
  pageUrl: string,
  provider: SiteConfig,
  timeoutMs: number,
): Promise<Candidate[]> {
  const links: Array<{ url: string; quality?: string; referer?: string }> = [];
  const seen = new Set<string>();

  const addLink = (rawUrl: string, qualityHint = '', referer = pageUrl) => {
    const url = absolute(pageUrl, rawUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({
      url,
      quality: qualityFromText(qualityHint, rawUrl) || 'source',
      referer,
    });
  };

  // Match the Re-3Arabi Anime4Up plugin exactly: every episode server is a data-watch URL.
  for (const match of html.matchAll(/<li\b[^>]*data-watch=["']([^"']+)["'][^>]*>/gi)) {
    const tag = match[0];
    addLink(match[1], qualityFromText(tag, match[1]) || 'source');
  }

  // And its explicit download list.
  for (const match of html.matchAll(/<tr\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>[\s\S]*?<\/tr>/gi)) {
    const tag = match[0];
    if (!/td[-_]link|download/i.test(tag)) continue;
    addLink(match[1], qualityFromText(tag, match[1]) || 'source');
  }

  // Fallback for direct native media already embedded in the page.
  if (!links.length) {
    for (const match of html.matchAll(/<(?:source|video)\b[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)) {
      addLink(match[1], qualityFromText(match[0], match[1]) || 'source');
    }
  }

  const all: Candidate[] = [];
  const seenUrls = new Set<string>();

  for (const item of links.slice(0, 8)) {
    const isMega = /(?:share4max|megamax)/i.test(item.url);
    const sources = isMega
      ? await resolveAnime4upMegabox(item.url, item.referer || pageUrl, provider, timeoutMs)
      : await resolveNestedPlaybackLinks([item], provider, timeoutMs);

    for (const source of sources) {
      if (seenUrls.has(source.url)) continue;
      seenUrls.add(source.url);
      all.push(source);
    }
  }

  return all.sort((a, b) => qualityValue(b.quality) - qualityValue(a.quality));
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

function resolveCimaClubEpisodeUrl(
  html: string,
  pageUrl: string,
  season?: number,
  episode?: number,
): string | null {
  if (episode === undefined) return null;

  const candidates: Array<{ url: string; season?: number; score: number }> = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = match[0];
    const href = decodeHtml(match[1]);
    const url = absolute(pageUrl, href);
    if (!url || seen.has(url)) continue;

    const epnumBlock = tag.match(/<[^>]*class=["'][^"']*\bepnum\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] || '';
    const epOwnText = stripTags(epnumBlock).trim();
    const number =
      normalizeNumber(epOwnText.match(/[0-9٠-٩]{1,3}/)?.[0]) ??
      parseSeasonEpisode([href, tag].join(' ')).episode ??
      normalizeNumber(
        stripTags(tag).match(/(?:episode|الحلقة|حلقه|حلقة)[^0-9٠-٩]*([0-9٠-٩]+)/i)?.[1],
      );

    if (number !== episode) continue;

    const identity = parseSeasonEpisode([href, tag].join(' '));
    const explicitSeason =
      identity.season ??
      normalizeNumber(
        stripTags(tag).match(/(?:الموسم|season|الجزء|part)[^0-9٠-٩]*([0-9٠-٩]+)/i)?.[1],
      );

    if (season !== undefined && explicitSeason !== undefined && explicitSeason !== season) continue;

    let score = 100;
    if (/section[^>]*allepcont|allepcont/i.test(tag)) score += 100;
    if (/epnum/i.test(tag)) score += 100;
    if (season !== undefined && explicitSeason === season) score += 80;
    if (/(?:الحلقة|episode)/i.test(href + ' ' + stripTags(tag))) score += 30;

    candidates.push({ url, season: explicitSeason, score });
    seen.add(url);
  }

  return candidates.sort((a, b) => b.score - a.score)[0]?.url || null;
}

async function resolveCimaClubSources(
  targetUrl: string,
  provider: SiteConfig,
  timeoutMs: number,
): Promise<Candidate[]> {
  const html = await postText(targetUrl, timeoutMs, targetUrl);
  const links: Array<{ url: string; quality?: string; referer?: string }> = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/<li\b[^>]*\bdata-watch=["']([^"']+)["'][^>]*>/gi)) {
    const url = absolute(targetUrl, match[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, quality: qualityFromText(match[0], url) || 'source', referer: targetUrl });
  }

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const tag = match[0];
    if (!/ServersList[^>]*Download|Download[^>]*ServersList/i.test(tag)) continue;
    const url = absolute(targetUrl, match[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, quality: qualityFromText(tag, url) || 'source', referer: targetUrl });
  }

  return resolveNestedPlaybackLinks(links.slice(0, 10), provider, timeoutMs);
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

      if (context.episodeNumber !== undefined) {
        const seasonPart = context.seasonNumber !== undefined
          ? String(context.seasonNumber).padStart(2, '0')
          : '01';
        const episodePart = String(context.episodeNumber).padStart(2, '0');
        variants.push(`${clean} S${seasonPart}E${episodePart}`);
        variants.push(`${clean} ${seasonPart}x${episodePart}`);
        variants.push(`${clean} الحلقة ${context.episodeNumber}`);
      }

      return variants;
    }),
  )];

  if (!searchTerms.length) return [];

  if (provider.key === 'anime3rb' && context.episodeNumber !== undefined) {
    const canonicalSources = await resolveCanonicalAnime3rbEpisode(
      searchTerms,
      context,
      provider,
      timeoutMs,
    );
    if (canonicalSources.length) return canonicalSources;
  }

  const searchJobs = searchTerms
    .slice(0, 2)
    .flatMap((term) =>
      provider.searchUrls(encodeURIComponent(term)).map((searchUrl) => ({ searchUrl })),
    );

  const searchResponses = await Promise.allSettled(
    searchJobs.map(({ searchUrl }) => getText(searchUrl, timeoutMs, provider.base)),
  );

  const searchResults: SearchHit[] = [];
  for (const result of searchResponses) {
    if (result.status !== 'fulfilled') continue;
    const html = result.value;
    if (provider.key === 'aflaam') {
      searchResults.push(...parseAflamSearchHits(html, provider.base));
      // Episode searches can return direct episode cards whose markup differs
      // from the movie/series result template. Keep the generic parser as a
      // second lane only for episode requests so those exact links are not
      // discarded before season/episode matching.
      if (context.episodeNumber !== undefined) {
        searchResults.push(...parseSearchHits(html, provider.base, true));
        searchResults.push(...parseMarkdownLinks(html, provider.base));
      }
    } else if (provider.key === 'anime3rb') {
      searchResults.push(...parseSearchHits(html, provider.base, context.episodeNumber !== undefined));
      searchResults.push(...parseMarkdownLinks(html, provider.base));
    } else if (provider.key === 'anime4up') {
      searchResults.push(...parseSearchHits(html, provider.base, context.episodeNumber !== undefined));
      searchResults.push(...parseMarkdownLinks(html, provider.base));
    } else {
      searchResults.push(...parseSearchHits(html, provider.base, context.episodeNumber !== undefined));
      searchResults.push(...parseMarkdownLinks(html, provider.base));
    }
  }

  let hits = rankHits(searchResults, searchTerms, context.releaseYear, context.seasonNumber);

  // Match the actual Re-3Arabi Aflam flow first: search the series, open its
  // detail page, then resolve the requested episode link from that page.
  // The sitemap is an expensive fallback only when ordinary search finds nothing.
  if (!hits.length && provider.key === 'aflaam') {
    const sitemapHits = await resolveAflamSitemapSearch(
      searchTerms,
      context,
      provider,
      Math.min(timeoutMs, 3_500),
    );
    hits = rankHits(sitemapHits, searchTerms, context.releaseYear, context.seasonNumber);
  }

  if (!hits.length) return [];

  for (const hit of hits) {
    try {
      const detail = await getText(hit.url, timeoutMs, provider.base);
      let targetUrl = hit.url;

      if (context.episodeNumber !== undefined) {
        const hitIdentity = parseSeasonEpisode([hit.url, hit.title].join(' '));

        // Never resolve an explicitly different episode page as the requested one.
        if (
          hitIdentity.episode !== undefined &&
          hitIdentity.episode !== context.episodeNumber
        ) {
          continue;
        }

        const explicitEpisode =
          hitIdentity.episode === context.episodeNumber &&
          (
            context.seasonNumber === undefined ||
            hitIdentity.season === context.seasonNumber ||
            (context.seasonNumber === 1 && hitIdentity.season === undefined)
          );

        if (!explicitEpisode) {
          if (provider.key === 'aflaam') {
            targetUrl = resolveAflamEpisodeUrl(
              detail,
              hit.url,
              context.seasonNumber,
              context.episodeNumber,
            ) || findEpisodeUrl(
              detail,
              hit.url,
              context.seasonNumber,
              context.episodeNumber,
            ) || '';
          } else if (provider.key === 'cimaclub') {
            targetUrl = resolveCimaClubEpisodeUrl(
              detail,
              hit.url,
              context.seasonNumber,
              context.episodeNumber,
            ) || findEpisodeUrl(
              detail,
              hit.url,
              context.seasonNumber,
              context.episodeNumber,
            ) || '';
          } else {
            targetUrl = findEpisodeUrl(
              detail,
              hit.url,
              context.seasonNumber,
              context.episodeNumber,
            ) || '';
          }
        }

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
          const firstEpisode = extractEpisodeCandidates(detail, hit.url)[0];
          if (firstEpisode?.url) {
            try {
              const episodePage = await getText(firstEpisode.url, timeoutMs, hit.url);
              targetUrl =
                findEpisodeUrl(
                  episodePage,
                  firstEpisode.url,
                  context.seasonNumber,
                  context.episodeNumber,
                ) ||
                (firstEpisode.number === context.episodeNumber ? firstEpisode.url : '');
            } catch {}
          }
        }
      }

      if (!targetUrl) continue;

      let sources: Candidate[] = [];
      if (provider.key === 'aflaam') {
        const sourcePageHtml =
          targetUrl === hit.url
            ? detail
            : await getText(targetUrl, timeoutMs, hit.url);
        sources = await resolveAflamQualitySources(
          sourcePageHtml,
          targetUrl,
          provider,
          timeoutMs,
        );
        if (!sources.length) {
          sources = parseQualitySources(sourcePageHtml, targetUrl, provider);
        }
      } else if (provider.key === 'cimaclub') {
        sources = await resolveCimaClubSources(targetUrl, provider, timeoutMs);
      } else if (provider.key === 'anime4up') {
        const watchHtml =
          targetUrl === hit.url
            ? detail
            : await getText(targetUrl, timeoutMs, hit.url);
        sources = await resolveAnime4upSources(watchHtml, targetUrl, provider);
      } else {
        const watchHtml =
          targetUrl === hit.url
            ? detail
            : await getText(targetUrl, timeoutMs, hit.url);
        sources = parseQualitySources(watchHtml, targetUrl, provider);
      }

      sources = (sources || []).filter((source) =>
        PLAYABLE_TYPES.has(source.type) &&
        source.quality !== 'auto',
      );

      if (
        sources.length &&
        context.episodeNumber !== undefined &&
        context.seasonNumber !== undefined
      ) {
        const tagged = sources.filter((source) => {
          const identities = [source.url || '', source.sourceUrl || '']
            .map(parseSeasonEpisode)
            .filter(
              (identity) =>
                identity.season !== undefined ||
                identity.episode !== undefined,
            );

          if (!identities.length) return true;

          return identities.some(
            (identity) =>
              identity.season === context.seasonNumber &&
              identity.episode === context.episodeNumber,
          );
        });

        if (tagged.length) return tagged;
        continue;
      }

      if (sources.length) return sources;
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
  const providerBudgetMs = Math.min(Math.max(timeoutMs + 3_000, 15_000), 22_000);
  const groups = await Promise.all(
    providers.map(async (provider) => {
      try {
        const sources = await withTimeout(
          resolveProvider(provider, context, Math.min(timeoutMs, 18_000)),
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
  // animated western titles continue through Aflam.
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
  const timeoutMs = Math.max(5_000, Number(process.env.RE3ARABI_TIMEOUT_MS || 15_000));

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
  const context = await resolveContext(request);
  const provider = PROVIDERS.find((item) => item.key === providerKey.toLowerCase());
  if (!provider) return [];

  const timeoutMs = Math.max(5_000, Number(process.env.RE3ARABI_TIMEOUT_MS || 15_000));
  return withTimeout(
    resolveProvider(provider, context, timeoutMs),
    Math.min(timeoutMs + 12_000, 20_000),
    `Provider ${providerKey} exceeded resolver budget`,
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

  const provider = PROVIDERS.find((item) => item.key === providerKey.toLowerCase());
  if (!provider) return [];

  const timeoutMs = Math.max(5_000, Number(process.env.RE3ARABI_TIMEOUT_MS || 15_000));
  return withTimeout(
    resolveProvider(provider, resolvedContext, timeoutMs),
    Math.min(timeoutMs + 12_000, 20_000),
    `Provider ${providerKey} exceeded resolver budget`,
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

  const timeoutMs = Math.max(5_000, Number(process.env.RE3ARABI_TIMEOUT_MS || 15_000));
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

  const timeoutMs = Math.max(5_000, Number(process.env.RE3ARABI_TIMEOUT_MS || 15_000));
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
    name: 'Aflam / CimaClub / Anime4Up',
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

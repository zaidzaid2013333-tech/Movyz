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

const CACHE_TTL_MS = 20_000;
const cache = new Map<string, { expiresAt: number; promise: Promise<Candidate[]> }>();

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
    base: 'https://cimacub.com',
    kind: 'general',
    searchUrls: (q) => [
      `https://cimacub.com/?s=${q}`,
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
    base: 'https://w1.anime4up.rest',
    kind: 'anime',
    searchUrls: (q) => [
      `https://w1.anime4up.rest/?s=${q}`,
      `https://w1.anime4up.rest/search?q=${q}`,
    ],
  },
] as const;

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

function extractYear(value: string) {
  const match = value.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function qualityValue(quality: string) {
  const match = quality.match(/(2160|1440|1080|720|576|480|360|240)/);
  return match ? Number(match[1]) : 0;
}

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
  const payload = await fetchJsonOrText(url, timeoutMs, {
    Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8',
    'Accept-Language': 'ar,en;q=0.9',
    Referer: referer || url,
    'User-Agent': 'Mozilla/5.0 (compatible; Movyz/1.0; +https://movyza.app)',
  });
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
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

function parseSearchHits(html: string, base: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html))) {
    const url = absolute(base, match[1]);
    const windowHtml = html.slice(match.index, Math.min(html.length, match.index + 2600));
    const title = stripTags(match[2]) ||
      stripTags(/<h3\\b[^>]*class=["'][^"']*\\bentry-title\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/h3>/i.exec(windowHtml)?.[1] || '') ||
      stripTags(/<h2\\b[^>]*>([\\s\\S]*?)<\\/h2>/i.exec(windowHtml)?.[1] || '');
    if (!url || !title || isNavigationLink(url, title) || seen.has(url)) continue;
    if (isLikelyEpisodeLink(url, title)) continue;
    seen.add(url);
    hits.push({ title, url, year: extractYear(title) });
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
  const qualityMatch =
    hint.match(/(?:^|[^0-9])(2160|1440|1080|720|576|480|360|240)(?:p)?(?:\b|[^0-9]|$)/i) ||
    rawUrl.match(/(?:^|[^0-9])(2160|1440|1080|720|576|480|360|240)p(?:\b|[^0-9]|$)/i);
  const quality = qualityMatch ? `${qualityMatch[1]}p` : 'auto';

  if (/\.m3u8(?:[?#]|$)/i.test(value)) return { type: 'hls', quality };
  if (/\.(?:mp4|m4v)(?:[?#]|$)/i.test(value)) return { type: 'mp4', quality };
  if (/\.(?:webm)(?:[?#]|$)/i.test(value)) return { type: 'webm', quality };
  if (/\.mpd(?:[?#]|$)/i.test(value)) return { type: 'dash', quality };
  if (/\.(?:m4v|mov|mkv|avi|mpeg|mpg|ogg|ogv|ts|m2ts|flv|3gp|3g2)(?:[?#]|$)/i.test(value)) return { type: 'direct', quality };

  // Cloudstream's four selected sites frequently expose their playable servers
  // as external watch/embed URLs. Keep those URLs external rather than proxying
  // their bytes through Movyz.
  if (/\/embed(?:\/|$)|\/watch(?:\/|$)|\/e\/|player|stream|megabox|share4max|data-watch/i.test(value)) {
    return { type: 'embed', quality };
  }

  return allowGenericDirect ? { type: 'direct', quality } : null;
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
      label: `${provider.name} ${classified.quality === 'auto' ? 'Auto' : classified.quality}`,
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

async function resolveAflamQualitySources(
  html: string,
  pageUrl: string,
  provider: SiteConfig,
  timeoutMs: number,
): Promise<Candidate[]> {
  const watchUrls: string[] = [];
  const anchorRe = /<a\b[^>]*>/gi;
  for (const match of html.matchAll(anchorRe)) {
    const tag = match[0];
    const classValue =
      /\bclass=["']([^"']*)["']/i.exec(tag)?.[1] ||
      /\bclass=([^\s>]+)/i.exec(tag)?.[1] ||
      '';
    if (!/\blink-show\b/i.test(classValue)) continue;
    const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1] ||
      /\bhref=([^\s>]+)/i.exec(tag)?.[1] ||
      '';
    const url = absolute(pageUrl, href);
    if (url) watchUrls.push(url);
  }

  const results: Candidate[] = [];
  for (const watchUrl of watchUrls.slice(0, 8)) {
    try {
      const watchHtml = await getText(watchUrl, timeoutMs, pageUrl);
      const sourceMatches = [...watchHtml.matchAll(/<source\b[^>]*src=["']([^"']+)["'][^>]*>/gi)];
      for (const match of sourceMatches) {
        const url = absolute(watchUrl, match[1]);
        if (!url) continue;
        const hint = /\bsize=["']([^"']+)["']/i.exec(match[0])?.[1] || '';
        const classified = classifyUrl(url, hint, true);
        if (!classified) continue;
        results.push({
          provider: provider.name,
          providerKey: provider.key,
          type: classified.type,
          url,
          providerReference: provider.key,
          quality: classified.quality,
          language: 'ar',
          label: `${provider.name} ${classified.quality === 'auto' ? 'Auto' : classified.quality}`,
          expiresAt: undefined,
          sourceUrl: watchUrl,
        });
      }
    } catch {}
    if (results.length) break;
  }
  return results;
}

async function resolveCimaClubSources(
  targetUrl: string,
  provider: SiteConfig,
  timeoutMs: number,
): Promise<Candidate[]> {
  const html = await postText(targetUrl, timeoutMs, targetUrl);
  const results: Candidate[] = [];
  const seen = new Set<string>();

  const add = (rawUrl: string, type: 'embed' | 'direct' = 'embed') => {
    const url = absolute(targetUrl, rawUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    results.push({
      provider: provider.name,
      providerKey: provider.key,
      type: type === 'direct'
        ? (classifyUrl(url, '', true)?.type || 'direct')
        : 'embed',
      url,
      providerReference: provider.key,
      quality: 'auto',
      language: 'ar',
      label: `${provider.name} Auto`,
      expiresAt: undefined,
      sourceUrl: targetUrl,
    });
  };

  for (const match of html.matchAll(/<li\\b[^>]*data-watch=["']([^"']+)["'][^>]*>/gi)) add(match[1], 'embed');
  for (const match of html.matchAll(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const tag = match[0];
    if (/ServersList|Download|download/i.test(tag)) add(match[1], 'embed');
  }
  return results;
}

function extractEpisodeCandidates(html: string, baseUrl: string) {
  const items: Array<{ url: string; number?: number; text: string }> = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html))) {
    const rawHref = decodeHtml(match[1]);
    const text = stripTags(match[2]);
    const url = absolute(baseUrl, rawHref);
    if (!url || seen.has(url) || isNavigationLink(url, text)) continue;

    const numberMatch =
      text.match(/(?:episode|ep|الحلقة|حلقه)[^0-9]*(\d+)/i) ||
      rawHref.match(/(?:episode|ep)[^0-9]*(\d+)/i) ||
      rawHref.match(/s\d+e(\d+)/i);

    if (!isLikelyEpisodeLink(rawHref, text) && !numberMatch) continue;
    seen.add(url);
    items.push({
      url,
      number: numberMatch ? Number(numberMatch[1]) : undefined,
      text,
    });
  }

  // Anime4Up also exposes episodes in a dedicated list.
  const liRe = /<li\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/li>/gi;
  while ((match = liRe.exec(html))) {
    const url = absolute(baseUrl, match[1]);
    const text = stripTags(match[2]);
    if (!url || seen.has(url)) continue;
    const n = text.match(/(?:episode|ep|الحلقة|حلقه)[^0-9]*(\d+)/i)?.[1];
    if (!n) continue;
    seen.add(url);
    items.push({ url, number: Number(n), text });
  }

  return items;
}

function findEpisodeUrl(html: string, pageUrl: string, season?: number, episode?: number) {
  if (episode === undefined) return null;

  const items = extractEpisodeCandidates(html, pageUrl);
  const exact = items.find((item) => item.number === episode);
  if (exact) return exact.url;

  const seasonPattern = season !== undefined
    ? new RegExp(`(?:season|الموسم|s)\\s*${season}\\b`, 'i')
    : null;

  const byText = items.find((item) =>
    normalize(item.text).includes(normalize(`الحلقة ${episode}`)) ||
    (seasonPattern ? seasonPattern.test(item.text) && String(item.number || '').includes(String(episode)) : false),
  );
  return byText?.url || null;
}

async function resolveProvider(
  provider: SiteConfig,
  context: ProviderContext,
  timeoutMs: number,
): Promise<Candidate[]> {
  const titles = [...new Set([
    context.title,
    context.originalTitle,
    ...(context.alternateTitles || []),
  ].filter((x): x is string => !!x?.trim()).map((x) => x.trim()))];

  if (!titles.length) return [];

  // Search each known title through the site's supported URL shapes.
  const searchResults: SearchHit[] = [];
  for (const term of titles.slice(0, 3)) {
    const q = encodeURIComponent(term);
    for (const searchUrl of provider.searchUrls(q)) {
      try {
        const html = await getText(searchUrl, timeoutMs, provider.base);
        searchResults.push(...parseSearchHits(html, provider.base));
      } catch {
        // Try the next route/domain variant.
      }
    }
  }

  const hits = rankHits(searchResults, titles, context.releaseYear);
  if (!hits.length) return [];

  for (const hit of hits) {
    try {
      const detail = await getText(hit.url, timeoutMs, provider.base);
      let targetUrl = hit.url;

      if (context.episodeNumber !== undefined) {
        targetUrl = findEpisodeUrl(detail, hit.url, context.seasonNumber, context.episodeNumber) || '';
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
      } else {
        const watchHtml = targetUrl === hit.url
          ? detail
          : await getText(targetUrl, timeoutMs, hit.url);
        sources = parseQualitySources(watchHtml, targetUrl, provider);
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

  // Run the two providers in parallel. We still publish only one chosen
  // provider group, so the player never mixes servers from different sites.
  const groups = await Promise.all(
    providers.map(async (provider) => {
      try {
        const sources = await resolveProvider(provider, context, timeoutMs);
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
    throw new Error(`No ${eligibleKind} playback source returned by Aflam/CimaClub or Anime3rb/Anime4Up`);
  }

  return usable[0].sources
    .sort((a, b) => {
      const qualityDiff = qualityValue(b.quality) - qualityValue(a.quality);
      if (qualityDiff) return qualityDiff;
      return a.type === 'embed' ? 1 : -1;
    })
    .filter((source, index, all) =>
      all.findIndex((item) => item.quality === source.quality && item.url === source.url) === index,
    );
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

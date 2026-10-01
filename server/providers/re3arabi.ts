import { fetchJsonOrText, inferPlaybackType, inferQuality } from './http';
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

type Candidate = NormalizedPlaybackSource & {
  providerKey: string;
  sourceUrl: string;
};

const CACHE_TTL_MS = 20_000;
const cache = new Map<string, { expiresAt: number; promise: Promise<Candidate[]> }>();

const PROVIDERS = [
  {
    key: 'akwam',
    name: 'Akwam',
    base: 'https://ak.sv',
    kind: 'akwam' as const,
  },
  {
    key: 'aflaam',
    name: 'Aflaam',
    base: 'https://aflaam.com',
    kind: 'aflaam' as const,
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
    const url = new URL(raw.trim(), base);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x27;/gi, "'");
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

async function getText(url: string, timeoutMs: number, referer?: string) {
  const payload = await fetchJsonOrText(url, timeoutMs, {
    Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8',
    'Accept-Language': 'ar,en;q=0.8',
    Referer: referer || url,
    'User-Agent': 'Movyz-Re3Arabi/1.0',
  });
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
}

function parseAkwamSearch(html: string, base: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const re = /<h3[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const url = absolute(base, decodeHtml(match[1]));
    const title = stripTags(match[2]);
    if (url && title) hits.push({ title, url, year: extractYear(title) });
  }
  return hits;
}

function parseAflaamSearch(html: string, base: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const itemRe = /<div[^>]*class=["'][^"']*\\bitem\\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?=<div|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(html))) {
    const block = match[1];
    const link = /<a[^>]*class=["'][^"']*box[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(block)
      || /<a[^>]*href=["']([^"']+)["']/i.exec(block);
    const titleMatch = /<h3[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i.exec(block);
    if (!link || !titleMatch) continue;
    const url = absolute(base, decodeHtml(link[1]));
    const title = stripTags(titleMatch[1]);
    if (url && title) hits.push({ title, url, year: extractYear(block) });
  }

  if (hits.length) return hits;

  const fallbackRe = /<h3[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = fallbackRe.exec(html))) {
    const url = absolute(base, decodeHtml(match[1]));
    const title = stripTags(match[2]);
    if (url && title) hits.push({ title, url, year: extractYear(title) });
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
      const yearMatch = year !== undefined && hit.year === year;
      const score = (exact ? 500 : partial ? 220 : 0) + (yearMatch ? 90 : 0) - index;
      return { hit, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.hit)
    .slice(0, 5);
}

function parseQualitySources(html: string, pageUrl: string, provider: string): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const add = (rawUrl: string, qualityHint: string, reference: string) => {
    const url = absolute(pageUrl, decodeHtml(rawUrl));
    if (!url || seen.has(url)) return;

    const type = inferPlaybackType(url, undefined);
    if (!type) return;

    const qualityMatch = (qualityHint || '').match(/(?:^|[^0-9])(2160|1440|1080|720|576|480|360|240)(?:p)?(?:\\b|[^0-9]|$)/i)
      || url.match(/(?:^|[^0-9])(2160|1440|1080|720|576|480|360|240)p(?:\\b|[^0-9]|$)/i);
    const quality = qualityMatch ? `${qualityMatch[1]}p` : 'auto';
    seen.add(url);
    candidates.push({
      provider,
      providerKey: provider.toLowerCase(),
      type,
      url,
      sourceUrl: reference,
      quality,
      language: 'ar',
      label: `${provider} ${quality === 'auto' ? 'Auto' : quality}`,
      expiresAt: undefined,
    });
  };

  const sourceRe = /<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = sourceRe.exec(html))) {
    const tag = match[0];
    const size = /\b(?:size|label|data-quality)=["']([^"']+)["']/i.exec(tag)?.[1] || '';
    add(match[1], size, pageUrl);
  }

  const videoRe = /<video\b[\s\S]*?<\/video>/gi;
  while ((match = videoRe.exec(html))) {
    const video = match[0];
    const src = /\bsrc=["']([^"']+)["']/i.exec(video)?.[1];
    if (src) add(src, /\b(?:size|label)=["']([^"']+)["']/i.exec(video)?.[1] || '', pageUrl);
  }

  return candidates;
}

async function resolveAkwam(
  context: ProviderContext,
  timeoutMs: number,
): Promise<Candidate[]> {
  const titleTerms = [...new Set([
    context.title,
    context.originalTitle,
    ...(context.alternateTitles || []),
  ].filter((x): x is string => !!x?.trim()).map((x) => x.trim()))];
  if (!titleTerms.length) return [];

  const searches = await Promise.all(titleTerms.slice(0, 2).map(async (term) => {
    const query = encodeURIComponent(term);
    const html = await getText(`https://ak.sv/search?q=${query}`, timeoutMs);
    return parseAkwamSearch(html, 'https://ak.sv');
  }));
  const hit = rankHits(searches.flat(), titleTerms, context.releaseYear)[0];
  if (!hit) return [];

  const contentHtml = await getText(hit.url, timeoutMs, 'https://ak.sv/');
  let targetUrl = hit.url;

  if (context.seasonNumber !== undefined && context.episodeNumber !== undefined) {
    const collectEpisodes = (html: string, baseUrl: string) => {
      const episodeLinks: Array<{ url: string; number?: number; text: string }> = [];
      const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html))) {
        const rawHref = decodeHtml(m[1]);
        const text = stripTags(m[2]);
        if (!/episode|الحلقة|ep/i.test(rawHref) && !/episode|الحلقة|ep/i.test(text)) continue;
        const url = absolute(baseUrl, rawHref);
        if (!url) continue;
        const tagEnd = html.slice(Math.max(0, m.index), Math.min(html.length, m.index + m[0].length + 350));
        const numberMatch =
          text.match(/(?:episode|الحلقة|ep)[^0-9]*(\d+)/i)
          || rawHref.match(/(?:episode|ep)[^0-9]*(\d+)/i)
          || tagEnd.match(/data-(?:episode|ep)[^0-9]*=["']?(\d+)/i)
          || rawHref.match(/s\d+e(\d+)/i);
        episodeLinks.push({ url, number: numberMatch ? Number(numberMatch[1]) : undefined, text });
      }
      return episodeLinks;
    };

    let episodeLinks = collectEpisodes(contentHtml, hit.url);

    // Port the Cloudstream provider's season-by-season behavior: choose the
    // requested season page first whenever the site exposes one.
    {
      const seasonLinks: Array<{ url: string; number?: number; text: string }> = [];
      const seasonRe = /<a[^>]+href=["']([^"']*\/series\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let sm: RegExpExecArray | null;
      while ((sm = seasonRe.exec(contentHtml))) {
        const url = absolute(hit.url, decodeHtml(sm[1]));
        const text = stripTags(sm[2]);
        const numberMatch = text.match(/(?:season|الموسم)[^0-9]*(\d+)/i)
          || sm[1].match(/(?:season|series)[^0-9]*(\d+)/i);
        if (url) seasonLinks.push({ url, number: numberMatch ? Number(numberMatch[1]) : undefined, text });
      }
      const seasonHit = seasonLinks.find((item) => item.number === context.seasonNumber)
        || seasonLinks.find((item) => normalize(item.text).includes(normalize(`الموسم ${context.seasonNumber}`)));
      if (seasonHit) {
        try {
          const seasonHtml = await getText(seasonHit.url, timeoutMs, hit.url);
          episodeLinks = collectEpisodes(seasonHtml, seasonHit.url);
        } catch {}
      }
    }

    const exact = episodeLinks.find((item) => item.number === context.episodeNumber);
    const fallback = episodeLinks.find((item) =>
      normalize(item.text).includes(normalize(`الحلقة ${context.episodeNumber}`))
      || item.url.match(new RegExp(`(?:episode|ep)[^0-9]*${context.episodeNumber}(?:\\D|$)`, 'i')),
    );
    targetUrl = (exact || fallback)?.url || '';

    // Last fallback: search the episode number with each known title.
    if (!targetUrl) {
      for (const term of titleTerms.slice(0, 3)) {
        try {
          const html = await getText(
            `https://ak.sv/search?q=${encodeURIComponent(`${term} ${context.episodeNumber}`)}`,
            timeoutMs,
          );
          const candidates = collectEpisodes(html, 'https://ak.sv');
          const match = candidates.find((item) => item.number === context.episodeNumber);
          if (match) {
            targetUrl = match.url;
            break;
          }
        } catch {}
      }
    }

    if (!targetUrl) return [];
  } else {
    const watch = /<a[^>]*class=["'][^"']*link-show[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(contentHtml)
      || /<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*link-show[^"']*["']/i.exec(contentHtml);
    targetUrl = watch ? absolute(hit.url, decodeHtml(watch[1])) || '' : '';
  }

  if (!targetUrl) return [];

  const watchHtml = await getText(targetUrl, timeoutMs, hit.url);
  return parseQualitySources(watchHtml, targetUrl, 'Akwam');
}

async function resolveAflaam(
  context: ProviderContext,
  timeoutMs: number,
): Promise<Candidate[]> {
  const titleTerms = [...new Set([
    context.title,
    context.originalTitle,
    ...(context.alternateTitles || []),
  ].filter((x): x is string => !!x?.trim()).map((x) => x.trim()))];
  if (!titleTerms.length) return [];

  const searches = await Promise.all(titleTerms.slice(0, 2).map(async (term) => {
    const query = encodeURIComponent(term);
    const html = await getText(`https://aflaam.com/search?q=${query}`, timeoutMs);
    return parseAflaamSearch(html, 'https://aflaam.com');
  }));
  const hit = rankHits(searches.flat(), titleTerms, context.releaseYear)[0];
  if (!hit) return [];

  const detail = await getText(hit.url, timeoutMs, 'https://aflaam.com/');
  let targetUrl = hit.url;

  if (context.episodeNumber !== undefined) {
    const episodeLinks: Array<{ url: string; number?: number; text: string }> = [];
    const re = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(detail))) {
      const text = stripTags(m[2]);
      if (!/episode|الحلقة/i.test(text) && !/episode|الحلقة/i.test(m[1])) continue;
      const url = absolute(hit.url, decodeHtml(m[1]));
      if (!url) continue;
      const n = (text.match(/(?:episode|الحلقة)[^0-9]*(\d+)/i) || m[1].match(/episode[^0-9]*(\d+)/i))?.[1];
      episodeLinks.push({ url, number: n ? Number(n) : undefined, text });
    }
    targetUrl = episodeLinks.find((x) => x.number === context.episodeNumber)?.url || '';
    if (!targetUrl) return [];
  } else {
    const quality = /<div[^>]*class=["'][^"']*qualities[^"']*["'][^>]*>[\s\S]*?<a[^>]*class=["'][^"']*link-show[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(detail);
    targetUrl = quality ? absolute(hit.url, decodeHtml(quality[1])) || '' : '';
  }

  if (!targetUrl) return [];

  const watchHtml = await getText(targetUrl, timeoutMs, hit.url);
  return parseQualitySources(watchHtml, targetUrl, 'Aflaam');
}

function groupScore(sources: Candidate[]) {
  const distinctQualities = new Set(sources.map((source) => source.quality));
  const maxQuality = Math.max(0, ...sources.map((source) => qualityValue(source.quality)));
  const directCount = sources.filter((source) => source.type === 'mp4').length;
  const adaptiveCount = sources.filter((source) => source.type === 'hls' || source.type === 'dash').length;
  return (distinctQualities.size * 500) + (maxQuality * 2) + (directCount * 80) + (adaptiveCount * 60);
}

async function resolveUncached(context: ProviderContext, timeoutMs: number) {
  const groups = await Promise.all(
    PROVIDERS.map(async (provider) => {
      try {
        const sources = provider.kind === 'akwam'
          ? await resolveAkwam(context, timeoutMs)
          : await resolveAflaam(context, timeoutMs);
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
    throw new Error('re-3arabi providers returned no direct playback sources');
  }

  const selected = usable[0].sources
    .sort((a, b) => qualityValue(b.quality) - qualityValue(a.quality))
    .filter((source, index, all) => all.findIndex((item) => item.quality === source.quality && item.url === source.url) === index);

  return selected;
}

async function resolveContext(request: Re3ArabiPlaybackRequest): Promise<ProviderContext> {
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

  return {
    tmdbId: request.tmdbId,
    title: typeof title === 'string' ? title : undefined,
    originalTitle: typeof originalTitle === 'string' ? originalTitle : undefined,
    alternateTitles: typeof arabicTitle === 'string' ? [arabicTitle] : [],
    releaseYear: typeof date === 'string' && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined,
    seasonNumber: request.season,
    episodeNumber: request.episode,
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
    name: 're-3arabi',
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
      try {
        await getText('https://ak.sv/', 3_000);
        return { status: 'healthy' as const, latencyMs: Date.now() - started };
      } catch (error) {
        return {
          status: 'offline' as const,
          latencyMs: Date.now() - started,
          message: error instanceof Error ? error.message : 're-3arabi provider health check failed',
        };
      }
    },
  };
}

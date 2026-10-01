import { extractPlaybackCandidates, fetchJsonOrText, inferPlaybackType, inferQuality } from './http';
import type { WorkerEnvironment } from '../mini-http';

export type RemotePlaybackRequest = {
  type: 'movie' | 'series';
  tmdbId: number;
  season?: number;
  episode?: number;
  episodeTmdbId?: number;
};

export type RemotePlaybackSource = {
  id: string;
  type: 'hls' | 'mp4' | 'dash' | 'web' | 'embed';
  embedUrl?: string;
  quality: string;
  language: string;
  label: string;
  labelEn: string;
  url: string;
  isWorking: boolean;
  provider: string;
  providerKey: string;
  providerReference?: string;
};

async function resolveTmdbTitle(type: 'movie' | 'series', tmdbId: number, timeoutMs: number) {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('TMDB_API_READ_ACCESS_TOKEN is not configured');

  const path = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const response = await fetchJsonOrText(
    `https://api.themoviedb.org/3${path}`,
    timeoutMs,
    { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  );

  if (!response || typeof response !== 'object') throw new Error('TMDB title response is invalid');
  const data = response as Record<string, unknown>;
  const title = type === 'movie' ? data.title : data.name;
  const originalTitle = type === 'movie' ? data.original_title : data.original_name;
  const chosen = typeof title === 'string' && title.trim() ? title.trim() : originalTitle;
  if (typeof chosen !== 'string' || !chosen.trim()) throw new Error(`No title found for TMDB ${tmdbId}`);
  return chosen.trim();
}

function normalizeTitle(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const REMOTE_RESOLVE_CACHE_TTL_MS = 20_000;
const remoteResolveCache = new Map<string, { expiresAt: number; promise: Promise<RemotePlaybackSource[]> }>();

function remoteResolveCacheKey(request: RemotePlaybackRequest) {
  return JSON.stringify([
    request.type,
    request.tmdbId,
    request.season ?? null,
    request.episode ?? null,
    request.episodeTmdbId ?? null,
  ]);
}

// Akwam embed probe follows the provider page before direct media fallback.
const DEFAULT_OMEGATECH_URLS = [
  'https://api.omegatech.app',
  'https://omegatech-api.dixonomega.tech',
] as const;

const URL_KEYS = [
  'url', 'link', 'href', 'pageUrl', 'page_url', 'contentUrl', 'content_url',
  'episodeUrl', 'episode_url', 'watchUrl', 'watch_url', 'watch',
  'playerUrl', 'player_url', 'player',
  'download', 'downloadUrl', 'download_url',
  'downloadLink', 'download_link', 'stream', 'streamUrl', 'stream_url',
  'videoUrl', 'video_url', 'file', 'src',
] as const;

const CONTENT_URL_KEYS = [
  'contentUrl', 'content_url', 'pageUrl', 'page_url', 'detailUrl', 'detail_url',
  'url', 'link', 'href', 'slug',
] as const;

const EPISODE_URL_KEYS = [
  'episodeUrl', 'episode_url', 'watchUrl', 'watch_url', 'watch',
  'playerUrl', 'player_url', 'player', 'url', 'link', 'href', 'pageUrl', 'page_url',
] as const;

function extractUrlsFromText(value: string) {
  const matches = value.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];
  return matches
    .map((url) => url.replace(/[),.;]+$/g, ''))
    .filter(Boolean);
}

function collectUrlStrings(value: unknown, depth = 0): string[] {
  if (depth > 7 || value == null) return [];
  if (typeof value === 'string') return extractUrlsFromText(value);
  if (Array.isArray(value)) return value.flatMap((item) => collectUrlStrings(item, depth + 1));

  const obj = asRecord(value);
  if (!obj) return [];

  const urls: string[] = [];
  for (const key of URL_KEYS) {
    const raw = obj[key];
    if (typeof raw === 'string') urls.push(...extractUrlsFromText(raw));
    else if (Array.isArray(raw)) urls.push(...collectUrlStrings(raw, depth + 1));
  }

  for (const [key, nested] of Object.entries(obj)) {
    if (!URL_KEYS.includes(key as typeof URL_KEYS[number])) {
      urls.push(...collectUrlStrings(nested, depth + 1));
    }
  }

  return [...new Set(urls)];
}

function collectUrlsFromKeys(value: unknown, keys: readonly string[]) {
  const obj = asRecord(value);
  if (!obj) return [];
  const urls: string[] = [];
  for (const key of keys) {
    const raw = obj[key];
    if (typeof raw === 'string') urls.push(...extractUrlsFromText(raw));
    else if (Array.isArray(raw)) urls.push(...collectUrlStrings(raw));
    else if (raw && typeof raw === 'object') urls.push(...collectUrlStrings(raw));
  }
  return [...new Set(urls)];
}

function isLikelyPlaybackUrl(url: string) {
  return /\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(url)
    || /(?:stream|video|play|embed)/i.test(url);
}

function isLikelyPageUrl(url: string) {
  return /^https?:\/\//i.test(url)
    && !/\.(?:jpg|jpeg|png|gif|webp|svg|avif|bmp|ico|m3u8|mp4|mpd|zip|rar|pdf)(?:$|[?#])/i.test(url)
    && !/(?:image|images|poster|thumbnail|thumb|logo|avatar|icon)/i.test(url);
}

function pickContentUrl(payload: unknown, fallback: string[] = []) {
  const preferred = [
    ...collectUrlsFromKeys(payload, CONTENT_URL_KEYS),
    ...fallback.filter(isLikelyPageUrl),
    ...fallback,
  ];
  return [...new Set(preferred)].find((url) => isLikelyPageUrl(url)) || [...new Set(preferred)][0] || null;
}

function collectNamedResults(payload: unknown, depth = 0): Array<{ title: string; urls: string[]; raw: Record<string, unknown> }> {
  if (depth > 6 || payload == null) return [];
  if (Array.isArray(payload)) return payload.flatMap((item) => collectNamedResults(item, depth + 1));

  const obj = asRecord(payload);
  if (!obj) return [];

  const titleValue = obj.title ?? obj.name ?? obj.originalTitle ?? obj.original_title ?? obj.slug;
  const urls = collectUrlStrings(obj);
  const current = typeof titleValue === 'string' && titleValue.trim() && urls.length
    ? [{ title: titleValue.trim(), urls, raw: obj }]
    : [];

  const nested = Object.values(obj)
    .filter((value) => value && typeof value === 'object')
    .flatMap((value) => collectNamedResults(value, depth + 1));

  return [...current, ...nested];
}

type NamedSearchResult = {
  title: string;
  urls: string[];
  raw: Record<string, unknown>;
};

function rankSearchResults(payload: unknown, titles: string[], limit = 8): NamedSearchResult[] {
  const wanted = titles.map(normalizeTitle).filter(Boolean);
  const results = collectNamedResults(payload);

  const score = (item: NamedSearchResult) => {
    const normalized = normalizeTitle(item.title);
    const exact = wanted.some((title) => normalized === title);
    const partial = wanted.some((title) => normalized.includes(title) || title.includes(normalized));
    const contentUrl = pickContentUrl(item.raw, item.urls);
    return (exact ? 100 : partial ? 50 : 0) + (contentUrl ? 10 : 0);
  };

  const seenContentUrls = new Set<string>();
  return results
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item)
    .filter((item) => {
      const contentUrl = pickContentUrl(item.raw, item.urls);
      if (!contentUrl || seenContentUrls.has(contentUrl)) return false;
      seenContentUrls.add(contentUrl);
      return true;
    })
    .slice(0, limit);
}

function inferSeasonFromText(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    .replace(/%20/gi, ' ')
    .replace(/[._-]+/g, ' ')
    .toLowerCase();

  const explicit = [
    /(?:\\b|^)s(\\d{1,3})(?:\\b|e\\d+)/i,
    /\\bseason\\s*0*(\\d{1,3})\\b/i,
    /\\bthe\\s+season\\s*0*(\\d{1,3})\\b/i,
    /الموسم\\s*0*(\\d{1,3})/i,
    /موسم\\s*0*(\\d{1,3})/i,
  ];

  for (const pattern of explicit) {
    const match = text.match(pattern);
    if (match) {
      const number = Number(match[1]);
      if (Number.isInteger(number) && number > 0) return number;
    }
  }

  return undefined;
}

function objectSeason(obj: Record<string, unknown>, inheritedSeason?: number) {
  const seasonValues = [
    obj.seasonNumber, obj.season_number, obj.season, obj.seasonNo, obj.season_no,
  ];
  const explicitSeason = seasonValues
    .map((raw) => Number(raw))
    .find((number) => Number.isInteger(number) && number > 0);
  if (explicitSeason !== undefined) return explicitSeason;

  const textSeason = [
    obj.title, obj.name, obj.slug, obj.url, obj.link, obj.href, obj.episodeUrl,
    obj.episode_url, obj.watchUrl, obj.watch_url,
  ]
    .map(inferSeasonFromText)
    .find((value) => value !== undefined);

  return textSeason ?? inheritedSeason;
}

function pickEpisodeUrl(payload: unknown, episodeNumber: number, seasonNumber?: number) {
  const visit = (value: unknown, depth = 0, inheritedSeason?: number): string | null => {
    if (depth > 9 || value == null) return null;

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1, inheritedSeason);
        if (found) return found;
      }
      return null;
    }

    const obj = asRecord(value);
    if (!obj) return null;

    const effectiveSeason = objectSeason(obj, inheritedSeason);
    const numberValues = [
      obj.episodeNumber, obj.episode_number, obj.episode, obj.number, obj.ep, obj.no,
    ];
    const matchesNumber = numberValues.some((raw) => Number(raw) === episodeNumber);

    let matchesSeason = seasonNumber === undefined;
    if (seasonNumber !== undefined) {
      matchesSeason = effectiveSeason === seasonNumber;
    }

    if (matchesNumber && matchesSeason) {
      const urls = [
        ...collectUrlsFromKeys(obj, EPISODE_URL_KEYS),
        ...collectUrlStrings(obj),
      ];
      const episodeUrl = [...new Set(urls)].find((url) => isLikelyPageUrl(url) && !isLikelyPlaybackUrl(url));
      if (episodeUrl) return episodeUrl;
    }

    for (const nested of Object.values(obj)) {
      if (nested && typeof nested === 'object') {
        const found = visit(nested, depth + 1, effectiveSeason);
        if (found) return found;
      }
    }
    return null;
  };

  return visit(payload);
}

function collectDownloadOrPlaybackUrls(payload: unknown) {
  const candidates = extractPlaybackCandidates(payload);
  const explicitDownloadUrls = collectUrlsFromKeys(payload, [
    'download', 'downloadUrl', 'download_url', 'downloadLink', 'download_link', 'file',
  ]);
  const urls = [
    ...candidates.map((candidate) => candidate.url),
    ...explicitDownloadUrls,
    ...collectUrlStrings(payload),
  ];

  return [...new Set(urls)].filter((url) =>
    isLikelyPlaybackUrl(url)
    || explicitDownloadUrls.includes(url)
    || /(?:download|downloadurl|download_url|downloadlink|download_link|(?:^|[/_-])dl(?:[/_.?-]|$)|file)/i.test(url),
  );
}

async function omegaRequest(
  base: string,
  params: Record<string, string>,
  timeoutMs: number,
) {
  const url = new URL('/api/movie/Akwam', base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetchJsonOrText(url.toString(), timeoutMs, {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
        Referer: 'https://api.omegatech.app/',
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 700));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function resolveOmegaDownloadUrls(
  base: string,
  payload: unknown,
  timeoutMs: number,
) {
  const candidates = extractPlaybackCandidates(payload);
  const resolved = candidates.map((candidate) => candidate.url).filter(isLikelyPlaybackUrl);

  const allUrls = collectDownloadOrPlaybackUrls(payload);
  const downloadUrls = allUrls.filter((url) => !isLikelyPlaybackUrl(url));

  const downloads = [...new Set(downloadUrls)].slice(0, 6);
  const resolvedBatches = await Promise.all(downloads.map(async (download) => {
    try {
      const resolvePayload = await omegaRequest(base, { action: 'resolve', download }, timeoutMs);
      return [
        ...extractPlaybackCandidates(resolvePayload).map((candidate) => candidate.url),
        ...collectDownloadOrPlaybackUrls(resolvePayload),
      ].filter(isLikelyPlaybackUrl);
    } catch {
      return [];
    }
  }));

  resolved.push(...resolvedBatches.flat());
  return [...new Set(resolved)].slice(0, 6);
}

async function resolveOmegaTechAkwamPlayback(
  request: RemotePlaybackRequest,
  timeoutMs: number,
) {
  const titles = new Set<string>();
  const primaryTitle = await resolveTmdbTitle(request.type, request.tmdbId, timeoutMs);
  titles.add(primaryTitle);

  try {
    const token = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
    if (token) {
      const path = request.type === 'movie' ? `/movie/${request.tmdbId}` : `/tv/${request.tmdbId}`;
      const payload = await fetchJsonOrText(
        `https://api.themoviedb.org/3${path}`,
        timeoutMs,
        { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      );
      const data = asRecord(payload);
      if (data) {
        const original = request.type === 'movie' ? data.original_title : data.original_name;
        if (typeof original === 'string' && original.trim()) titles.add(original.trim());
      }
    }
  } catch {
    // Primary TMDB title is enough to continue.
  }

  let lastError = 'OmegaTech Akwam returned no playback source';
  const baseErrors: string[] = [];
  for (const base of DEFAULT_OMEGATECH_URLS) {
    try {
      const searchResults: NamedSearchResult[] = [];
      let lastSearchError = '';

      const searchQueries = new Set<string>(titles);
      if (request.type === 'series' && request.season !== undefined) {
        for (const title of titles) {
          searchQueries.add(`${title} Season ${request.season}`);
          searchQueries.add(`${title} S${String(request.season).padStart(2, '0')}`);
          searchQueries.add(`${title} الموسم ${request.season}`);
        }
      }

      for (const title of searchQueries) {
        try {
          const searchPayload = await omegaRequest(base, { action: 'search', query: title }, timeoutMs);
          searchResults.push(...rankSearchResults(searchPayload, [title, primaryTitle], 8));
        } catch (error) {
          lastSearchError = error instanceof Error ? error.message : String(error);
        }
      }

      if (!searchResults.length) {
        throw new Error(lastSearchError || 'OmegaTech Akwam search returned no candidates');
      }

      const rankedResults = rankSearchResults(
        searchResults.map((item) => item.raw),
        [...titles, primaryTitle],
        8,
      );

      for (const selected of rankedResults) {
        try {
          const contentUrl = pickContentUrl(selected.raw, selected.urls);
          if (!contentUrl) continue;

          if (request.type === 'series' && request.season !== undefined) {
            const declaredSeason = [
              selected.title,
              ...selected.urls,
              ...collectUrlsFromKeys(selected.raw, CONTENT_URL_KEYS),
            ]
              .map(inferSeasonFromText)
              .find((value) => value !== undefined);

            if (declaredSeason !== undefined && declaredSeason !== request.season) {
              continue;
            }
          }

          let targetPayload: unknown;
          if (request.type === 'series') {
            const episodeNumber = request.episode;
            if (typeof episodeNumber !== 'number' || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
              throw new Error('OmegaTech Akwam series playback requires episode');
            }

            const contentPayload = await omegaRequest(base, { action: 'content', url: contentUrl }, timeoutMs);
            const episodeUrl = pickEpisodeUrl(contentPayload, episodeNumber, request.season);
            if (!episodeUrl) throw new Error('OmegaTech Akwam episode not found');

            targetPayload = await omegaRequest(base, { action: 'episode', episode: episodeUrl }, timeoutMs);
          } else {
            targetPayload = await omegaRequest(base, { action: 'content', url: contentUrl }, timeoutMs);
          }

          let urls = await resolveOmegaDownloadUrls(base, targetPayload, timeoutMs);
          if (!urls.length) {
            urls = await resolveOmegaDownloadUrls(base, selected.raw, timeoutMs);
          }
          if (!urls.length) throw new Error('OmegaTech Akwam returned no direct playback URL');

          return urls.map((url, index) => ({
            url,
            type: inferPlaybackType(url, 'mp4') || 'web',
            quality: inferQuality(url, url),
            language: 'ar',
            label: `OmegaTech Akwam ${inferQuality(url, url) || index + 1}`,
            providerReference: contentUrl,
          }));
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      throw new Error(lastError || 'OmegaTech Akwam returned no playback source');
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      baseErrors.push(`${base}: ${lastError}`);
    }
  }

  throw new Error(baseErrors.length ? baseErrors.join(' | ') : lastError);
}

export async function resolveRemotePlayback(
  request: RemotePlaybackRequest,
  env?: WorkerEnvironment,
): Promise<RemotePlaybackSource[]> {
  const cacheKey = remoteResolveCacheKey(request);
  const now = Date.now();
  const cached = remoteResolveCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = resolveRemotePlaybackUncached(request, env);
  remoteResolveCache.set(cacheKey, { expiresAt: now + REMOTE_RESOLVE_CACHE_TTL_MS, promise });
  promise.catch(() => {
    const current = remoteResolveCache.get(cacheKey);
    if (current?.promise === promise) remoteResolveCache.delete(cacheKey);
  });
  return promise;
}

async function resolveRemotePlaybackUncached(
  request: RemotePlaybackRequest,
  _env?: WorkerEnvironment,
): Promise<RemotePlaybackSource[]> {
  const timeoutMs = Math.max(4_000, Number(process.env.PLAYBACK_RESOLVER_TIMEOUT_MS || 12_000));
  const errors: string[] = [];
  const candidates: Array<{
    url: string;
    type?: string;
    quality?: string;
    language?: string;
    label?: string;
    providerReference?: string;
  }> = [];

  try {
    candidates.push(...await resolveOmegaTechAkwamPlayback(request, timeoutMs));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (!candidates.length && errors.length) {
    throw new Error(errors.join(' | '));
  }

  const unique = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.url)) unique.set(candidate.url, candidate);
    if (unique.size >= 6) break;
  }

  return [...unique.values()].map((candidate, index) => ({
    id: `remote-${index + 1}-${candidate.providerReference || 'source'}`,
    type: inferPlaybackType(candidate.url, candidate.type) || 'web',
    quality: candidate.quality || 'auto',
    language: candidate.language || 'ar',
    label: candidate.label || 'OmegaTech Akwam',
    labelEn: candidate.label || 'OmegaTech Akwam',
    url: candidate.url,
    isWorking: true,
    provider: 'OmegaTech',
    providerKey: 'omegatech-akwam',
    ...(candidate.providerReference ? { providerReference: candidate.providerReference } : {}),

  }));
}

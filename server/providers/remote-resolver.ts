import { extractPlaybackCandidates, fetchJsonOrText, inferPlaybackType, inferQuality } from './http';

export type RemotePlaybackRequest = {
  type: 'movie' | 'series';
  tmdbId: number;
  season?: number;
  episode?: number;
  episodeTmdbId?: number;
};

export type RemotePlaybackSource = {
  id: string;
  type: 'hls' | 'mp4' | 'dash' | 'web';
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
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}]+/gu, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function resolverTemplates() {
  const configured = [
    process.env.PLAYBACK_RESOLVER_URLS,
    process.env.PLAYBACK_RESOLVER_URL,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  const unique = [...new Set(configured)];
  
  for (const value of unique) {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') {
      throw new Error('PLAYBACK_RESOLVER_URL must use HTTPS');
    }
  }

  return unique;
}

export function buildRemoteResolverUrl(
  request: RemotePlaybackRequest,
  template: string,
) {
  const replacements: Record<string, string> = {
    type: request.type,
    tmdbId: String(request.tmdbId),
    tmdb_id: String(request.tmdbId),
    season: request.season !== undefined ? String(request.season) : '',
    episode: request.episode !== undefined ? String(request.episode) : '',
    episodeTmdbId: request.episodeTmdbId !== undefined ? String(request.episodeTmdbId) : '',
    episode_tmdb_id: request.episodeTmdbId !== undefined ? String(request.episodeTmdbId) : '',
  };

  let resolved = template;
  for (const [key, value] of Object.entries(replacements)) {
    resolved = resolved.replaceAll(`{{${key}}}`, encodeURIComponent(value));
  }

  const url = new URL(resolved);
  if (!template.includes('{{type}}')) url.searchParams.set('type', request.type);
  if (!template.includes('{{tmdbId}}') && !template.includes('{{tmdb_id}}')) {
    url.searchParams.set('tmdb_id', String(request.tmdbId));
  }
  if (request.season !== undefined && !template.includes('{{season}}')) {
    url.searchParams.set('season', String(request.season));
  }
  if (request.episode !== undefined && !template.includes('{{episode}}')) {
    url.searchParams.set('episode', String(request.episode));
  }
  if (
    request.episodeTmdbId !== undefined &&
    !template.includes('{{episodeTmdbId}}') &&
    !template.includes('{{episode_tmdb_id}}')
  ) {
    url.searchParams.set('episode_tmdb_id', String(request.episodeTmdbId));
  }
  return url.toString();
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

const DEFAULT_OMEGATECH_URLS = [
  'https://api.omegatech.app',
  'https://omegatech-api.dixonomega.tech',
] as const;

function collectUrlStrings(value: unknown, depth = 0): string[] {
  if (depth > 6 || value == null) return [];
  if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) return [value.trim()];
  if (Array.isArray(value)) return value.flatMap((item) => collectUrlStrings(item, depth + 1));

  const obj = asRecord(value);
  if (!obj) return [];

  const preferredKeys = [
    'url', 'link', 'href', 'pageUrl', 'page_url', 'contentUrl', 'content_url',
    'episodeUrl', 'episode_url', 'download', 'downloadUrl', 'download_url',
    'downloadLink', 'download_link', 'stream', 'streamUrl', 'stream_url',
    'videoUrl', 'video_url', 'file', 'src',
  ];

  const urls: string[] = [];
  for (const key of preferredKeys) {
    if (typeof obj[key] === 'string' && /^https?:\/\//i.test(obj[key].trim())) {
      urls.push(obj[key].trim());
    }
  }

  for (const [key, nested] of Object.entries(obj)) {
    if (!preferredKeys.includes(key)) urls.push(...collectUrlStrings(nested, depth + 1));
  }
  return [...new Set(urls)];
}

function isLikelyPlaybackUrl(url: string) {
  return /\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(url)
    || /(?:stream|video|play|embed)/i.test(url);
}

function collectNamedResults(payload: unknown, depth = 0): Array<{ title: string; urls: string[]; raw: Record<string, unknown> }> {
  if (depth > 5 || payload == null) return [];
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

function pickBestResult(payload: unknown, titles: string[]) {
  const wanted = titles.map(normalizeTitle).filter(Boolean);
  const results = collectNamedResults(payload);

  const exact = results.find((item) => wanted.includes(normalizeTitle(item.title)));
  if (exact) return exact;

  const partial = results.find((item) => {
    const normalized = normalizeTitle(item.title);
    return wanted.some((title) => normalized.includes(title) || title.includes(normalized));
  });
  return partial || results[0] || null;
}

function pickEpisodeUrl(payload: unknown, episodeNumber: number, seasonNumber?: number) {
  const visit = (value: unknown, depth = 0): string | null => {
    if (depth > 7 || value == null) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    const obj = asRecord(value);
    if (!obj) return null;

    const numberValues = [
      obj.episodeNumber,
      obj.episode_number,
      obj.episode,
      obj.number,
      obj.ep,
      obj.no,
    ];
    const matchesNumber = numberValues.some((raw) => Number(raw) === episodeNumber);
    const seasonValues = [obj.seasonNumber, obj.season_number, obj.season, obj.seasonNo, obj.season_no];
    const hasSeason = seasonNumber !== undefined;
    const matchesSeason = !hasSeason || seasonValues.some((raw) => Number(raw) === seasonNumber);

    if (matchesNumber && matchesSeason) {
      const urls = collectUrlStrings(obj);
      const episodeUrl = urls.find((url) => !isLikelyPlaybackUrl(url));
      if (episodeUrl) return episodeUrl;
    }

    for (const nested of Object.values(obj)) {
      const found = visit(nested, depth + 1);
      if (found) return found;
    }
    return null;
  };

  return visit(payload);
}

function collectDownloadOrPlaybackUrls(payload: unknown) {
  const urls = collectUrlStrings(payload);
  return urls.filter((url) => isLikelyPlaybackUrl(url) || /(?:download|dl|file)/i.test(url));
}

async function omegaRequest(
  base: string,
  params: Record<string, string>,
  timeoutMs: number,
) {
  const url = new URL('/api/movie/Akwam', base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return fetchJsonOrText(url.toString(), timeoutMs);
}

async function resolveOmegaDownloadUrls(
  base: string,
  payload: unknown,
  timeoutMs: number,
) {
  const direct = collectDownloadOrPlaybackUrls(payload);
  const resolved: string[] = direct.filter(isLikelyPlaybackUrl);

  const downloadUrls = direct.filter((url) => !isLikelyPlaybackUrl(url));
  for (const download of [...new Set(downloadUrls)].slice(0, 3)) {
    try {
      const resolvePayload = await omegaRequest(base, { action: 'resolve', download }, timeoutMs);
      resolved.push(...collectDownloadOrPlaybackUrls(resolvePayload).filter(isLikelyPlaybackUrl));
    } catch {
      // Keep trying other candidates.
    }
    if (resolved.length >= 6) break;
  }

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
  for (const base of DEFAULT_OMEGATECH_URLS) {
    try {
      let searchPayload: unknown = null;
      let selected: { title: string; urls: string[]; raw: Record<string, unknown> } | null = null;

      for (const title of titles) {
        searchPayload = await omegaRequest(base, { action: 'search', query: title }, timeoutMs);
        selected = pickBestResult(searchPayload, [title, primaryTitle]);
        if (selected) break;
      }

      if (!selected) throw new Error(`OmegaTech Akwam search found no match for "${primaryTitle}"`);

      const contentUrl = selected.urls.find((url) => !isLikelyPlaybackUrl(url)) || selected.urls[0];
      if (!contentUrl) throw new Error('OmegaTech Akwam search returned no content URL');

      let targetPayload: unknown;
      if (request.type === 'series') {
        if (!Number.isInteger(request.episode) || request.episode < 1) {
          throw new Error('OmegaTech Akwam series playback requires episode');
        }

        const contentPayload = await omegaRequest(base, { action: 'content', url: contentUrl }, timeoutMs);
        const episodeUrl = pickEpisodeUrl(contentPayload, request.episode, request.season);
        if (!episodeUrl) throw new Error(`OmegaTech Akwam episode ${request.episode} was not found`);

        targetPayload = await omegaRequest(base, { action: 'episode', episode: episodeUrl }, timeoutMs);
      } else {
        targetPayload = await omegaRequest(base, { action: 'content', url: contentUrl }, timeoutMs);
      }

      const urls = await resolveOmegaDownloadUrls(base, targetPayload, timeoutMs);
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

  throw new Error(lastError);
}
\nexport async function resolveRemotePlayback(
  request: RemotePlaybackRequest,
): Promise<RemotePlaybackSource[]> {
  const cacheKey = remoteResolveCacheKey(request);
  const now = Date.now();
  const cached = remoteResolveCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = resolveRemotePlaybackUncached(request);
  remoteResolveCache.set(cacheKey, { expiresAt: now + REMOTE_RESOLVE_CACHE_TTL_MS, promise });
  promise.catch(() => {
    const current = remoteResolveCache.get(cacheKey);
    if (current?.promise === promise) remoteResolveCache.delete(cacheKey);
  });
  return promise;
}

async function resolveRemotePlaybackUncached(
  request: RemotePlaybackRequest,
): Promise<RemotePlaybackSource[]> {
  const timeoutMs = Math.max(2_000, Number(process.env.PLAYBACK_RESOLVER_TIMEOUT_MS || 9_000));
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

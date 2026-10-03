import { adminSupabase } from './supabase';
import { createPlaybackProxyUrl } from './playback-proxy';
import { resolveAkwamPlayback } from './providers/arprov-akwam';
import type { NormalizedPlaybackSource, ProviderContext } from './providers/types';

type PlaybackContentType = 'movie' | 'episode';

type CachedSource = {
  type: NormalizedPlaybackSource['type'];
  url: string;
  providerReference: 'akwam';
  quality: string;
  language: string;
  label: string;
  referer: string;
  headers?: Record<string, string>;
  expiresAt?: string;
};

const SOURCE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_TTL_MS = 20 * 1000;
const REDIRECT_TOKEN_TTL_MS = 10 * 60 * 1000;
const inFlight = new Map<string, Promise<CachedSource[]>>();

function edgeCache(): Cache | null {
  const cacheStorage = (globalThis as typeof globalThis & {
    caches?: { default?: Cache };
  }).caches;
  return cacheStorage?.default ?? null;
}

function cacheKey(requestUrl: string, contentType: PlaybackContentType, contentId: string) {
  const origin = new URL(requestUrl).origin;
  return new Request(
    `${origin}/__movyz-cache/akwam-on-demand?type=${contentType}&id=${encodeURIComponent(contentId)}`,
    { method: 'GET' },
  );
}

function qualityScore(value: string) {
  return /2160|4k/.test(value) ? 4000 :
    /1440/.test(value) ? 3000 :
    /1080/.test(value) ? 2000 :
    /720/.test(value) ? 1500 :
    /576/.test(value) ? 1200 :
    /480/.test(value) ? 1000 :
    /360/.test(value) ? 800 : 600;
}

function typeScore(value: string) {
  return value === 'mp4' ? 50 :
    value === 'hls' ? 45 :
    value === 'dash' ? 40 :
    value === 'webm' ? 35 : 30;
}

function normalizeSources(sources: NormalizedPlaybackSource[]): CachedSource[] {
  const allowedTypes = new Set(['mp4', 'hls', 'dash', 'webm', 'direct']);
  const byQuality = new Map<string, CachedSource>();

  for (const source of sources) {
    const url = String(source.url || '').trim();
    const quality = String(source.quality || '').trim().toLowerCase();
    const type = String(source.type || '').trim().toLowerCase() as NormalizedPlaybackSource['type'];
    const providerReference = String(source.providerReference || '').trim().toLowerCase();

    if (providerReference !== 'akwam') continue;
    if (!/^https:\/\//i.test(url)) continue;
    if (!allowedTypes.has(type)) continue;
    if (!/^\d{3,4}p$/i.test(quality)) continue;
    if (/\/\/(?:[^/]+\.)?akwam\.(?:com|to|live|tv)(?:\/|$)/i.test(url) && !/^https:\/\/akwam\.ss\//i.test(url)) continue;

    const item: CachedSource = {
      type,
      url,
      providerReference: 'akwam',
      quality,
      language: source.language || 'und',
      label: source.label || `Akwam ${quality}`,
      referer: source.referer || 'https://akwam.ss/',
      headers: source.headers,
      expiresAt: source.expiresAt,
    };

    const current = byQuality.get(quality);
    if (!current || typeScore(item.type) > typeScore(current.type)) {
      byQuality.set(quality, item);
    }
  }

  return [...byQuality.values()]
    .sort((a, b) => {
      const q = qualityScore(b.quality) - qualityScore(a.quality);
      return q || typeScore(b.type) - typeScore(a.type);
    })
    .slice(0, 6);
}

function filterFresh(sources: CachedSource[]) {
  const now = Date.now();
  return sources.filter((source) => {
    if (!source.expiresAt) return true;
    const expires = Date.parse(source.expiresAt);
    return !Number.isFinite(expires) || expires > now + 15_000;
  });
}

function expectedContentType(type: string) {
  switch (type) {
    case 'mp4': return /^(?:video\/(?:mp4|mpeg|quicktime)|application\/mp4|application\/octet-stream)/i;
    case 'webm': return /^(?:video\/webm|application\/octet-stream)/i;
    case 'hls': return /^(?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/mpegurl|text\/plain|application\/octet-stream)/i;
    case 'dash': return /^(?:application\/dash\+xml|text\/xml|application\/octet-stream)/i;
    case 'direct': return /^video\//i;
    default: return null;
  }
}

async function validateDirectSource(source: CachedSource): Promise<CachedSource | null> {
  let parsed: URL;
  try {
    parsed = new URL(source.url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== 'akwam.ss') {
    // The page resolver may legitimately expose Akwam-hosted CDN media.
    // Only enforce HTTPS here; never synthesize a host.
  }
  if (/\/(?:embed|iframe|download|link)(?:\/|$)/i.test(parsed.pathname)) return null;

  const headers: Record<string, string> = {
    Accept: '*/*',
    Range: 'bytes=0-2048',
    'User-Agent': 'Movyz-Akwam-Resolver/1.0',
  };
  if (source.referer) headers.Referer = source.referer;

  try {
    const response = await fetch(source.url, {
      method: 'GET',
      redirect: 'follow',
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    const status = response.status;
    const finalUrl = response.url || source.url;
    let finalParsed: URL;
    try {
      finalParsed = new URL(finalUrl);
    } catch {
      try { await response.body?.cancel(); } catch {}
      return null;
    }
    if (finalParsed.protocol !== 'https:') {
      try { await response.body?.cancel(); } catch {}
      return null;
    }
    if (/(?:^|\\/)(?:embed|iframe|download|link)(?:\\/|$)/i.test(finalParsed.pathname)) {
      try { await response.body?.cancel(); } catch {}
      return null;
    }
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const finalPath = (() => {
      try { return new URL(finalUrl).pathname.toLowerCase(); } catch { return parsed.pathname.toLowerCase(); }
    })();

    if (status !== 200 && status !== 206) {
      try { await response.body?.cancel(); } catch {}
      return null;
    }

    const looksLikeMediaPath = /\\.(?:mp4|webm|m3u8|mpd|m4v|mov|mpeg|mpg|ts|m2ts|flv|3gp|3g2)(?:$|[?#])/i.test(finalPath);
    const typeMatches = expectedContentType(source.type)?.test(contentType) ?? false;
    const obviouslyTextual = /text\\/html|application\\/json|text\\/json/i.test(contentType);

    if (obviouslyTextual) {
      try { await response.body?.cancel(); } catch {}
      return null;
    }

    // Never buffer a full media file just to validate it. If the upstream
    // ignores Range, inspect only a tiny prefix for textual manifests.
    if (source.type === 'hls' && !typeMatches) {
      if (!/\\.(?:m3u8)(?:$|[?#])/i.test(finalPath)) {
        try { await response.body?.cancel(); } catch {}
        return null;
      }
      const reader = response.body?.getReader();
      if (!reader) return null;
      const first = await reader.read();
      try { await reader.cancel(); } catch {}
      const prefix = new TextDecoder().decode(first.value || new Uint8Array()).slice(0, 8192);
      if (!/^#EXTM3U\\b/i.test(prefix.trim())) return null;
    } else if (source.type === 'dash' && !typeMatches) {
      if (!/\\.(?:mpd)(?:$|[?#])/i.test(finalPath)) {
        try { await response.body?.cancel(); } catch {}
        return null;
      }
      const reader = response.body?.getReader();
      if (!reader) return null;
      const first = await reader.read();
      try { await reader.cancel(); } catch {}
      const prefix = new TextDecoder().decode(first.value || new Uint8Array()).slice(0, 8192);
      if (!/<(?:MPD|mpd)\\b/i.test(prefix)) return null;
    } else if (!typeMatches && !(contentType === 'application/octet-stream' && looksLikeMediaPath)) {
      try { await response.body?.cancel(); } catch {}
      return null;
    } else {
      try { await response.body?.cancel(); } catch {}
    }

    return { ...source, url: finalUrl };
  } catch {
    return null;
  }
}

async function loadContext(
  contentType: PlaybackContentType,
  contentId: string,
): Promise<ProviderContext> {
  if (contentType === 'movie') {
    const { data, error } = await adminSupabase
      .from('movies')
      .select('id,tmdb_id,title_ar,title_en,original_title,alternative_titles,release_date,status')
      .eq('id', contentId)
      .eq('status', 'published')
      .maybeSingle();

    if (error) throw new Error('Unable to load movie: ' + error.message);
    if (!data) throw new Error('Movie not found');

    return {
      tmdbId: Number(data.tmdb_id || 0) || undefined,
      title: data.title_ar || data.title_en || data.original_title || undefined,
      originalTitle: data.original_title || data.title_en || data.title_ar || undefined,
      alternateTitles: Array.isArray(data.alternative_titles) ? data.alternative_titles
        .flatMap((item: unknown) => {
          if (typeof item === 'string') return [item];
          if (item && typeof item === 'object') {
            const value = item as Record<string, unknown>;
            return [value.title, value.name].filter((entry): entry is string => typeof entry === 'string');
          }
          return [];
        })
        .map((item: string) => item.trim())
        .filter(Boolean)
        .slice(0, 20) : [],
      releaseYear: data.release_date ? Number(String(data.release_date).slice(0, 4)) : undefined,
    };
  }

  const { data, error } = await adminSupabase
    .from('episodes')
    .select('id,episode_number,name_ar,name_en,seasons!inner(id,season_number,series_id,series:series_id!inner(id,tmdb_id,title_ar,title_en,original_title,alternative_titles,status,first_air_date))')
    .eq('id', contentId)
    .maybeSingle();

  if (error) throw new Error('Unable to load episode: ' + error.message);
  if (!data) throw new Error('Episode not found');

  const season = Array.isArray(data.seasons) ? data.seasons[0] : data.seasons;
  const series = season && (Array.isArray(season.series) ? season.series[0] : season.series);
  if (!season || !series || String(series.status || 'published') !== 'published') {
    throw new Error('Episode is unavailable');
  }

  return {
    tmdbId: Number(series.tmdb_id || 0) || undefined,
    title: series.title_ar || series.title_en || series.original_title || undefined,
    originalTitle: series.original_title || series.title_en || series.title_ar || undefined,
    alternateTitles: Array.isArray(series.alternative_titles) ? series.alternative_titles
      .flatMap((item: unknown) => {
        if (typeof item === 'string') return [item];
        if (item && typeof item === 'object') {
          const value = item as Record<string, unknown>;
          return [value.title, value.name].filter((entry): entry is string => typeof entry === 'string');
        }
        return [];
      })
      .map((item: string) => item.trim())
      .filter(Boolean)
      .slice(0, 20) : [],
    releaseYear: series.first_air_date ? Number(String(series.first_air_date).slice(0, 4)) : undefined,
    seasonNumber: Number(season.season_number || 1),
    episodeNumber: Number(data.episode_number || 0),
    episodeTitle: data.name_ar || data.name_en || undefined,
  };
}

async function resolveAndValidate(
  contentType: PlaybackContentType,
  contentId: string,
): Promise<CachedSource[]> {
  const context = await loadContext(contentType, contentId);
  const resolved = normalizeSources(await resolveAkwamPlayback(context, {}));
  if (!resolved.length) return [];

  const validated = await Promise.all(resolved.map(validateDirectSource));
  return validated
    .filter((source): source is CachedSource => Boolean(source))
    .sort((a, b) => qualityScore(b.quality) - qualityScore(a.quality))
    .slice(0, 6);
}

async function resolveCached(
  contentType: PlaybackContentType,
  contentId: string,
): Promise<CachedSource[]> {
  const key = `${contentType}:${contentId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = resolveAndValidate(contentType, contentId).finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

async function readEdgeCache(
  requestUrl: string,
  contentType: PlaybackContentType,
  contentId: string,
): Promise<CachedSource[] | null> {
  const cache = edgeCache();
  if (!cache) return null;

  try {
    const response = await cache.match(cacheKey(requestUrl, contentType, contentId));
    if (!response) return null;
    const payload = await response.json() as { expiresAt: number; sources: CachedSource[] };
    if (!payload || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;

    if (!Array.isArray(payload.sources)) return null;
    // An empty array is a valid negative-cache hit. Keep it distinct from
    // "no cache entry" so repeated failed lookups do not hammer Akwam.
    return filterFresh(payload.sources);
  } catch {
    return null;
  }
}

async function writeEdgeCache(
  requestUrl: string,
  contentType: PlaybackContentType,
  contentId: string,
  sources: CachedSource[],
) {
  const cache = edgeCache();
  if (!cache) return;

  const ttlCandidates = [
    SOURCE_TTL_MS,
    ...sources
      .map((source) => source.expiresAt ? Date.parse(source.expiresAt) - Date.now() - 15_000 : Number.POSITIVE_INFINITY)
      .filter((value) => Number.isFinite(value)),
  ];
  const ttlMs = Math.max(
    5_000,
    Math.min(...ttlCandidates, sources.length ? SOURCE_TTL_MS : NEGATIVE_TTL_MS),
  );

  const key = cacheKey(requestUrl, contentType, contentId);
  const response = new Response(JSON.stringify({
    expiresAt: Date.now() + ttlMs,
    sources,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

  try {
    await cache.put(key, response);
  } catch {
    // Cache is an optimization. Playback still works without it.
  }
}

export async function getOnDemandAkwamSources(
  contentType: PlaybackContentType,
  contentId: string,
  requestUrl: string,
  env: Record<string, unknown>,
) {
  let sources = await readEdgeCache(requestUrl, contentType, contentId);

  if (!sources) {
    sources = await resolveCached(contentType, contentId);
    await writeEdgeCache(requestUrl, contentType, contentId, sources);
  }

  if (!sources.length) return [];

  const output = [];
  for (const source of filterFresh(sources)) {
    const redirectUrl = await createPlaybackProxyUrl(
      {
        provider: 'Akwam',
        providerReference: 'akwam',
        type: source.type,
        url: source.url,
        quality: source.quality,
        language: source.language,
        label: source.label,
        referer: source.referer,
        headers: source.headers,
        expiresAt: source.expiresAt,
      },
      requestUrl,
      env,
      REDIRECT_TOKEN_TTL_MS,
    );

    if (!redirectUrl || redirectUrl === source.url) {
      throw new Error('Playback redirect secret is not configured');
    }

    output.push({
      id: `ondemand:${contentType}:${contentId}:${source.quality}:${source.type}`,
      type: source.type,
      quality: source.quality,
      language: source.language,
      label: source.label,
      labelEn: source.label,
      url: redirectUrl,
      isWorking: true,
      provider: 'Akwam',
      providerKey: 'akwam',
      providerReference: 'akwam',
      expiresAt: source.expiresAt || null,
    });
  }

  return output;
}

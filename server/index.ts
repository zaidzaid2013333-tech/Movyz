import { MiniApp, type NextFunction, type HttpRequest, type HttpResponse } from './mini-http';
import { z } from 'zod';
import { adminSupabase } from './supabase';
import { asyncRoute, created, fail, ok } from './http';
import { requireAdmin, requireAuth, requireOwner, type AuthenticatedRequest } from './auth';
import { runTmdbSync, runFreshTmdbSync, syncEpisodesForSeries, syncMovieByTmdbId, syncSeriesByTmdbId, importCuratedCatalog } from './tmdb';

export const app = new MiniApp();
const api = '/api/v1';

app.disable('x-powered-by');

// Playback backend: cache-first, live Akwam resolution through the dedicated
// external resolver service. No playback URLs are persisted in Supabase; only
// short-lived edge/memory cache entries are used.
const MOVYZ_BUILD_ID = process.env.MOVYZ_BUILD_ID || 'unknown';
const MOVYZ_PLAYBACK_CONTRACT = 'broker-v1';

function normalizePlaybackQuality(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Auto';
  if (/^auto$/i.test(raw)) return 'Auto';
  const match = raw.match(/(?:^|\D)(2160|1440|1080|720|576|480|360|240)(?:p)?(?:$|\D)/i);
  return match?.[1] ? `${match[1]}p` : raw;
}

// Playback Broker: cache-first, live Akwam resolution.
// Playback URLs are never persisted by this path. The edge cache is short-lived
// so the same title can be reused immediately without creating a source archive.
type BrokerSource = {
  id: string;
  type: string;
  quality: string;
  language: string;
  label: string;
  labelEn: string;
  url: string;
  directUrl?: string;
  isWorking: boolean;
  provider: string;
  providerKey: string;
  providerReference: string;
  expiresAt: string | null;
  referer?: string;
};

type BrokerCacheValue = {
  sources: BrokerSource[];
  cachedAt: number;
};

const playbackBrokerMemory = new Map<string, BrokerCacheValue>();
const playbackBrokerInflight = new Map<string, Promise<BrokerSource[]>>();
const PLAYBACK_BROKER_TTL_MS = 2 * 60 * 1000;
const PLAYBACK_BROKER_MAX_MEMORY_KEYS = 256;
const PLAYBACK_CONTEXT_TTL_MS = 5 * 60 * 1000;
const PLAYBACK_CONTEXT_MAX_KEYS = 512;
type PlaybackResolverContext = {
  contentId: string;
  titles: string[];
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
};
const playbackContextMemory = new Map<string, { value: PlaybackResolverContext; cachedAt: number }>();

function brokerCacheKey(
  contentType: 'movie' | 'episode',
  contentId: string,
  seasonNumber?: number,
  episodeNumber?: number,
) {
  const query = new URLSearchParams();
  if (Number.isFinite(seasonNumber)) query.set('season', String(Math.trunc(Number(seasonNumber))));
  if (Number.isFinite(episodeNumber)) query.set('episode', String(Math.trunc(Number(episodeNumber))));
  const suffix = query.toString();
  return `https://movyz-cache.invalid/playback/${contentType}/${encodeURIComponent(contentId)}${suffix ? `?${suffix}` : ''}`;
}

function trimBrokerMemory() {
  while (playbackBrokerMemory.size > PLAYBACK_BROKER_MAX_MEMORY_KEYS) {
    const first = playbackBrokerMemory.keys().next().value;
    if (!first) break;
    playbackBrokerMemory.delete(first);
  }
}

async function edgeBrokerRead(key: string): Promise<BrokerSource[] | null> {
  const now = Date.now();
  const memory = playbackBrokerMemory.get(key);
  if (memory && memory.cachedAt + PLAYBACK_BROKER_TTL_MS > now) {
    return memory.sources;
  }
  if (memory) playbackBrokerMemory.delete(key);

  const cacheApi = (globalThis as any).caches?.default;
  if (!cacheApi) return null;

  try {
    const cached = await cacheApi.match(new Request(key));
    if (!cached) return null;
    const payload = await cached.json() as { sources?: BrokerSource[] };
    const sources = Array.isArray(payload?.sources) ? payload.sources : [];
    if (!sources.length) return null;
    playbackBrokerMemory.set(key, { sources, cachedAt: now });
    trimBrokerMemory();
    return sources;
  } catch {
    return null;
  }
}

async function edgeBrokerWrite(key: string, sources: BrokerSource[]) {
  const cachedAt = Date.now();
  playbackBrokerMemory.set(key, { sources, cachedAt });
  trimBrokerMemory();

  const cacheApi = (globalThis as any).caches?.default;
  if (!cacheApi) return;

  try {
    const response = new Response(JSON.stringify({ sources, cachedAt }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=300',
      },
    });
    await cacheApi.put(new Request(key), response);
  } catch {
    // Edge Cache is an optimization; playback remains functional without it.
  }
}

async function edgeBrokerInvalidate(key: string) {
  playbackBrokerMemory.delete(key);

  const cacheApi = (globalThis as any).caches?.default;
  if (!cacheApi) return;

  try {
    await cacheApi.delete(new Request(key));
  } catch {
    // Cache invalidation is best-effort; the next resolver call can still refresh memory.
  }
}

function normalizeBrokerMediaSources(
  sources: Array<{ url: string; type: string; quality?: string; referer?: string }>,
  contentType: 'movie' | 'episode',
  contentId: string,
  requestUrl: string,
  seasonNumber?: number,
  episodeNumber?: number,
): BrokerSource[] {
  const relayOrigin = new URL(requestUrl).origin;
  return sources
    .filter((source) => /^https:\/\//i.test(String(source?.url || '')))
    .map((source, index) => {
      const quality = normalizePlaybackQuality(source.quality || 'Auto');
      const relayParams = new URLSearchParams({
        type: contentType,
        contentId,
        source: String(index),
      });
      if (Number.isFinite(seasonNumber)) relayParams.set('season', String(seasonNumber));
      if (Number.isFinite(episodeNumber)) relayParams.set('episode', String(episodeNumber));
      const relayUrl = relayOrigin + api + '/playback/stream?' + relayParams.toString();
      return {
        id: `akwam-live:${contentType}:${contentId}:${index}`,
        type: String(source.type || 'direct').toLowerCase(),
        quality,
        language: 'und',
        label: `Akwam • ${quality}`,
        labelEn: `Akwam • ${quality}`,
        url: relayUrl,
        directUrl: String(source.url),
        isWorking: true,
        provider: 'Akwam',
        providerKey: 'akwam',
        providerReference: 'akwam',
        expiresAt: null,
        referer: typeof source.referer === 'string' && /^https:\/\//i.test(source.referer)
          ? source.referer
          : 'https://akwam.ss/',
      };
    })
    .filter((source) =>
      ['mp4', 'hls', 'dash', 'webm', 'direct'].includes(source.type) &&
      /^https:\/\//i.test(source.url),
    );
}

async function loadPlaybackResolverContext(
  contentType: 'movie' | 'episode',
  contentId: string,
  seasonNumber?: number,
  episodeNumber?: number,
): Promise<PlaybackResolverContext> {
  const cacheKey = [
    contentType,
    contentId,
    Number.isFinite(seasonNumber) ? Number(seasonNumber) : '',
    Number.isFinite(episodeNumber) ? Number(episodeNumber) : '',
  ].join(':');
  const cached = playbackContextMemory.get(cacheKey);
  if (cached && cached.cachedAt + PLAYBACK_CONTEXT_TTL_MS > Date.now()) {
    return cached.value;
  }
  if (cached) playbackContextMemory.delete(cacheKey);

  const store = (value: PlaybackResolverContext) => {
    playbackContextMemory.set(cacheKey, { value, cachedAt: Date.now() });
    while (playbackContextMemory.size > PLAYBACK_CONTEXT_MAX_KEYS) {
      const first = playbackContextMemory.keys().next().value;
      if (!first) break;
      playbackContextMemory.delete(first);
    }
    return value;
  };

  if (contentType === 'movie') {
    const isTmdbId = /^\d+$/.test(contentId);
    const query = adminSupabase
      .from('movies')
      .select('id,title_ar,title_en,original_title,alternative_titles,release_date')
      .limit(1);
    const { data, error } = isTmdbId
      ? await query.eq('tmdb_id', Number(contentId))
      : await query.eq('id', contentId);
    if (error || !data?.[0]) throw new Error('PLAYBACK_CONTENT_NOT_FOUND');

    const row: any = data[0];
    return store({
      contentId: String(row.id),
      titles: Array.from(new Set([
        row.title_ar,
        row.title_en,
        row.original_title,
        ...(Array.isArray(row.alternative_titles)
          ? row.alternative_titles.map((x: any) => x?.title).filter(Boolean)
          : []),
      ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0))),
      year: typeof row.release_date === 'string'
        ? Number(row.release_date.slice(0, 4)) || undefined
        : undefined,
    });
  }

  // Prefer one relational Supabase query for episode -> season -> series.
  // Older schemas can still fall back to the three-query path below.
  const nested = await adminSupabase
    .from('episodes')
    .select('id,episode_number,season_id,seasons!inner(series_id,season_number,series!inner(title_ar,title_en,original_title,alternative_titles))')
    .eq('id', contentId)
    .limit(1);

  const nestedRow: any = nested.data?.[0];
  const nestedSeason = nestedRow?.seasons;
  const nestedSeries = nestedSeason?.series;

  if (!nested.error && nestedRow && nestedSeason && nestedSeries) {
    const value = {
      contentId: String(nestedRow.id),
      titles: Array.from(new Set([
        nestedSeries.title_ar,
        nestedSeries.title_en,
        nestedSeries.original_title,
        ...(Array.isArray(nestedSeries.alternative_titles)
          ? nestedSeries.alternative_titles.map((x: any) => x?.title).filter(Boolean)
          : []),
      ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0))),
      seasonNumber: Number.isFinite(seasonNumber)
        ? Number(seasonNumber)
        : Number(nestedSeason.season_number),
      episodeNumber: Number.isFinite(episodeNumber)
        ? Number(episodeNumber)
        : Number(nestedRow.episode_number),
    };
    if (value.titles.length) return store(value);
  }

  // Some legacy/catalog routes pass the series TMDB ID + season/episode.
  // Normalize those requests to the exact episode UUID so every playback route
  // shares one canonical broker contract.
  if (
    /^\d+$/.test(contentId) &&
    Number.isFinite(seasonNumber) &&
    Number.isFinite(episodeNumber)
  ) {
    const { data: seriesByTmdb, error: seriesByTmdbError } = await adminSupabase
      .from('series')
      .select('id,title_ar,title_en,original_title,alternative_titles')
      .eq('tmdb_id', Number(contentId))
      .limit(1);

    const seriesRow: any = seriesByTmdb?.[0];
    if (!seriesByTmdbError && seriesRow?.id) {
      const { data: seasonByNumber, error: seasonByNumberError } = await adminSupabase
        .from('seasons')
        .select('id,season_number')
        .eq('series_id', seriesRow.id)
        .eq('season_number', Number(seasonNumber))
        .limit(1);

      const seasonRow: any = seasonByNumber?.[0];
      if (!seasonByNumberError && seasonRow?.id) {
        const { data: episodeByNumber, error: episodeByNumberError } = await adminSupabase
          .from('episodes')
          .select('id,episode_number')
          .eq('season_id', seasonRow.id)
          .eq('episode_number', Number(episodeNumber))
          .limit(1);

        const episodeRow: any = episodeByNumber?.[0];
        if (!episodeByNumberError && episodeRow?.id) {
          return store({
            contentId: String(episodeRow.id),
            titles: Array.from(new Set([
              seriesRow.title_ar,
              seriesRow.title_en,
              seriesRow.original_title,
              ...(Array.isArray(seriesRow.alternative_titles)
                ? seriesRow.alternative_titles.map((x: any) => x?.title).filter(Boolean)
                : []),
            ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0))),
            seasonNumber: Number(seasonNumber),
            episodeNumber: Number(episodeNumber),
          });
        }
      }
    }
  }

  const { data: episodeData, error: episodeError } = await adminSupabase
    .from('episodes')
    .select('id,season_id,episode_number')
    .eq('id', contentId)
    .limit(1);
  const episode = episodeData?.[0] as any;
  if (episodeError || !episode?.season_id) throw new Error('PLAYBACK_EPISODE_NOT_FOUND');

  const { data: seasonData, error: seasonError } = await adminSupabase
    .from('seasons')
    .select('series_id,season_number')
    .eq('id', episode.season_id)
    .limit(1);
  const season = seasonData?.[0] as any;
  if (seasonError || !season?.series_id) throw new Error('PLAYBACK_SEASON_NOT_FOUND');

  const { data: seriesData, error: seriesError } = await adminSupabase
    .from('series')
    .select('title_ar,title_en,original_title,alternative_titles')
    .eq('id', season.series_id)
    .limit(1);
  const series = seriesData?.[0] as any;
  if (seriesError || !series) throw new Error('PLAYBACK_SERIES_NOT_FOUND');

  return store({
    contentId: String(episode.id),
    titles: Array.from(new Set([
      series.title_ar,
      series.title_en,
      series.original_title,
      ...(Array.isArray(series.alternative_titles)
        ? series.alternative_titles.map((x: any) => x?.title).filter(Boolean)
        : []),
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0))),
    seasonNumber: Number.isFinite(seasonNumber) ? Number(seasonNumber) : Number(season.season_number),
    episodeNumber: Number.isFinite(episodeNumber) ? Number(episodeNumber) : Number(episode.episode_number),
  });
}

async function resolveAkwamThroughExternalResolver(
  req: HttpRequest,
  contentType: 'movie' | 'episode',
  contentId: string,
  seasonNumber?: number,
  episodeNumber?: number,
) {
  const resolverBase = String(
    (req.env as any)?.PLAYBACK_RESOLVER_URL ||
    process.env.PLAYBACK_RESOLVER_URL ||
    '',
  ).trim().replace(/\/+$/, '');
  if (!resolverBase) throw new Error('PLAYBACK_RESOLVER_CONFIG_MISSING');

  const context = await loadPlaybackResolverContext(
    contentType,
    contentId,
    seasonNumber,
    episodeNumber,
  );

  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json',
    'user-agent': 'Movyz-Cloudflare-Playback/1.0',
  });
  const resolverKey = String(
    (req.env as any)?.PLAYBACK_RESOLVER_KEY ||
    process.env.PLAYBACK_RESOLVER_KEY ||
    '',
  ).trim();
  if (resolverKey) headers.set('x-movyz-resolver-key', resolverKey);

  const body = JSON.stringify({
    contentType,
    contentId: context.contentId,
    titles: context.titles,
    year: context.year,
    seasonNumber: context.seasonNumber,
    episodeNumber: context.episodeNumber,
  });

  const resolverUrl = resolverBase.endsWith('/resolve') ? resolverBase : `${resolverBase}/resolve`;
  const requestResolver = () => fetch(resolverUrl, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(22000),
  });

  const resolverStartedAt = Date.now();
  let response = await requestResolver();
  if (response.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    response = await requestResolver();
  }

  const raw = await response.text();
  let payload: any = null;
  try { payload = JSON.parse(raw); } catch {}

  if (!response.ok || payload?.ok !== true) {
    const detail = String(payload?.error || raw || ('HTTP_' + response.status)).slice(0, 900);
    throw new Error('PLAYBACK_EXTERNAL_RESOLVER_FAILED ' + detail + ' resolverMs=' + (Date.now() - resolverStartedAt));
  }

  const media = Array.isArray(payload.sources) ? payload.sources : [];
  return media.filter((source: any) => /^https:\/\//i.test(String(source?.url || '')));
}

async function resolvePlaybackBroker(
  req: HttpRequest,
  contentType: 'movie' | 'episode',
  contentId: string,
  seasonNumber?: number,
  episodeNumber?: number,
): Promise<{ sources: BrokerSource[]; mode: 'edge-cache' | 'live' }> {
  // Normalize every incoming route identifier before cache/inflight resolution.
  // UUID and TMDB-ID entry points must share exactly one broker architecture.
  const context = await loadPlaybackResolverContext(
    contentType,
    contentId,
    seasonNumber,
    episodeNumber,
  );
  const canonicalContentId = context.contentId;
  const key = brokerCacheKey(contentType, canonicalContentId, context.seasonNumber, context.episodeNumber);

  const cached = await edgeBrokerRead(key);
  if (cached?.length) {
    return { sources: cached, mode: 'edge-cache' };
  }

  const existing = playbackBrokerInflight.get(key);
  if (existing) {
    return { sources: await existing, mode: 'live' };
  }

  const resolverPromise = (async () => {
    const media = await resolveAkwamThroughExternalResolver(
      req,
      contentType,
      canonicalContentId,
      context.seasonNumber,
      context.episodeNumber,
    );

    const sources = normalizeBrokerMediaSources(
      media,
      contentType,
      canonicalContentId,
      req.url,
      context.seasonNumber,
      context.episodeNumber,
    );
    if (!sources.length) throw new Error('PLAYBACK_BROKER_NO_PLAYABLE_SOURCE');
    await edgeBrokerWrite(key, sources);
    return sources;
  })();

  playbackBrokerInflight.set(key, resolverPromise);
  try {
    return { sources: await resolverPromise, mode: 'live' };
  } finally {
    playbackBrokerInflight.delete(key);
  }
}

app.get(`${api}/playback/stream`, asyncRoute(async (req, res) => {
  const rawType = typeof req.query.type === 'string' ? req.query.type : '';
  const rawContentId = typeof req.query.contentId === 'string' ? req.query.contentId : '';
  const rawSource = typeof req.query.source === 'string' ? req.query.source : '';

  const contentType = rawType === 'movie' || rawType === 'episode' ? rawType : null;
  const contentId = rawContentId.trim();
  const sourceIndex = Number(rawSource);

  if (!contentType || !contentId || !Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex > 20) {
    return fail(res, 400, 'PLAYBACK_STREAM_INVALID_REQUEST', 'Invalid playback stream request');
  }

  const seasonNumber = typeof req.query.season === 'string' ? Number(req.query.season) : undefined;
  const episodeNumber = typeof req.query.episode === 'string' ? Number(req.query.episode) : undefined;
  const cacheKey = brokerCacheKey(contentType, contentId, seasonNumber, episodeNumber);

  const fetchUpstream = async (upstreamUrl: string, referer?: string) => {
    const upstreamHeaders = new Headers();
    // Media startup/seek is driven by byte ranges. Do not forward conditional-cache
    // validators from the browser because a 304 has no media body and can leave a
    // <video> element stuck at 00:00 behind the relay.
    const range = req.headers.get('range');
    if (range) upstreamHeaders.set('range', range);
    upstreamHeaders.set('Accept', req.headers.get('accept') || '*/*');
    const sourceReferer = /^https:\/\//i.test(String(referer || '')) ? String(referer) : 'https://akwam.ss/';
    upstreamHeaders.set('Referer', sourceReferer);
    try {
      upstreamHeaders.set('Origin', new URL(sourceReferer).origin);
    } catch {
      upstreamHeaders.set('Origin', 'https://akwam.ss');
    }
    upstreamHeaders.set('User-Agent', req.headers.get('user-agent') || 'Mozilla/5.0');
    upstreamHeaders.set('Accept-Encoding', 'identity');

    return fetch(upstreamUrl, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });
  };
 

  const isBadUpstream = (upstream: Response) => {
    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    return [304, 401, 403, 404, 410, 416, 429].includes(upstream.status) ||
      contentType.includes('text/html') ||
      contentType.includes('application/json') ||
      contentType.includes('text/plain');
  };

  const upstreamLooksPlayable = async (upstream: Response, source: BrokerSource) => {
    if (isBadUpstream(upstream)) return false;

    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    const sourceType = String(source.type || '').toLowerCase();
    if ([200, 206].includes(upstream.status) && (sourceType === 'mp4' || /\.mp4(?:[?#]|$)/i.test(source.directUrl || ''))) return true;
    if (
      contentType.startsWith('video/') ||
      contentType.includes('mpegurl') ||
      contentType.includes('dash+xml') ||
      contentType.includes('x-mpegurl')
    ) {
      return true;
    }

    try {
      const clone = upstream.clone();
      const reader = clone.body?.getReader();
      if (!reader) return false;

      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < 4096) {
        const next = await reader.read();
        if (next.done) break;
        if (!next.value?.length) continue;
        const remaining = 4096 - total;
        const chunk = next.value.length > remaining ? next.value.slice(0, remaining) : next.value;
        chunks.push(chunk);
        total += chunk.length;
      }
      try { await reader.cancel(); } catch {}

      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }

      const sample = new TextDecoder().decode(body.slice(0, Math.min(body.length, 4096))).trim();
      if (!sample) return false;
      if (/^<!doctype|^<html|captcha|cloudflare|access denied|application\/json/i.test(sample)) return false;

      if (sourceType === 'hls' || /\.m3u8(?:[?#]|$)/i.test(source.directUrl || '')) {
        return /#EXTM3U|#EXT-X-/i.test(sample) || contentType.includes('mpegurl');
      }
      if (sourceType === 'dash' || /\.mpd(?:[?#]|$)/i.test(source.directUrl || '')) {
        return /<MPD[\s>]|<\?xml[\s\S]*<MPD/i.test(sample) || contentType.includes('dash+xml');
      }
      if (sourceType === 'webm') {
        return body.length >= 4 && body[0] === 0x1a && body[1] === 0x45 && body[2] === 0xdf && body[3] === 0xa3;
      }

      return (
        body.length >= 256 &&
        (
          contentType.includes('octet-stream') ||
          upstream.status === 206 ||
          /\b(?:moov|ftyp)\b/i.test(sample)
        )
      );
    } catch {
      return false;
    }
  };

  try {
    let result = await resolvePlaybackBroker(
      req,
      contentType,
      contentId,
      Number.isFinite(seasonNumber) ? seasonNumber : undefined,
      Number.isFinite(episodeNumber) ? episodeNumber : undefined,
    );

    const buildCandidateIndices = (sources: BrokerSource[]) =>
      [sourceIndex, ...sources.map((_, index) => index).filter((index) => index !== sourceIndex)];

    const trySources = async (
      sources: BrokerSource[],
    ): Promise<{ source: BrokerSource; upstream: Response; body: ReadableStream<Uint8Array> | null } | null> => {
      for (const candidateIndex of buildCandidateIndices(sources)) {
        const candidate = sources[candidateIndex];
        const candidateUrl = String(candidate?.directUrl || '').trim();
        if (!candidate || candidate.providerKey !== 'akwam' || !/^https:\/\//i.test(candidateUrl)) continue;

        try {
          const candidateResponse = await fetchUpstream(candidateUrl, candidate.referer);
          if (!(await upstreamLooksPlayable(candidateResponse, candidate))) continue;

          return {
            source: candidate,
            upstream: candidateResponse,
            body: candidateResponse.body,
          };
        } catch (error) {
          console.warn(
            '[playback-stream-candidate]',
            candidateIndex,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      return null;
    };

    let selected = await trySources(result.sources);

    // Akwam URLs can expire or a specific CDN node can stall a ranged read.
    // Invalidate the short-lived broker cache once and resolve a fresh source set
    // before giving up so the player can recover without a manual source switch.
    if (!selected) {
      await edgeBrokerInvalidate(cacheKey);
      result = await resolvePlaybackBroker(
        req,
        contentType,
        contentId,
        Number.isFinite(seasonNumber) ? seasonNumber : undefined,
        Number.isFinite(episodeNumber) ? episodeNumber : undefined,
      );
      selected = await trySources(result.sources);
    }

    if (!selected) {
      return fail(res, 502, 'PLAYBACK_STREAM_UPSTREAM_INVALID', 'No responsive Akwam media source is available');
    }

    const { source, upstream } = selected;
    const responseHeaders = new Headers();
    for (const name of ['content-type','content-length','content-range','accept-ranges','etag','last-modified','content-disposition']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }

    const sourceType = String(source.type || '').toLowerCase();
    const currentContentType = String(responseHeaders.get('content-type') || '').toLowerCase();
    if (sourceType === 'mp4' && (!currentContentType || currentContentType.includes('application/octet-stream'))) {
      responseHeaders.set('content-type', 'video/mp4');
    }

    responseHeaders.set('cache-control', 'private, no-store');
    responseHeaders.set('access-control-allow-origin', req.headers.get('origin') || '*');
    responseHeaders.set('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag, Last-Modified');

    if (isBadUpstream(upstream)) {
      return fail(res, 502, 'PLAYBACK_STREAM_UPSTREAM_INVALID', 'Upstream playback response is not a media stream');
    }

    return new Response(req.method === 'HEAD' ? null : selected.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.warn('[playback-stream]', error instanceof Error ? error.message : String(error));
    return fail(res, 502, 'PLAYBACK_STREAM_FAILED', 'Unable to stream the selected playback source');
  }
}));app.get(`${api}/playback/prepare`, asyncRoute(async (req, res) => {
  const rawType = typeof req.query.type === 'string' ? req.query.type : '';
  const rawContentId = typeof req.query.contentId === 'string' ? req.query.contentId : '';
  const contentType = rawType === 'movie' || rawType === 'episode' ? rawType : null;
  const contentId = rawContentId.trim();

  if (!contentType || !contentId) {
    return fail(res, 400, 'PLAYBACK_BROKER_INVALID_REQUEST', 'Playback type and contentId are required');
  }

  const seasonNumber = typeof req.query.season === 'string' ? Number(req.query.season) : undefined;
  const episodeNumber = typeof req.query.episode === 'string' ? Number(req.query.episode) : undefined;

  try {
    const result = await resolvePlaybackBroker(
      req,
      contentType,
      contentId,
      Number.isFinite(seasonNumber) ? seasonNumber : undefined,
      Number.isFinite(episodeNumber) ? episodeNumber : undefined,
    );

    res.setHeader(
      'cache-control',
      result.mode === 'live'
        ? 'private, no-store'
        : 'public, max-age=15, stale-while-revalidate=60',
    );
    return ok(res, {
      contentType,
      contentId,
      mode: result.mode,
      sources: result.sources,
      ready: result.sources.length > 0,
    });
  } catch (error) {
    console.warn(
      '[playback-broker]',
      error instanceof Error ? error.message : String(error),
    );
    return fail(
      res,
      502,
      'PLAYBACK_BROKER_RESOLVE_FAILED',
      'A playable source is not available right now',
    );
  }
}));

app.use(async (req: HttpRequest, res: HttpResponse, next: NextFunction) => {
  const origin = req.headers.get('origin');
  const allow = (process.env.CORS_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (origin && (allow.length === 0 || allow.includes(origin))) res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-headers', 'Authorization, Content-Type');
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  res.setHeader('x-movyz-build-id', MOVYZ_BUILD_ID);
  res.setHeader('x-movyz-playback-contract', MOVYZ_PLAYBACK_CONTRACT);
  if (req.method === 'OPTIONS') return res.status(204).send();
  return next();
});

const catalogQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  genreId: z.coerce.number().int().optional(),
  year: z.coerce.number().int().optional(),
  minRating: z.coerce.number().min(0).max(10).optional(),
  sortBy: z.enum(['popular', 'rating', 'newest']).default('popular'),
  search: z.string().trim().max(120).optional(),
});

const genreDto = (g: any) => ({
  id: g.id,
  name: g.name_ar,
  nameEn: g.name_en,
  slug: g.slug,
});

const movieCardDto = (row: any, genres: any[] = []) => ({
  id: row.id,
  tmdbId: Number(row.tmdb_id || 0),
  type: 'movie',
  title: row.title_ar,
  titleEn: row.title_en || row.title_ar,
  originalTitle: row.original_title || row.title_en || row.title_ar,
  year: row.release_date ? Number(String(row.release_date).slice(0, 4)) : 0,
  releaseDate: row.release_date || '',
  rating: Number(row.rating || 0),
  votesCount: Number(row.vote_count || 0),
  runtime: Number(row.runtime_minutes || 0),
  overview: row.overview_ar || '',
  overviewEn: row.overview_en || row.overview_ar || '',
  posterUrl: row.poster_url || '',
  backdropUrl: row.backdrop_url || '',
  genres,
  director: row.metadata?.director_ar || '',
  directorEn: row.metadata?.director_en || '',
  cast: [],
  sources: [],
  isFeatured: !!row.featured,
  isTrending: !!row.trending,
  isPopular: !!row.popular,
  addedAt: row.created_at,
  ageRating: row.age_rating || '',
});

const seriesCardDto = (row: any, genres: any[] = []) => ({
  id: row.id,
  tmdbId: Number(row.tmdb_id || 0),
  type: 'series',
  title: row.title_ar,
  titleEn: row.title_en || row.title_ar,
  originalTitle: row.original_title || row.title_en || row.title_ar,
  startYear: row.first_air_date ? Number(String(row.first_air_date).slice(0, 4)) : 0,
  endYear: row.last_air_date ? Number(String(row.last_air_date).slice(0, 4)) : undefined,
  releaseDate: row.first_air_date || '',
  rating: Number(row.rating || 0),
  votesCount: Number(row.vote_count || 0),
  overview: row.overview_ar || '',
  overviewEn: row.overview_en || row.overview_ar || '',
  posterUrl: row.poster_url || '',
  backdropUrl: row.backdrop_url || '',
  genres,
  creator: row.metadata?.creator_ar || '',
  creatorEn: row.metadata?.creator_en || '',
  cast: [],
  seasonsCount: 0,
  episodesCount: 0,
  seasons: [],
  isFeatured: !!row.featured,
  isTrending: !!row.trending,
  isPopular: !!row.popular,
  status: row.status,
  addedAt: row.created_at,
  ageRating: row.age_rating || '',
});

async function batchMovieGenres(ids: string[]) {
  if (!ids.length) return new Map<string, any[]>();
  const { data } = await adminSupabase
    .from('movie_genres')
    .select('movie_id,genres(id,name_ar,name_en,slug)')
    .in('movie_id', ids);
  const map = new Map<string, any[]>();
  for (const row of data || []) {
    const list = map.get(row.movie_id) || [];
    if (row.genres) list.push(genreDto(row.genres));
    map.set(row.movie_id, list);
  }
  return map;
}

async function batchSeriesGenres(ids: string[]) {
  if (!ids.length) return new Map<string, any[]>();
  const { data } = await adminSupabase
    .from('series_genres')
    .select('series_id,genres(id,name_ar,name_en,slug)')
    .in('series_id', ids);
  const map = new Map<string, any[]>();
  for (const row of data || []) {
    const list = map.get(row.series_id) || [];
    if (row.genres) list.push(genreDto(row.genres));
    map.set(row.series_id, list);
  }
  return map;
}

async function movieDto(row: any) {
  const [genresResult, castResult] = await Promise.all([
    adminSupabase.from('movie_genres').select('genres(id,name_ar,name_en,slug)').eq('movie_id', row.id),
    adminSupabase.from('movie_cast').select('character_ar,character_en,people(id,name_ar,name_en,avatar_url)').eq('movie_id', row.id).order('cast_order'),
  ]);

  const genres = genresResult.error ? [] : (genresResult.data || []);
  const cast = castResult.error ? [] : (castResult.data || []);

  return {
    id: row.id, tmdbId: Number(row.tmdb_id || 0), type: 'movie',
    title: row.title_ar, titleEn: row.title_en || row.title_ar,
    originalTitle: row.original_title || row.title_en || row.title_ar,
    year: row.release_date ? Number(String(row.release_date).slice(0, 4)) : 0,
    releaseDate: row.release_date || '',
    rating: Number(row.rating || 0), votesCount: Number(row.vote_count || 0),
    runtime: Number(row.runtime_minutes || 0),
    overview: row.overview_ar || '', overviewEn: row.overview_en || row.overview_ar || '',
    posterUrl: row.poster_url || '', backdropUrl: row.backdrop_url || '',
    genres: genres.map((x: any) => genreDto(x.genres)),
    director: row.metadata?.director_ar || '', directorEn: row.metadata?.director_en || '',
    cast: cast.map((x: any) => ({
      id: x.people.id, name: x.people.name_ar || x.people.name_en,
      nameEn: x.people.name_en || x.people.name_ar,
      character: x.character_ar || '', characterEn: x.character_en || '',
      avatarUrl: x.people.avatar_url || '',
    })),
    sources: [],
    isFeatured: !!row.featured, isTrending: !!row.trending, isPopular: !!row.popular,
    addedAt: row.created_at, ageRating: row.age_rating || '',
  } as any;
}

async function seriesDto(row: any, includePlaybackSources = false, requestUrl?: string, env?: Record<string, unknown>) {
  const [genres, cast, seasons] = await Promise.all([
    adminSupabase.from('series_genres').select('genres(id,name_ar,name_en,slug)').eq('series_id', row.id),
    adminSupabase.from('series_cast').select('character_ar,character_en,people(id,name_ar,name_en,avatar_url)').eq('series_id', row.id).order('cast_order'),
    adminSupabase.from('seasons').select('id,series_id,season_number,name_ar,name_en,poster_url,overview_ar,air_date').eq('series_id', row.id).order('season_number'),
  ]);

  const seasonRows = seasons.data || [];
  const ids = seasonRows.map((x: any) => x.id);
  const episodes = ids.length
    ? await adminSupabase.from('episodes').select('id,season_id,tmdb_id,episode_number,name_ar,name_en,overview_ar,overview_en,still_url,runtime_minutes,air_date').in('season_id', ids).order('episode_number')
    : { data: [] as any[] };

  const episodeRows = episodes.data || [];

  // Sources are resolved only for the selected watch request. Resolving every
  // episode while rendering a series detail page creates an N+1 resolver storm.
  const seasonDtos = seasonRows.map((s: any) => ({
    id: s.id, seriesId: row.id, seasonNumber: s.season_number,
    name: s.name_ar || s.name_en || `الموسم ${s.season_number}`,
    nameEn: s.name_en || s.name_ar || `Season ${s.season_number}`,
    posterUrl: s.poster_url || '', overview: s.overview_ar || '',
    airDate: s.air_date || '', episodesCount: (episodes.data || []).filter((e: any) => e.season_id === s.id).length,
    episodes: (episodes.data || []).filter((e: any) => e.season_id === s.id).map((e: any) => ({
      id: e.id, seriesId: row.id, tmdbId: Number(e.tmdb_id || 0), seasonNumber: s.season_number, episodeNumber: e.episode_number,
      title: e.name_ar || e.name_en || `الحلقة ${e.episode_number}`,
      titleEn: e.name_en || e.name_ar || `Episode ${e.episode_number}`,
      overview: e.overview_ar || '', overviewEn: e.overview_en || e.overview_ar || '',
      stillUrl: e.still_url || '', duration: Number(e.runtime_minutes || 0), airDate: e.air_date || '',
      sources: [],
    })),
  }));

  return {
    id: row.id, tmdbId: Number(row.tmdb_id || 0), type: 'series',
    title: row.title_ar, titleEn: row.title_en || row.title_ar,
    originalTitle: row.original_title || row.title_en || row.title_ar,
    startYear: row.first_air_date ? Number(String(row.first_air_date).slice(0, 4)) : 0,
    endYear: row.last_air_date ? Number(String(row.last_air_date).slice(0, 4)) : undefined,
    releaseDate: row.first_air_date || '',
    rating: Number(row.rating || 0), votesCount: Number(row.vote_count || 0),
    overview: row.overview_ar || '', overviewEn: row.overview_en || row.overview_ar || '',
    posterUrl: row.poster_url || '', backdropUrl: row.backdrop_url || '',
    genres: (genres.data || []).map((x: any) => genreDto(x.genres)),
    creator: row.metadata?.creator_ar || '', creatorEn: row.metadata?.creator_en || '',
    cast: (cast.data || []).map((x: any) => ({
      id: x.people.id, name: x.people.name_ar || x.people.name_en,
      nameEn: x.people.name_en || x.people.name_ar,
      character: x.character_ar || '', characterEn: x.character_en || '',
      avatarUrl: x.people.avatar_url || '',
    })),
    seasonsCount: seasonDtos.length,
    episodesCount: seasonDtos.reduce((sum: number, s: any) => sum + s.episodes.length, 0),
    seasons: seasonDtos, isFeatured: !!row.featured, isTrending: !!row.trending, isPopular: !!row.popular,
    status: row.status, addedAt: row.created_at, ageRating: row.age_rating || '',
  } as any;
}

async function seriesWatchDto(row: any, seasonNumber: number, episodeNumber: number, requestUrl?: string, env?: Record<string, unknown>) {
  const [genresResult, castResult, seasonResult] = await Promise.all([
    adminSupabase.from('series_genres').select('genres(id,name_ar,name_en,slug)').eq('series_id', row.id),
    adminSupabase.from('series_cast').select('character_ar,character_en,people(id,name_ar,name_en,avatar_url)').eq('series_id', row.id).order('cast_order'),
    adminSupabase.from('seasons').select('id,series_id,season_number,name_ar,name_en,poster_url,overview_ar,air_date').eq('series_id', row.id).eq('season_number', seasonNumber).maybeSingle(),
  ]);

  if (seasonResult.error || !seasonResult.data) return null;
  const season = seasonResult.data;
  const genres = genresResult.error ? [] : (genresResult.data || []);
  const cast = castResult.error ? [] : (castResult.data || []);
  const { data: episodes, error: episodesError } = await adminSupabase
    .from('episodes').select('id,season_id,tmdb_id,episode_number,name_ar,name_en,overview_ar,overview_en,still_url,runtime_minutes,air_date').eq('season_id', season.id).order('episode_number');
  if (episodesError) throw new Error('Unable to load season episodes: ' + episodesError.message);

  // Playback is resolved exclusively by the live Broker for the selected episode.

  const seasonDto = {
    id: season.id, seriesId: row.id, seasonNumber: season.season_number,
    name: season.name_ar || season.name_en || ('الموسم ' + season.season_number),
    nameEn: season.name_en || season.name_ar || ('Season ' + season.season_number),
    posterUrl: season.poster_url || '', overview: season.overview_ar || '',
    airDate: season.air_date || '', episodesCount: (episodes || []).length,
    episodes: (episodes || []).map((e: any) => ({
      id: e.id, seriesId: row.id, tmdbId: Number(e.tmdb_id || 0),
      seasonNumber: season.season_number, episodeNumber: e.episode_number,
      title: e.name_ar || e.name_en || ('الحلقة ' + e.episode_number),
      titleEn: e.name_en || e.name_ar || ('Episode ' + e.episode_number),
      overview: e.overview_ar || '', overviewEn: e.overview_en || e.overview_ar || '',
      stillUrl: e.still_url || '', duration: Number(e.runtime_minutes || 0),
      airDate: e.air_date || '',
      sources: [],
    })),
  };

  return {
    id: row.id, tmdbId: Number(row.tmdb_id || 0), type: 'series',
    title: row.title_ar, titleEn: row.title_en || row.title_ar,
    originalTitle: row.original_title || row.title_en || row.title_ar,
    startYear: row.first_air_date ? Number(String(row.first_air_date).slice(0, 4)) : 0,
    endYear: row.last_air_date ? Number(String(row.last_air_date).slice(0, 4)) : undefined,
    releaseDate: row.first_air_date || '', rating: Number(row.rating || 0),
    votesCount: Number(row.vote_count || 0), overview: row.overview_ar || '',
    overviewEn: row.overview_en || row.overview_ar || '',
    posterUrl: row.poster_url || '', backdropUrl: row.backdrop_url || '',
    genres: genres.map((x: any) => genreDto(x.genres)),
    creator: row.metadata?.creator_ar || '', creatorEn: row.metadata?.creator_en || '',
    cast: cast.map((x: any) => ({
      id: x.people.id, name: x.people.name_ar || x.people.name_en,
      nameEn: x.people.name_en || x.people.name_ar, character: x.character_ar || '',
      characterEn: x.character_en || '', avatarUrl: x.people.avatar_url || '',
    })),
    seasonsCount: 1, episodesCount: seasonDto.episodesCount, seasons: [seasonDto],
    isFeatured: !!row.featured, isTrending: !!row.trending, isPopular: !!row.popular,
    status: row.status, addedAt: row.created_at, ageRating: row.age_rating || '',
  };
}

app.get(`${api}/subtitles/proxy`, asyncRoute(async (req, res) => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  let target: URL;

  try {
    target = new URL(rawUrl);
  } catch {
    return fail(res, 400, 'INVALID_SUBTITLE_URL', 'Invalid subtitle URL');
  }

  if (
    target.protocol !== 'https:' ||
    target.hostname !== 'commons.wikimedia.org' ||
    target.pathname !== '/w/api.php' ||
    target.searchParams.get('action') !== 'timedtext'
  ) {
    return fail(res, 403, 'SUBTITLE_URL_NOT_ALLOWED', 'Subtitle URL is not allowed');
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        Accept: 'text/vtt, text/plain;q=0.9, */*;q=0.8',
        'Accept-Language': 'ar,en;q=0.8',
        'User-Agent': 'MOVYZA/1.0 (subtitle proxy; https://movyza.app)',
      },
      redirect: 'follow',
    });

    if (!upstream.ok) {
      const upstreamBody = (await upstream.text()).slice(0, 1200);
      console.error('[subtitle-proxy-upstream]', upstream.status, upstreamBody);
      return fail(res, 502, 'SUBTITLE_FETCH_FAILED', `Wikimedia subtitle request failed (${upstream.status})`);
    }

    const body = (await upstream.text()).replace(/^\uFEFF/, '').trim();
    const isWebVtt = /^WEBVTT(?:\s|$)/i.test(body);
    const hasSrtCue = /(?:^|\n)\s*\d+\s*\n\s*\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(body);

    if (!body || (!isWebVtt && !hasSrtCue)) {
      return fail(res, 502, 'SUBTITLE_FORMAT_INVALID', 'Wikimedia returned an invalid timed-text payload');
    }

    const vttBody = isWebVtt
      ? body
      : `WEBVTT\n\n${body.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}\n`;

    const responseHeaders = new Headers({
      'content-type': 'text/vtt; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    });

    return new Response(vttBody, { status: 200, headers: responseHeaders });
  } catch (error) {
    console.error('[subtitle-proxy]', error instanceof Error ? error.message : error);
    return fail(res, 502, 'SUBTITLE_PROXY_FAILED', 'Subtitle proxy failed');
  }
}));

app.get('/health', asyncRoute(async (_req, res) => {
  const { error } = await adminSupabase.from('genres').select('id').limit(1);
  if (error) return fail(res, 503, 'DATABASE_UNAVAILABLE', 'Database check failed');
  return ok(res, { status: 'ok', service: 'movyz-api', timestamp: new Date().toISOString() });
}));

app.get(`${api}/genres`, asyncRoute(async (_req, res) => {
  const { data, error } = await adminSupabase.from('genres').select('id,name_ar,name_en,slug').order('id');
  if (error) return fail(res, 500, 'GENRES_QUERY_FAILED', 'Unable to load genres');
  return ok(res, (data || []).map(genreDto));
}));

app.get(`${api}/movies`, asyncRoute(async (req, res) => {
  const p = catalogQuery.safeParse(req.query);
  if (!p.success) return fail(res, 400, 'INVALID_QUERY', 'Invalid catalog parameters');
  const q = p.data;
  const from = (q.page - 1) * q.limit;
  const to = from + q.limit - 1;
  let query = adminSupabase.from('movies').select('id,tmdb_id,title_ar,title_en,original_title,release_date,rating,vote_count,runtime_minutes,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating', { count: 'exact' }).eq('status', 'published');
  if (q.year) query = query.gte('release_date', `${q.year}-01-01`).lt('release_date', `${q.year + 1}-01-01`);
  if (q.minRating !== undefined) query = query.gte('rating', q.minRating);
  if (q.search) query = query.or(`title_ar.ilike.%${q.search}%,title_en.ilike.%${q.search}%,original_title.ilike.%${q.search}%`);
  if (q.genreId) {
    const { data } = await adminSupabase.from('movie_genres').select('movie_id').eq('genre_id', q.genreId);
    query = query.in('id', (data || []).map((x: any) => x.movie_id));
  }
  query = q.sortBy === 'rating' ? query.order('rating', { ascending: false })
    : q.sortBy === 'newest' ? query.order('release_date', { ascending: false })
    : query.order('vote_count', { ascending: false });
  const { data, count, error } = await query.range(from, to);
  if (error) return fail(res, 500, 'MOVIES_QUERY_FAILED', 'Unable to load movies');
  const rows = data || [];
  const genreMap = await batchMovieGenres(rows.map((row: any) => row.id));
  const output = rows.map((row: any) => movieCardDto(row, genreMap.get(row.id) || []));
  return ok(res, output, { page: q.page, limit: q.limit, total: count || 0, totalPages: Math.ceil((count || 0) / q.limit) || 1 });
}));

app.get(`${api}/movies/tmdb/:tmdbId`, asyncRoute(async (req, res) => {
  const tmdbId = Number(req.params.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return fail(res, 400, 'INVALID_TMDB_ID', 'Invalid TMDB id');

  let { data, error } = await adminSupabase
    .from('movies')
    .select('id,tmdb_id,title_ar,title_en,original_title,release_date,rating,vote_count,runtime_minutes,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating')
    .eq('tmdb_id', tmdbId)
    .eq('status', 'published')
    .maybeSingle();

  if (error) return fail(res, 500, 'MOVIE_QUERY_FAILED', 'Unable to load movie');

  if (!data) {
    try {
      await syncMovieByTmdbId(tmdbId);
      const refreshed = await adminSupabase
        .from('movies')
        .select('id,tmdb_id,title_ar,title_en,original_title,release_date,rating,vote_count,runtime_minutes,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating')
        .eq('tmdb_id', tmdbId)
        .eq('status', 'published')
        .maybeSingle();
      data = refreshed.data;
      error = refreshed.error;
    } catch (syncError) {
      console.warn('[auto-import-movie]', syncError instanceof Error ? syncError.message : String(syncError));
    }
  }

  if (error || !data) return fail(res, 404, 'MOVIE_NOT_FOUND', 'Movie not found');
  const movie = await movieDto(data);
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=600');
  return ok(res, { movie, similar: [] });
}));

app.get(`${api}/movies/:id`, asyncRoute(async (req, res) => {
  const { data, error } = await adminSupabase.from('movies').select('id,tmdb_id,title_ar,title_en,original_title,release_date,rating,vote_count,runtime_minutes,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating').eq('id', req.params.id).eq('status', 'published').maybeSingle();
  if (error || !data) return fail(res, 404, 'MOVIE_NOT_FOUND', 'Movie not found');
  const movie = await movieDto(data);
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=600');
  return ok(res, { movie, similar: [] });
}));

app.get(`${api}/series`, asyncRoute(async (req, res) => {
  const p = catalogQuery.safeParse(req.query);
  if (!p.success) return fail(res, 400, 'INVALID_QUERY', 'Invalid catalog parameters');
  const q = p.data;
  const from = (q.page - 1) * q.limit;
  const to = from + q.limit - 1;
  let query = adminSupabase.from('series').select('id,tmdb_id,title_ar,title_en,original_title,first_air_date,last_air_date,rating,vote_count,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating', { count: 'exact' }).eq('status', 'published');
  if (q.year) query = query.gte('first_air_date', `${q.year}-01-01`).lt('first_air_date', `${q.year + 1}-01-01`);
  if (q.minRating !== undefined) query = query.gte('rating', q.minRating);
  if (q.search) query = query.or(`title_ar.ilike.%${q.search}%,title_en.ilike.%${q.search}%,original_title.ilike.%${q.search}%`);
  if (q.genreId) {
    const { data } = await adminSupabase.from('series_genres').select('series_id').eq('genre_id', q.genreId);
    query = query.in('id', (data || []).map((x: any) => x.series_id));
  }
  query = q.sortBy === 'rating' ? query.order('rating', { ascending: false })
    : q.sortBy === 'newest' ? query.order('first_air_date', { ascending: false })
    : query.order('vote_count', { ascending: false });
  const { data, count, error } = await query.range(from, to);
  if (error) return fail(res, 500, 'SERIES_QUERY_FAILED', 'Unable to load series');
  const rows = data || [];
  const genreMap = await batchSeriesGenres(rows.map((row: any) => row.id));
  const output = rows.map((row: any) => seriesCardDto(row, genreMap.get(row.id) || []));
  return ok(res, output, { page: q.page, limit: q.limit, total: count || 0, totalPages: Math.ceil((count || 0) / q.limit) || 1 });
}));

app.get(`${api}/series/tmdb/:tmdbId/watch/:season/:episode`, asyncRoute(async (req, res) => {
  const tmdbId = Number(req.params.tmdbId);
  const seasonNumber = Number(req.params.season);
  const episodeNumber = Number(req.params.episode);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
    return fail(res, 400, 'INVALID_WATCH_REQUEST', 'Invalid series watch request');
  }
  const { data, error } = await adminSupabase.from('series').select('id,tmdb_id,title_ar,title_en,original_title,first_air_date,last_air_date,rating,vote_count,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating')
    .eq('tmdb_id', tmdbId).eq('status', 'published').maybeSingle();
  if (error) return fail(res, 500, 'SERIES_QUERY_FAILED', 'Unable to load series');
  if (!data) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
  const series = await seriesWatchDto(data, seasonNumber, episodeNumber);
  if (!series) return fail(res, 404, 'SEASON_NOT_FOUND', 'Season not found');
  if (!series.seasons[0].episodes.some((item: any) => item.episodeNumber === episodeNumber)) {
    return fail(res, 404, 'EPISODE_NOT_FOUND', 'Episode not found');
  }
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=600');
  return ok(res, { series, currentSeason: series.seasons[0] });
}));

app.get(`${api}/series/:id/watch/:season/:episode`, asyncRoute(async (req, res) => {
  const seasonNumber = Number(req.params.season);
  const episodeNumber = Number(req.params.episode);
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
    return fail(res, 400, 'INVALID_WATCH_REQUEST', 'Invalid series watch request');
  }
  const { data, error } = await adminSupabase.from('series').select('id,tmdb_id,title_ar,title_en,original_title,first_air_date,last_air_date,rating,vote_count,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating')
    .eq('id', req.params.id).eq('status', 'published').maybeSingle();
  if (error) return fail(res, 500, 'SERIES_QUERY_FAILED', 'Unable to load series');
  if (!data) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
  const series = await seriesWatchDto(data, seasonNumber, episodeNumber);
  if (!series) return fail(res, 404, 'SEASON_NOT_FOUND', 'Season not found');
  if (!series.seasons[0].episodes.some((item: any) => item.episodeNumber === episodeNumber)) {
    return fail(res, 404, 'EPISODE_NOT_FOUND', 'Episode not found');
  }
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=600');
  return ok(res, { series, currentSeason: series.seasons[0] });
}));

app.get(`${api}/series/tmdb/:tmdbId`, asyncRoute(async (req, res) => {
  const tmdbId = Number(req.params.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return fail(res, 400, 'INVALID_TMDB_ID', 'Invalid TMDB id');

  let { data, error } = await adminSupabase
    .from('series')
    .select('id,tmdb_id,title_ar,title_en,original_title,first_air_date,last_air_date,rating,vote_count,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating')
    .eq('tmdb_id', tmdbId)
    .eq('status', 'published')
    .maybeSingle();

  if (error) return fail(res, 500, 'SERIES_QUERY_FAILED', 'Unable to load series');

  if (!data) {
    try {
      await syncSeriesByTmdbId(tmdbId);
      const refreshed = await adminSupabase
        .from('series')
        .select('id,tmdb_id,title_ar,title_en,original_title,first_air_date,last_air_date,rating,vote_count,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating')
        .eq('tmdb_id', tmdbId)
        .eq('status', 'published')
        .maybeSingle();
      data = refreshed.data;
      error = refreshed.error;
    } catch (syncError) {
      console.warn('[auto-import-series]', syncError instanceof Error ? syncError.message : String(syncError));
    }
  }

  if (error || !data) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
  const series = await seriesDto(data, false);
  return ok(res, { series, similar: [] });
}));

app.get(`${api}/series/:id`, asyncRoute(async (req, res) => {
  const { data, error } = await adminSupabase.from('series').select('id,tmdb_id,title_ar,title_en,original_title,first_air_date,last_air_date,rating,vote_count,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating').eq('id', req.params.id).eq('status', 'published').maybeSingle();
  if (error || !data) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
  const series = await seriesDto(data);
  return ok(res, { series, similar: [] });
}));

app.get(`${api}/series/:id/seasons`, asyncRoute(async (req, res) => {
  const { data: series, error: seriesError } = await adminSupabase
    .from('series').select('id').eq('id', req.params.id).eq('status', 'published').maybeSingle();
  if (seriesError || !series) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');

  const { data: seasons, error } = await adminSupabase
    .from('seasons').select('*').eq('series_id', req.params.id).order('season_number');
  if (error) return fail(res, 500, 'SEASONS_QUERY_FAILED', 'Unable to load seasons');

  const seasonRows = seasons || [];
  const seasonIds = seasonRows.map((season: any) => season.id);
  const { data: episodeRows } = seasonIds.length
    ? await adminSupabase.from('episodes').select('season_id').in('season_id', seasonIds)
    : { data: [] as any[] };
  const counts = new Map<string, number>();
  for (const episode of episodeRows || []) counts.set(episode.season_id, (counts.get(episode.season_id) || 0) + 1);

  return ok(res, seasonRows.map((season: any) => ({
    id: season.id, seriesId: season.series_id, tmdbId: season.tmdb_id, seasonNumber: season.season_number,
    name: season.name_ar || season.name_en || `الموسم ${season.season_number}`,
    nameEn: season.name_en || season.name_ar || `Season ${season.season_number}`,
    overview: season.overview_ar || '', overviewEn: season.overview_en || season.overview_ar || '',
    posterUrl: season.poster_url || '', airDate: season.air_date || '',
    episodesCount: counts.get(season.id) || 0,
  })));
}));

app.get(`${api}/seasons/:id`, asyncRoute(async (req, res) => {
  const { data: season, error } = await adminSupabase.from('seasons').select('*').eq('id', req.params.id).maybeSingle();
  if (error || !season) return fail(res, 404, 'SEASON_NOT_FOUND', 'Season not found');
  const { data: series } = await adminSupabase.from('series').select('id,title_ar,title_en,original_title,poster_url').eq('id', season.series_id).eq('status', 'published').maybeSingle();
  if (!series) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
  const { data: episodes, error: episodeError } = await adminSupabase.from('episodes').select('*').eq('season_id', season.id).order('episode_number');
  if (episodeError) return fail(res, 500, 'EPISODES_QUERY_FAILED', 'Unable to load episodes');
  return ok(res, {
    season: { id: season.id, seriesId: season.series_id, tmdbId: season.tmdb_id, seasonNumber: season.season_number,
      name: season.name_ar || season.name_en || `الموسم ${season.season_number}`, nameEn: season.name_en || season.name_ar || `Season ${season.season_number}`,
      overview: season.overview_ar || '', overviewEn: season.overview_en || season.overview_ar || '', posterUrl: season.poster_url || '', airDate: season.air_date || '',
      episodesCount: (episodes || []).length },
    series: { id: series.id, title: series.title_ar, titleEn: series.title_en || series.title_ar, originalTitle: series.original_title || series.title_en || series.title_ar, posterUrl: series.poster_url || '' },
    episodes: (episodes || []).map((episode: any) => ({
      id: episode.id, seriesId: series.id, seasonId: season.id, seasonNumber: season.season_number, tmdbId: episode.tmdb_id, episodeNumber: episode.episode_number,
      title: episode.name_ar || episode.name_en || `الحلقة ${episode.episode_number}`, titleEn: episode.name_en || episode.name_ar || `Episode ${episode.episode_number}`,
      overview: episode.overview_ar || '', overviewEn: episode.overview_en || episode.overview_ar || '', stillUrl: episode.still_url || '',
      duration: Number(episode.runtime_minutes || 0), airDate: episode.air_date || '',
    })),
  });
}));

app.get(`${api}/episodes/:id`, asyncRoute(async (req, res) => {
  const { data: episode, error } = await adminSupabase.from('episodes').select('*').eq('id', req.params.id).maybeSingle();
  if (error || !episode) return fail(res, 404, 'EPISODE_NOT_FOUND', 'Episode not found');
  const { data: season } = await adminSupabase.from('seasons').select('id,series_id,season_number,name_ar,name_en').eq('id', episode.season_id).maybeSingle();
  if (!season) return fail(res, 404, 'SEASON_NOT_FOUND', 'Season not found');
  const { data: series } = await adminSupabase.from('series').select('id,title_ar,title_en,original_title,poster_url,backdrop_url').eq('id', season.series_id).eq('status', 'published').maybeSingle();
  if (!series) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
  return ok(res, {
    id: episode.id, seriesId: series.id, seasonId: season.id, seasonNumber: season.season_number, tmdbId: episode.tmdb_id, episodeNumber: episode.episode_number,
    title: episode.name_ar || episode.name_en || `الحلقة ${episode.episode_number}`, titleEn: episode.name_en || episode.name_ar || `Episode ${episode.episode_number}`,
    overview: episode.overview_ar || '', overviewEn: episode.overview_en || episode.overview_ar || '', stillUrl: episode.still_url || '',
    duration: Number(episode.runtime_minutes || 0), airDate: episode.air_date || '',
    series: { id: series.id, title: series.title_ar, titleEn: series.title_en || series.title_ar, originalTitle: series.original_title || series.title_en || series.title_ar, posterUrl: series.poster_url || '', backdropUrl: series.backdrop_url || '' },
    season: { id: season.id, seasonNumber: season.season_number, name: season.name_ar || season.name_en || `الموسم ${season.season_number}`, nameEn: season.name_en || season.name_ar || `Season ${season.season_number}` },
  });
}));

app.get(`${api}/watch/:id`, asyncRoute(async (req, res) => {
  const contentType = z.enum(['movie', 'episode']).default('movie').parse(req.query.type);
  const id = req.params.id;

  if (contentType === 'movie') {
    const { data, error } = await adminSupabase
      .from('movies')
      .select('*')
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle();
    if (error || !data) return fail(res, 404, 'MOVIE_NOT_FOUND', 'Movie not found');
    return ok(res, {
      contentType,
      id,
      tmdbId: Number(data.tmdb_id || 0),
      content: await movieDto(data),
    });
  }

  const { data: episode, error } = await adminSupabase
    .from('episodes')
    .select('*,seasons(id,season_number,series_id,series:series_id(id,title_ar,title_en,original_title,status,tmdb_id,poster_url,backdrop_url))')
    .eq('id', id)
    .maybeSingle();
  const series = episode?.seasons?.series;
  if (error || !episode || !series || series.status !== 'published') {
    return fail(res, 404, 'EPISODE_NOT_FOUND', 'Episode not found');
  }

  return ok(res, {
    contentType,
    id,
    tmdbId: Number(series.tmdb_id || 0),
    content: {
      id: episode.id,
      seriesId: series.id,
      seriesTitle: series.title_ar,
      seriesTitleEn: series.title_en || series.title_ar,
      seasonNumber: episode.seasons.season_number,
      episodeNumber: episode.episode_number,
      title: episode.name_ar || episode.name_en || ('الحلقة ' + episode.episode_number),
      titleEn: episode.name_en || episode.name_ar || ('Episode ' + episode.episode_number),
      overview: episode.overview_ar || '',
      overviewEn: episode.overview_en || episode.overview_ar || '',
      stillUrl: episode.still_url || '',
      duration: Number(episode.runtime_minutes || 0),
      airDate: episode.air_date || '',
      sources: [],
    },
  });
}));

app.get(`${api}/search`, asyncRoute(async (req, res) => {
  const q = z.string().trim().min(1).max(100).parse(req.query.q);
  const [movies, series, people] = await Promise.all([
    adminSupabase.from('movies').select('id,tmdb_id,title_ar,title_en,original_title,release_date,rating,vote_count,runtime_minutes,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating').eq('status', 'published').or(`title_ar.ilike.%${q}%,title_en.ilike.%${q}%,original_title.ilike.%${q}%`).limit(24),
    adminSupabase.from('series').select('id,tmdb_id,title_ar,title_en,original_title,first_air_date,last_air_date,rating,vote_count,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating').eq('status', 'published').or(`title_ar.ilike.%${q}%,title_en.ilike.%${q}%,original_title.ilike.%${q}%`).limit(24),
    adminSupabase.from('people').select('id,name_ar,name_en,original_name,avatar_url').or(`name_ar.ilike.%${q}%,name_en.ilike.%${q}%,original_name.ilike.%${q}%`).limit(12),
  ]);
  const movieRows = movies.data || []; const seriesRows = series.data || []; const personRows = people.data || [];
  const [movieGenres, seriesGenres] = await Promise.all([batchMovieGenres(movieRows.map((row: any) => row.id)), batchSeriesGenres(seriesRows.map((row: any) => row.id))]);
  const personIds = personRows.map((person: any) => person.id);
  const [movieLinks, seriesLinks] = personIds.length ? await Promise.all([
    adminSupabase.from('movie_cast').select('person_id').in('person_id', personIds),
    adminSupabase.from('series_cast').select('person_id').in('person_id', personIds),
  ]) : [{ data: [] as any[] }, { data: [] as any[] }];
  const workCounts = new Map<string, number>();
  for (const link of [...(movieLinks.data || []), ...(seriesLinks.data || [])]) workCounts.set(link.person_id, (workCounts.get(link.person_id) || 0) + 1);
  const movieResults = movieRows.map((row: any) => movieCardDto(row, movieGenres.get(row.id) || []));
  const seriesResults = seriesRows.map((row: any) => seriesCardDto(row, seriesGenres.get(row.id) || []));
  const castResults = personRows.map((person: any) => ({ name: person.name_ar || person.name_en || person.original_name || '', nameEn: person.name_en || person.original_name || person.name_ar || '', worksCount: workCounts.get(person.id) || 0, avatarUrl: person.avatar_url || '' }));
  return ok(res, { movies: movieResults, series: seriesResults, cast: castResults }, { total: movieResults.length + seriesResults.length + castResults.length });
}));
app.get(`${api}/home`, asyncRoute(async (_req, res) => {
  const [movies, series, recentMovies, recentSeries, genres] = await Promise.all([
    adminSupabase.from('movies').select('id,tmdb_id,title_ar,title_en,original_title,release_date,rating,vote_count,runtime_minutes,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating').eq('status', 'published').order('vote_count', { ascending: false }).limit(12),
    adminSupabase.from('series').select('id,tmdb_id,title_ar,title_en,original_title,first_air_date,last_air_date,rating,vote_count,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating').eq('status', 'published').order('vote_count', { ascending: false }).limit(12),
    adminSupabase.from('movies').select('id,tmdb_id,title_ar,title_en,original_title,release_date,rating,vote_count,runtime_minutes,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating').eq('status', 'published').order('created_at', { ascending: false }).limit(12),
    adminSupabase.from('series').select('id,tmdb_id,title_ar,title_en,original_title,first_air_date,last_air_date,rating,vote_count,overview_ar,overview_en,poster_url,backdrop_url,metadata,featured,trending,popular,status,created_at,age_rating').eq('status', 'published').order('created_at', { ascending: false }).limit(12),
    adminSupabase.from('genres').select('id,name_ar,name_en,slug').order('id'),
  ]);
  const movieRows = movies.data || [];
  const seriesRows = series.data || [];
  const recentMovieRows = recentMovies.data || [];
  const recentSeriesRows = recentSeries.data || [];
  const allMovieRows = [...new Map([...movieRows, ...recentMovieRows].map((row: any) => [row.id, row])).values()];
  const allSeriesRows = [...new Map([...seriesRows, ...recentSeriesRows].map((row: any) => [row.id, row])).values()];
  const [movieGenres, seriesGenres] = await Promise.all([
    batchMovieGenres(allMovieRows.map((row: any) => row.id)),
    batchSeriesGenres(allSeriesRows.map((row: any) => row.id)),
  ]);
  const movieDtos = movieRows.map((row: any) => movieCardDto(row, movieGenres.get(row.id) || []));
  const seriesDtos = seriesRows.map((row: any) => seriesCardDto(row, seriesGenres.get(row.id) || []));
  const recentMovieDtos = recentMovieRows.map((row: any) => movieCardDto(row, movieGenres.get(row.id) || []));
  const recentSeriesDtos = recentSeriesRows.map((row: any) => seriesCardDto(row, seriesGenres.get(row.id) || []));
  const combined = [...movieDtos, ...seriesDtos].sort((a: any, b: any) => b.rating - a.rating);
  return ok(res, {
    hero: combined.find((x: any) => x.isFeatured) || combined[0],
    continueWatching: [],
    trending: combined.filter((x: any) => x.isTrending),
    popularMovies: movieDtos.filter((x: any) => x.isPopular),
    featuredSeries: seriesDtos.filter((x: any) => x.isFeatured),
    recentAdded: [...recentMovieDtos, ...recentSeriesDtos]
      .sort((a: any, b: any) => String(b.addedAt).localeCompare(String(a.addedAt)))
      .slice(0, 24),
    genres: (genres.data || []).map(genreDto),
  });
}));

app.get(`${api}/auth/me`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { data: authData } = await req.supabase!.auth.getUser();
  const { data: profile } = await req.supabase!.from('profiles').select('*').eq('id', req.userId!).single();
  return ok(res, {
    id: req.userId, email: authData.user?.email || '', name: profile?.display_name || '',
    role: profile?.role || 'USER', avatarUrl: profile?.avatar_url || '',
    preferredLanguage: profile?.locale || 'ar', createdAt: profile?.created_at || '',
  });
}));

app.get(`${api}/watchlist`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { data, error } = await req.supabase!.from('watchlist').select('*').eq('user_id', req.userId!).order('created_at', { ascending: false });
  if (error) return fail(res, 500, 'WATCHLIST_QUERY_FAILED', 'Unable to load watchlist');
  const rows = data || [];
  const movieIds = rows.filter((x: any) => x.content_type === 'movie').map((x: any) => x.content_id);
  const seriesIds = rows.filter((x: any) => x.content_type === 'series').map((x: any) => x.content_id);
  const [movies, series] = await Promise.all([
    movieIds.length ? adminSupabase.from('movies').select('*').in('id', movieIds) : { data: [] as any[] },
    seriesIds.length ? adminSupabase.from('series').select('*').in('id', seriesIds) : { data: [] as any[] },
  ]);
  const movieMap = new Map((movies.data || []).map((x: any) => [x.id, x]));
  const seriesMap = new Map((series.data || []).map((x: any) => [x.id, x]));
  const [movieGenres, seriesGenres] = await Promise.all([batchMovieGenres(movieIds), batchSeriesGenres(seriesIds)]);
  return ok(res, rows.map((x: any) => {
    const row = x.content_type === 'movie' ? movieMap.get(x.content_id) : seriesMap.get(x.content_id);
    const genres = x.content_type === 'movie' ? movieGenres.get(x.content_id) || [] : seriesGenres.get(x.content_id) || [];
    return { id: x.id, userId: x.user_id, contentId: x.content_id, contentType: x.content_type, title: row?.title_ar || '', titleEn: row?.title_en || row?.title_ar || '', posterUrl: row?.poster_url || '', year: Number(String(row?.release_date || row?.first_air_date || '').slice(0,4)) || 0, rating: Number(row?.rating || 0), genres, addedAt: x.created_at };
  }));
}));
app.get(`${api}/history`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { data, error } = await req.supabase!.from('watch_history').select('*').eq('user_id', req.userId!).order('updated_at', { ascending: false }).limit(100);
  if (error) return fail(res, 500, 'HISTORY_QUERY_FAILED', 'Unable to load history');
  const rows = data || [];
  const movieIds = rows.filter((x: any) => x.content_type === 'movie').map((x: any) => x.content_id);
  const episodeIds = rows.filter((x: any) => x.content_type === 'episode').map((x: any) => x.content_id);
  const [movies, episodes] = await Promise.all([
    movieIds.length ? adminSupabase.from('movies').select('id,tmdb_id,title_ar,title_en,poster_url,backdrop_url,rating').in('id', movieIds) : { data: [] as any[] },
    episodeIds.length ? adminSupabase.from('episodes').select('id,season_id,episode_number,name_ar,name_en').in('id', episodeIds) : { data: [] as any[] },
  ]);
  const movieMap = new Map((movies.data || []).map((x: any) => [x.id, x]));
  const episodeRows = episodes.data || []; const seasonIds = episodeRows.map((x: any) => x.season_id);
  const { data: seasons } = seasonIds.length ? await adminSupabase.from('seasons').select('id,series_id,season_number').in('id', seasonIds) : { data: [] as any[] };
  const seasonMap = new Map((seasons || []).map((x: any) => [x.id, x]));
  const seriesIds = [...new Set((seasons || []).map((x: any) => x.series_id))];
  const { data: seriesRows } = seriesIds.length ? await adminSupabase.from('series').select('id,tmdb_id,title_ar,title_en,poster_url,backdrop_url,rating').in('id', seriesIds) : { data: [] as any[] };
  const seriesMap = new Map((seriesRows || []).map((x: any) => [x.id, x])); const episodeMap = new Map(episodeRows.map((x: any) => [x.id, x]));
  return ok(res, rows.map((x: any) => {
    const movie = x.content_type === 'movie' ? movieMap.get(x.content_id) : null; const episode = x.content_type === 'episode' ? episodeMap.get(x.content_id) : null;
    const season = episode ? seasonMap.get(episode.season_id) : null; const series = season ? seriesMap.get(season.series_id) : null; const base = movie || series;
    return { contentId: base?.id || x.content_id, tmdbId: Number(base?.tmdb_id || 0), contentType: movie ? 'movie' : 'series', episodeId: episode?.id || undefined, episodeNumber: episode?.episode_number || undefined, seasonNumber: season?.season_number || undefined,
      title: base?.title_ar || episode?.name_ar || '', titleEn: base?.title_en || episode?.name_en || '', posterUrl: base?.poster_url || '', backdropUrl: base?.backdrop_url || '',
      positionSeconds: x.position_seconds, durationSeconds: x.duration_seconds, percentage: x.duration_seconds ? Math.floor((x.position_seconds / x.duration_seconds) * 100) : 0, lastWatchedAt: x.updated_at, completed: x.completed };
  }));
}));
app.delete(`${api}/history`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { error } = await req.supabase!.from('watch_history').delete().eq('user_id', req.userId!);
  if (error) return fail(res, 500, 'HISTORY_DELETE_FAILED', 'Unable to clear history');
  return ok(res, { cleared: true });
}));

app.get(`${api}/watch/:id/progress`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const episodeId = typeof req.query.episodeId === 'string' ? req.query.episodeId : null;
  const contentType = episodeId ? 'episode' : 'movie'; const contentId = episodeId || req.params.id;
  const { data, error } = await req.supabase!.from('watch_history').select('*').eq('user_id', req.userId!).eq('content_type', contentType).eq('content_id', contentId).maybeSingle();
  if (error) return fail(res, 500, 'PROGRESS_QUERY_FAILED', 'Unable to load progress'); if (!data) return ok(res, null);
  if (contentType === 'episode') {
    const { data: episode } = await adminSupabase.from('episodes').select('id,season_id,episode_number').eq('id', data.content_id).maybeSingle();
    const { data: season } = episode ? await adminSupabase.from('seasons').select('id,series_id,season_number').eq('id', episode.season_id).maybeSingle() : { data: null };
    const { data: series } = season ? await adminSupabase.from('series').select('id,title_ar,title_en,poster_url,backdrop_url').eq('id', season.series_id).maybeSingle() : { data: null };
    return ok(res, { contentId: series?.id || data.content_id, contentType: 'series', title: series?.title_ar || '', titleEn: series?.title_en || '', posterUrl: series?.poster_url || '', backdropUrl: series?.backdrop_url || '', positionSeconds: data.position_seconds, durationSeconds: data.duration_seconds, percentage: data.duration_seconds ? Math.floor((data.position_seconds / data.duration_seconds) * 100) : 0, lastWatchedAt: data.updated_at, completed: data.completed, episodeId: data.content_id, episodeNumber: episode?.episode_number || undefined, seasonNumber: season?.season_number || undefined });
  }
  const { data: movie } = await adminSupabase.from('movies').select('title_ar,title_en,poster_url,backdrop_url').eq('id', data.content_id).maybeSingle();
  return ok(res, { contentId: data.content_id, contentType: 'movie', title: movie?.title_ar || '', titleEn: movie?.title_en || '', posterUrl: movie?.poster_url || '', backdropUrl: movie?.backdrop_url || '', positionSeconds: data.position_seconds, durationSeconds: data.duration_seconds, percentage: data.duration_seconds ? Math.floor((data.position_seconds / data.duration_seconds) * 100) : 0, lastWatchedAt: data.updated_at, completed: data.completed });
}));

app.post(`${api}/watch/:id/progress`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = z.object({
    contentType: z.enum(['movie', 'series']),
    episodeId: z.string().uuid().optional(),
    positionSeconds: z.number().int().min(0),
    durationSeconds: z.number().int().min(0),
    completed: z.boolean().default(false),
  }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid progress payload');
  const type = body.data.episodeId ? 'episode' : 'movie';
  const contentId = body.data.episodeId || req.params.id;
  const { data, error } = await req.supabase!.from('watch_history').upsert({
    user_id: req.userId!, content_type: type, content_id: contentId,
    position_seconds: body.data.positionSeconds, duration_seconds: body.data.durationSeconds,
    completed: body.data.completed,
  }, { onConflict: 'user_id,content_type,content_id' }).select('*').single();
  if (error) return fail(res, 500, 'PROGRESS_WRITE_FAILED', 'Unable to save progress');
  return ok(res, {
    contentId: data.content_id, contentType: body.data.contentType, title: '', titleEn: '',
    posterUrl: '', backdropUrl: '', positionSeconds: data.position_seconds, durationSeconds: data.duration_seconds,
    percentage: data.duration_seconds ? Math.floor((data.position_seconds / data.duration_seconds) * 100) : 0,
    lastWatchedAt: data.updated_at, completed: data.completed, episodeId: body.data.episodeId,
  });
}));

app.post(`${api}/reports`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = z.object({
    contentId: z.string().uuid(), contentType: z.enum(['movie', 'episode']),
    contentTitle: z.string().max(300), sourceId: z.string().uuid(),
    issueType: z.string().max(80), description: z.string().max(2000),
  }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid report payload');
  const { data, error } = await req.supabase!.from('reports').insert({
    user_id: req.userId!, content_id: body.data.contentId, content_type: body.data.contentType,
    source_id: body.data.sourceId, issue_type: body.data.issueType, description: body.data.description,
  }).select('*').single();
  if (error) return fail(res, 500, 'REPORT_WRITE_FAILED', 'Unable to submit report');
  return created(res, {
    id: data.id, contentId: data.content_id, contentTitle: body.data.contentTitle,
    sourceId: data.source_id, issueType: data.issue_type, description: data.description || '',
    reportedAt: data.created_at, status: data.status,
  });
}));


async function writeAudit(actorId: string, action: string, targetType: string, targetId: string, details: Record<string, unknown> = {}) {
  await adminSupabase.from('audit_logs').insert({ actor_id: actorId, action, target_type: targetType, target_id: targetId, details });
}

const adminListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
});

app.get(`${api}` + '/admin/movies', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const parsed = adminListQuery.safeParse(req.query);
  if (!parsed.success) return fail(res, 400, 'INVALID_QUERY', 'Invalid admin movie parameters');
  const { page, limit, search } = parsed.data;
  let query = adminSupabase.from('movies').select('*', { count: 'exact' }).order('updated_at', { ascending: false });
  if (search) query = query.or('title_ar.ilike.%' + search + '%,title_en.ilike.%' + search + '%,original_title.ilike.%' + search + '%');
  const from = (page - 1) * limit;
  const { data, count, error } = await query.range(from, from + limit - 1);
  if (error) return fail(res, 500, 'ADMIN_MOVIES_QUERY_FAILED', 'Unable to load admin movies');
  return ok(res, (data || []).map((row: any) => movieCardDto(row)), { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) || 1 });
}));

const adminMovieBody = z.object({
  titleAr: z.string().min(1).max(300),
  titleEn: z.string().max(300).optional().nullable(),
  originalTitle: z.string().max(300).optional().nullable(),
  overviewAr: z.string().max(10000).optional().nullable(),
  overviewEn: z.string().max(10000).optional().nullable(),
  posterUrl: z.string().url().optional().nullable(),
  backdropUrl: z.string().url().optional().nullable(),
  releaseDate: z.string().optional().nullable(),
  runtimeMinutes: z.number().int().min(0).max(1000).optional().nullable(),
  rating: z.number().min(0).max(10).optional(),
  voteCount: z.number().int().min(0).optional(),
  ageRating: z.string().max(30).optional().nullable(),
  status: z.enum(['draft','published','archived']).optional(),
  featured: z.boolean().optional(), trending: z.boolean().optional(), popular: z.boolean().optional(),
});

app.post(`${api}` + '/admin/movies', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = adminMovieBody.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid movie payload');
  const b = body.data;
  const { data, error } = await adminSupabase.from('movies').insert({
    title_ar: b.titleAr, title_en: b.titleEn || null, original_title: b.originalTitle || null,
    overview_ar: b.overviewAr || '', overview_en: b.overviewEn || '', poster_url: b.posterUrl || '', backdrop_url: b.backdropUrl || '',
    release_date: b.releaseDate || null, runtime_minutes: b.runtimeMinutes ?? null, rating: b.rating ?? 0, vote_count: b.voteCount ?? 0,
    age_rating: b.ageRating || '', status: b.status || 'draft', featured: b.featured ?? false, trending: b.trending ?? false, popular: b.popular ?? false,
  }).select('*').single();
  if (error || !data) return fail(res, 500, 'MOVIE_CREATE_FAILED', 'Unable to create movie');
  await writeAudit(req.userId!, 'create_movie', 'movie', data.id);
  return created(res, movieCardDto(data));
}));

app.patch(`${api}` + '/admin/movies/:id', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = adminMovieBody.partial().safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid movie payload');
  const b = body.data;
  const map: Record<string,string> = { titleAr:'title_ar', titleEn:'title_en', originalTitle:'original_title', overviewAr:'overview_ar', overviewEn:'overview_en', posterUrl:'poster_url', backdropUrl:'backdrop_url', releaseDate:'release_date', runtimeMinutes:'runtime_minutes', rating:'rating', voteCount:'vote_count', ageRating:'age_rating', status:'status', featured:'featured', trending:'trending', popular:'popular' };
  const update: Record<string, unknown> = {};
  for (const [from,to] of Object.entries(map)) if ((b as any)[from] !== undefined) update[to] = (b as any)[from];
  const { data, error } = await adminSupabase.from('movies').update(update).eq('id', req.params.id).select('*').maybeSingle();
  if (error || !data) return fail(res, 404, 'MOVIE_UPDATE_FAILED', 'Movie not found or not updated');
  await writeAudit(req.userId!, 'update_movie', 'movie', data.id, { fields: Object.keys(update) });
  return ok(res, movieCardDto(data));
}));

app.get(`${api}` + '/admin/series', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const parsed = adminListQuery.safeParse(req.query);
  if (!parsed.success) return fail(res, 400, 'INVALID_QUERY', 'Invalid admin series parameters');
  const { page, limit, search } = parsed.data;
  let query = adminSupabase.from('series').select('*', { count: 'exact' }).order('updated_at', { ascending: false });
  if (search) query = query.or('title_ar.ilike.%' + search + '%,title_en.ilike.%' + search + '%,original_title.ilike.%' + search + '%');
  const from = (page - 1) * limit;
  const { data, count, error } = await query.range(from, from + limit - 1);
  if (error) return fail(res, 500, 'ADMIN_SERIES_QUERY_FAILED', 'Unable to load admin series');
  return ok(res, (data || []).map((row: any) => seriesCardDto(row)), { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) || 1 });
}));

const adminSeriesBody = z.object({
  titleAr: z.string().min(1).max(300),
  titleEn: z.string().max(300).optional().nullable(),
  originalTitle: z.string().max(300).optional().nullable(),
  overviewAr: z.string().max(10000).optional().nullable(),
  overviewEn: z.string().max(10000).optional().nullable(),
  posterUrl: z.string().url().optional().nullable(),
  backdropUrl: z.string().url().optional().nullable(),
  firstAirDate: z.string().optional().nullable(),
  lastAirDate: z.string().optional().nullable(),
  rating: z.number().min(0).max(10).optional(), voteCount: z.number().int().min(0).optional(),
  ageRating: z.string().max(30).optional().nullable(), status: z.enum(['draft','published','archived']).optional(),
  featured: z.boolean().optional(), trending: z.boolean().optional(), popular: z.boolean().optional(),
});

app.post(`${api}` + '/admin/series', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = adminSeriesBody.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid series payload');
  const b = body.data;
  const { data, error } = await adminSupabase.from('series').insert({
    title_ar: b.titleAr, title_en: b.titleEn || null, original_title: b.originalTitle || null,
    overview_ar: b.overviewAr || '', overview_en: b.overviewEn || '', poster_url: b.posterUrl || '', backdrop_url: b.backdropUrl || '',
    first_air_date: b.firstAirDate || null, last_air_date: b.lastAirDate || null, rating: b.rating ?? 0, vote_count: b.voteCount ?? 0,
    age_rating: b.ageRating || '', status: b.status || 'draft', featured: b.featured ?? false, trending: b.trending ?? false, popular: b.popular ?? false,
  }).select('*').single();
  if (error || !data) return fail(res, 500, 'SERIES_CREATE_FAILED', 'Unable to create series');
  await writeAudit(req.userId!, 'create_series', 'series', data.id);
  return created(res, seriesCardDto(data));
}));

app.patch(`${api}` + '/admin/series/:id', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = adminSeriesBody.partial().safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid series payload');
  const b = body.data;
  const map: Record<string,string> = { titleAr:'title_ar', titleEn:'title_en', originalTitle:'original_title', overviewAr:'overview_ar', overviewEn:'overview_en', posterUrl:'poster_url', backdropUrl:'backdrop_url', firstAirDate:'first_air_date', lastAirDate:'last_air_date', rating:'rating', voteCount:'vote_count', ageRating:'age_rating', status:'status', featured:'featured', trending:'trending', popular:'popular' };
  const update: Record<string,unknown> = {};
  for (const [from,to] of Object.entries(map)) if ((b as any)[from] !== undefined) update[to] = (b as any)[from];
  const { data, error } = await adminSupabase.from('series').update(update).eq('id', req.params.id).select('*').maybeSingle();
  if (error || !data) return fail(res, 404, 'SERIES_UPDATE_FAILED', 'Series not found or not updated');
  await writeAudit(req.userId!, 'update_series', 'series', data.id, { fields:Object.keys(update) });
  return ok(res, seriesCardDto(data));
}));

app.get(`${api}` + '/admin/episodes', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const q = z.object({ seriesId:z.string().uuid().optional(), seasonId:z.string().uuid().optional(), page:z.coerce.number().int().min(1).default(1), limit:z.coerce.number().int().min(1).max(100).default(50) }).safeParse(req.query);
  if (!q.success) return fail(res, 400, 'INVALID_QUERY', 'Invalid episode parameters');
  const { seriesId, seasonId, page, limit } = q.data;
  let query = adminSupabase.from('episodes').select('*,seasons(series_id,season_number)', { count:'exact' }).order('episode_number');
  if (seasonId) query = query.eq('season_id', seasonId);
  const from = (page - 1) * limit;
  const result = await query.range(from, from + limit - 1);
  if (result.error) return fail(res, 500, 'EPISODES_QUERY_FAILED', 'Unable to load episodes');
  let rows = result.data || [];
  if (seriesId) rows = rows.filter((x:any) => x.seasons?.series_id === seriesId);
  return ok(res, rows, { page, limit, total:result.count || rows.length, totalPages:Math.ceil((result.count || rows.length)/limit) || 1 });
}));

const adminEpisodeBody = z.object({
  seasonId:z.string().uuid(), episodeNumber:z.number().int().min(1), nameAr:z.string().min(1).max(500), nameEn:z.string().max(500).optional().nullable(),
  overviewAr:z.string().max(10000).optional().nullable(), overviewEn:z.string().max(10000).optional().nullable(),
  stillUrl:z.string().url().optional().nullable(), airDate:z.string().optional().nullable(), runtimeMinutes:z.number().int().min(0).max(1000).optional().nullable(),
});

app.post(`${api}` + '/admin/episodes', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = adminEpisodeBody.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid episode payload');
  const b = body.data;
  const { data, error } = await adminSupabase.from('episodes').insert({
    season_id:b.seasonId, episode_number:b.episodeNumber, name_ar:b.nameAr, name_en:b.nameEn || null, overview_ar:b.overviewAr || '', overview_en:b.overviewEn || '',
    still_url:b.stillUrl || '', air_date:b.airDate || null, runtime_minutes:b.runtimeMinutes ?? null,
  }).select('*').single();
  if (error || !data) return fail(res, 500, 'EPISODE_CREATE_FAILED', 'Unable to create episode');
  await writeAudit(req.userId!, 'create_episode', 'episode', data.id);
  return created(res, data);
}));

app.patch(`${api}` + '/admin/episodes/:id', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = adminEpisodeBody.partial().safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid episode payload');
  const b = body.data;
  const map: Record<string,string> = { seasonId:'season_id', episodeNumber:'episode_number', nameAr:'name_ar', nameEn:'name_en', overviewAr:'overview_ar', overviewEn:'overview_en', stillUrl:'still_url', airDate:'air_date', runtimeMinutes:'runtime_minutes' };
  const update: Record<string,unknown> = {};
  for (const [from,to] of Object.entries(map)) if ((b as any)[from] !== undefined) update[to] = (b as any)[from];
  const { data, error } = await adminSupabase.from('episodes').update(update).eq('id', req.params.id).select('*').maybeSingle();
  if (error || !data) return fail(res, 404, 'EPISODE_UPDATE_FAILED', 'Episode not found or not updated');
  await writeAudit(req.userId!, 'update_episode', 'episode', data.id, { fields:Object.keys(update) });
  return ok(res, data);
}));

app.delete(`${api}` + '/admin/episodes/:id', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { error } = await adminSupabase.from('episodes').delete().eq('id', req.params.id);
  if (error) return fail(res, 500, 'EPISODE_DELETE_FAILED', 'Unable to delete episode');
  await writeAudit(req.userId!, 'delete_episode', 'episode', req.params.id);
  return ok(res, { deleted:true });
}));

app.post(`${api}/internal/tmdb/sync-fresh`, asyncRoute(async (req, res) => {
  const expectedKey = String(req.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const providedKey = String(req.header('x-movyz-internal-key') || '').trim();
  if (!expectedKey || !providedKey || providedKey !== expectedKey) return fail(res, 401, 'UNAUTHORIZED', 'Unauthorized internal fresh sync request');
  const body = z.object({ pages: z.number().int().min(1).max(3).default(2) }).safeParse(req.body || {});
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid fresh sync options');
  try { return ok(res, await runFreshTmdbSync({ pages: body.data.pages })); }
  catch (error) { return fail(res, 502, 'TMDB_FRESH_SYNC_FAILED', error instanceof Error ? error.message : String(error)); }
}));

app.post(`${api}/admin/sync/tmdb/episodes`, requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = z.object({ seriesLimit: z.number().int().min(1).max(25).default(10) }).safeParse(req.body || {});
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid episode sync options');
  try {
    const result = await syncEpisodesForSeries(body.data.seriesLimit);
    await adminSupabase.from('audit_logs').insert({
      actor_id: req.userId,
      action: 'tmdb_episode_sync',
      target_type: 'episodes',
      target_id: 'tmdb',
      details: result,
    });
    return ok(res, {
      syncedCount: result.episodes,
      message: `Episode sync completed: ${result.episodes} episodes across ${result.seasons} seasons`,
    });
  } catch (error) {
    return fail(res, 502, 'TMDB_EPISODE_SYNC_FAILED', error instanceof Error ? error.message : 'Episode sync failed');
  }
}));

app.post(`${api}/internal/tmdb/import-curated`, asyncRoute(async (req, res) => {
  const expectedKey = String(req.env?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const providedKey = String(req.header('x-movyz-internal-key') || '').trim();
  if (!expectedKey || !providedKey || providedKey !== expectedKey) {
    return fail(res, 401, 'UNAUTHORIZED', 'Unauthorized internal import request');
  }

  const body = z.object({
    items: z.array(z.object({
      rank: z.number().int().min(1).max(200),
      title: z.string().trim().min(1).max(300),
      year: z.number().int().min(1900).max(2100).optional(),
      mediaType: z.enum(['movie', 'series']),
    })).min(1).max(200),
  }).safeParse(req.body || {});

  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid curated catalog payload');

  try {
    const result = await importCuratedCatalog(body.data.items);
    return ok(res, result);
  } catch (error) {
    return fail(res, 502, 'CURATED_IMPORT_FAILED', error instanceof Error ? error.message : String(error));
  }
}));

app.get(`${api}/admin/sync/jobs`, requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await adminSupabase
    .from('sync_jobs')
    .select('id,provider,job_type,status,pages,movies_synced,series_synced,seasons_synced,episodes_synced,error,started_at,finished_at,created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return fail(res, 500, 'SYNC_JOBS_QUERY_FAILED', 'Unable to load sync jobs');

  return ok(res, (data || []).map((job: any) => ({
    id: job.id,
    provider: job.provider,
    jobType: job.job_type,
    status: job.status,
    pages: job.pages,
    moviesSynced: job.movies_synced,
    seriesSynced: job.series_synced,
    seasonsSynced: job.seasons_synced,
    episodesSynced: job.episodes_synced,
    error: job.error || '',
    startedAt: job.started_at || '',
    finishedAt: job.finished_at || '',
    createdAt: job.created_at,
  })));
}));

app.get(`${api}/admin/audit`, requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await adminSupabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return fail(res, 500, 'AUDIT_QUERY_FAILED', 'Unable to load audit logs');
  return ok(res, (data || []).map((x: any) => ({
    id: x.id, timestamp: x.created_at, userId: x.actor_id || '', userEmail: '',
    action: x.action, actionEn: x.action, target: x.target_id || '',
    details: JSON.stringify(x.details || {}), ip: '-',
  })));
}));

app.delete(`${api}/admin/movies/:id`, requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { error } = await adminSupabase.from('movies').update({ status: 'archived' }).eq('id', req.params.id);
  if (error) return fail(res, 500, 'MOVIE_DELETE_FAILED', 'Unable to archive movie');
  await adminSupabase.from('audit_logs').insert({ actor_id: req.userId!, action: 'archive_movie', target_type: 'movie', target_id: req.params.id });
  return ok(res, { deleted: true });
}));

app.post(`${api}/admin/sync/tmdb`, requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({ pages: z.number().int().min(1).max(3).default(1) }).safeParse(req.body || {});
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid sync options');
  try {
    const result = await runTmdbSync({ pages: body.data.pages });
    await adminSupabase.from('audit_logs').insert({
      actor_id: (req as AuthenticatedRequest).userId,
      action: 'tmdb_sync',
      target_type: 'catalog',
      target_id: 'tmdb',
      details: result,
    });
    return ok(res, {
      syncedCount: result.total,
      message: `TMDB sync completed: ${result.movies} movies, ${result.series} series`,
    });
  } catch (error) {
    return fail(res, 502, 'TMDB_SYNC_FAILED', error instanceof Error ? error.message : 'TMDB sync failed');
  }
}));

app.use((err: any, _req: HttpRequest, res: HttpResponse, _next: NextFunction) => {
  console.error(err);

  return fail(res, 500, 'INTERNAL_ERROR', 'Internal server error');
});
// Playback runtime uses the external live Akwam resolver with only short-lived edge/memory caching.

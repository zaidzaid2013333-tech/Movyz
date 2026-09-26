import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import {
  absoluteHttpsUrl,
  fetchJsonOrText,
  inferPlaybackType,
  inferQuality,
} from '../http';

function inferTmdbEmbedType(url: string, explicitType?: unknown) {
  const explicit = typeof explicitType === 'string' ? explicitType.toLowerCase() : '';

  if (explicit === 'hls' || explicit === 'm3u8') return 'hls' as const;
  if (explicit === 'mp4') return 'mp4' as const;
  if (explicit === 'dash' || explicit === 'mpd') return 'dash' as const;

  const lower = url.toLowerCase();
  if (lower.includes('/m3u8-proxy') || lower.includes('.m3u8')) return 'hls' as const;
  if (lower.includes('/ts-proxy') || lower.includes('.mp4') || lower.includes('.mkv')) return 'mp4' as const;

  return inferPlaybackType(url) || null;
}

function readStreams(payload: unknown) {
  if (!payload || typeof payload !== 'object') return [];

  const candidate = (payload as Record<string, unknown>).streams;
  return Array.isArray(candidate) ? candidate : [];
}

export function createTmdbEmbedAdapter(): ProviderAdapter {
  const baseUrl = (process.env.MOVYZA_TMDB_EMBED_API_BASE_URL || '').trim().replace(/\/$/g, '');
  const timeoutMs = Math.max(2_000, Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000));

  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode'): Promise<NormalizedPlaybackSource[]> => {
    if (!baseUrl || !context.tmdbId) return [];
    if (kind === 'episode' && (context.seasonNumber == null || context.episodeNumber == null)) return [];

    const url = kind === 'movie'
      ? `${baseUrl}/api/streams/movie/${encodeURIComponent(String(context.tmdbId))}`
      : `${baseUrl}/api/streams/series/${encodeURIComponent(String(context.tmdbId))}?season=${encodeURIComponent(String(context.seasonNumber))}&episode=${encodeURIComponent(String(context.episodeNumber))}`;

    const payload = await fetchJsonOrText(url, timeoutMs, {
      Accept: 'application/json',
    });

    return readStreams(payload).flatMap((stream: any): NormalizedPlaybackSource[] => {
      if (!stream || typeof stream !== 'object' || typeof stream.url !== 'string') return [];

      const streamUrl = absoluteHttpsUrl(stream.url);
      if (!streamUrl) return [];

      const type = inferTmdbEmbedType(streamUrl, stream.type);
      if (!type) return [];

      const providerLabel = typeof stream.provider === 'string' && stream.provider.trim()
        ? stream.provider.trim()
        : 'TMDB Embed API';

      const label = typeof stream.name === 'string' && stream.name.trim()
        ? stream.name.trim()
        : typeof stream.title === 'string' && stream.title.trim()
          ? stream.title.trim()
          : providerLabel;

      return [{
        provider: 'tmdbembed',
        type,
        url: streamUrl,
        providerReference: [providerLabel, context.tmdbId, context.seasonNumber, context.episodeNumber]
          .filter((value) => value != null)
          .join(':'),
        quality: typeof stream.quality === 'string' && stream.quality.trim()
          ? stream.quality.trim()
          : inferQuality(label, streamUrl),
        language: typeof stream.language === 'string' && stream.language.trim()
          ? stream.language.trim()
          : 'und',
        label,
      }];
    });
  };

  return {
    key: 'tmdbembed',
    name: 'TMDB Embed API',
    enabled: true,
    requiresMapping: false,
    resolveMovie: (context) => resolve(context, 'movie'),
    resolveEpisode: (context) => resolve(context, 'episode'),
    health: async () => {
      const started = Date.now();

      if (!baseUrl) {
        return {
          status: 'degraded' as const,
          latencyMs: 0,
          message: 'MOVYZA_TMDB_EMBED_API_BASE_URL is not configured',
        };
      }

      try {
        const payload = await fetchJsonOrText(
          `${baseUrl}/api/health`,
          Math.min(timeoutMs, 5_000),
          { Accept: 'application/json' },
        );

        if (payload && typeof payload === 'object' && (payload as Record<string, unknown>).ok === true) {
          return { status: 'healthy' as const, latencyMs: Date.now() - started };
        }

        return {
          status: 'degraded' as const,
          latencyMs: Date.now() - started,
          message: 'TMDB Embed API health endpoint returned an unexpected payload',
        };
      } catch (error) {
        return {
          status: 'offline' as const,
          latencyMs: Date.now() - started,
          message: error instanceof Error ? error.message : 'TMDB Embed API health check failed',
        };
      }
    },
  };
}

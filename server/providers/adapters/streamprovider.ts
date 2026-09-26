import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import { absoluteHttpsUrl, fetchJsonOrText, inferPlaybackType, inferQuality } from '../http';

function normalizeSource(payload: unknown, context: ProviderContext): NormalizedPlaybackSource[] {
  if (!payload || typeof payload !== 'object') return [];

  const value = payload as Record<string, unknown>;
  const rawUrl = typeof value.url === 'string' ? value.url : '';
  const url = absoluteHttpsUrl(rawUrl);
  if (!url) return [];

  const type = inferPlaybackType(url) || 'hls';
  const referer = typeof value.referer === 'string' ? value.referer : '';
  const providerReference = referer
    ? `${String(context.tmdbId)}:${context.seasonNumber ?? ''}:${context.episodeNumber ?? ''}:${referer}`
    : String(context.tmdbId ?? '');

  return [{
    provider: 'streamprovider',
    type,
    url,
    providerReference,
    quality: inferQuality(url, url),
    language: 'und',
    label: type === 'hls' ? 'StreamProvider HLS' : 'StreamProvider',
  }];
}

export function createStreamProviderAdapter(): ProviderAdapter {
  const baseUrl = (process.env.MOVYZA_STREAMPROVIDER_BASE_URL || 'https://streamprovider.byteful.me')
    .trim()
    .replace(/\/$/g, '');
  const timeoutMs = Math.max(2_000, Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000));

  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode'): Promise<NormalizedPlaybackSource[]> => {
    if (!context.tmdbId) return [];
    if (kind === 'episode' && (context.seasonNumber == null || context.episodeNumber == null)) return [];

    const params = new URLSearchParams({ tmdbId: String(context.tmdbId) });
    if (kind === 'episode') {
      params.set('season', String(context.seasonNumber));
      params.set('episode', String(context.episodeNumber));
    }

    const payload = await fetchJsonOrText(`${baseUrl}/?${params.toString()}`, timeoutMs, {
      Accept: 'application/json',
    });

    return normalizeSource(payload, context);
  };

  return {
    key: 'streamprovider',
    name: 'StreamProvider',
    enabled: true,
    requiresMapping: false,
    resolveMovie: (context) => resolve(context, 'movie'),
    resolveEpisode: (context) => resolve(context, 'episode'),
    health: async () => {
      const started = Date.now();
      try {
        const payload = await fetchJsonOrText(
          `${baseUrl}/?tmdbId=157336`,
          Math.min(timeoutMs, 8_000),
          { Accept: 'application/json' },
        );
        const sources = normalizeSource(payload, { tmdbId: 157336 });
        return sources.length
          ? { status: 'healthy' as const, latencyMs: Date.now() - started }
          : {
              status: 'degraded' as const,
              latencyMs: Date.now() - started,
              message: 'StreamProvider returned no playable source',
            };
      } catch (error) {
        return {
          status: 'offline' as const,
          latencyMs: Date.now() - started,
          message: error instanceof Error ? error.message : 'StreamProvider health check failed',
        };
      }
    },
  };
}

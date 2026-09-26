import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import { fetchJsonOrText, inferPlaybackType, inferQuality, resolveSourcesFromPayload } from '../http';

const DEFAULT_PROVIDER = 'vidsrc';
// JSON/HLS endpoints are served from api.ezvidapi.com. The ezvidapi.com
// host is reserved for the iframe embed URLs used by the frontend fallback.
const DEFAULT_ORIGINS = ['https://api.ezvidapi.com'];

export function createEzvidApiAdapter(): ProviderAdapter {
  const timeoutMs = Math.max(2_000, Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000));
  const origins = (process.env.EZVIDAPI_ORIGINS || DEFAULT_ORIGINS.join(','))
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const configuredProvider = (process.env.EZVIDAPI_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();

  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode'): Promise<NormalizedPlaybackSource[]> => {
    if (!context.tmdbId) return [];
    if (kind === 'episode' && (context.seasonNumber == null || context.episodeNumber == null)) return [];

    let lastError: unknown;
    const provider = configuredProvider || DEFAULT_PROVIDER;

    for (const origin of origins) {
      const url = kind === 'movie'
        ? origin + '/movie/' + encodeURIComponent(provider) + '/' + context.tmdbId
        : origin + '/tv/' + encodeURIComponent(provider) + '/' + context.tmdbId + '?season=' + context.seasonNumber + '&episode=' + context.episodeNumber;

      try {
        const payload = await fetchJsonOrText(url, timeoutMs, { Referer: 'https://ezvidapi.com/' });
        const candidates = resolveSourcesFromPayload(payload, { language: 'und', label: 'ezvidAPI ' + provider })
          .flatMap((source) => {
            // ezvidapi documents these JSON endpoints as returning an HLS stream.
            const type = inferPlaybackType(source.url, source.type) || 'hls';
            return [{
              provider: 'ezvidapi',
              type,
              url: source.url,
              providerReference: source.providerReference || String(context.tmdbId),
              quality: source.quality || inferQuality(source.label, source.url),
              language: source.language || 'und',
              label: source.label || ('ezvidAPI ' + provider),
              expiresAt: source.expiresAt,
            } satisfies NormalizedPlaybackSource];
          });

        if (candidates.length) return candidates;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) console.error('[ezvidapi-adapter]', lastError instanceof Error ? lastError.message : lastError);
    return [];
  };

  return {
    key: 'ezvidapi',
    name: 'ezvidAPI',
    enabled: true,
    requiresMapping: false,
    resolveMovie: (context) => resolve(context, 'movie'),
    resolveEpisode: (context) => resolve(context, 'episode'),
    health: async () => {
      const started = Date.now();
      try {
        const provider = configuredProvider || DEFAULT_PROVIDER;
        const probeUrl = origins[0] + '/movie/' + encodeURIComponent(provider) + '/157336';
        await fetchJsonOrText(probeUrl, Math.min(timeoutMs, 8_000), { Referer: 'https://ezvidapi.com/' });
        return { status: 'healthy' as const, latencyMs: Date.now() - started };
      } catch (error) {
        return {
          status: 'offline' as const,
          latencyMs: Date.now() - started,
          message: error instanceof Error ? error.message : 'ezvidAPI health check failed',
        };
      }
    },
  };
}

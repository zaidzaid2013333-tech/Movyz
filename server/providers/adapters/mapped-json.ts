import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import { fetchJsonOrText, inferPlaybackType, inferQuality, materializeTemplate, resolveSourcesFromPayload } from '../http';

type MappedJsonConfig = {
  key: string;
  name: string;
  baseUrl: string;
  timeoutMs: number;
  language: string;
};

export function createMappedJsonAdapter(config: MappedJsonConfig): ProviderAdapter {
  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode') => {
    if (!context.providerId) return [];

    const url = materializeTemplate(config.baseUrl, {
      providerId: context.providerId,
      tmdbId: context.tmdbId,
      season: context.seasonNumber,
      episode: context.episodeNumber,
    });

    const payload = await fetchJsonOrText(url, config.timeoutMs);
    const sources = resolveSourcesFromPayload(payload, {
      language: config.language,
      label: config.name,
    });

    return sources.map((source): NormalizedPlaybackSource => ({
      provider: config.key,
      type: inferPlaybackType(source.url, source.type),
      url: source.url,
      providerReference: context.providerId,
      quality: source.quality || inferQuality(source.label, source.url),
      language: source.language || config.language,
      label: source.label || config.name,
      expiresAt: source.expiresAt,
    }));
  };

  return {
    key: config.key,
    name: config.name,
    enabled: true,
    resolveMovie: (context) => resolve(context, 'movie'),
    resolveEpisode: (context) => resolve(context, 'episode'),
    health: async () => {
      const healthUrl = process.env[`MOVYZA_${config.key.toUpperCase()}_HEALTH_URL`];
      if (!healthUrl) {
        return { status: 'degraded' as const, latencyMs: 0, message: 'No provider health URL configured' };
      }
      const started = Date.now();
      try {
        await fetchJsonOrText(healthUrl, Math.min(config.timeoutMs, 5_000));
        return {
          status: 'healthy' as const,
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        return {
          status: 'offline' as const,
          latencyMs: Date.now() - started,
          message: error instanceof Error ? error.message : 'Health check failed',
        };
      }
    },
  };
}

export function createFaselHdAdapter() {
  const baseUrl = process.env.FASELHD_API_BASE_URL?.trim();
  if (!baseUrl) return null;

  return createMappedJsonAdapter({
    key: 'faselhd',
    name: 'FaselHD',
    baseUrl: `${baseUrl.replace(/\/$/, '')}/directlink?id={{providerId}}`,
    timeoutMs: Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000),
    language: 'ar',
  });
}

import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import { fetchJsonOrText, inferPlaybackType, inferQuality, materializeTemplate, resolveSourcesFromPayload } from '../http';

type MappedJsonConfig = {
  key: string;
  name: string;
  baseUrl: string;
  timeoutMs: number;
  language: string;
  requiresMapping?: boolean;
  moviePath?: string;
  episodePath?: string;
  headers?: Record<string, string>;
};

export function createMappedJsonAdapter(config: MappedJsonConfig): ProviderAdapter {
  const resolve = async (context: ProviderContext) => {
    if (!context.providerId) return [];

    const template = context.seasonNumber != null && context.episodeNumber != null
      ? (config.episodePath || config.baseUrl)
      : (config.moviePath || config.baseUrl);
    const url = materializeTemplate(template, {
      providerId: context.providerId,
      tmdbId: context.tmdbId,
      season: context.seasonNumber,
      episode: context.episodeNumber,
    });

    const payload = await fetchJsonOrText(url, config.timeoutMs, config.headers);
    return resolveSourcesFromPayload(payload, {
      language: config.language,
      label: config.name,
    }).flatMap((source): NormalizedPlaybackSource[] => {
      const type = inferPlaybackType(source.url, source.type);
      if (!type) return [];
      return [{
        provider: config.key,
        type,
        url: source.url,
        providerReference: context.providerId,
        quality: source.quality || inferQuality(source.label, source.url),
        language: source.language || config.language,
        label: source.label || config.name,
        expiresAt: source.expiresAt,
      }];
    });
  };

  return {
    key: config.key,
    name: config.name,
    enabled: true,
    requiresMapping: config.requiresMapping === true,
    resolveMovie: resolve,
    resolveEpisode: resolve,
    health: async () => {
      const healthUrl = process.env[`MOVYZA_${config.key.toUpperCase()}_HEALTH_URL`];
      if (!healthUrl) {
        return { status: 'degraded' as const, latencyMs: 0, message: 'No provider health URL configured' };
      }
      const started = Date.now();
      try {
        await fetchJsonOrText(healthUrl, Math.min(config.timeoutMs, 5_000));
        return { status: 'healthy' as const, latencyMs: Date.now() - started };
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
    requiresMapping: true,
  });
}


export function createEgyBestAdapter() {
  const baseUrl = process.env.EGYBEST_API_BASE_URL?.trim().replace(/\/$/, '');
  const accessToken = process.env.EGYBEST_ACCESS_TOKEN?.trim();
  if (!baseUrl || !accessToken) return null;

  const moviePath = process.env.EGYBEST_MOVIE_PATH || '/dls?url={{providerId}}&v=2';
  const episodePath = process.env.EGYBEST_EPISODE_PATH || '/dls?url={{providerId}}&v=2';

  return createMappedJsonAdapter({
    key: 'egybest',
    name: 'EgyBest',
    baseUrl,
    moviePath: `${baseUrl}${moviePath}`,
    episodePath: `${baseUrl}${episodePath}`,
    language: 'ar',
    requiresMapping: true,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

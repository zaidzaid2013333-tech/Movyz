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
  // The public FaselHD API resolves a TMDB/content id itself and returns
  // playable links from /movie/:id and /tv/:id/episode/:episodeNumber.
  // No project-side API key or provider_mapping is required.
  const baseUrl = (process.env.FASELHD_API_BASE_URL || 'https://faselhdapi.onrender.com').trim().replace(/\/$/, '');
  const timeoutMs = Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000);

  const resolvePayload = async (url: string, context: ProviderContext) => {
    const payload = await fetchJsonOrText(url, timeoutMs);
    return resolveSourcesFromPayload(payload, {
      language: 'ar',
      label: 'FaselHD',
    }).flatMap((source): NormalizedPlaybackSource[] => {
      const type = inferPlaybackType(source.url, source.type);
      if (!type) return [];
      return [{
        provider: 'faselhd',
        type,
        url: source.url,
        providerReference: String(context.tmdbId ?? ''),
        quality: source.quality || inferQuality(source.label, source.url),
        language: source.language || 'ar',
        label: source.label || 'FaselHD',
        expiresAt: source.expiresAt,
      }];
    });
  };

  return {
    key: 'faselhd',
    name: 'FaselHD',
    enabled: true,
    requiresMapping: false,
    resolveMovie: (context: ProviderContext) => context.tmdbId
      ? resolvePayload(`${baseUrl}/movie/${encodeURIComponent(context.tmdbId)}`, context)
      : Promise.resolve([]),
    resolveEpisode: (context: ProviderContext) => context.tmdbId && context.episodeNumber != null
      ? resolvePayload(`${baseUrl}/tv/${encodeURIComponent(context.tmdbId)}/episode/${encodeURIComponent(context.episodeNumber)}`, context)
      : Promise.resolve([]),
    health: async () => {
      const started = Date.now();
      try {
        await fetchJsonOrText(`${baseUrl}/discover/movies?page=1&pageSize=1`, Math.min(timeoutMs, 5_000));
        return { status: 'healthy' as const, latencyMs: Date.now() - started };
      } catch (error) {
        return {
          status: 'offline' as const,
          latencyMs: Date.now() - started,
          message: error instanceof Error ? error.message : 'FaselHD health check failed',
        };
      }
    },
  } satisfies ProviderAdapter;
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
    timeoutMs: Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000),
    language: 'ar',
    requiresMapping: true,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

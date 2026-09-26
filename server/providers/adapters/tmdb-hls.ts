import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import { fetchJsonOrText, inferPlaybackType, inferQuality, materializeTemplate, resolveSourcesFromPayload } from '../http';

type TmdbHlsConfig = {
  key: string;
  name: string;
  baseUrl: string;
  timeoutMs: number;
  language: string;
};

export function createTmdbHlsAdapter(config: TmdbHlsConfig): ProviderAdapter {
  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode') => {
    if (!context.tmdbId) return [];

    const url = materializeTemplate(config.baseUrl, {
      tmdbId: context.tmdbId,
      season: context.seasonNumber,
      episode: context.episodeNumber,
    });

    const payload = await fetchJsonOrText(url, config.timeoutMs);
    return resolveSourcesFromPayload(payload, {
      language: config.language,
      label: config.name,
    }).map((source): NormalizedPlaybackSource => ({
      provider: config.key,
      type: inferPlaybackType(source.url, source.type),
      url: source.url,
      providerReference: `${context.tmdbId}:${kind}`,
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
      const started = Date.now();
      const healthUrl = process.env[`MOVYZA_${config.key.toUpperCase()}_HEALTH_URL`] || materializeTemplate(config.baseUrl, {
        tmdbId: 550,
        season: 1,
        episode: 1,
      });
      try {
        await fetchJsonOrText(healthUrl, Math.min(config.timeoutMs, 5_000));
        const latencyMs = Date.now() - started;
        return { status: latencyMs < 2_500 ? 'healthy' as const : 'degraded' as const, latencyMs };
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

export function createEzvidApiAdapter() {
  return createTmdbHlsAdapter({
    key: 'ezvidapi',
    name: 'ezvidAPI',
    baseUrl: process.env.EZVIDAPI_URL_TEMPLATE || 'https://ezvidapi.com/movie/{{tmdbId}}',
    timeoutMs: Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000),
    language: 'ar',
  });
}

export function createStreamProviderAdapter() {
  return createTmdbHlsAdapter({
    key: 'streamprovider',
    name: 'StreamProvider',
    baseUrl: process.env.STREAMPROVIDER_URL_TEMPLATE || 'https://streamprovider.byteful.me/?tmdbId={{tmdbId}}&season={{season}}&episode={{episode}}',
    timeoutMs: Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000),
    language: 'und',
  });
}

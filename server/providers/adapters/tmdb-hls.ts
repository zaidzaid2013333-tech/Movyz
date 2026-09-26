import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import { fetchJsonOrText, inferPlaybackType, inferQuality, materializeTemplate, resolveSourcesFromPayload } from '../http';

type TmdbHlsConfig = {
  key: string;
  name: string;
  movieUrl: string;
  episodeUrl: string;
  timeoutMs: number;
  language: string;
  templateValues?: Record<string, string | number | undefined>;
  healthUrl?: string;
};

export function createTmdbHlsAdapter(config: TmdbHlsConfig): ProviderAdapter {
  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode') => {
    if (!context.tmdbId) return [];

    const template = kind === 'movie' ? config.movieUrl : config.episodeUrl;
    const url = materializeTemplate(template, {
      tmdbId: context.tmdbId,
      season: context.seasonNumber,
      episode: context.episodeNumber,
      ...(config.templateValues || {}),
    });

    const payload = await fetchJsonOrText(url, config.timeoutMs);

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
        providerReference: `${context.tmdbId}:${kind}`,
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
    resolveMovie: (context) => resolve(context, 'movie'),
    resolveEpisode: (context) => resolve(context, 'episode'),
    health: async () => {
      const started = Date.now();
      const healthUrl = config.healthUrl || materializeTemplate(config.movieUrl, {
        tmdbId: 550,
        season: 1,
        episode: 1,
        ...(config.templateValues || {}),
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

const timeoutMs = Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000);

export function createEzvidApiAdapter() {
  return createTmdbHlsAdapter({
    key: 'ezvidapi',
    name: 'ezvidAPI',
    movieUrl: process.env.EZVIDAPI_MOVIE_URL_TEMPLATE || 'https://ezvidapi.com/movie/{{provider}}/{{tmdbId}}',
    episodeUrl: process.env.EZVIDAPI_TV_URL_TEMPLATE || 'https://ezvidapi.com/tv/{{provider}}/{{tmdbId}}?season={{season}}&episode={{episode}}',
    timeoutMs,
    language: 'und',
    templateValues: { provider: process.env.EZVIDAPI_PROVIDER || 'vidsrc' },
    healthUrl: process.env.EZVIDAPI_HEALTH_URL || undefined,
  });
}

export function createStreamProviderAdapter() {
  return createTmdbHlsAdapter({
    key: 'streamprovider',
    name: 'StreamProvider',
    movieUrl: process.env.STREAMPROVIDER_MOVIE_URL_TEMPLATE || 'https://streamprovider.byteful.me/?tmdbId={{tmdbId}}',
    episodeUrl: process.env.STREAMPROVIDER_TV_URL_TEMPLATE || 'https://streamprovider.byteful.me/?tmdbId={{tmdbId}}&season={{season}}&episode={{episode}}',
    timeoutMs,
    language: 'und',
    healthUrl: process.env.STREAMPROVIDER_HEALTH_URL || undefined,
  });
}


export function createNhdApiAdapter() {
  const key = process.env.NHD_API_KEY?.trim();
  if (!key) return null;

  return createTmdbHlsAdapter({
    key: 'nhdapi',
    name: 'NHD API',
    movieUrl: process.env.NHD_MOVIE_URL_TEMPLATE || 'https://nhdapi.st/movie/{{tmdbId}}?key={{key}}',
    episodeUrl: process.env.NHD_TV_URL_TEMPLATE || 'https://nhdapi.st/tv/{{tmdbId}}/{{season}}/{{episode}}?key={{key}}',
    timeoutMs,
    language: 'und',
    templateValues: { key },
    healthUrl: process.env.NHD_HEALTH_URL || undefined,
  });
}

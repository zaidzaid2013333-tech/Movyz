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
    const url = materializeTemplate(template, { tmdbId: context.tmdbId, season: context.seasonNumber, episode: context.episodeNumber, ...(config.templateValues || {}) });
    const payload = await fetchJsonOrText(url, config.timeoutMs);
    return resolveSourcesFromPayload(payload, { language: config.language, label: config.name }).flatMap((source): NormalizedPlaybackSource[] => {
      const type = inferPlaybackType(source.url, source.type);
      if (!type) return [];
      return [{ provider: config.key, type, url: source.url, providerReference: `${context.tmdbId}:${kind}`, quality: source.quality || inferQuality(source.label, source.url), language: source.language || config.language, label: source.label || config.name, expiresAt: source.expiresAt }];
    });
  };
  return {
    key: config.key, name: config.name, enabled: true,
    resolveMovie: (context) => resolve(context, 'movie'),
    resolveEpisode: (context) => resolve(context, 'episode'),
    health: async () => {
      const started = Date.now();
      const healthUrl = config.healthUrl || materializeTemplate(config.movieUrl, { tmdbId: 550, season: 1, episode: 1, ...(config.templateValues || {}) });
      try { await fetchJsonOrText(healthUrl, Math.min(config.timeoutMs, 5_000)); const latencyMs = Date.now() - started; return { status: latencyMs < 2_500 ? 'healthy' as const : 'degraded' as const, latencyMs }; }
      catch (error) { return { status: 'offline' as const, latencyMs: Date.now() - started, message: error instanceof Error ? error.message : 'Health check failed' }; }
    },
  };
}

const timeoutMs = Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000);

import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import { fetchJsonOrText, inferPlaybackType, inferQuality, resolveSourcesFromPayload } from '../http';

const DEFAULT_PROVIDER = 'vidsrc';
const DEFAULT_ORIGINS = ['https://ezvidapi.com', 'https://api.ezvidapi.com'];

function providerKeys(payload: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 5 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    for (const field of ['key', 'slug', 'provider', 'providerKey', 'id']) {
      const candidate = object[field];
      if (typeof candidate === 'string' && /^[a-z0-9_-]{2,40}$/i.test(candidate)) found.add(candidate.toLowerCase());
    }
    for (const field of ['providers', 'data', 'results', 'items']) visit(object[field], depth + 1);
  };
  visit(payload);
  return [...found];
}

export function createEzvidApiAdapter(): ProviderAdapter {
  const timeoutMs = Math.max(2_000, Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000));
  const origins = (process.env.EZVIDAPI_ORIGINS || DEFAULT_ORIGINS.join(','))
    .split(',')
    .map((value) => value.trim().replace(/\\/$/, ''))
    .filter(Boolean);
  const configuredProvider = (process.env.EZVIDAPI_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();

  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode'): Promise<NormalizedPlaybackSource[]> => {
    if (!context.tmdbId) return [];
    if (kind === 'episode' && (context.seasonNumber == null || context.episodeNumber == null)) return [];

    let lastError: unknown;
    for (const origin of origins) {
      const providers = new Set<string>([configuredProvider]);
      try {
        const listed = await fetchJsonOrText(origin + '/list', Math.min(timeoutMs, 8_000), { Referer: 'https://ezvidapi.com/' });
        for (const key of providerKeys(listed)) providers.add(key);
      } catch (error) {
        lastError = error;
      }

      for (const provider of providers) {
        const url = kind === 'movie'
          ? origin + '/movie/' + encodeURIComponent(provider) + '/' + context.tmdbId
          : origin + '/tv/' + encodeURIComponent(provider) + '/' + context.tmdbId + '?season=' + context.seasonNumber + '&episode=' + context.episodeNumber;
        try {
          const payload = await fetchJsonOrText(url, timeoutMs, { Referer: 'https://ezvidapi.com/' });
          const candidates = resolveSourcesFromPayload(payload, { language: 'und', label: 'ezvidAPI ' + provider })
            .flatMap((source) => {
              const type = inferPlaybackType(source.url, source.type);
              if (!type) return [];
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
        await fetchJsonOrText(origins[0] + '/list', Math.min(timeoutMs, 5_000), { Referer: 'https://ezvidapi.com/' });
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

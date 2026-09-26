import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import { fetchJsonOrText, inferPlaybackType, inferQuality, resolveSourcesFromPayload } from '../http';

const DEFAULT_PROVIDER = 'vidsrc';
// JSON/HLS endpoints are served from api.ezvidapi.com. The ezvidapi.com
// host is reserved for the iframe embed URLs used by the frontend fallback.
const DEFAULT_ORIGINS = ['https://api.ezvidapi.com'];

function discoverProviderKeys(payload: unknown): string[] {
  const found = new Set<string>();

  const visit = (value: unknown, depth = 0): void => {
    if (depth > 6 || value == null) return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    if (typeof value !== 'object') return;
    const object = value as Record<string, unknown>;

    for (const field of ['key', 'slug', 'provider', 'providerKey', 'id']) {
      const candidate = object[field];
      if (typeof candidate === 'string' && /^[a-z0-9_-]{2,40}$/i.test(candidate)) {
        found.add(candidate.toLowerCase());
      }
    }

    const name = object.name;
    if (typeof name === 'string') {
      const normalized = name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (/^[a-z0-9_-]{2,40}$/.test(normalized)) found.add(normalized);
    }

    for (const field of ['providers', 'servers', 'data', 'results', 'items']) {
      if (field in object) visit(object[field], depth + 1);
    }
  };

  visit(payload);
  return [...found];
}

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
    const configured = configuredProvider && configuredProvider !== 'auto'
      ? configuredProvider
      : '';
    
    for (const origin of origins) {
      const providers = new Set<string>();
      if (configured) providers.add(configured);

      const tryProvider = async (provider: string): Promise<NormalizedPlaybackSource[]> => {
        const url = kind === 'movie'
          ? origin + '/movie/' + encodeURIComponent(provider) + '/' + context.tmdbId
          : origin + '/tv/' + encodeURIComponent(provider) + '/' + context.tmdbId + '?season=' + context.seasonNumber + '&episode=' + context.episodeNumber;

        try {
          const payload = await fetchJsonOrText(url, timeoutMs, { Referer: 'https://ezvidapi.com/' });
          return resolveSourcesFromPayload(payload, { language: 'und', label: 'ezvidAPI ' + provider })
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
        } catch (error) {
          lastError = error;
          return [];
        }
      };

      // Prefer the configured provider, then ask ezvidapi for the current
      // provider catalog and try the remaining providers in that list.
      for (const provider of providers) {
        const candidates = await tryProvider(provider);
        if (candidates.length) return candidates;
      }

      try {
        const listed = await fetchJsonOrText(origin + '/list', Math.min(timeoutMs, 8_000), {
          Referer: 'https://ezvidapi.com/',
        });
        for (const provider of discoverProviderKeys(listed)) providers.add(provider);
      } catch (error) {
        lastError = error;
      }

      for (const provider of providers) {
        const candidates = await tryProvider(provider);
        if (candidates.length) return candidates;
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
        const listed = await fetchJsonOrText(origins[0] + '/list', Math.min(timeoutMs, 8_000), {
          Referer: 'https://ezvidapi.com/',
        });
        if (!discoverProviderKeys(listed).length) {
          // Some deployments may return a list object without provider keys;
          // the successful HTTP response still proves the API is reachable.
          return { status: 'healthy' as const, latencyMs: Date.now() - started };
        }
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

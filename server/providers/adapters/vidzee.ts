import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import { fetchJsonOrText, inferQuality, resolveSourcesFromPayload } from '../http';

const BASE_URL = 'https://core.vidzee.wtf';
const PLAYER_REFERER = 'https://player.vidzee.wtf/';
const DEFAULT_SERVERS = ['dcloud', 'tik', 'ipcloud', 'v6:Hindi'];

function serversFromEnv() {
  return (process.env.VIDZEE_SERVERS || DEFAULT_SERVERS.join(','))
    .split(',').map((value) => value.trim()).filter(Boolean);
}

function proxyUrl(rawUrl: string) {
  return '/api/v1/playback/proxy?url=' + encodeURIComponent(rawUrl);
}

export function createVidZeeAdapter(): ProviderAdapter {
  const timeoutMs = Math.max(2_000, Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000));
  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode'): Promise<NormalizedPlaybackSource[]> => {
    if (!context.tmdbId) return [];
    if (kind === 'episode' && (context.seasonNumber == null || context.episodeNumber == null)) return [];

    for (const server of serversFromEnv()) {
      const url = kind === 'movie'
        ? `${BASE_URL}/streams/movie/${context.tmdbId}?s=${encodeURIComponent(server)}&e=0`
        : `${BASE_URL}/streams/tv/${context.tmdbId}/${context.seasonNumber}/${context.episodeNumber}?s=${encodeURIComponent(server)}&e=0`;
      try {
        const payload = await fetchJsonOrText(url, timeoutMs, {
          Referer: PLAYER_REFERER,
          Origin: 'https://player.vidzee.wtf',
        });
        const candidates = resolveSourcesFromPayload(payload, { language: 'und', label: 'VidZee ' + server });
        for (const source of candidates) {
          if (!/\.m3u8(?:$|[?#])/i.test(source.url)) continue;
          return [{
            provider: 'vidzee',
            type: 'hls',
            url: proxyUrl(source.url),
            providerReference: source.providerReference || server + ':' + String(context.tmdbId),
            quality: source.quality || inferQuality(source.label, source.url),
            language: source.language || 'und',
            label: source.label || 'VidZee ' + server,
            expiresAt: source.expiresAt,
          }];
        }
      } catch (error) {
        console.error('[vidzee-adapter]', server, error instanceof Error ? error.message : error);
      }
    }
    return [];
  };

  return {
    key: 'vidzee',
    name: 'VidZee',
    enabled: true,
    requiresMapping: false,
    resolveMovie: (context) => resolve(context, 'movie'),
    resolveEpisode: (context) => resolve(context, 'episode'),
    health: async () => {
      const started = Date.now();
      const sources = await resolve({ tmdbId: 550 }, 'movie');
      return sources.length
        ? { status: 'healthy' as const, latencyMs: Date.now() - started }
        : { status: 'degraded' as const, latencyMs: Date.now() - started, message: 'No playable VidZee source returned' };
    },
  };
}

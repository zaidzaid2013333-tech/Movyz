import type { WorkerEnvironment } from '../mini-http';
import { resolveRe3ArabiPlayback, resolveRe3ArabiProvider } from './re3arabi';
import type { PlaybackKind } from './types';

export type RemotePlaybackRequest = {
  type: 'movie' | 'series';
  tmdbId: number;
  season?: number;
  episode?: number;
  episodeTmdbId?: number;
};

export type RemotePlaybackSource = {
  id: string;
  type: PlaybackKind | 'web';
  quality: string;
  language: string;
  label: string;
  labelEn: string;
  url: string;
  isWorking: boolean;
  provider: string;
  providerKey: string;
  providerReference?: string;
};

async function verifyRemoteSources(sources: RemotePlaybackSource[]) {
  const results = await Promise.all(
    sources.map(async (source, index) => {
      try {
        const response = await fetch(source.url, {
          method: 'GET',
          redirect: 'follow',
          headers: {
            Accept: source.type === 'mp4'
              ? 'video/mp4,application/octet-stream;q=0.9,*/*;q=0.5'
              : '*/*',
            Range: 'bytes=0-1023',
            'User-Agent': 'Movyza/1.0',
          },
        });
        try { await response.body?.cancel(); } catch {}
        return { source, ok: response.status === 200 || response.status === 206, index };
      } catch {
        return { source, ok: false, index };
      }
    }),
  );

  const healthy = results.filter((item) => item.ok);
  const byQuality = new Map<string, typeof healthy[number]>();
  for (const item of healthy) {
    const key = String(item.source.quality || 'source').trim().toLowerCase();
    if (!byQuality.has(key)) byQuality.set(key, item);
  }

  return [...byQuality.values()]
    .sort((a, b) => {
      const aq = Number(String(a.source.quality).match(/\d{3,4}/)?.[0] || 0);
      const bq = Number(String(b.source.quality).match(/\d{3,4}/)?.[0] || 0);
      return bq - aq || a.index - b.index;
    })
    .map((item) => item.source);
}

export async function resolveRemotePlaybackFast(
  request: RemotePlaybackRequest,
): Promise<RemotePlaybackSource[]> {
  const keys = ['aflaam', 'anime3rb'] as const;
  const attempts = keys.map((providerKey) =>
    resolveRe3ArabiProvider({
      type: request.type,
      tmdbId: request.tmdbId,
      season: request.season,
      episode: request.episode,
    }, providerKey).then((sources) => {
      if (!sources.length) throw new Error('no sources');
      return sources;
    }).catch(() => Promise.reject(new Error('provider unavailable'))),
  );

  let first: Awaited<ReturnType<typeof resolveRe3ArabiProvider>> = [];
  try {
    first = await Promise.any(attempts);
  } catch {
    first = [];
  }
  const mapped = first.map((source, index) => ({
    id: `fast-${index + 1}-${source.providerReference || source.sourceUrl || 'source'}`,
    type: source.type,
    quality: source.quality || 'auto',
    language: source.language || 'ar',
    label: source.label || source.provider,
    labelEn: source.label || source.provider,
    url: source.url || '',
    isWorking: true,
    provider: source.provider,
    providerKey: source.providerKey,
    ...(source.providerReference ? { providerReference: source.providerReference } : {}),
  }));
  return verifyRemoteSources(mapped);
}

export async function resolveRemotePlayback(
  request: RemotePlaybackRequest,
  _env?: WorkerEnvironment,
): Promise<RemotePlaybackSource[]> {
  const sources = await resolveRe3ArabiPlayback({
    type: request.type,
    tmdbId: request.tmdbId,
    season: request.season,
    episode: request.episode,
  });

  return sources.map((source, index) => ({
    id: `remote-${index + 1}-${source.providerReference || source.sourceUrl || 'source'}`,
    type: source.type,
    quality: source.quality || 'auto',
    language: source.language || 'ar',
    label: source.label || source.provider,
    labelEn: source.label || source.provider,
    url: source.url || '',
    isWorking: true,
    provider: source.provider,
    providerKey: source.providerKey,
    ...(source.providerReference ? { providerReference: source.providerReference } : {}),
  }));
}

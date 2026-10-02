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

export async function resolveRemotePlaybackFast(
  request: RemotePlaybackRequest,
): Promise<RemotePlaybackSource[]> {
  const keys = ['aflaam', 'anime3rb'] as const;
  const results = await Promise.all(
    keys.map(async (providerKey) => {
      try {
        return await resolveRe3ArabiProvider({
          type: request.type,
          tmdbId: request.tmdbId,
          season: request.season,
          episode: request.episode,
        }, providerKey);
      } catch {
        return [];
      }
    }),
  );

  const first = results.find((sources) => sources.length) || [];
  return first.map((source, index) => ({
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

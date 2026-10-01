import type { WorkerEnvironment } from '../mini-http';
import { resolveRe3ArabiPlayback } from './re3arabi';

export type RemotePlaybackRequest = {
  type: 'movie' | 'series';
  tmdbId: number;
  season?: number;
  episode?: number;
  episodeTmdbId?: number;
};

export type RemotePlaybackSource = {
  id: string;
  type: 'hls' | 'mp4' | 'dash' | 'embed' | 'web';
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

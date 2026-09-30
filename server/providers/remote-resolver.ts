import { extractPlaybackCandidates, fetchJsonOrText, inferPlaybackType } from './http';

export type RemotePlaybackRequest = {
  type: 'movie' | 'series';
  tmdbId: number;
  season?: number;
  episode?: number;
  episodeTmdbId?: number;
};

export type RemotePlaybackSource = {
  id: string;
  type: 'hls' | 'mp4' | 'dash' | 'web';
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

function requiredResolverUrl() {
  const value = process.env.PLAYBACK_RESOLVER_URL?.trim();
  if (!value) throw new Error('PLAYBACK_RESOLVER_URL is not configured');

  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') {
    throw new Error('PLAYBACK_RESOLVER_URL must use HTTPS');
  }
  return value;
}

export function buildRemoteResolverUrl(
  request: RemotePlaybackRequest,
  template = requiredResolverUrl(),
) {
  const replacements: Record<string, string> = {
    type: request.type,
    tmdbId: String(request.tmdbId),
    tmdb_id: String(request.tmdbId),
    season: request.season !== undefined ? String(request.season) : '',
    episode: request.episode !== undefined ? String(request.episode) : '',
    episodeTmdbId: request.episodeTmdbId !== undefined ? String(request.episodeTmdbId) : '',
    episode_tmdb_id: request.episodeTmdbId !== undefined ? String(request.episodeTmdbId) : '',
  };

  let resolved = template;
  for (const [key, value] of Object.entries(replacements)) {
    resolved = resolved.replaceAll(`{{${key}}}`, encodeURIComponent(value));
  }

  const url = new URL(resolved);
  if (!template.includes('{{type}}')) url.searchParams.set('type', request.type);
  if (!template.includes('{{tmdbId}}') && !template.includes('{{tmdb_id}}')) {
    url.searchParams.set('tmdb_id', String(request.tmdbId));
  }
  if (request.season !== undefined && !template.includes('{{season}}')) {
    url.searchParams.set('season', String(request.season));
  }
  if (request.episode !== undefined && !template.includes('{{episode}}')) {
    url.searchParams.set('episode', String(request.episode));
  }
  if (
    request.episodeTmdbId !== undefined &&
    !template.includes('{{episodeTmdbId}}') &&
    !template.includes('{{episode_tmdb_id}}')
  ) {
    url.searchParams.set('episode_tmdb_id', String(request.episodeTmdbId));
  }
  return url.toString();
}

export async function resolveRemotePlayback(
  request: RemotePlaybackRequest,
): Promise<RemotePlaybackSource[]> {
  const url = buildRemoteResolverUrl(request);
  const payload = await fetchJsonOrText(
    url,
    Math.max(2_000, Number(process.env.PLAYBACK_RESOLVER_TIMEOUT_MS || 7_000)),
  );

  const candidates = extractPlaybackCandidates(payload).slice(0, 6);

  return candidates.map((candidate, index) => ({
    id: `remote-${index + 1}-${candidate.providerReference || 'source'}`,
    type: inferPlaybackType(candidate.url, candidate.type) || 'web',
    quality: candidate.quality || 'auto',
    language: candidate.language || 'und',
    label: candidate.label || 'Remote source',
    labelEn: candidate.label || 'Remote source',
    url: candidate.url,
    isWorking: true,
    provider: 'Remote Resolver',
    providerKey: 'remote-resolver',
    ...(candidate.providerReference ? { providerReference: candidate.providerReference } : {}),
  }));
}

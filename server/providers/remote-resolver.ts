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

function resolverTemplates() {
  const configured = [
    process.env.PLAYBACK_RESOLVER_URLS,
    process.env.PLAYBACK_RESOLVER_URL,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  const unique = [...new Set(configured)];
  if (!unique.length) throw new Error('PLAYBACK_RESOLVER_URL is not configured');

  for (const value of unique) {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') {
      throw new Error('PLAYBACK_RESOLVER_URL must use HTTPS');
    }
  }

  return unique;
}

export function buildRemoteResolverUrl(
  request: RemotePlaybackRequest,
  template: string,
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

export async function resolveRemotePlayback
export async function resolveRemotePlayback(
  request: RemotePlaybackRequest,
): Promise<RemotePlaybackSource[]> {
  const urls = resolverTemplates();
  const timeoutMs = Math.max(2_000, Number(process.env.PLAYBACK_RESOLVER_TIMEOUT_MS || 7_000));
  const candidates = [];
  const errors: string[] = [];

  for (const template of urls) {
    try {
      const url = buildRemoteResolverUrl(request, template);
      const payload = await fetchJsonOrText(url, timeoutMs);
      candidates.push(...extractPlaybackCandidates(payload));
      if (candidates.length >= 6) break;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const unique = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.url)) unique.set(candidate.url, candidate);
    if (unique.size >= 6) break;
  }

  if (!unique.size && errors.length) {
    throw new Error(errors.join(' | '));
  }

  return [...unique.values()].map((candidate, index) => ({
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

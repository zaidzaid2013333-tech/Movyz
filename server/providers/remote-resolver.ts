import { extractPlaybackCandidates, fetchJsonOrText, inferPlaybackType } from './http';

const DEFAULT_STREAMAR_ADDON_URL = 'https://2ecbbd610840-stremio-ar.baby-beamup.club';

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

const DEFAULT_FASELHD_API_URL = 'https://faselhdapi.onrender.com';

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

async function resolveTmdbExternalId(type: 'movie' | 'series', tmdbId: number, timeoutMs: number) {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('TMDB_API_READ_ACCESS_TOKEN is not configured');

  const path = type === 'movie' ? `/movie/${tmdbId}/external_ids` : `/tv/${tmdbId}/external_ids`;
  const response = await fetchJsonOrText(
    `https://api.themoviedb.org/3${path}`,
    timeoutMs,
    { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  );

  if (!response || typeof response !== 'object') throw new Error('TMDB external ids response is invalid');
  const imdbId = (response as Record<string, unknown>).imdb_id;
  if (typeof imdbId !== 'string' || !/^tt\\d+$/i.test(imdbId)) {
    throw new Error(`No IMDb id found for TMDB ${tmdbId}`);
  }
  return imdbId;
}

async function resolveTmdbTitle(type: 'movie' | 'series', tmdbId: number, timeoutMs: number) {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('TMDB_API_READ_ACCESS_TOKEN is not configured');

  const path = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const response = await fetchJsonOrText(
    `https://api.themoviedb.org/3${path}`,
    timeoutMs,
    { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  );

  if (!response || typeof response !== 'object') throw new Error('TMDB title response is invalid');
  const data = response as Record<string, unknown>;
  const title = type === 'movie' ? data.title : data.name;
  const originalTitle = type === 'movie' ? data.original_title : data.original_name;
  const chosen = typeof title === 'string' && title.trim() ? title.trim() : originalTitle;
  if (typeof chosen !== 'string' || !chosen.trim()) throw new Error(`No title found for TMDB ${tmdbId}`);
  return chosen.trim();
}

function normalizeTitle(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}]+/gu, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function collectSearchCandidates(payload: unknown): Array<{ id: string; title: string; year?: number }> {
  const out: Array<{ id: string; title: string; year?: number }> = [];
  const seen = new Set<string>();

  const visit = (value: unknown) => {
    if (out.length >= 25) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const obj = asRecord(value);
    if (!obj) return;

    const idValue = obj.id ?? obj.contentId ?? obj.contentID ?? obj.content_id;
    const titleValue = obj.name ?? obj.title ?? obj.originalTitle ?? obj.original_title;
    if (idValue !== undefined && titleValue !== undefined) {
      const id = String(idValue).trim();
      const title = String(titleValue).trim();
      if (id && title && !seen.has(id)) {
        seen.add(id);
        const rawYear = obj.year ?? obj.releaseYear ?? obj.release_year;
        const year = rawYear !== undefined && /^\\d{4}$/.test(String(rawYear)) ? Number(rawYear) : undefined;
        out.push({ id, title, ...(year ? { year } : {}) });
      }
    }

    for (const nested of Object.values(obj)) visit(nested);
  };

  visit(payload);
  return out;
}

function extractFaselLinks(payload: unknown) {
  const links: Array<{ url: string; quality?: string; reference?: string }> = [];
  const seen = new Set<string>();

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const obj = asRecord(value);
    if (!obj) return;

    const urlValue = obj.url ?? obj.link ?? obj.file ?? obj.src;
    if (typeof urlValue === 'string' && /^https?:\\/\\//i.test(urlValue)) {
      const url = urlValue.trim();
      if (!seen.has(url)) {
        seen.add(url);
        const qualityValue = obj.label ?? obj.quality ?? obj.resolution ?? obj.name;
        links.push({
          url,
          ...(typeof qualityValue === 'string' && qualityValue.trim() ? { quality: qualityValue.trim() } : {}),
          ...(typeof obj.id === 'string' || typeof obj.id === 'number' ? { reference: String(obj.id) } : {}),
        });
      }
    }

    for (const nested of Object.values(obj)) visit(nested);
  };

  visit(payload);
  return links.slice(0, 6);
}

async function resolveFaselHdPlayback(
  request: RemotePlaybackRequest,
  timeoutMs: number,
): Promise<RemotePlaybackSource[]> {
  const base = (process.env.FASELHD_API_URL?.trim() || DEFAULT_FASELHD_API_URL).replace(/\\/$/, '');
  const title = await resolveTmdbTitle(request.type, request.tmdbId, timeoutMs);

  const searchPayload = await fetchJsonOrText(
    `${base}/search?query=${encodeURIComponent(title)}&page=1&pageSize=10`,
    timeoutMs,
  );

  const candidates = collectSearchCandidates(searchPayload);
  if (!candidates.length) throw new Error(`FaselHD returned no search results for "${title}"`);

  const wanted = normalizeTitle(title);
  const exact = candidates.find((candidate) => normalizeTitle(candidate.title) === wanted)
    || candidates.find((candidate) => normalizeTitle(candidate.title).includes(wanted) || wanted.includes(normalizeTitle(candidate.title)))
    || candidates[0];

  let contentPayload: unknown;
  if (request.type === 'movie') {
    contentPayload = await fetchJsonOrText(`${base}/movie/${encodeURIComponent(exact.id)}`, timeoutMs);
  } else {
    if (!Number.isInteger(request.episode) || request.episode < 1) {
      throw new Error('FaselHD series playback requires episode');
    }
    contentPayload = await fetchJsonOrText(
      `${base}/tv/${encodeURIComponent(exact.id)}/episode/${request.episode}`,
      timeoutMs,
    );
  }

  const links = extractFaselLinks(contentPayload);
  if (!links.length) throw new Error(`FaselHD returned no playback links for "${exact.title}"`);

  return links.map((link, index) => ({
    id: `faselhd-${index + 1}`,
    type: inferPlaybackType(link.url, 'hls') || 'web',
    quality: link.quality || 'auto',
    language: 'ar',
    label: `FaselHD ${link.quality || index + 1}`,
    labelEn: `FaselHD ${link.quality || index + 1}`,
    url: link.url,
    isWorking: true,
    provider: 'FaselHD',
    providerKey: 'faselhd',
    ...(link.reference ? { providerReference: link.reference } : {}),
  }));
}

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


export async function resolveRemotePlayback(
  request: RemotePlaybackRequest,
): Promise<RemotePlaybackSource[]> {
  const timeoutMs = Math.max(2_000, Number(process.env.PLAYBACK_RESOLVER_TIMEOUT_MS || 7_000));
  const candidates = [];
  const errors: string[] = [];

  // StreamAR is the primary provider for Movyz.
  try {
    candidates.push(...await resolveStreamArPlayback(request, timeoutMs));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  // Optional generic resolvers are secondary fallbacks.
  if (!candidates.length) {
    for (const template of resolverTemplates()) {
      try {
        const url = buildRemoteResolverUrl(request, template);
        const payload = await fetchJsonOrText(url, timeoutMs);
        candidates.push(...extractPlaybackCandidates(payload));
        if (candidates.length >= 6) break;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  if (!candidates.length && errors.length) {
    throw new Error(errors.join(' | '));
  }

  const unique = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.url)) unique.set(candidate.url, candidate);
    if (unique.size >= 6) break;
  }

  return [...unique.values()].map((candidate, index) => ({
    id: `remote-${index + 1}-${candidate.providerReference || 'source'}`,
    type: inferPlaybackType(candidate.url, candidate.type) || 'web',
    quality: candidate.quality || 'auto',
    language: candidate.language || 'und',
    label: candidate.label || 'StreamAR',
    labelEn: candidate.label || 'StreamAR',
    url: candidate.url,
    isWorking: true,
    provider: 'StreamAR',
    providerKey: 'streamar',
    ...(candidate.providerReference ? { providerReference: candidate.providerReference } : {}),
  }));
}

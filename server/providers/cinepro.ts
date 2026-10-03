import type { NormalizedPlaybackSource } from './types';

type CineProEnv = Record<string, unknown>;

export type CineProMediaLocator =
  | { type: 'movie'; tmdbId: number }
  | { type: 'episode'; tmdbId: number; season: number; episode: number };

type CineProSource = {
  url?: unknown;
  type?: unknown;
  quality?: unknown;
  provider?: { id?: unknown; name?: unknown };
  language?: unknown;
  label?: unknown;
  labelEn?: unknown;
  headers?: Record<string, string>;
  referer?: string;
};

type CineProResponse = {
  sources?: CineProSource[];
  subtitles?: unknown[];
  diagnostics?: unknown[];
  expiresAt?: string;
};

const timeoutMs = 15_000;

function baseUrl(env: CineProEnv) {
  const value = String(env.CINEPRO_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\//i.test(value) ? value : '';
}

function sourceType(value: unknown): NormalizedPlaybackSource['type'] | null {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'hls' || type === 'dash' || type === 'mp4' || type === 'webm' || type === 'direct') {
    return type;
  }
  return null;
}

function quality(value: unknown) {
  const raw = String(value || '').trim().toLowerCase();
  if (/^\d{3,4}p$/.test(raw)) return raw;
  const match = raw.match(/(\d{3,4})/);
  return match ? `${match[1]}p` : '720p';
}

function absoluteUrl(value: unknown, cineProBase: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, cineProBase).toString();
  } catch {
    return '';
  }
}

async function fetchJson(path: string, env: CineProEnv): Promise<CineProResponse | null> {
  const cineProBase = baseUrl(env);
  if (!cineProBase) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const apiKey = String(env.CINEPRO_API_KEY || '').trim();
    const headers = new Headers({
      Accept: 'application/json',
      'User-Agent': 'Movyz-CinePro/1.0',
    });
    if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);

    const response = await fetch(`${cineProBase}${path}`, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn('[cinepro]', `${path} -> HTTP ${response.status}`);
      return null;
    }

    const payload = await response.json() as CineProResponse;
    return payload && typeof payload === 'object' ? payload : null;
  } catch (error) {
    console.warn('[cinepro]', error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getCineProPlaybackSources(
  locator: CineProMediaLocator,
  env: CineProEnv,
): Promise<NormalizedPlaybackSource[]> {
  if (!baseUrl(env)) return [];

  const path = locator.type === 'movie'
    ? `/v1/movies/${encodeURIComponent(String(locator.tmdbId))}?platform=web`
    : `/v1/tv/${encodeURIComponent(String(locator.tmdbId))}/seasons/${locator.season}/episodes/${locator.episode}?platform=web`;

  const payload = await fetchJson(path, env);
  const sources = Array.isArray(payload?.sources) ? payload.sources : [];

  return sources
    .map((source): NormalizedPlaybackSource | null => {
      const type = sourceType(source.type);
      const url = absoluteUrl(source.url, baseUrl(env));
      if (!type || !url || !/^https:\/\//i.test(url)) return null;

      const providerId = String(source.provider?.id || 'cinepro').trim() || 'cinepro';
      const providerName = String(source.provider?.name || providerId).trim() || providerId;
      const sourceQuality = quality(source.quality);

      return {
        provider: providerName,
        providerReference: `cinepro:${providerId}`,
        type,
        url,
        quality: sourceQuality,
        language: String(source.language || 'und'),
        label: String(source.label || providerName),
        referer: source.referer,
        headers: source.headers,
        expiresAt: payload?.expiresAt,
      };
    })
    .filter((source): source is NormalizedPlaybackSource => source !== null);
}

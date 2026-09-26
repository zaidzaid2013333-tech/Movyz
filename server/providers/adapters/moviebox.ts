import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import { fetchWithTimeout, inferPlaybackType, inferQuality } from '../http';

const H5_API = 'https://h5-api.aoneroom.com';
const DEFAULT_MOVIEBOX_API = 'https://movyz-moviebox.sameranede.workers.dev';
const DEFAULT_STREAM_DOMAIN = 'https://123movienow.cc';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type SearchItem = { title?: string; name?: string; slug?: string; detailPath?: string; releaseDate?: string | number; year?: string | number };

function env(name: string, fallback = '') { return String(process.env[name] || fallback).trim(); }

function h5Headers(extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': USER_AGENT,
    'X-Client-Info': '{"timezone":"Africa/Algiers"}',
    'X-Request-Lang': 'en',
    Referer: 'https://moviebox.pk/',
    ...extra,
  };
  return headers;
}

function normalizeTitle(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\[\]().,:;!?"']/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleScore(query: string, candidate: string) {
  const a = normalizeTitle(query); const b = normalizeTitle(candidate);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.includes(a) || a.includes(b)) return 82;
  const aw = new Set(a.split(' ').filter((x) => x.length > 1));
  const bw = new Set(b.split(' ').filter((x) => x.length > 1));
  if (!aw.size || !bw.size) return 0;
  let shared = 0; for (const word of aw) if (bw.has(word)) shared++;
  return Math.round((shared / Math.max(aw.size, bw.size)) * 70);
}

function yearOf(item: SearchItem) {
  const match = String(item.releaseDate ?? item.year ?? '').match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : 0;
}

async function fetchJson<T>(url: string, timeoutMs: number, init: RequestInit = {}, headersOverride?: Record<string, string>): Promise<T> {
  const response = await fetchWithTimeout(url, {
    ...init,
    headers: headersOverride || h5Headers(init.headers && !(init.headers instanceof Headers) ? init.headers as Record<string, string> : {}),
    timeoutMs,
  });
  const text = await response.text();
  if (!response.ok) {
    const snippet = text.replace(/\s+/g, ' ').slice(0, 240);
    throw new Error('MovieBox HTTP ' + response.status + (snippet ? ': ' + snippet : ''));
  }
  try { return JSON.parse(text) as T; } catch { throw new Error('MovieBox returned invalid JSON'); }
}

async function searchViaMovieBoxApi(baseUrl: string, query: string, timeoutMs: number): Promise<SearchItem[]> {
  const payload = await fetchJson<any>(baseUrl + '/search?q=' + encodeURIComponent(query), timeoutMs, {}, { Accept: 'application/json', 'User-Agent': USER_AGENT });
  return Array.isArray(payload?.movies) ? payload.movies : Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.items) ? payload.items : [];
}

async function searchViaH5(query: string, timeoutMs: number): Promise<SearchItem[]> {
  const endpoints = [
    '/wefeed-h5api-bff/subject/search',
    '/wefeed-h5api-bff/subject/everyone-search',
  ];
  for (const endpoint of endpoints) {
    try {
      const payload = await fetchJson<any>(H5_API + endpoint, timeoutMs, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: query, perPage: 30, page: 1 }),
      });
      const items = payload?.data?.items || payload?.data?.subjects || payload?.items || [];
      if (Array.isArray(items) && items.length) return items;
    } catch {
      // Try the current alternate H5 search endpoint.
    }
  }
  return [];
}

async function chooseMatch(context: ProviderContext, timeoutMs: number, baseUrl: string) {
  const queries = [...new Set([context.title, context.originalTitle].map((value) => String(value || '').trim()).filter(Boolean))];
  const all: SearchItem[] = [];
  const failures: string[] = [];
  for (const query of queries) {
    try {
      all.push(...await searchViaMovieBoxApi(baseUrl, query, timeoutMs));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'dedicated worker search failed');
      try {
        all.push(...await searchViaH5(query, timeoutMs));
      } catch (fallbackError) {
        failures.push(fallbackError instanceof Error ? fallbackError.message : 'H5 search failed');
      }
    }
  }
  if (!all.length && failures.length) throw new Error('MovieBox search failed for "' + context.title + '": ' + failures.join(' | '));
  const unique = new Map<string, SearchItem>();
  for (const item of all) {
    const slug = String(item.slug || item.detailPath || '').trim();
    if (slug && !unique.has(slug)) unique.set(slug, item);
  }
  let best: { score: number; item: SearchItem } | null = null;
  for (const item of unique.values()) {
    const title = String(item.title || item.name || '');
    const score = Math.max(...queries.map((query) => {
      const base = titleScore(query, title);
      const yearBonus = context.releaseYear && yearOf(item) === context.releaseYear ? 24 : 0;
      return base + yearBonus;
    }));
    if (!best || score > best.score) best = { score, item };
  }
  if (!best || best.score < 45) return null;
  const slug = String(best.item.slug || best.item.detailPath || '').trim();
  return slug ? { slug, item: best.item, score: best.score } : null;
}
async function getSubjectIdFromMovieBoxApi(baseUrl: string, slug: string, timeoutMs: number) {
  const detail = await fetchJson<any>(baseUrl + '/detail/' + encodeURIComponent(slug), timeoutMs, {}, { Accept: 'application/json', 'User-Agent': USER_AGENT });
  const subjectId = detail?.metadata?.id || detail?.subjectId || detail?.id;
  return subjectId != null ? String(subjectId) : '';
}

async function getSubjectIdFromH5(slug: string, timeoutMs: number) {
  const detail = await fetchJson<any>(H5_API + '/wefeed-h5api-bff/detail?detailPath=' + encodeURIComponent(slug), timeoutMs);
  const data = detail?.data || {};
  const resource = data.resource || {};
  const subject = data.subject || resource.subject || {};
  const subjectId = subject.subjectId || subject.id || data.subjectId || data.subject_id || data.id || resource.id || resource.subjectId;
  return subjectId != null ? String(subjectId) : '';
}

async function discoverDomain(timeoutMs: number) {
  const configured = env('MOVIEBOX_STREAM_DOMAIN');
  if (configured) return configured.replace(/\/+$/, '');
  try {
    const payload = await fetchJson<any>(H5_API + '/wefeed-h5api-bff/media-player/get-domain', timeoutMs, {
      headers: { 'X-Client-Type': 'h5' },
    });
    const domain = String(payload?.data?.domain || payload?.data?.url || payload?.data || '').trim();
    if (domain) return domain.replace(/\/+$/, '');
  } catch {}
  return DEFAULT_STREAM_DOMAIN;
}

async function fetchStreamsViaMovieBoxApi(baseUrl: string, subjectId: string, slug: string, season: number, episode: number, timeoutMs: number) {
  const url = baseUrl + '/api/stream/' + encodeURIComponent(subjectId) + '?detail_path=' + encodeURIComponent(slug) + '&se=' + season + '&ep=' + episode;
  const payload = await fetchJson<any>(url, timeoutMs, {}, { Accept: 'application/json', 'User-Agent': USER_AGENT });
  return payload?.sources || payload?.streams || payload?.data?.sources || payload?.data?.streams || [];
}

async function fetchStreamsViaH5(subjectId: string, slug: string, season: number, episode: number, timeoutMs: number) {
  const domain = await discoverDomain(timeoutMs);
  const url = domain + '/wefeed-h5api-bff/subject/play?subjectId=' + encodeURIComponent(subjectId) + '&se=' + season + '&ep=' + episode + '&detailPath=' + encodeURIComponent(slug);
  const payload = await fetchJson<any>(url, timeoutMs, {
    headers: {
      'Content-Type': 'application/json',
      referer: domain + '/spa/videoPlayPage/movies/' + slug,
      'X-Client-Info': '{"timezone":"Africa/Algiers"}',
    },
  });
  const data = payload?.data || payload;
  return data?.streams || data?.sources || data?.resourceList || data?.resources || payload?.streams || payload?.sources || [];
}

function buildProxyUrl(baseUrl: string, subjectId: string, slug: string, season: number, episode: number, resolution: number) {
  const params = new URLSearchParams({
    detail_path: slug,
    se: String(season),
    ep: String(episode),
    resolution: String(resolution || 0),
  });
  return baseUrl + '/watch/' + encodeURIComponent(subjectId) + '?' + params.toString();
}

function streamUrl(stream: any) {
  for (const key of ['url', 'resourceUrl', 'resourceLink', 'playUrl', 'videoUrl', 'link', 'src']) {
    if (typeof stream?.[key] === 'string' && stream[key].trim()) return stream[key].trim();
  }
  return '';
}

function streamType(stream: any, rawUrl: string) {
  const explicit = String(stream?.format || stream?.type || stream?.mimeType || stream?.contentType || '').toLowerCase();
  const inferred = inferPlaybackType(rawUrl, explicit);
  if (inferred) return inferred;
  if (explicit.includes('m3u8') || explicit.includes('hls')) return 'hls' as const;
  if (explicit.includes('mpd') || explicit.includes('dash')) return 'dash' as const;
  if (explicit.includes('mp4') || explicit.includes('video/')) return 'mp4' as const;
  return null;
}

export function createMovieBoxApiAdapter(): ProviderAdapter {
  const timeoutMs = Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000);
  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode'): Promise<NormalizedPlaybackSource[]> => {
    if (!context.tmdbId || !context.title) return [];
    const baseUrl = env('MOVIEBOX_API_BASE_URL', DEFAULT_MOVIEBOX_API).replace(/\/+$/, '');
    const proxyPlayback = env('MOVIEBOX_PROXY_PLAYBACK', 'true').toLowerCase() === 'true';

    const match = await chooseMatch(context, timeoutMs, baseUrl);
    if (!match) throw new Error('MovieBox match resolution returned no result');
    const subjectId = await getSubjectIdFromMovieBoxApi(baseUrl, match.slug, timeoutMs);
    if (!subjectId) throw new Error('MovieBox detail returned no subject id for ' + match.slug);

    const season = kind === 'episode' ? Number(context.seasonNumber || 0) : 0;
    const episode = kind === 'episode' ? Number(context.episodeNumber || 0) : 0;
    let streams: any[];
    try {
      streams = await fetchStreamsViaMovieBoxApi(baseUrl, subjectId, match.slug, season, episode, timeoutMs);
    } catch (error) {
      const workerError = error instanceof Error ? error.message : 'dedicated worker stream failed';
      try {
        streams = await fetchStreamsViaH5(subjectId, match.slug, season, episode, timeoutMs);
      } catch (fallbackError) {
        const h5Error = fallbackError instanceof Error ? fallbackError.message : 'H5 stream failed';
        throw new Error('MovieBox stream failed for subject ' + subjectId + ': ' + workerError + ' | ' + h5Error);
      }
    }

    const normalized = (Array.isArray(streams) ? streams : []).flatMap((stream: any, index: number): NormalizedPlaybackSource[] => {
      const rawUrl = streamUrl(stream);
      if (!rawUrl || !/^https:\/\//i.test(rawUrl)) return [];

      const resolution = Number(String(stream?.resolutions ?? stream?.resolution ?? '').replace(/[^0-9]/g, '')) || 0;
      const type = streamType(stream, rawUrl);
      if (!type) return [];

      const quality = resolution ? String(resolution) + 'p' : inferQuality(stream?.label || stream?.quality || '', rawUrl);
      const url = proxyPlayback
        ? buildProxyUrl(baseUrl, subjectId, match.slug, season, episode, resolution)
        : rawUrl;

      return [{
        provider: 'moviebox-api',
        type,
        url,
        providerReference: subjectId + ':' + match.slug + ':' + season + ':' + episode + ':' + String(stream?.id ?? index),
        quality: quality || 'auto',
        language: typeof stream?.language === 'string' ? stream.language : 'und',
        label: proxyPlayback
          ? (quality && quality !== 'auto' ? 'MovieBox Proxy ' + quality : 'MovieBox Proxy')
          : (quality && quality !== 'auto' ? 'MovieBox ' + quality : 'MovieBox'),
      }];
    });

    if (!normalized.length) {
      const sample = (Array.isArray(streams) ? streams : []).slice(0, 6).map((stream: any) => ({
        id: stream?.id ?? null,
        format: stream?.format ?? stream?.type ?? null,
        resolution: stream?.resolutions ?? stream?.resolution ?? null,
        hasUrl: Boolean(streamUrl(stream)),
      }));
      throw new Error('MovieBox returned no playable sources: ' + JSON.stringify(sample));
    }

    return normalized;
  };

  return {
    key: 'moviebox-api', name: 'MovieBox API', enabled: true, requiresMapping: false,
    resolveMovie: (context) => resolve(context, 'movie'),
    resolveEpisode: (context) => resolve(context, 'episode'),
    health: async () => {
      const started = Date.now();
      try {
        const sources = await resolve({ tmdbId: 550, title: 'Fight Club', originalTitle: 'Fight Club', releaseYear: 1999 }, 'movie');
        const latencyMs = Date.now() - started;
        return sources.length ? { status: latencyMs < 5_000 ? 'healthy' as const : 'degraded' as const, latencyMs } : { status: 'offline' as const, latencyMs, message: 'MovieBox returned no playable source' };
      } catch (error) {
        return { status: 'offline' as const, latencyMs: Date.now() - started, message: error instanceof Error ? error.message : 'MovieBox health check failed' };
      }
    },
  };
}
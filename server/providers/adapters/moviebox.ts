import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import { fetchWithTimeout, inferPlaybackType, inferQuality } from '../http';

const H5_API = 'https://h5-api.aoneroom.com';
const DEFAULT_STREAM_DOMAIN = 'https://123movienow.cc';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type SearchItem = { title?: string; name?: string; slug?: string; detailPath?: string; releaseDate?: string | number; year?: string | number };

function env(name: string, fallback = '') { return String(process.env[name] || fallback).trim(); }

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

async function fetchJson<T>(url: string, timeoutMs: number, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithTimeout(url, {
    ...init,
    headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': USER_AGENT, ...(init.headers || {}) },
    timeoutMs,
  });
  const text = await response.text();
  if (!response.ok) throw new Error('MovieBox HTTP ' + response.status);
  try { return JSON.parse(text) as T; } catch { throw new Error('MovieBox returned invalid JSON'); }
}

async function searchViaMovieBoxApi(baseUrl: string, query: string, timeoutMs: number): Promise<SearchItem[]> {
  const payload = await fetchJson<any>(baseUrl + '/search?q=' + encodeURIComponent(query), timeoutMs);
  return Array.isArray(payload?.movies) ? payload.movies : Array.isArray(payload?.results) ? payload.results : [];
}

async function searchViaH5(query: string, timeoutMs: number): Promise<SearchItem[]> {
  const payload = await fetchJson<any>(H5_API + '/wefeed-h5api-bff/subject/search', timeoutMs, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: query, perPage: 30, page: 1 }),
  });
  return Array.isArray(payload?.data?.items) ? payload.data.items : [];
}

async function chooseMatch(context: ProviderContext, timeoutMs: number, baseUrl: string) {
  const queries = [...new Set([context.title, context.originalTitle].map((value) => String(value || '').trim()).filter(Boolean))];
  const all: SearchItem[] = [];
  for (const query of queries) {
    try { all.push(...(baseUrl ? await searchViaMovieBoxApi(baseUrl, query, timeoutMs) : await searchViaH5(query, timeoutMs))); } catch { continue; }
  }
  const unique = new Map<string, SearchItem>();
  for (const item of all) { const slug = String(item.slug || item.detailPath || '').trim(); if (slug && !unique.has(slug)) unique.set(slug, item); }
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
  const detail = await fetchJson<any>(baseUrl + '/detail/' + encodeURIComponent(slug), timeoutMs);
  const subjectId = detail?.metadata?.id;
  return subjectId != null ? String(subjectId) : '';
}

async function getSubjectIdFromH5(slug: string, timeoutMs: number) {
  const detail = await fetchJson<any>(H5_API + '/wefeed-h5api-bff/detail?detailPath=' + encodeURIComponent(slug), timeoutMs);
  const data = detail?.data || {}; const resource = data.resource || {};
  const subjectId = data.subject?.subjectId || data.subjectId || resource.id;
  return subjectId != null ? String(subjectId) : '';
}

async function discoverDomain(timeoutMs: number) {
  const configured = env('MOVIEBOX_STREAM_DOMAIN');
  if (configured) return configured.replace(/\/+$/, '');
  try {
    const payload = await fetchJson<any>(H5_API + '/wefeed-h5api-bff/media-player/get-domain', timeoutMs, { headers: { 'X-Client-Type': 'h5' } });
    const domain = String(payload?.data || '').trim(); if (domain) return domain.replace(/\/+$/, '');
  } catch {}
  return DEFAULT_STREAM_DOMAIN;
}

async function fetchStreamsViaMovieBoxApi(baseUrl: string, subjectId: string, slug: string, season: number, episode: number, timeoutMs: number) {
  const url = baseUrl + '/api/stream/' + encodeURIComponent(subjectId) + '?detail_path=' + encodeURIComponent(slug) + '&se=' + season + '&ep=' + episode;
  const payload = await fetchJson<any>(url, timeoutMs);
  return Array.isArray(payload?.sources) ? payload.sources : [];
}

async function fetchStreamsViaH5(subjectId: string, slug: string, season: number, episode: number, timeoutMs: number) {
  const domain = await discoverDomain(timeoutMs);
  const url = domain + '/wefeed-h5api-bff/subject/play?subjectId=' + encodeURIComponent(subjectId) + '&se=' + season + '&ep=' + episode + '&detailPath=' + encodeURIComponent(slug);
  const payload = await fetchJson<any>(url, timeoutMs, {
    headers: { referer: domain + '/spa/videoPlayPage/movies/' + slug, 'X-Client-Info': '{"timezone":"Africa/Algiers"}', Cookie: 'uuid=d8c3539e-2e46-4000-af20-7046a856e30a' },
  });
  return Array.isArray(payload?.data?.streams) ? payload.data.streams : [];
}

export function createMovieBoxApiAdapter(): ProviderAdapter {
  const timeoutMs = Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000);
  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode'): Promise<NormalizedPlaybackSource[]> => {
    if (!context.tmdbId || !context.title) return [];
    const baseUrl = env('MOVIEBOX_API_BASE_URL').replace(/\/+$/, '');
    const match = await chooseMatch(context, timeoutMs, baseUrl); if (!match) return [];
    const subjectId = baseUrl ? await getSubjectIdFromMovieBoxApi(baseUrl, match.slug, timeoutMs) : await getSubjectIdFromH5(match.slug, timeoutMs);
    if (!subjectId) return [];
    const season = kind === 'episode' ? Number(context.seasonNumber || 0) : 0;
    const episode = kind === 'episode' ? Number(context.episodeNumber || 0) : 0;
    const streams = baseUrl ? await fetchStreamsViaMovieBoxApi(baseUrl, subjectId, match.slug, season, episode, timeoutMs) : await fetchStreamsViaH5(subjectId, match.slug, season, episode, timeoutMs);
    return streams.flatMap((stream: any, index: number): NormalizedPlaybackSource[] => {
      const url = typeof stream?.url === 'string' ? stream.url.trim() : ''; if (!url || !/^https:\/\//i.test(url)) return [];
      const type = inferPlaybackType(url, stream?.format || stream?.type); if (!type) return [];
      const quality = stream?.resolutions ? String(stream.resolutions) + 'p' : inferQuality(stream?.label || '', url);
      return [{ provider: 'moviebox-api', type, url, providerReference: subjectId + ':' + match.slug + ':' + season + ':' + episode + ':' + String(stream?.id ?? index), quality: quality || 'auto', language: typeof stream?.language === 'string' ? stream.language : 'und', label: quality && quality !== 'auto' ? 'MovieBox ' + quality : 'MovieBox' }];
    });
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
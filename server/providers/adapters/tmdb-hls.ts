import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import { fetchJsonOrText, inferPlaybackType, inferQuality, materializeTemplate, resolveSourcesFromPayload } from '../http';

type TmdbHlsConfig = {
  key: string;
  name: string;
  movieUrl: string;
  episodeUrl: string;
  timeoutMs: number;
  language: string;
  templateValues?: Record<string, string | number | undefined>;
  healthUrl?: string;
};

export function createTmdbHlsAdapter(config: TmdbHlsConfig): ProviderAdapter {
  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode') => {
    if (!context.tmdbId) return [];
    const template = kind === 'movie' ? config.movieUrl : config.episodeUrl;
    const url = materializeTemplate(template, { tmdbId: context.tmdbId, season: context.seasonNumber, episode: context.episodeNumber, ...(config.templateValues || {}) });
    const payload = await fetchJsonOrText(url, config.timeoutMs);
    return resolveSourcesFromPayload(payload, { language: config.language, label: config.name }).flatMap((source): NormalizedPlaybackSource[] => {
      const type = inferPlaybackType(source.url, source.type);
      if (!type) return [];
      return [{ provider: config.key, type, url: source.url, providerReference: `${context.tmdbId}:${kind}`, quality: source.quality || inferQuality(source.label, source.url), language: source.language || config.language, label: source.label || config.name, expiresAt: source.expiresAt }];
    });
  };
  return {
    key: config.key, name: config.name, enabled: true,
    resolveMovie: (context) => resolve(context, 'movie'),
    resolveEpisode: (context) => resolve(context, 'episode'),
    health: async () => {
      const started = Date.now();
      const healthUrl = config.healthUrl || materializeTemplate(config.movieUrl, { tmdbId: 550, season: 1, episode: 1, ...(config.templateValues || {}) });
      try { await fetchJsonOrText(healthUrl, Math.min(config.timeoutMs, 5_000)); const latencyMs = Date.now() - started; return { status: latencyMs < 2_500 ? 'healthy' as const : 'degraded' as const, latencyMs }; }
      catch (error) { return { status: 'offline' as const, latencyMs: Date.now() - started, message: error instanceof Error ? error.message : 'Health check failed' }; }
    },
  };
}

const timeoutMs = Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000);

export function createVidZeeAdapter() {
  const timeout = Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000);
  const baseUrl = process.env.VIDZEE_API_BASE_URL || 'https://core.vidzee.wtf';
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; Movyz/1.0)', Accept: 'application/json, */*', Referer: process.env.VIDZEE_REFERER || 'https://player.vidzee.wtf/' };
  const servers = (process.env.VIDZEE_SERVERS || 'dcloud,tik,ipcloud,v6:Hindi').split(',').map((v) => v.trim()).filter(Boolean);

  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode'): Promise<NormalizedPlaybackSource[]> => {
    if (!context.tmdbId) return [];
    const pathFor = (server: string) => kind === 'movie'
      ? `/streams/movie/${encodeURIComponent(String(context.tmdbId))}?s=${encodeURIComponent(server)}&e=0`
      : context.seasonNumber != null && context.episodeNumber != null
        ? `/streams/tv/${encodeURIComponent(String(context.tmdbId))}/${encodeURIComponent(String(context.seasonNumber))}/${encodeURIComponent(String(context.episodeNumber))}?s=${encodeURIComponent(server)}&e=0`
        : null;

    const sources: NormalizedPlaybackSource[] = [];
    for (const server of servers) {
      const path = pathFor(server);
      if (!path) break;
      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, { headers, signal: AbortSignal.timeout(timeout) });
        if (!response.ok) continue;
        const payload = await response.json() as any;
        const candidates = Array.isArray(payload) ? payload : [payload];
        for (const item of candidates) {
          const url = typeof item?.url === 'string' ? item.url.trim() : '';
          const type = inferPlaybackType(url, item?.type);
          if (!/^https?:\/\//i.test(url) || !type) continue;
          sources.push({
            provider: 'vidzee', type, url,
            providerReference: `${context.tmdbId}:${kind}${kind === 'episode' ? `:${context.seasonNumber}:${context.episodeNumber}` : ''}:${server}`,
            quality: inferQuality(item?.quality || item?.label || '', url),
            language: typeof item?.language === 'string' ? item.language : 'und',
            label: item?.quality || item?.label || `VidZee ${server}`,
          });
        }
      } catch {
        continue;
      }
    }
    if (!sources.length) throw new Error('VidZee returned no playable source from configured servers');
    return sources;
  };

  return {
    key: 'vidzee', name: 'VidZee', enabled: true, requiresMapping: false,
    resolveMovie: (context: ProviderContext) => resolve(context, 'movie'),
    resolveEpisode: (context: ProviderContext) => resolve(context, 'episode'),
    health: async () => {
      const started = Date.now();
      try {
        const result = await resolve({ tmdbId: 550 }, 'movie');
        if (!result.length) throw new Error('No VidZee source');
        const latencyMs = Date.now() - started;
        return { status: latencyMs < 2_500 ? 'healthy' as const : 'degraded' as const, latencyMs };
      } catch (error) {
        return { status: 'offline' as const, latencyMs: Date.now() - started, message: error instanceof Error ? error.message : 'VidZee health check failed' };
      }
    },
  };
}

export function createEzvidApiAdapter() {
  return createTmdbHlsAdapter({
    key: 'ezvidapi', name: 'ezvidAPI',
    movieUrl: process.env.EZVIDAPI_MOVIE_URL_TEMPLATE || 'https://ezvidapi.com/movie/{{provider}}/{{tmdbId}}',
    episodeUrl: process.env.EZVIDAPI_TV_URL_TEMPLATE || 'https://ezvidapi.com/tv/{{provider}}/{{tmdbId}}?season={{season}}&episode={{episode}}',
    timeoutMs, language: 'und', templateValues: { provider: process.env.EZVIDAPI_PROVIDER || 'vidsrc' },
    healthUrl: process.env.EZVIDAPI_HEALTH_URL || undefined,
  });
}

export function createStreamProviderAdapter() {
  return createTmdbHlsAdapter({
    key: 'streamprovider', name: 'StreamProvider',
    movieUrl: process.env.STREAMPROVIDER_MOVIE_URL_TEMPLATE || 'https://streamprovider.byteful.me/?tmdbId={{tmdbId}}',
    episodeUrl: process.env.STREAMPROVIDER_TV_URL_TEMPLATE || 'https://streamprovider.byteful.me/?tmdbId={{tmdbId}}&season={{season}}&episode={{episode}}',
    timeoutMs, language: 'und', healthUrl: process.env.STREAMPROVIDER_HEALTH_URL || undefined,
  });
}

export function createNhdApiAdapter() {
  const key = process.env.NHD_API_KEY?.trim();
  if (!key) return null;
  return createTmdbHlsAdapter({
    key: 'nhdapi', name: 'NHD API',
    movieUrl: process.env.NHD_MOVIE_URL_TEMPLATE || 'https://nhdapi.st/movie/{{tmdbId}}?key={{key}}',
    episodeUrl: process.env.NHD_TV_URL_TEMPLATE || 'https://nhdapi.st/tv/{{tmdbId}}/{{season}}/{{episode}}?key={{key}}',
    timeoutMs, language: 'und', templateValues: { key }, healthUrl: process.env.NHD_HEALTH_URL || undefined,
  });
}

export function createStreamFlixAdapter() {
  const timeoutMs = Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000);
  const apiBase = 'https://api.streamflix.app';
  const firebaseBase = 'https://chilflix-410be-default-rtdb.asia-southeast1.firebasedatabase.app';
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137 Safari/537.36', Accept: 'application/json, */*', 'Accept-Language': 'en-US,en;q=0.9' };
  let dataCache: { items: any[]; expiresAt: number } | null = null;
  let configCache: { config: any; expiresAt: number } | null = null;
  const getData = async () => {
    if (dataCache && dataCache.expiresAt > Date.now()) return dataCache.items;
    const response = await fetch(`${apiBase}/data.json`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`StreamFlix data.json returned ${response.status}`);
    const payload = await response.json() as any;
    const items = Array.isArray(payload?.data) ? payload.data : [];
    dataCache = { items, expiresAt: Date.now() + 30 * 60 * 1000 }; return items;
  };
  const getConfig = async () => {
    if (configCache && configCache.expiresAt > Date.now()) return configCache.config;
    const response = await fetch(`${apiBase}/config/config-streamflixapp.json`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`StreamFlix config returned ${response.status}`);
    const config = await response.json() as any; configCache = { config, expiresAt: Date.now() + 5 * 60 * 1000 }; return config;
  };
  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode'): Promise<NormalizedPlaybackSource[]> => {
    if (!context.tmdbId) return [];
    const [items, config] = await Promise.all([getData(), getConfig()]);
    const match = items.find((item: any) => String(item?.tmdb) === String(context.tmdbId)); if (!match) return [];
    const bases = [...new Set((Array.isArray(config?.download) ? config.download : []).filter((value: unknown): value is string => typeof value === 'string' && value.startsWith('https://')))];
    if (!bases.length) return [];
    if (kind === 'movie') {
      if (!match.movielink) return [];
      return bases.flatMap((base, index) => {
        const url = `${base}${match.movielink}`;
        if (/\\.(mkv|avi|webm|mov)(?:\\?|$)/i.test(url)) return [];
        return [{
          provider: 'streamflix',
          type: inferPlaybackType(url) || 'mp4',
          url,
          providerReference: String(context.tmdbId),
          quality: inferQuality('', url),
          language: 'und',
          label: `StreamFlix${index ? ` Mirror ${index + 1}` : ''}`,
        }];
      });
    }
    if (context.seasonNumber == null || context.episodeNumber == null || !match.moviekey) return [];
    const episodeIndex = context.episodeNumber - 1;
    const episodeUrl = `${firebaseBase}/Data/${encodeURIComponent(String(match.moviekey))}/seasons/${encodeURIComponent(String(context.seasonNumber))}/episodes.json`;
    const episodeResponse = await fetch(episodeUrl, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!episodeResponse.ok) throw new Error(`StreamFlix episodes returned ${episodeResponse.status}`);
    const episodes = await episodeResponse.json() as Record<string, any>;
    const episode = episodes[String(episodeIndex)] ?? episodes[String(context.episodeNumber)]; if (!episode?.link) return [];
    return bases.flatMap((base, index) => {
      const url = `${base}${episode.link}`;
      if (/\\.(mkv|avi|webm|mov)(?:\\?|$)/i.test(url)) return [];
      return [{
        provider: 'streamflix',
        type: inferPlaybackType(url) || 'mp4',
        url,
        providerReference: `${context.tmdbId}:${context.seasonNumber}:${context.episodeNumber}`,
        quality: inferQuality('', url),
        language: 'und',
        label: `StreamFlix${index ? ` Mirror ${index + 1}` : ''}`,
      }];
    });
  };
  return {
    key: 'streamflix', name: 'StreamFlix', enabled: true, requiresMapping: false,
    resolveMovie: (context: ProviderContext) => resolve(context, 'movie'),
    resolveEpisode: (context: ProviderContext) => resolve(context, 'episode'),
    health: async () => { const started = Date.now(); try { await getData(); const latencyMs = Date.now() - started; return { status: latencyMs < 4_000 ? 'healthy' as const : 'degraded' as const, latencyMs }; } catch (error) { return { status: 'offline' as const, latencyMs: Date.now() - started, message: error instanceof Error ? error.message : 'StreamFlix health check failed' }; } },
  };
}

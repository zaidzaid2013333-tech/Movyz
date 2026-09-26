import { adminSupabase } from '../supabase';
import { getProvider } from './registry';
import type { NormalizedPlaybackSource, ProviderContext } from './types';

const VALID_TYPES = new Set(['hls', 'mp4', 'dash']);

export const PROVIDER_PRIORITY: Record<string, number> = {
  // Primary order: FaselHD → NHD → EgyBest → EzVid → StreamProvider.
  // A provider that is disabled, missing credentials/mapping, times out, or
  // returns no valid HLS/MP4/DASH source is skipped automatically.
  faselhd: 0,
  nhdapi: 1,
  egybest: 2,
  ezvidapi: 3,
  streamprovider: 4,
};

function providerPriority(key: string) {
  return PROVIDER_PRIORITY[key] ?? 100;
}

function sourceDto(source: any) {
  return {
    id: source.id,
    type: source.source_type,
    quality: source.quality || 'auto',
    language: source.language || 'und',
    label: source.label_ar || source.providers?.name || 'Source',
    labelEn: source.label_en || source.providers?.name || 'Source',
    url: source.url || '',
    isWorking: source.is_working === true,
    provider: source.providers?.name || 'Provider',
  };
}

function normalizeUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function getContext(contentType: 'movie' | 'episode', contentId: string): Promise<ProviderContext | null> {
  if (contentType === 'movie') {
    const { data } = await adminSupabase.from('movies').select('tmdb_id').eq('id', contentId).maybeSingle();
    return data?.tmdb_id ? { tmdbId: data.tmdb_id } : null;
  }

  const { data: episode } = await adminSupabase
    .from('episodes')
    .select('episode_number,season_id')
    .eq('id', contentId)
    .maybeSingle();
  if (!episode?.season_id || episode.episode_number == null) return null;

  const { data: season } = await adminSupabase
    .from('seasons')
    .select('season_number,series_id')
    .eq('id', episode.season_id)
    .maybeSingle();
  if (!season?.series_id || season.season_number == null) return null;

  const { data: series } = await adminSupabase.from('series').select('tmdb_id').eq('id', season.series_id).maybeSingle();
  if (!series?.tmdb_id) return null;

  return { tmdbId: series.tmdb_id, seasonNumber: season.season_number, episodeNumber: episode.episode_number };
}

export async function resolvePlaybackSources(contentType: 'movie' | 'episode', contentId: string, excludedProviders: string[] = []) {
  const context = await getContext(contentType, contentId);
  if (!context) return [];

  const [{ data: providers, error: providersError }, { data: mappings, error: mappingsError }] = await Promise.all([
    adminSupabase.from('providers').select('id,key,name,enabled,status,latency_ms,success_rate').eq('enabled', true),
    adminSupabase.from('provider_mappings').select('provider_id,provider_content_id,confidence,status')
      .eq('content_type', contentType).eq('internal_content_id', contentId).eq('status', 'active'),
  ]);

  if (providersError) throw new Error('Unable to load enabled providers');
  if (mappingsError) throw new Error('Unable to load provider mappings');

  const mappingByProvider = new Map((mappings || []).map((mapping: any) => [mapping.provider_id, mapping]));
  const orderedProviders = [...(providers || [])].sort((a: any, b: any) => {
    const pa = providerPriority(a.key);
    const pb = providerPriority(b.key);
    if (pa !== pb) return pa - pb;
    const rateDiff = Number(b.success_rate ?? -1) - Number(a.success_rate ?? -1);
    return rateDiff || Number(a.latency_ms ?? Number.MAX_SAFE_INTEGER) - Number(b.latency_ms ?? Number.MAX_SAFE_INTEGER);
  });

  const excluded = new Set(excludedProviders.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const timeoutMs = Math.max(2_000, Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 8_000));

  // True fallback: call providers in fixed priority order and stop at the first
  // provider that returns at least one validated playable source.
  for (const provider of orderedProviders) {
    if (excluded.has(provider.key.toLowerCase()) || excluded.has(String(provider.name || '').trim().toLowerCase().replace(/\s+/g, ''))) continue;

    const adapter = getProvider(provider.key);
    if (!adapter?.enabled) continue;

    const mapping = mappingByProvider.get(provider.id);
    if (adapter.requiresMapping && !mapping?.provider_content_id) continue;

    const started = Date.now();

    try {
      const rawSources = await withTimeout(
        contentType === 'movie'
          ? adapter.resolveMovie({ ...context, providerId: mapping?.provider_content_id })
          : adapter.resolveEpisode({ ...context, providerId: mapping?.provider_content_id }),
        timeoutMs,
        `Provider ${provider.key} timed out`,
      );

      const latencyMs = Date.now() - started;
      const resolved: Array<NormalizedPlaybackSource & {
        providerId: string;
        providerName: string;
        providerLatencyMs: number;
      }> = [];

      for (const source of rawSources || []) {
        const url = normalizeUrl(source.url);
        if (!url || !VALID_TYPES.has(source.type)) continue;
        if (source.expiresAt && Number.isFinite(Date.parse(source.expiresAt)) && new Date(source.expiresAt) <= new Date()) continue;

        resolved.push({
          ...source,
          url,
          quality: source.quality || 'auto',
          language: source.language || 'und',
          label: source.label || provider.name,
          providerId: provider.id,
          providerName: provider.name,
          providerLatencyMs: latencyMs,
        });
      }

      const currentRate = provider.success_rate == null ? 50 : Number(provider.success_rate);
      const nextSuccessRate = resolved.length
        ? Math.min(100, currentRate * 0.8 + 20)
        : Math.max(0, currentRate * 0.9);

      await adminSupabase.from('providers').update({
        status: resolved.length ? 'healthy' : 'degraded',
        latency_ms: latencyMs,
        success_rate: Number(nextSuccessRate.toFixed(2)),
        last_checked_at: new Date().toISOString(),
      }).eq('id', provider.id);

      if (!resolved.length) continue;

      const unique = new Map<string, typeof resolved[number]>();
      for (const source of resolved) {
        unique.set([source.providerId, contentType, source.type, source.url].join('|'), source);
      }

      const rows = [...unique.values()].map((source) => ({
        provider_id: source.providerId,
        content_type: contentType,
        content_id: contentId,
        source_type: source.type,
        url: source.url,
        provider_reference: source.providerReference || null,
        quality: source.quality,
        language: source.language,
        label_ar: source.label,
        label_en: source.label,
        expires_at: source.expiresAt || null,
        is_working: true,
        last_checked_at: new Date().toISOString(),
        failure_count: 0,
      }));

      const { data: persistedSources, error: insertError } = await adminSupabase
        .from('playback_sources')
        .upsert(rows, { onConflict: 'provider_id,content_type,content_id,url' })
        .select('id,source_type,url,quality,language,label_ar,label_en,expires_at,is_working,providers(name)');

      if (insertError) {
        throw new Error('Unable to persist resolved playback sources');
      }

      return (persistedSources || []).map(sourceDto);
    } catch {
      await adminSupabase.from('providers').update({
        status: 'degraded',
        latency_ms: Math.max(Date.now() - started, timeoutMs),
        last_checked_at: new Date().toISOString(),
      }).eq('id', provider.id);
    }
  }

  return [];
}

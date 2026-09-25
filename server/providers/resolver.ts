import { adminSupabase } from '../supabase';
import { getProvider } from './registry';
import type { NormalizedPlaybackSource, ProviderContext } from './types';

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

const validTypes = new Set(['hls', 'mp4', 'dash']);

function normalizeUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function getContext(contentType: 'movie' | 'episode', contentId: string): Promise<ProviderContext | null> {
  if (contentType === 'movie') {
    const { data } = await adminSupabase
      .from('movies')
      .select('tmdb_id')
      .eq('id', contentId)
      .maybeSingle();

    if (!data?.tmdb_id) return null;
    return { tmdbId: data.tmdb_id };
  }

  const { data: episode } = await adminSupabase
    .from('episodes')
    .select('episode_number,season_id')
    .eq('id', contentId)
    .maybeSingle();

  if (!episode?.season_id || !episode.episode_number) return null;

  const { data: season } = await adminSupabase
    .from('seasons')
    .select('season_number,series_id')
    .eq('id', episode.season_id)
    .maybeSingle();

  if (!season?.series_id || !season.season_number) return null;

  const { data: series } = await adminSupabase
    .from('series')
    .select('tmdb_id')
    .eq('id', season.series_id)
    .maybeSingle();

  if (!series?.tmdb_id) return null;

  return {
    tmdbId: series.tmdb_id,
    seasonNumber: season.season_number,
    episodeNumber: episode.episode_number,
  };
}

export async function resolvePlaybackSources(
  contentType: 'movie' | 'episode',
  contentId: string,
) {
  const context = await getContext(contentType, contentId);
  if (!context) return [];

  const { data: providers, error } = await adminSupabase
    .from('providers')
    .select('id,key,name,enabled')
    .eq('enabled', true);

  if (error) throw new Error('Unable to load enabled providers');

  const resolved: Array<NormalizedPlaybackSource & { providerId: string; providerName: string }> = [];

  for (const provider of providers || []) {
    const adapter = getProvider(provider.key);
    if (!adapter || !adapter.enabled) continue;

    try {
      const sources = contentType === 'movie'
        ? await adapter.resolveMovie(context)
        : await adapter.resolveEpisode(context);

      for (const source of sources || []) {
        const url = normalizeUrl(source.url);
        if (!url || !validTypes.has(source.type)) continue;

        resolved.push({
          ...source,
          url,
          quality: source.quality || 'auto',
          language: source.language || 'und',
          label: source.label || provider.name,
          providerId: provider.id,
          providerName: provider.name,
        });
      }
    } catch {
      // One provider must never prevent another configured provider from resolving.
    }
  }

  const unique = new Map<string, typeof resolved[number]>();
  for (const source of resolved) {
    unique.set(source.providerId + '|' + source.type + '|' + source.url, source);
  }

  const uniqueSources = [...unique.values()];

  const activeSources = uniqueSources.filter(
    (source) => !source.expiresAt || new Date(source.expiresAt) > new Date(),
  );

  if (!activeSources.length) return [];

  const { data: insertedSources, error: insertError } = await adminSupabase
    .from('playback_sources')
    .insert(
      activeSources.map((source) => ({
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
      })),
    )
    .select('id,source_type,url,quality,language,label_ar,label_en,expires_at,is_working,providers(name)');

  if (insertError) throw new Error('Unable to persist resolved playback sources');

  return (insertedSources || []).map((source: any) => sourceDto(source));
}

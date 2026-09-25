import { adminSupabase } from '../supabase';
import { getProvider } from './registry';
import type { NormalizedPlaybackSource, ProviderContext } from './types';

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

  const { data } = await adminSupabase
    .from('episodes')
    .select('tmdb_id,episode_number,seasons(season_number)')
    .eq('id', contentId)
    .maybeSingle();

  const season = Array.isArray(data?.seasons) ? data?.seasons[0] : data?.seasons;
  if (!data?.tmdb_id || !season?.season_number) return null;

  return {
    tmdbId: data.tmdb_id,
    seasonNumber: season.season_number,
    episodeNumber: data.episode_number,
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

  if (uniqueSources.length) {
    await adminSupabase.from('playback_sources').insert(
      uniqueSources.map((source) => ({
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
    );
  }

  return uniqueSources.map((source) => ({
    id: `resolved-${source.providerId}-${source.type}-${Buffer.from(source.url!).toString('base64url').slice(0, 12)}`,
    type: source.type,
    quality: source.quality,
    language: source.language,
    label: source.label,
    labelEn: source.label,
    url: source.url,
    isWorking: true,
    provider: source.providerName,
  }));
}

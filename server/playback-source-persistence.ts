import { adminSupabase } from './supabase';
import type { PlaybackKind, NormalizedPlaybackSource } from './providers/types';

type PersistableSource = NormalizedPlaybackSource & {
  providerKey?: string;
};

const SELECTED_PROVIDERS = new Set(['akwam', 'anime4up']);
const NATIVE_TYPES = new Set<PlaybackKind>(['hls', 'mp4', 'dash', 'webm', 'direct']);

let providerIdPromise: Promise<string | null> | null = null;

function inferExpiry(url: string, explicit?: string) {
  if (explicit) return explicit;
  try {
    const parsed = new URL(url);
    for (const key of ['expires', 'expires_at', 'exp']) {
      const raw = parsed.searchParams.get(key);
      if (!raw) continue;
      const numeric = Number(raw);
      const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      if (Number.isFinite(ms) && ms > Date.now()) return new Date(ms).toISOString();
    }
  } catch {}
  return new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
}

async function getProviderId() {
  if (!providerIdPromise) {
    providerIdPromise = (async () => {
      const existing = await adminSupabase
        .from('providers')
        .select('id')
        .eq('key', 're3arabi')
        .maybeSingle();

      if (existing.data?.id) return existing.data.id as string;

      const created = await adminSupabase
        .from('providers')
        .upsert({
          key: 're3arabi',
          name: 're-3arabi',
          adapter_name: 're3arabi',
          enabled: true,
          status: 'healthy',
        }, { onConflict: 'key' })
        .select('id')
        .single();

      if (created.error || !created.data?.id) return null;
      return created.data.id as string;
    })().catch(() => {
      providerIdPromise = null;
      return null;
    });
  }

  return providerIdPromise;
}

function normalizeSources(sources: PersistableSource[]) {
  return sources
    .map((source) => ({
      ...source,
      providerKey: String(source.providerKey || source.providerReference || '').trim().toLowerCase(),
      type: String(source.type || '').trim().toLowerCase() as PlaybackKind,
      url: String(source.url || '').trim(),
    }))
    .filter((source) =>
      SELECTED_PROVIDERS.has(source.providerKey) &&
      NATIVE_TYPES.has(source.type) &&
      /^https:\/\//i.test(source.url) &&
      !['auto', 'source'].includes(String(source.quality || '').trim().toLowerCase()),
    )
    .filter((source, index, all) =>
      index === all.findIndex((candidate) => candidate.url === source.url),
    );
}

async function persist(
  contentType: 'movie' | 'episode',
  contentId: string,
  sources: PersistableSource[],
) {
  const providerId = await getProviderId();
  if (!providerId) return { persisted: 0, nextCheckAt: null as string | null };

  const normalized = normalizeSources(sources);
  const providerKeys = [...new Set(normalized.map((source) => source.providerKey))];

  if (!providerKeys.length) {
    return { persisted: 0, nextCheckAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
  }

  for (const providerKey of providerKeys) {
    await adminSupabase
      .from('playback_sources')
      .update({
        is_working: false,
        failure_count: 1,
        last_checked_at: new Date().toISOString(),
      })
      .eq('provider_id', providerId)
      .eq('content_type', contentType)
      .eq('content_id', contentId)
      .eq('provider_reference', providerKey);
  }

  const rows = normalized.map((source) => ({
    provider_id: providerId,
    content_type: contentType,
    content_id: contentId,
    source_type: source.type,
    url: source.url,
    provider_reference: source.providerKey,
    quality: source.quality || 'source',
    language: source.language || 'ar',
    label_ar: source.label || 'Selected Playback Site',
    label_en: source.label || 'Selected Playback Site',
    expires_at: inferExpiry(source.url, source.expiresAt),
    is_working: true,
    last_checked_at: new Date().toISOString(),
    failure_count: 0,
  }));

  const { error } = await adminSupabase
    .from('playback_sources')
    .upsert(rows, { onConflict: 'provider_id,content_type,content_id,url' });

  if (error) throw new Error('source persistence failed: ' + error.message);

  const expiries = normalized
    .map((source) => inferExpiry(source.url, source.expiresAt))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);

  const nextCheckAt = expiries.length
    ? new Date(Math.max(Date.now() + 30 * 60 * 1000, Math.min(...expiries) - 60 * 60 * 1000)).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  return { persisted: rows.length, nextCheckAt };
}

export async function persistEvergreenMovieSources(movieId: string, sources: PersistableSource[]) {
  return persist('movie', movieId, sources);
}

export async function persistEvergreenEpisodeSources(episodeId: string, sources: PersistableSource[]) {
  return persist('episode', episodeId, sources);
}

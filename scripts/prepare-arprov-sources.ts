import 'dotenv/config';

import { adminSupabase } from '../server/supabase';
import { resolveAkwamPlayback } from '../server/providers/arprov-akwam';
import type { ProviderContext, NormalizedPlaybackSource } from '../server/providers/types';

type Mode = 'movies' | 'episodes';
const MODE = (process.env.PREPARE_MODE || 'movies') as Mode;
const LIMIT = Math.max(1, Number.parseInt(process.env.PREPARE_LIMIT || (MODE === 'movies' ? '500' : '250'), 10) || 250);
const OFFSET = Math.max(0, Number.parseInt(process.env.PREPARE_OFFSET || '0', 10) || 0);
const CONCURRENCY = Math.max(1, Math.min(12, Number.parseInt(process.env.PREPARE_CONCURRENCY || '10', 10) || 10));
const ONLY_MISSING = !/^(0|false|no)$/i.test(process.env.PREPARE_ONLY_MISSING || 'true');

function cleanTitles(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (typeof value === 'string') return [value];
    if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>;
      return [item.title, item.name].filter((x): x is string => typeof x === 'string');
    }
    return [];
  }).map((x) => x.trim()).filter(Boolean).slice(0, 20);
}

function normalizeSource(source: NormalizedPlaybackSource) {
  const url = String(source.url || '').trim();
  const quality = String(source.quality || '').trim().toLowerCase();
  const type = String(source.type || '').trim().toLowerCase();
  if (!/^https:\/\//i.test(url)) return null;
  try {
    if (/\/download(?:\/|$)/i.test(new URL(url).pathname)) return null;
  } catch {
    return null;
  }
  if (!['mp4', 'hls', 'dash', 'webm', 'direct'].includes(type)) return null;
  if (!quality || quality === 'auto' || quality === 'source') return null;
  return { source_type: type, url, provider_reference: 'akwam', quality, language: source.language || 'und', label_ar: source.label || ('Akwam ' + quality), label_en: source.label || ('Akwam ' + quality), expires_at: source.expiresAt || null, is_working: true, last_checked_at: new Date().toISOString(), failure_count: 0 };
}

async function savePrepared(contentType: 'movie' | 'episode', contentId: string, sources: NormalizedPlaybackSource[], providerId: string) {
  const rows = sources.map(normalizeSource).filter((x): x is NonNullable<ReturnType<typeof normalizeSource>> => Boolean(x));
  const deduped = [...new Map(rows.map((row) => [row.quality + '|' + row.source_type + '|' + row.url, row])).values()];
  if (!deduped.length) return 0;
  const { error: deleteError } = await adminSupabase.from('playback_sources').delete().eq('provider_id', providerId).eq('content_type', contentType).eq('content_id', contentId).eq('provider_reference', 'akwam');
  if (deleteError) throw deleteError;
  const payload = deduped.map((row) => ({ provider_id: providerId, content_type: contentType, content_id: contentId, ...row }));
  const { error: insertError } = await adminSupabase.from('playback_sources').insert(payload);
  if (insertError) throw insertError;
  return deduped.length;
}

async function prepareMovie(row: any, providerId: string) {
  const context: ProviderContext = { tmdbId: Number(row.tmdb_id || 0) || undefined, title: row.title_ar || row.title_en || row.original_title || undefined, originalTitle: row.original_title || row.title_en || row.title_ar || undefined, alternateTitles: cleanTitles(row.alternative_titles), releaseYear: row.release_date ? Number(String(row.release_date).slice(0, 4)) : undefined };
  const sources = await resolveAkwamPlayback(context, {});
  const count = await savePrepared('movie', row.id, sources, providerId);
  return { id: row.id, title: row.title_en || row.title_ar, count };
}

async function prepareEpisode(row: any, providerId: string) {
  const season = row.seasons;
  const series = season?.series;
  if (!series || String(series.status || 'published') !== 'published') return { id: row.id, title: row.name_en || row.name_ar, count: 0 };
  const context: ProviderContext = { tmdbId: Number(series.tmdb_id || 0) || undefined, title: series.title_ar || series.title_en || series.original_title || undefined, originalTitle: series.original_title || series.title_en || series.title_ar || undefined, alternateTitles: cleanTitles(series.alternative_titles), releaseYear: series.first_air_date ? Number(String(series.first_air_date).slice(0, 4)) : undefined, seasonNumber: Number(season.season_number || 1), episodeNumber: Number(row.episode_number || 0), episodeTitle: row.name_ar || row.name_en || undefined };
  const sources = await resolveAkwamPlayback(context, {});
  const count = await savePrepared('episode', row.id, sources, providerId);
  return { id: row.id, title: (series.title_en || series.title_ar || 'Series') + ' S' + String(context.seasonNumber).padStart(2, '0') + 'E' + String(context.episodeNumber).padStart(2, '0'), count };
}

async function mapLimit<T>(items: T[], fn: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (true) { const index = cursor++; if (index >= items.length) return; await fn(items[index]); }
  });
  await Promise.all(workers);
}

async function getReadyContentIds(contentType: 'movie' | 'episode', providerId: string) {
  const ids = new Set<string>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await adminSupabase
      .from('playback_sources')
      .select('content_id')
      .eq('provider_id', providerId)
      .eq('content_type', contentType)
      .eq('provider_reference', 'akwam')
      .eq('is_working', true)
      .not('url', 'is', null)
      .is('expires_at', null)
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of data || []) {
      if (row.content_id) ids.add(String(row.content_id));
    }
    if (!data || data.length < pageSize) break;
  }
  return ids;
}

async function main() {
  const { data: provider, error: providerError } = await adminSupabase.from('providers').select('id,key').eq('key', 'arprov').maybeSingle();
  if (providerError) throw providerError;
  if (!provider?.id) throw new Error('ArProv provider row not found');

  if (MODE === 'movies') {
    const { data, error } = await adminSupabase.from('movies').select('id,tmdb_id,title_ar,title_en,original_title,alternative_titles,release_date,status').eq('status', 'published').order('id');
    if (error) throw error;
    const allRows = data || [];
    const readyIds = ONLY_MISSING ? await getReadyContentIds('movie', provider.id) : new Set<string>();
    const candidates = allRows.filter((row: any) => !readyIds.has(String(row.id)));
    const rows = candidates.slice(OFFSET, OFFSET + LIMIT);
    let prepared = 0; let sources = 0;
    await mapLimit(rows, async (row) => { try { const result = await prepareMovie(row, provider.id); if (result.count > 0) prepared++; sources += result.count; console.log(JSON.stringify({ ok: true, ...result })); } catch (error) { console.error(JSON.stringify({ ok: false, id: row.id, title: row.title_en || row.title_ar, error: error instanceof Error ? error.message : String(error) })); } });
    console.log(JSON.stringify({ mode: MODE, requested: rows.length, candidates: candidates.length, skipped: allRows.length - candidates.length, prepared, sources, offset: OFFSET, limit: LIMIT, onlyMissing: ONLY_MISSING }));
    return;
  }

  const { data, error } = await adminSupabase.from('episodes').select('id,tmdb_id,episode_number,name_ar,name_en,seasons!inner(season_number,series:series_id!inner(id,tmdb_id,title_ar,title_en,original_title,alternative_titles,status,first_air_date))').order('id');
  if (error) throw error;
  const allRows = data || [];
  const readyIds = ONLY_MISSING ? await getReadyContentIds('episode', provider.id) : new Set<string>();
  const candidates = allRows.filter((row: any) => !readyIds.has(String(row.id)));
  const rows = candidates.slice(OFFSET, OFFSET + LIMIT);
  let prepared = 0; let sources = 0;
  await mapLimit(rows, async (row) => { try { const result = await prepareEpisode(row, provider.id); if (result.count > 0) prepared++; sources += result.count; console.log(JSON.stringify({ ok: true, ...result })); } catch (error) { console.error(JSON.stringify({ ok: false, id: row.id, title: row.name_en || row.name_ar, error: error instanceof Error ? error.message : String(error) })); } });
  console.log(JSON.stringify({ mode: MODE, requested: rows.length, candidates: candidates.length, skipped: allRows.length - candidates.length, prepared, sources, offset: OFFSET, limit: LIMIT, onlyMissing: ONLY_MISSING }));
}

await main();
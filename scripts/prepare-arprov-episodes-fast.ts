import 'dotenv/config';

import { adminSupabase } from '../server/supabase';
import {
  discoverAkwamSeasonEpisodes,
  resolveAkwamEpisodePage,
} from '../server/providers/arprov-akwam';
import type { ProviderContext, NormalizedPlaybackSource } from '../server/providers/types';
import { validatePreparedMediaSource } from './validate-prepared-source';

const SHARD_INDEX = Math.max(0, Number.parseInt(process.env.EPISODE_SHARD_INDEX || '0', 10) || 0);
const SHARD_COUNT = Math.max(1, Number.parseInt(process.env.EPISODE_SHARD_COUNT || '4', 10) || 4);
const SEASON_CONCURRENCY = Math.max(1, Math.min(2, Number.parseInt(process.env.SEASON_CONCURRENCY || '1', 10) || 1));
const EPISODE_CONCURRENCY = Math.max(1, Math.min(16, Number.parseInt(process.env.EPISODE_CONCURRENCY || '12', 10) || 12));
const ONLY_MISSING = !/^(0|false|no)$/i.test(process.env.PREPARE_ONLY_MISSING || 'true');
const SEASON_LIMIT = Math.max(1, Number.parseInt(process.env.EPISODE_SEASON_LIMIT || '80', 10) || 80);
const PRIORITY_TMDB_IDS = new Set(
  (process.env.AKWAM_PRIORITY_TMDB_IDS || '')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0),
);

type EpisodeRow = {
  id: string;
  episode_number: number;
  name_ar?: string | null;
  name_en?: string | null;
  season_id: string;
};

type SeasonRow = {
  id: string;
  season_number: number;
  series_id: string;
  series: {
    id: string;
    tmdb_id: number | null;
    title_ar: string | null;
    title_en: string | null;
    original_title: string | null;
    alternative_titles: unknown;
    status: string | null;
    first_air_date: string | null;
  };
};

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
    new URL(url);
  } catch {
    return null;
  }
  if (!['mp4', 'hls', 'dash', 'webm', 'direct'].includes(type)) return null;
  if (!quality || quality === 'auto' || quality === 'source') return null;

  return {
    source_type: type,
    url,
    provider_reference: 'akwam',
    quality,
    language: source.language || 'und',
    label_ar: source.label || 'Akwam ' + quality,
    label_en: source.label || 'Akwam ' + quality,
    expires_at: source.expiresAt || null,
    is_working: true,
    last_checked_at: new Date().toISOString(),
    failure_count: 0,
  };
}

async function mapLimit<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchEpisodesBySeason(seasonIds: string[]) {
  const output = new Map<string, EpisodeRow[]>();
  const seasonChunkSize = 10;
  const pageSize = 1000;

  for (let i = 0; i < seasonIds.length; i += seasonChunkSize) {
    const chunk = seasonIds.slice(i, i + seasonChunkSize);

    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await adminSupabase
        .from('episodes')
        .select('id,episode_number,name_ar,name_en,season_id')
        .in('season_id', chunk)
        .order('season_id')
        .order('episode_number')
        .range(offset, offset + pageSize - 1);
      if (error) throw error;

      for (const row of data || []) {
        const current = output.get(String(row.season_id)) || [];
        current.push(row as EpisodeRow);
        output.set(String(row.season_id), current);
      }

      if (!data || data.length < pageSize) break;
    }
  }

  return output;
}

async function fetchSeasons() {
  const output: SeasonRow[] = [];
  const pageSize = 500;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await adminSupabase
      .from('seasons')
      .select('id,season_number,series_id,series:series_id!inner(id,tmdb_id,title_ar,title_en,original_title,alternative_titles,status,first_air_date)')
      .order('id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;

    for (const row of data || []) {
      const rawSeries = Array.isArray(row.series) ? row.series[0] : row.series;
      const series = rawSeries as SeasonRow['series'] | null | undefined;
      if (!series || String(series.status || 'published') !== 'published') continue;
      output.push({ ...row, series });
    }

    if (!data || data.length < pageSize) break;
  }

  return output;
}

async function readyEpisodeIds(episodeIds: string[]) {
  const ready = new Set<string>();
  const assigned = new Set(episodeIds);
  const pageSize = 1000;

  // Read prepared episode IDs by pagination instead of generating hundreds
  // of large IN(...) requests. This keeps shard startup fast and avoids
  // HTTP header overflow on Supabase/PostgREST.
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await adminSupabase
      .from('playback_sources')
      .select('content_id')
      .eq('content_type', 'episode')
      .eq('provider_reference', 'akwam')
      .eq('is_working', true)
      .not('url', 'is', null)
      .is('expires_at', null)
      .range(offset, offset + pageSize - 1);
    if (error) throw error;

    for (const row of data || []) {
      const id = String(row.content_id);
      if (assigned.has(id)) ready.add(id);
    }

    if (!data || data.length < pageSize) break;
  }

  return ready;
}

async function saveBatch(rows: Array<{ episodeId: string; sources: NormalizedPlaybackSource[] }>, providerId: string) {
  const successful = rows
    .map((item) => {
      const normalized = item.sources
        .map(normalizeSource)
        .filter((x): x is NonNullable<ReturnType<typeof normalizeSource>> => Boolean(x));
      return { episodeId: item.episodeId, normalized };
    })
    .filter((item) => item.normalized.length > 0);

  if (!successful.length) return 0;

  const validated = [];
  for (const item of successful) {
    const sources = [];
    for (const row of item.normalized) {
      const checked = await validatePreparedMediaSource({
        provider: 'Akwam',
        providerReference: 'akwam',
        type: row.source_type as NormalizedPlaybackSource['type'],
        url: row.url,
        quality: row.quality,
        language: row.language,
        label: row.label_ar,
        referer: 'https://akwam.ss/',
      });
      if (checked) sources.push({ ...row, url: checked.url });
    }
    const deduped = [...new Map(sources.map((x) => [x.quality + '|' + x.source_type + '|' + x.url, x])).values()];
    if (deduped.length) validated.push({ episodeId: item.episodeId, sources: deduped });
  }

  if (!validated.length) return 0;

  // Refresh only the qualities that were actually validated for each episode.
  // Never delete the episode's other prepared qualities.
  for (const item of validated) {
    const qualities = [...new Set(item.sources.map((source) => source.quality))];
    const { error } = await adminSupabase
      .from('playback_sources')
      .delete()
      .eq('provider_id', providerId)
      .eq('content_type', 'episode')
      .eq('provider_reference', 'akwam')
      .eq('content_id', item.episodeId)
      .in('quality', qualities);
    if (error) throw error;
  }

  const payload = validated.flatMap((item) =>
    item.sources.map((source) => ({
      provider_id: providerId,
      content_type: 'episode',
      content_id: item.episodeId,
      ...source,
    })),
  );

  for (let i = 0; i < payload.length; i += 200) {
    const chunk = payload.slice(i, i + 200);
    const { error } = await adminSupabase.from('playback_sources').insert(chunk);
    if (error) throw error;
  }

  return validated.length;
}

async function prepareSeason(
  season: SeasonRow,
  episodes: EpisodeRow[],
  providerId: string,
  readyIds: Set<string>,
) {
  const seasonEpisodes = episodes
    .filter((episode) => episode.season_id === season.id)
    .sort((a, b) => a.episode_number - b.episode_number);

  if (!seasonEpisodes.length) return { seasonId: season.id, episodes: 0, prepared: 0, fallback: 0 };

  const first = seasonEpisodes[0];
  const contextBase: ProviderContext = {
    tmdbId: Number(season.series.tmdb_id || 0) || undefined,
    title: season.series.title_ar || season.series.title_en || season.series.original_title || undefined,
    originalTitle: season.series.original_title || season.series.title_en || season.series.title_ar || undefined,
    alternateTitles: cleanTitles(season.series.alternative_titles),
    releaseYear: season.series.first_air_date ? Number(String(season.series.first_air_date).slice(0, 4)) : undefined,
    seasonNumber: season.season_number,
  };

  let index: Awaited<ReturnType<typeof discoverAkwamSeasonEpisodes>> = [];
  try {
    index = await discoverAkwamSeasonEpisodes({
      ...contextBase,
      episodeNumber: first.episode_number,
      episodeTitle: first.name_ar || first.name_en || undefined,
    }, {});
  } catch (error) {
    console.warn(JSON.stringify({
      ok: false,
      stage: 'season-discovery',
      seasonId: season.id,
      seasonNumber: season.season_number,
      series: season.series.title_en || season.series.title_ar,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  const byEpisode = new Map<number, { url: string; season?: number }>();
  for (const item of index) {
    const current = byEpisode.get(item.episode);
    const seasonMatches = item.season === undefined || item.season === season.season_number;
    if (!seasonMatches) continue;
    if (!current || item.season !== undefined) byEpisode.set(item.episode, item);
  }

  const targets = seasonEpisodes.filter((episode) => !ONLY_MISSING || !readyIds.has(episode.id));
  let fallback = 0;
  let failed = 0;

  let prepared = 0;
  const targetBatchSize = 50;

  // Resolve and persist in bounded batches so the database reflects progress
  // while a large season is still being processed.
  for (let offset = 0; offset < targets.length; offset += targetBatchSize) {
    const batchTargets = targets.slice(offset, offset + targetBatchSize);
    const results = await mapLimit(batchTargets, EPISODE_CONCURRENCY, async (episode) => {
      const mapped = byEpisode.get(episode.episode_number);
      const context: ProviderContext = {
        ...contextBase,
        episodeNumber: episode.episode_number,
        episodeTitle: episode.name_ar || episode.name_en || undefined,
      };

      if (mapped?.url) {
        try {
          const sources = await resolveAkwamEpisodePage(mapped.url, context, {});
          return { episodeId: episode.id, sources, fallback: false };
        } catch (error) {
          failed++;
          console.warn(JSON.stringify({
            ok: false,
            stage: 'episode-resolve',
            episodeId: episode.id,
            episodeNumber: episode.episode_number,
            seasonId: season.id,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }

      // If the season index did not yield a concrete episode URL, fall back to
      // the provider's episode-aware search/resolution path. This still runs
      // only in the background preparation job; playback never performs it.
      fallback++;
      try {
        const sources = await resolveAkwamPlayback(context, {});
        return { episodeId: episode.id, sources, fallback: true };
      } catch (error) {
        failed++;
        console.warn(JSON.stringify({
          ok: false,
          stage: 'episode-fallback-resolve',
          episodeId: episode.id,
          episodeNumber: episode.episode_number,
          seasonId: season.id,
          error: error instanceof Error ? error.message : String(error),
        }));
        return { episodeId: episode.id, sources: [], fallback: true };
      }
    });

    prepared += await saveBatch(
      results.map((item) => ({ episodeId: item.episodeId, sources: item.sources })),
      providerId,
    );
  }

  return {
    seasonId: season.id,
    series: season.series.title_en || season.series.title_ar,
    seasonNumber: season.season_number,
    episodes: targets.length,
    prepared,
    fallback,
    failed,
  };
}

async function main() {
  const { data: provider, error: providerError } = await adminSupabase
    .from('providers')
    .select('id')
    .eq('key', 'arprov')
    .maybeSingle();
  if (providerError) throw providerError;
  if (!provider?.id) throw new Error('ArProv provider row not found');

  const seasons = await fetchSeasons();
  const assigned = seasons.filter((_, index) => index % SHARD_COUNT === SHARD_INDEX);
  const episodesBySeason = await fetchEpisodesBySeason(assigned.map((season) => season.id));
  const assignedEpisodes = [...episodesBySeason.values()].flat();
  const readyIds = ONLY_MISSING
    ? await readyEpisodeIds(assignedEpisodes.map((episode) => episode.id))
    : new Set<string>();

  // Progressive robot behavior: select only seasons that still contain missing
  // episodes, then take a bounded batch. Once a season is complete it drops out
  // automatically and the next run advances to the next missing seasons.
  const pendingSeasons = assigned
    .filter((season) => {
      const episodes = episodesBySeason.get(season.id) || [];
      return !ONLY_MISSING || episodes.some((episode) => !readyIds.has(episode.id));
    })
    .sort((a, b) => {
      const aPriority = PRIORITY_TMDB_IDS.has(Number(a.series.tmdb_id || 0)) ? 0 : 1;
      const bPriority = PRIORITY_TMDB_IDS.has(Number(b.series.tmdb_id || 0)) ? 0 : 1;
      return aPriority - bPriority;
    })
    .slice(0, SEASON_LIMIT);

  let prepared = 0;
  let scanned = 0;

  await mapLimit(pendingSeasons, SEASON_CONCURRENCY, async (season) => {
    const result = await prepareSeason(
      season,
      episodesBySeason.get(season.id) || [],
      provider.id,
      readyIds,
    );
    scanned += result.episodes;
    prepared += result.prepared;
    console.log(JSON.stringify({ ok: true, shard: SHARD_INDEX, ...result }));
  });

  console.log(JSON.stringify({
    mode: 'episodes-fast',
    shard: SHARD_INDEX,
    shards: SHARD_COUNT,
    seasons: pendingSeasons.length,
    pendingSeasons: pendingSeasons.length,
    scanned,
    prepared,
    totalEpisodesLoaded: assignedEpisodes.length,
    onlyMissing: ONLY_MISSING,
    seasonLimit: SEASON_LIMIT,
  }));
}

await main();

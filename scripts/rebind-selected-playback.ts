import 'dotenv/config';

import { adminSupabase } from '../server/supabase';
import { resolvePlaybackSources } from '../server/providers/resolver';
import { resolveRe3ArabiPlayback } from '../server/providers/re3arabi';

const ALLOWED_PROVIDER_KEYS = new Set(['aflaam', 'cimaclub', 'anime3rb', 'anime4up']);
const ALLOWED_TYPES = new Set(['hls', 'mp4', 'dash', 'webm', 'direct', 'embed']);

const MODE = (process.env.REBIND_MODE || 'movies') as 'movies' | 'episodes';
const LIMIT = Math.min(Math.max(Number(process.env.REBIND_LIMIT || 200), 1), 10_000);
const OFFSET = Math.max(Number(process.env.REBIND_OFFSET || 0), 0);
const CONCURRENCY = Math.min(Math.max(Number(process.env.REBIND_CONCURRENCY || 6), 1), 16);
const EXPLICIT_CURSOR = process.env.REBIND_CURSOR?.trim() || '';

function assertEnvironment() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase environment is incomplete');
  }
}

async function mapWithConcurrency<T>(items: T[], worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

function validateSources(sources: any[]) {
  const groups = new Map<string, any[]>();

  for (const source of sources) {
    const providerKey = String(source?.providerKey || source?.providerReference || '').toLowerCase();
    const url = String(source?.url || '');
    const type = String(source?.type || '').toLowerCase();

    if (!ALLOWED_PROVIDER_KEYS.has(providerKey)) {
      throw new Error(`unexpected providerKey=${providerKey || 'missing'}`);
    }
    if (!ALLOWED_TYPES.has(type)) {
      throw new Error(`unexpected playback type=${type}`);
    }
    if (!/^https:\/\//i.test(url) || /movyz-api\.sameranede\.workers\.dev/i.test(url)) {
      throw new Error('resolver returned a non-external playback URL');
    }

    const list = groups.get(providerKey) || [];
    list.push(source);
    groups.set(providerKey, list);
  }

  return groups;
}

async function ensureSyncJob(details: Record<string, unknown>) {
  await adminSupabase.from('sync_jobs').insert({
    provider: 'selected-sites',
    job_type: MODE === 'movies' ? 'playback-rebind-movies' : 'playback-rebind-episodes',
    status: 'succeeded',
    stage: 'playback-rebind',
    pages: 1,
    details,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    movies_synced: MODE === 'movies' ? Number(details.processed || 0) : 0,
    series_synced: 0,
    seasons_synced: 0,
    episodes_synced: MODE === 'episodes' ? Number(details.processed || 0) : 0,
  });
}

async function rebindMovies() {
  const { data, error } = await adminSupabase
    .from('movies')
    .select('id,tmdb_id,title_en')
    .eq('status', 'published')
    .not('tmdb_id', 'is', null)
    .order('tmdb_id', { ascending: true })
    .range(OFFSET, OFFSET + LIMIT - 1);

  if (error) throw new Error('Unable to load published movies: ' + error.message);

  const summary = { processed: 0, playable: 0, failed: 0, providerGroups: {} as Record<string, number>, lastTmdbId: 0 };

  await mapWithConcurrency(data || [], async (movie: any) => {
    try {
      const sources = await resolvePlaybackSources('movie', movie.id);
      const groups = validateSources(sources);

      summary.processed++;
      summary.playable += groups.size > 0 ? 1 : 0;
      summary.lastTmdbId = Math.max(summary.lastTmdbId, Number(movie.tmdb_id || 0));

      for (const [providerKey, providerSources] of groups) {
        summary.providerGroups[providerKey] = (summary.providerGroups[providerKey] || 0) + providerSources.length;
      }

      console.log('REBIND_MOVIE', JSON.stringify({
        tmdbId: movie.tmdb_id,
        title: movie.title_en,
        providers: [...groups.keys()],
        sources: sources.length,
      }));
    } catch (error) {
      summary.processed++;
      summary.failed++;
      console.warn('REBIND_MOVIE_FAIL', JSON.stringify({
        tmdbId: movie.tmdb_id,
        title: movie.title_en,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  });

  await ensureSyncJob(summary);
  console.log('REBIND_MOVIES_SUMMARY', JSON.stringify(summary));
}

async function persistExactEpisodeSources(
  episodeId: string,
  sources: any[],
) {
  if (!sources.length) return 0;

  const { data: provider } = await adminSupabase
    .from('providers')
    .select('id')
    .eq('key', 're3arabi')
    .maybeSingle();

  if (!provider?.id) return 0;

  const allowed = sources.filter((source: any) =>
    ALLOWED_PROVIDER_KEYS.has(String(source?.providerKey || source?.providerReference || '').toLowerCase()) &&
    ALLOWED_TYPES.has(String(source?.type || '').toLowerCase()) &&
    ['mp4', 'hls', 'dash', 'webm', 'direct'].includes(String(source?.type || '').toLowerCase()) &&
    /^https:\/\//i.test(String(source?.url || '')) &&
    !/movyz-api\.sameranede\.workers\.dev/i.test(String(source?.url || '')) &&
    !['auto', 'source'].includes(String(source?.quality || '').trim().toLowerCase())
  );

  await adminSupabase
    .from('playback_sources')
    .delete()
    .eq('provider_id', provider.id)
    .eq('content_type', 'episode')
    .eq('content_id', episodeId);

  if (!allowed.length) return 0;

  const rows = allowed
    .filter((source: any, index: number, all: any[]) =>
      index === all.findIndex((candidate) => candidate.url === source.url),
    )
    .slice(0, 12)
    .map((source: any) => ({
      provider_id: provider.id,
      content_type: 'episode',
      content_id: episodeId,
      source_type: String(source.type).toLowerCase(),
      url: String(source.url),
      provider_reference: String(source.providerKey || source.providerReference || '').toLowerCase(),
      quality: String(source.quality || ''),
      language: String(source.language || 'ar'),
      label_ar: String(source.label || source.provider || 'Selected Playback Site'),
      label_en: String(source.labelEn || source.label || source.provider || 'Selected Playback Site'),
      expires_at: source.expiresAt || null,
      is_working: true,
      last_checked_at: new Date().toISOString(),
      failure_count: 0,
    }));

  if (!rows.length) return 0;

  const { error } = await adminSupabase
    .from('playback_sources')
    .upsert(rows, { onConflict: 'provider_id,content_type,content_id,url' });

  if (error) throw new Error('Unable to persist episode playback sources: ' + error.message);
  return rows.length;
}

async function rebindEpisodes() {
  const { data: seriesRows, error: seriesError } = await adminSupabase
    .from('series')
    .select('id,tmdb_id,title_en')
    .eq('status', 'published');

  if (seriesError) throw new Error('Unable to load published series: ' + seriesError.message);

  const seriesById = new Map((seriesRows || []).map((row: any) => [String(row.id), row]));

  const { data: seasonRows, error: seasonError } = await adminSupabase
    .from('seasons')
    .select('id,series_id,season_number');

  if (seasonError) throw new Error('Unable to load seasons: ' + seasonError.message);

  const seasonById = new Map(
    (seasonRows || [])
      .filter((row: any) => seriesById.has(String(row.series_id)))
      .map((row: any) => [String(row.id), row]),
  );

  let cursor = EXPLICIT_CURSOR;
  let previousFailedIds: string[] = [];

  if (!cursor) {
    const { data: previous } = await adminSupabase
      .from('sync_jobs')
      .select('details')
      .eq('provider', 'selected-sites')
      .eq('job_type', 'playback-rebind-episodes')
      .eq('status', 'succeeded')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const details = previous?.details && typeof previous.details === 'object'
      ? previous.details as Record<string, unknown>
      : {};

    cursor = String(details.cursor || '');
    previousFailedIds = Array.isArray(details.failedEpisodeIds)
      ? details.failedEpisodeIds.filter((id): id is string => typeof id === 'string').slice(0, 5000)
      : [];
  }

  // A full catalog rebuild recreates every episode UUID. If the saved cursor
  // no longer exists in the new catalog, discard the old retry/cursor state
  // and start a fresh sweep instead of sending thousands of stale UUIDs to
  // PostgREST (which can exceed its URL limits and return HTTP 400).
  if (cursor) {
    const { data: cursorRow, error: cursorError } = await adminSupabase
      .from('episodes')
      .select('id')
      .eq('id', cursor)
      .maybeSingle();

    if (cursorError) throw new Error('Unable to validate episode rebind cursor: ' + cursorError.message);

    if (!cursorRow) {
      console.log('REBIND_EPISODES_RESET_STALE_CURSOR', JSON.stringify({
        staleCursor: cursor,
        droppedFailedEpisodeIds: previousFailedIds.length,
      }));
      cursor = '';
      previousFailedIds = [];
    }
  }

  // Retry failed IDs first so transient provider failures never disappear
  // permanently just because the sweep cursor moved forward.
  let retryRows: any[] = [];
  if (previousFailedIds.length) {
    const { data, error } = await adminSupabase
      .from('episodes')
      .select('id,season_id,episode_number,name_en,tmdb_id')
      .in('id', previousFailedIds);

    if (error) throw new Error('Unable to load failed episode retries: ' + error.message);
    retryRows = data || [];
  }

  const remaining = Math.max(0, LIMIT - retryRows.length);
  let sweepRows: any[] = [];

  if (remaining > 0) {
    let query = adminSupabase
      .from('episodes')
      .select('id,season_id,episode_number,name_en,tmdb_id')
      .order('id', { ascending: true })
      .limit(remaining);

    if (cursor) query = query.gt('id', cursor);
    if (!cursor && OFFSET > 0) query = query.range(OFFSET, OFFSET + remaining - 1);

    const { data, error } = await query;
    if (error) throw new Error('Unable to load episode batch: ' + error.message);
    sweepRows = data || [];
  }

  const rowsById = new Map<string, any>();
  for (const row of [...retryRows, ...sweepRows]) rowsById.set(String(row.id), row);
  const eligible = [...rowsById.values()].filter((episode: any) => seasonById.has(String(episode.season_id)));

  const summary = {
    requested: LIMIT,
    processed: 0,
    playable: 0,
    failed: 0,
    retried: retryRows.length,
    providerGroups: {} as Record<string, number>,
    cursor: cursor || null,
    nextCursor: cursor || null,
    failedEpisodeIds: [] as string[],
  };

  const failed = new Set(previousFailedIds);

  await mapWithConcurrency(eligible, async (episode: any) => {
    const season = seasonById.get(String(episode.season_id));
    const series = season ? seriesById.get(String(season.series_id)) : null;
    if (!season || !series) return;

    try {
      const sources = await resolveRe3ArabiPlayback({
        type: 'series',
        tmdbId: Number(series.tmdb_id),
        season: Number(season.season_number),
        episode: Number(episode.episode_number),
      });
      const persistedCount = await persistExactEpisodeSources(String(episode.id), sources);
      const groups = validateSources(sources);

      summary.processed++;
      summary.playable += groups.size > 0 ? 1 : 0;
      failed.delete(String(episode.id));

      for (const [providerKey, providerSources] of groups) {
        summary.providerGroups[providerKey] = (summary.providerGroups[providerKey] || 0) + providerSources.length;
      }

      console.log('REBIND_EPISODE', JSON.stringify({
        tmdbId: series.tmdb_id,
        season: season.season_number,
        episode: episode.episode_number,
        episodeId: episode.id,
        providers: [...groups.keys()],
        sources: sources.length,
        persisted: persistedCount,
      }));
    } catch (error) {
      summary.processed++;
      summary.failed++;
      failed.add(String(episode.id));
      console.warn('REBIND_EPISODE_FAIL', JSON.stringify({
        tmdbId: series.tmdb_id,
        season: season.season_number,
        episode: episode.episode_number,
        episodeId: episode.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  });

  // Advance only across the fresh sweep rows, not retries. Any failed row is
  // retained in failedEpisodeIds for the next run.
  if (sweepRows.length) {
    summary.nextCursor = String(sweepRows[sweepRows.length - 1].id);
  }

  summary.failedEpisodeIds = [...failed].slice(0, 5000);

  await ensureSyncJob(summary);
  console.log('REBIND_EPISODES_SUMMARY', JSON.stringify(summary));
}


assertEnvironment();

if (MODE === 'movies') {
  await rebindMovies();
} else {
  await rebindEpisodes();
}

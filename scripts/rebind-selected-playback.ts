import 'dotenv/config';

import { adminSupabase } from '../server/supabase';
import { resolvePlaybackSources } from '../server/providers/resolver';

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

    const previousCursor = previous?.details && typeof previous.details === 'object'
      ? String((previous.details as Record<string, unknown>).cursor || '')
      : '';
    cursor = previousCursor;
  }

  let query = adminSupabase
    .from('episodes')
    .select('id,season_id,episode_number,name_en,tmdb_id')
    .order('id', { ascending: true })
    .limit(LIMIT);

  if (cursor) query = query.gt('id', cursor);

  if (OFFSET > 0) query = query.range(OFFSET, OFFSET + LIMIT - 1);

  const { data: episodeRows, error: episodeError } = await query;
  if (episodeError) throw new Error('Unable to load episode batch: ' + episodeError.message);

  const eligible = (episodeRows || []).filter((episode: any) => seasonById.has(String(episode.season_id)));

  const summary = {
    requested: LIMIT,
    processed: 0,
    playable: 0,
    failed: 0,
    providerGroups: {} as Record<string, number>,
    cursor: cursor || null,
    nextCursor: cursor || null,
  };

  await mapWithConcurrency(eligible, async (episode: any) => {
    const season = seasonById.get(String(episode.season_id));
    const series = season ? seriesById.get(String(season.series_id)) : null;
    if (!season || !series) return;

    try {
      const sources = await resolvePlaybackSources('episode', episode.id);
      const groups = validateSources(sources);

      summary.processed++;
      summary.playable += groups.size > 0 ? 1 : 0;
      summary.nextCursor = episode.id;

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
      }));
    } catch (error) {
      summary.processed++;
      summary.failed++;
      summary.nextCursor = episode.id;
      console.warn('REBIND_EPISODE_FAIL', JSON.stringify({
        tmdbId: series.tmdb_id,
        season: season.season_number,
        episode: episode.episode_number,
        episodeId: episode.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  });

  await ensureSyncJob(summary);
  console.log('REBIND_EPISODES_SUMMARY', JSON.stringify(summary));
}

assertEnvironment();

if (MODE === 'movies') {
  await rebindMovies();
} else {
  await rebindEpisodes();
}

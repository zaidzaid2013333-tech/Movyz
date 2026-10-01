import 'dotenv/config';

import { adminSupabase } from '../server/supabase';
import { resolveRemotePlayback } from '../server/providers/remote-resolver';

type MovieCandidate = {
  contentType: 'movie';
  contentId: string;
  tmdbId: number;
};

type EpisodeCandidate = {
  contentType: 'episode';
  contentId: string;
  seriesId: string;
  tmdbId: number;
  season: number;
  episode: number;
};

type Candidate = MovieCandidate | EpisodeCandidate;

const MOVIE_LIMIT = Math.min(Math.max(Number(process.env.MOVIE_LIMIT || 48), 1), 240);
const EPISODE_LIMIT = Math.min(Math.max(Number(process.env.EPISODE_LIMIT ?? 72), 0), 5000);
const CONCURRENCY = Math.min(Math.max(Number(process.env.CACHE_CONCURRENCY || 1), 1), 2);
const CURATED_SERIES_IDS = [1396, 60059, 70523, 2316, 5920];
const CURATED_MOVIE_IDS = [27205, 157336, 278, 550, 155];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readAll<T>(table: string, columns: string, pageSize = 1000) {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await adminSupabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(table + ': ' + error.message);
    rows.push(...((data || []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function inferExpiry(url: string) {
  const match = url.match(/\/download\/(\d{10}|\d{13})\//i);
  if (!match) {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }

  const raw = Number(match[1]);
  const milliseconds = raw > 10_000_000_000 ? raw : raw * 1000;
  const timestamp = new Date(milliseconds).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    return new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  }
  return new Date(timestamp).toISOString();
}

function isFresh(expiresAt: string | null | undefined) {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp > Date.now() + 5 * 60 * 1000;
}

async function ensureProvider() {
  const { data, error } = await adminSupabase
    .from('providers')
    .upsert({
      key: 'omegatech-akwam',
      name: 'OmegaTech Akwam',
      adapter_name: 'omegatech-akwam',
      enabled: true,
      status: 'healthy',
    }, { onConflict: 'key' })
    .select('id')
    .single();

  if (error || !data) throw new Error('Unable to ensure OmegaTech provider: ' + (error?.message || 'unknown'));
  return data.id as string;
}

async function loadCandidates(): Promise<{ movies: MovieCandidate[]; episodes: EpisodeCandidate[] }> {
  const [moviesRaw, seriesRaw, seasonsRaw, episodesRaw] = await Promise.all([
    adminSupabase
      .from('movies')
      .select('id,tmdb_id,vote_count,rating,created_at')
      .eq('status', 'published')
      .not('tmdb_id', 'is', null)
      .order('created_at', { ascending: false }),
    adminSupabase
      .from('series')
      .select('id,tmdb_id,vote_count,rating')
      .eq('status', 'published')
      .not('tmdb_id', 'is', null)
      .order('vote_count', { ascending: false })
      .order('rating', { ascending: false }),
    readAll<{ id: string; series_id: string; season_number: number }>('seasons', 'id,series_id,season_number'),
    readAll<{ id: string; season_id: string; episode_number: number }>('episodes', 'id,season_id,episode_number'),
  ]);

  if (moviesRaw.error) throw new Error('movies: ' + moviesRaw.error.message);
  if (seriesRaw.error) throw new Error('series: ' + seriesRaw.error.message);

  const seriesById = new Map<string, { tmdbId: number; votes: number; rating: number }>();
  for (const row of seriesRaw.data || []) {
    const tmdbId = Number((row as any).tmdb_id);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) continue;
    seriesById.set((row as any).id, {
      tmdbId,
      votes: Number((row as any).vote_count || 0),
      rating: Number((row as any).rating || 0),
    });
  }

  const seasonById = new Map(seasonsRaw.map((row) => [row.id, row]));

  const movies: MovieCandidate[] = (moviesRaw.data || [])
    .map((row: any): MovieCandidate => ({
      contentType: 'movie',
      contentId: row.id,
      tmdbId: Number(row.tmdb_id),
    }))
    .filter((row) => Number.isInteger(row.tmdbId) && row.tmdbId > 0);

  const episodes: EpisodeCandidate[] = [];
  for (const row of episodesRaw) {
    const season = seasonById.get(row.season_id);
    const series = season ? seriesById.get(season.series_id) : undefined;

    if (!season || !series || !Number.isInteger(row.episode_number) || row.episode_number < 1) continue;
    if (!Number.isInteger(season.season_number) || season.season_number < 1) continue;

    episodes.push({
      contentType: 'episode',
      contentId: row.id,
      seriesId: season.series_id,
      tmdbId: series.tmdbId,
      season: Number(season.season_number),
      episode: Number(row.episode_number),
    });
  }

  episodes.sort((a, b) => {
    const aRank = seriesById.get(a.seriesId);
    const bRank = seriesById.get(b.seriesId);
    return Number(bRank?.votes || 0) - Number(aRank?.votes || 0)
      || Number(bRank?.rating || 0) - Number(aRank?.rating || 0)
      || a.tmdbId - b.tmdbId
      || a.season - b.season
      || a.episode - b.episode;
  });

  return { movies, episodes };
}

async function loadFreshSourceIds() {
  const rows = await readAll<{
    content_type: 'movie' | 'episode';
    content_id: string;
    expires_at: string | null;
    is_working: boolean;
  }>('playback_sources', 'content_type,content_id,expires_at,is_working');

  const fresh = new Set<string>();
  for (const row of rows) {
    if (row.is_working && isFresh(row.expires_at)) {
      fresh.add(row.content_type + ':' + row.content_id);
    }
  }
  return fresh;
}

async function persistSources(providerId: string, candidate: Candidate, sources: any[]) {
  const rows = sources
    .filter((source) => typeof source?.url === 'string' && /^https:\/\//i.test(source.url))
    .slice(0, 6)
    .map((source) => ({
      provider_id: providerId,
      content_type: candidate.contentType,
      content_id: candidate.contentId,
      source_type: source.type === 'hls' || source.type === 'dash' ? source.type : 'mp4',
      url: source.url,
      provider_reference: source.providerReference || null,
      quality: source.quality || 'auto',
      language: source.language || 'ar',
      label_ar: source.label || 'OmegaTech Akwam',
      label_en: source.labelEn || source.label || 'OmegaTech Akwam',
      expires_at: inferExpiry(source.url),
      is_working: true,
      last_checked_at: new Date().toISOString(),
      failure_count: 0,
    }));

  if (!rows.length) throw new Error('OmegaTech returned no HTTPS playback URLs');

  const { error } = await adminSupabase
    .from('playback_sources')
    .upsert(rows, { onConflict: 'provider_id,content_type,content_id,url' });

  if (error) throw new Error('cache upsert failed: ' + error.message);
  return rows.length;
}

async function resolveCandidate(providerId: string, candidate: Candidate) {
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const sources = candidate.contentType === 'movie'
        ? await resolveRemotePlayback({ type: 'movie', tmdbId: candidate.tmdbId })
        : await resolveRemotePlayback({
            type: 'series',
            tmdbId: candidate.tmdbId,
            season: candidate.season,
            episode: candidate.episode,
          });

      return await persistSources(providerId, candidate, sources);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await sleep(2500);
    }
  }
  throw new Error(lastError);
}

async function mapWithConcurrency<T>(items: T[], worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]);
      await sleep(750);
    }
  });
  await Promise.all(workers);
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.TMDB_API_READ_ACCESS_TOKEN) {
    throw new Error('Supabase/TMDB environment is incomplete');
  }

  const providerId = await ensureProvider();
  const fresh = await loadFreshSourceIds();
  const { movies, episodes } = await loadCandidates();

  const curatedMovies = movies.filter((item) => CURATED_MOVIE_IDS.includes(item.tmdbId));
  const remainingMovies = movies.filter((item) => !CURATED_MOVIE_IDS.includes(item.tmdbId));
  const orderedMovies = [
    ...curatedMovies,
    ...remainingMovies,
  ]
    .filter((item) => !fresh.has('movie:' + item.contentId))
    .slice(0, MOVIE_LIMIT);

  const curatedEpisodes = episodes.filter((item) => CURATED_SERIES_IDS.includes(item.tmdbId));
  const remainingEpisodes = episodes.filter((item) => !CURATED_SERIES_IDS.includes(item.tmdbId));
  const orderedEpisodes = [
    ...curatedEpisodes,
    ...remainingEpisodes,
  ].filter((item) => !fresh.has('episode:' + item.contentId));

  const candidates: Candidate[] = [
    ...orderedMovies,
    ...orderedEpisodes.slice(0, EPISODE_LIMIT),
  ];

  const summary = { candidates: candidates.length, playable: 0, sources: 0, failed: 0 };

  await mapWithConcurrency(candidates, async (candidate) => {
    try {
      const count = await resolveCandidate(providerId, candidate);
      summary.playable++;
      summary.sources += count;
      console.log('CACHED_PLAYBACK', JSON.stringify({ ...candidate, sources: count }));
    } catch (error) {
      summary.failed++;
      console.warn('CACHE_FAIL', JSON.stringify({
        ...candidate,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  });

  console.log('OMEGATECH_CACHE_SUMMARY ' + JSON.stringify(summary));
  if (summary.failed && summary.playable === 0) {
    throw new Error('OmegaTech cache refresh failed without any successful source');
  }
}

await main();

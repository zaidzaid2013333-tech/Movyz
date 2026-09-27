import 'dotenv/config';

import { adminSupabase } from '../server/supabase';
import { syncMovieCandidate } from '../server/tmdb';
import { resolvePlaybackSources } from '../server/providers/resolver';

type MovieListItem = {
  id: number;
  title?: string;
  original_title?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  overview?: string;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  genre_ids?: number[];
};

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p/w500';
const REQUEST_TIMEOUT_MS = Number(process.env.TMDB_REQUEST_TIMEOUT_MS || 15_000);
const PROVIDER_TIMEOUT_MS = Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 6_000);
const PAGES = Math.min(Math.max(Number(process.env.COVERAGE_PAGES || 3), 1), 5);
const LIMIT = Math.min(Math.max(Number(process.env.COVERAGE_LIMIT || 120), 1), 240);
const CONCURRENCY = Math.min(Math.max(Number(process.env.COVERAGE_CONCURRENCY || 5), 1), 8);

const ANCHOR_IDS = [
  550,      // Fight Club — playback anchor.
  157336,   // Interstellar
  27205,    // Inception
  680,      // Pulp Fiction
  155,      // The Dark Knight
  19995,    // Avatar
  603,      // The Matrix
  299534,   // Avengers: Endgame
  634649,   // Spider-Man: No Way Home
  693134,   // Dune: Part Two
  438631,   // Dune
  335984,   // Blade Runner 2049
];

function token() {
  const value = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  if (!value) throw new Error('TMDB_API_READ_ACCESS_TOKEN is not configured');
  return value;
}

async function tmdbGet<T>(path: string, params: Record<string, string | number | boolean> = {}) {
  const url = new URL(TMDB_BASE + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token(), accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

function toDetailListItem(detail: any): MovieListItem {
  return {
    id: detail.id,
    title: detail.title || detail.original_title || '',
    original_title: detail.original_title || detail.title || '',
    poster_path: detail.poster_path,
    backdrop_path: detail.backdrop_path,
    release_date: detail.release_date || '',
    overview: detail.overview || '',
    vote_average: detail.vote_average,
    vote_count: detail.vote_count,
    popularity: detail.popularity,
    genre_ids: Array.isArray(detail.genres) ? detail.genres.map((g: any) => Number(g.id)).filter(Number.isInteger) : [],
  };
}

async function fetchMoviePair(id: number): Promise<{ ar: MovieListItem; en: MovieListItem }> {
  const [ar, en] = await Promise.all([
    tmdbGet<any>(`/movie/${id}`, { language: 'ar-SA' }),
    tmdbGet<any>(`/movie/${id}`, { language: 'en-US' }),
  ]);
  return { ar: toDetailListItem(ar), en: toDetailListItem(en) };
}

async function fetchLists() {
  const pairs = await Promise.all([
    ...['popular', 'top_rated', 'now_playing'].flatMap(endpoint =>
      Array.from({ length: PAGES }, (_, index) => index + 1).map(async page => {
        const [ar, en] = await Promise.all([
          tmdbGet<any>(`/movie/${endpoint}`, { language: 'ar-SA', page, include_adult: false, include_video: false }),
          tmdbGet<any>(`/movie/${endpoint}`, { language: 'en-US', page, include_adult: false, include_video: false }),
        ]);
        return { ar: Array.isArray(ar.results) ? ar.results as MovieListItem[] : [], en: Array.isArray(en.results) ? en.results as MovieListItem[] : [] };
      }),
    ),
  ]);

  const byId = new Map<number, { ar: MovieListItem; en: MovieListItem }>();
  for (const pair of pairs) {
    const enById = new Map(pair.en.map(item => [item.id, item]));
    for (const arMovie of pair.ar) {
      const enMovie = enById.get(arMovie.id) || arMovie;
      byId.set(arMovie.id, { ar: arMovie, en: enMovie });
    }
  }

  const priorityIds: number[] = [];

  for (const anchor of ANCHOR_IDS) {
    priorityIds.push(anchor);
    if (!byId.has(anchor)) {
      try {
        byId.set(anchor, await fetchMoviePair(anchor));
      } catch (error) {
        console.warn('Anchor ' + anchor + ' metadata lookup failed: ' + (error instanceof Error ? error.message : String(error)));
      }
    }
  }

  const { data: currentMovies, error } = await adminSupabase
    .from('movies')
    .select('tmdb_id')
    .eq('status', 'published')
    .not('tmdb_id', 'is', null)
    .limit(240);

  if (error) throw new Error('Unable to load current movie ids: ' + error.message);

  for (const row of currentMovies || []) {
    const id = Number(row.tmdb_id);
    if (!Number.isInteger(id)) continue;
    priorityIds.push(id);
    if (byId.has(id)) continue;
    try {
      byId.set(id, await fetchMoviePair(id));
    } catch (lookupError) {
      console.warn('Current movie ' + id + ' metadata lookup failed: ' + (lookupError instanceof Error ? lookupError.message : String(lookupError)));
    }
  }

  const prioritized = Array.from(new Set(priorityIds))
    .map((id) => byId.get(id))
    .filter((value): value is { ar: MovieListItem; en: MovieListItem } => Boolean(value));

  const remainder = [...byId.entries()]
    .filter(([id]) => !priorityIds.includes(id))
    .map(([, value]) => value);

  return [...prioritized, ...remainder].slice(0, LIMIT);
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

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase environment is incomplete');
  }

  process.env.MOVYZA_PROVIDER_TIMEOUT_MS = String(PROVIDER_TIMEOUT_MS);
  const providerRows = await adminSupabase
    .from('providers')
    .select('key,enabled')
    .in('key', ['vidzee', 'ezvidapi']);

  if (providerRows.error) throw new Error('Unable to load playback providers');
  const enabledKeys = new Set((providerRows.data || []).filter((row: any) => row.enabled).map((row: any) => row.key));
  if (!enabledKeys.has('vidzee') && !enabledKeys.has('ezvidapi')) {
    throw new Error('No configured playback provider is enabled in Supabase');
  }

  const candidates = await fetchLists();

  const summary = { candidates: candidates.length, playable: 0, synced: 0, sources: 0, failed: 0, skipped: 0 };

  await mapWithConcurrency(candidates, async (candidate) => {
    const tmdbId = candidate.en.id;
    try {
      const existing = await adminSupabase
        .from('movies')
        .select('id')
        .eq('tmdb_id', tmdbId)
        .eq('status', 'published')
        .maybeSingle();
      if (existing.error) throw new Error(existing.error.message);

      const movieId = existing.data?.id || await syncMovieCandidate(candidate.ar, candidate.en);
      const started = Date.now();
      const sources = await resolvePlaybackSources('movie', movieId);

      if (!sources.length) {
        summary.skipped++;
        return;
      }

      summary.playable++;
      summary.synced++;
      summary.sources += sources.length;
      console.log('PLAYABLE tmdb=' + tmdbId + ' title=' + (candidate.en.title || candidate.en.original_title || '') + ' providers=' + sources.map((s: any) => s.provider).join(',') + ' sources=' + sources.length + ' latencyMs=' + (Date.now() - started));
    } catch (error) {
      summary.failed++;
      console.warn('COVERAGE_FAIL tmdb=' + tmdbId + ' title=' + (candidate.en.title || candidate.en.original_title || '') + ' error=' + (error instanceof Error ? error.message : String(error)));
    }
  });
  console.log('COVERAGE_SUMMARY ' + JSON.stringify(summary));
}

await main();

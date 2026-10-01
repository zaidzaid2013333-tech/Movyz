import 'dotenv/config';
import { adminSupabase } from '../server/supabase';
import { syncMovieCandidate, syncSeriesCandidate } from '../server/tmdb';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const PLAYBACK_BASE = (process.env.PLAYBACK_BASE_URL || 'https://movyz-api.sameranede.workers.dev').replace(/\/$/, '');

const MOVIE_IDS = [27205, 157336, 278, 550, 155];
const SERIES_IDS = [1396, 60059, 70523, 2316, 5920];

type ExpectedSeason = {
  seasonNumber: number;
  episodeNumbers: number[];
};

type SeriesPlan = {
  tmdbId: number;
  title: string;
  seasons: ExpectedSeason[];
};

function token() {
  const value = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  if (!value) throw new Error('TMDB_API_READ_ACCESS_TOKEN is missing');
  return value;
}

async function tmdbGet(path: string, params: Record<string, string | number> = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set('include_adult', 'false');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token(), accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`TMDB ${path}: HTTP ${response.status}`);
  return response.json() as Promise<any>;
}

async function loadMoviePair(tmdbId: number) {
  const [ar, en] = await Promise.all([
    tmdbGet(`/movie/${tmdbId}`, { language: 'ar-SA' }),
    tmdbGet(`/movie/${tmdbId}`, { language: 'en-US' }),
  ]);
  return { ar, en };
}

async function loadSeriesPlan(tmdbId: number): Promise<{ ar: any; en: any; plan: SeriesPlan }> {
  const [ar, en] = await Promise.all([
    tmdbGet(`/tv/${tmdbId}`, { language: 'ar-SA' }),
    tmdbGet(`/tv/${tmdbId}`, { language: 'en-US' }),
  ]);

  const rawSeasons = (Array.isArray(en.seasons) ? en.seasons : [])
    .filter((season: any) => Number.isInteger(season?.season_number) && season.season_number > 0);

  const seasons: ExpectedSeason[] = [];
  for (const season of rawSeasons) {
    const detail = await tmdbGet(`/tv/${tmdbId}/season/${season.season_number}`, { language: 'en-US' });
    const episodeNumbers = (Array.isArray(detail.episodes) ? detail.episodes : [])
      .filter((episode: any) => Number.isInteger(episode?.episode_number) && Number.isInteger(episode?.id))
      .map((episode: any) => Number(episode.episode_number))
      .sort((a: number, b: number) => a - b);

    if (episodeNumbers.length === 0) {
      throw new Error(`TMDB ${tmdbId} season ${season.season_number} returned no numbered episodes`);
    }

    seasons.push({ seasonNumber: season.season_number, episodeNumbers });
  }

  if (seasons.length === 0) throw new Error(`TMDB ${tmdbId} returned no numbered seasons`);

  return {
    ar,
    en,
    plan: { tmdbId, title: en.name || ar.name || String(tmdbId), seasons },
  };
}

async function verifyDbSeries(plan: SeriesPlan) {
  const { data: series, error: seriesError } = await adminSupabase
    .from('series')
    .select('id,tmdb_id,title_en,status')
    .eq('tmdb_id', plan.tmdbId)
    .maybeSingle();

  if (seriesError) throw new Error(`DB series ${plan.tmdbId}: ${seriesError.message}`);
  if (!series) throw new Error(`DB series ${plan.tmdbId}: row missing`);
  if (series.status !== 'published') throw new Error(`DB series ${plan.tmdbId}: not published`);

  const { data: dbSeasons, error: seasonError } = await adminSupabase
    .from('seasons')
    .select('id,season_number,tmdb_id')
    .eq('series_id', series.id)
    .order('season_number');

  if (seasonError) throw new Error(`DB seasons ${plan.tmdbId}: ${seasonError.message}`);

  const expectedSeasonNumbers = plan.seasons.map((season) => season.seasonNumber);
  const actualSeasonNumbers = (dbSeasons || []).map((season) => season.season_number);
  if (
    actualSeasonNumbers.length !== expectedSeasonNumbers.length ||
    actualSeasonNumbers.some((value, index) => value !== expectedSeasonNumbers[index])
  ) {
    throw new Error(`Season mismatch for ${plan.title}: expected [${expectedSeasonNumbers.join(',')}], got [${actualSeasonNumbers.join(',')}]`);
  }

  const seasonByNumber = new Map((dbSeasons || []).map((season) => [season.season_number, season]));
  const allSeasonIds = (dbSeasons || []).map((season) => season.id);

  const { data: dbEpisodes, error: episodeError } = await adminSupabase
    .from('episodes')
    .select('season_id,episode_number,tmdb_id')
    .in('season_id', allSeasonIds)
    .order('season_id')
    .order('episode_number');

  if (episodeError) throw new Error(`DB episodes ${plan.tmdbId}: ${episodeError.message}`);

  const bySeason = new Map<string, number[]>();
  for (const episode of dbEpisodes || []) {
    const list = bySeason.get(episode.season_id) || [];
    list.push(Number(episode.episode_number));
    bySeason.set(episode.season_id, list);
  }

  let episodeCount = 0;
  for (const expected of plan.seasons) {
    const season = seasonByNumber.get(expected.seasonNumber);
    if (!season) throw new Error(`Season ${expected.seasonNumber} missing for ${plan.title}`);

    const actual = (bySeason.get(season.id) || []).sort((a, b) => a - b);
    const expectedUnique = [...new Set(expected.episodeNumbers)];
    if (
      actual.length !== expectedUnique.length ||
      actual.some((value, index) => value !== expectedUnique[index])
    ) {
      throw new Error(
        `Episode mismatch for ${plan.title} S${expected.seasonNumber}: expected ${expectedUnique.length} [${expectedUnique[0]}..${expectedUnique[expectedUnique.length - 1]}], got ${actual.length} [${actual[0] ?? '-'}..${actual[actual.length - 1] ?? '-'}]`,
      );
    }
    episodeCount += actual.length;
  }

  return {
    title: series.title_en,
    seasons: expectedSeasonNumbers.length,
    episodes: episodeCount,
    seasonCounts: plan.seasons.map((season) => ({
      season: season.seasonNumber,
      episodes: season.episodeNumbers.length,
    })),
  };
}

async function resolvePlayback(input: Record<string, string | number>) {
  const url = new URL(PLAYBACK_BASE + '/api/v1/playback/resolve');
  for (const [key, value] of Object.entries(input)) url.searchParams.set(key, String(value));

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      const body = await response.text();
      let parsed: any = null;
      try { parsed = JSON.parse(body); } catch {}

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 180)}`);
      const sources = Array.isArray(parsed?.data?.sources) ? parsed.data.sources : [];
      const omega = sources.filter((source: any) =>
        source?.providerKey === 'omegatech-akwam' ||
        source?.provider === 'OmegaTech',
      );
      const external = omega.filter((source: any) => /^https?:\/\//i.test(String(source?.url || '')));

      if (!external.length) {
        throw new Error(`no OmegaTech HTTP source returned (${sources.length} total sources)`);
      }

      return { sourceCount: external.length };
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  throw new Error('unreachable');
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => runWorker()));
  return results;
}

const seededMovies: Array<{ tmdbId: number; title: string }> = [];

for (const tmdbId of MOVIE_IDS) {
  const { ar, en } = await loadMoviePair(tmdbId);
  await syncMovieCandidate(ar, en);
  seededMovies.push({ tmdbId, title: en.title || ar.title || String(tmdbId) });
}

const seriesPlans: SeriesPlan[] = [];
for (const tmdbId of SERIES_IDS) {
  const { ar, en, plan } = await loadSeriesPlan(tmdbId);
  await syncSeriesCandidate(ar, en);
  seriesPlans.push(plan);
}

const verifiedSeries = [];
for (const plan of seriesPlans) {
  verifiedSeries.push(await verifyDbSeries(plan));
}

const moviePlayback = [];
for (const movie of seededMovies) {
  moviePlayback.push({
    tmdbId: movie.tmdbId,
    title: movie.title,
    ...(await resolvePlayback({ type: 'movie', tmdbId: movie.tmdbId })),
  });
}

const episodeCases: Array<{ tmdbId: number; season: number; episode: number; title: string }> = [];
for (const plan of seriesPlans) {
  for (const season of plan.seasons) {
    for (const episode of season.episodeNumbers) {
      episodeCases.push({
        tmdbId: plan.tmdbId,
        season: season.seasonNumber,
        episode,
        title: plan.title,
      });
    }
  }
}

const episodeResults = await mapConcurrent(episodeCases, 6, async (item) => {
  try {
    const result = await resolvePlayback({
      type: 'series',
      tmdbId: item.tmdbId,
      season: item.season,
      episode: item.episode,
    });
    return { ...item, ok: true, sourceCount: result.sourceCount };
  } catch (error) {
    return { ...item, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

const failures = episodeResults.filter((item) => !item.ok);
if (failures.length) {
  console.error(JSON.stringify({ playbackFailures: failures.slice(0, 100), failureCount: failures.length }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  movies: seededMovies,
  series: verifiedSeries,
  playback: {
    moviesVerified: moviePlayback.length,
    episodesVerified: episodeResults.length,
    failures: failures.length,
    concurrency: 6,
  },
}, null, 2));

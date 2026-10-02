import 'dotenv/config';

import {
  resolveRe3ArabiMovieContext,
  resolveRe3ArabiSeriesContext,
  resolveRe3ArabiProvider,
  resolveRe3ArabiProviderWithContext,
} from '../server/providers/re3arabi';

type DiagnosticCase = {
  name: string;
  provider: 'aflaam' | 'anime3rb' | 'anime4up';
  type: 'movie' | 'episode';
  context: Awaited<ReturnType<typeof resolveRe3ArabiSeriesContext>> | Awaited<ReturnType<typeof resolveRe3ArabiMovieContext>>;
  season?: number;
  episode?: number;
  tmdbId: number;
};

const movieContext = await resolveRe3ArabiMovieContext(27205);
const breakingBadContext = await resolveRe3ArabiSeriesContext(1396);
const onePieceContext = await resolveRe3ArabiSeriesContext(37854);

const cases: DiagnosticCase[] = [
  {
    name: 'Inception movie',
    provider: 'aflaam',
    type: 'movie',
    context: movieContext,
    tmdbId: 27205,
  },
  ...[1, 2, 3, 4, 5, 6, 7].map((episode) => ({
    name: `Breaking Bad S01E${String(episode).padStart(2, '0')}`,
    provider: 'aflaam' as const,
    type: 'episode' as const,
    context: breakingBadContext,
    season: 1,
    episode,
    tmdbId: 1396,
  })),
  {
    name: 'Breaking Bad S05E01',
    provider: 'aflaam',
    type: 'episode',
    context: breakingBadContext,
    season: 5,
    episode: 1,
    tmdbId: 1396,
  },
  {
    name: 'One Piece S01E01',
    provider: 'anime3rb',
    type: 'episode',
    context: onePieceContext,
    season: 1,
    episode: 1,
    tmdbId: 37854,
  },
];

for (const test of cases) {
  const started = Date.now();
  try {
    const sources = test.type === 'movie'
      ? await resolveRe3ArabiProvider(
          { type: 'movie', tmdbId: test.tmdbId },
          test.provider,
        )
      : await resolveRe3ArabiProviderWithContext(
          test.context as Awaited<ReturnType<typeof resolveRe3ArabiSeriesContext>>,
          Number(test.season),
          Number(test.episode),
          test.provider,
        );

    const playable = sources.filter((source) =>
      /^https:\/\//i.test(String(source.url || '')) &&
      ['mp4', 'hls', 'dash', 'webm', 'direct'].includes(String(source.type || '').toLowerCase()),
    );

    console.log(JSON.stringify({
      case: test.name,
      provider: test.provider,
      sources: sources.length,
      playable: playable.length,
      qualities: [...new Set(playable.map((source) => source.quality).filter(Boolean))],
      elapsedMs: Date.now() - started,
    }));

    if (!playable.length) {
      throw new Error(`No native playback source for ${test.name}`);
    }
  } catch (error) {
    console.error(JSON.stringify({
      case: test.name,
      provider: test.provider,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started,
    }));
    process.exitCode = 1;
  }
}

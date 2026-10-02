import 'dotenv/config';

import {
  resolveRe3ArabiMovieContext,
  resolveRe3ArabiSeriesContext,
  resolveRe3ArabiPlayback,
  resolveRe3ArabiPlaybackWithContext,
} from '../server/providers/re3arabi';
import { resolveArProvPlayback } from '../server/providers/arprov';

} from '../server/providers/re3arabi';

type DiagnosticCase =
  | {
      name: string;
      type: 'movie';
      tmdbId: number;
      expectedProviders: string[];
    }
  | {
      name: string;
      type: 'episode';
      tmdbId: number;
      context: Awaited<ReturnType<typeof resolveRe3ArabiSeriesContext>>;
      season: number;
      episode: number;
      expectedProviders: string[];
    };

const movieContext = await resolveRe3ArabiMovieContext(27205);
const breakingBadContext = await resolveRe3ArabiSeriesContext(1396);
const onePieceContext = await resolveRe3ArabiSeriesContext(37854);

const cases: DiagnosticCase[] = [
  {
    name: 'Inception movie (Akwam)',
    type: 'movie',
    tmdbId: 27205,
    expectedProviders: ['akwam'],
  },
  {
    name: 'Breaking Bad S01E01 (Akwam)',
    type: 'episode',
    tmdbId: 1396,
    context: breakingBadContext,
    season: 1,
    episode: 1,
    expectedProviders: ['akwam'],
  },
  {
    name: 'Breaking Bad S01E07 (Akwam)',
    type: 'episode',
    tmdbId: 1396,
    context: breakingBadContext,
    season: 1,
    episode: 7,
    expectedProviders: ['akwam'],
  },
  {
    name: 'Breaking Bad S05E01 (Akwam)',
    type: 'episode',
    tmdbId: 1396,
    context: breakingBadContext,
    season: 5,
    episode: 1,
    expectedProviders: ['akwam'],
  },
  {
    name: 'One Piece S01E01 (Anime4Up)',
    type: 'episode',
    tmdbId: 37854,
    context: onePieceContext,
    season: 1,
    episode: 1,
    expectedProviders: ['anime4up'],
  },
];

for (const test of cases) {
  const started = Date.now();
  try {
    const sources =
      test.type === 'movie'
        ? await resolveArProvPlayback(test.context)
        : test.name.includes('(Akwam)')
          ? await resolveArProvPlayback({
              ...test.context,
              seasonNumber: test.season,
              episodeNumber: test.episode,
            })
          : await resolveRe3ArabiPlaybackWithContext(
              test.context,
              test.season,
              test.episode,
            );

    const playable = sources.filter((source) =>
      /^https:\/\//i.test(String(source.url || '')) &&
      ['mp4', 'hls', 'dash', 'webm', 'direct'].includes(
        String(source.type || '').toLowerCase(),
      ),
    );

    const providers = [...new Set(playable.map((source) => source.providerKey))];

    console.log(
      JSON.stringify({
        case: test.name,
        sources: sources.length,
        playable: playable.length,
        providers,
        qualities: [...new Set(playable.map((source) => source.quality).filter(Boolean))],
        elapsedMs: Date.now() - started,
      }),
    );

    if (!playable.length) {
      throw new Error(`No native playback source for ${test.name}`);
    }

    if (!test.expectedProviders.some((provider) => providers.includes(provider))) {
      throw new Error(
        `Expected one of [${test.expectedProviders.join(', ')}], got [${providers.join(', ')}]`,
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        case: test.name,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - started,
      }),
    );
    process.exitCode = 1;
  }
}

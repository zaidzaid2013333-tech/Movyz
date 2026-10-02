import 'dotenv/config';

import {
  resolveRe3ArabiMovieContext,
  resolveRe3ArabiSeriesContext,
  resolveRe3ArabiProvider,
  resolveRe3ArabiProviderWithContext,
} from '../server/providers/re3arabi';

const inceptionContext = await resolveRe3ArabiMovieContext(27205);
const breakingBadContext = await resolveRe3ArabiSeriesContext(1396);

const cases = [
  {
    provider: 'aflaam' as const,
    type: 'movie' as const,
    context: inceptionContext,
  },
  {
    provider: 'aflaam' as const,
    type: 'episode' as const,
    context: breakingBadContext,
    season: 1,
    episode: 1,
  },
];

const results = await Promise.all(
  cases.map(async (test) => {
    const started = Date.now();

    try {
      const sources = test.type === 'movie'
        ? await resolveRe3ArabiProvider(
            {
              type: 'movie',
              tmdbId: 27205,
            },
            test.provider,
          )
        : await resolveRe3ArabiProviderWithContext(
            test.context,
            test.season!,
            test.episode!,
            test.provider,
          );

      const normalized = sources.filter((source) =>
        source &&
        typeof source.url === 'string' &&
        /^https:\/\//i.test(source.url) &&
        ['hls', 'mp4', 'dash', 'webm', 'direct'].includes(String(source.type).toLowerCase()),
      );

      const summary = {
        provider: test.provider,
        type: test.type,
        season: test.season,
        episode: test.episode,
        ms: Date.now() - started,
        count: normalized.length,
        qualities: [...new Set(normalized.map((x: any) => x.quality))],
        types: [...new Set(normalized.map((x: any) => x.type))],
        sampleUrls: normalized.slice(0, 3).map((x: any) => x.url),
      };

      console.log(JSON.stringify(summary));
      return normalized.length > 0;
    } catch (error) {
      console.log(JSON.stringify({
        provider: test.provider,
        type: test.type,
        season: test.season,
        episode: test.episode,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
  }),
);

if (results.some((ok) => !ok)) process.exit(1);

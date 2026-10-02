import 'dotenv/config';

import { diagnoseRe3ArabiPlayback } from '../server/providers/re3arabi';

const timeout = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error('diagnostic timeout')), 20_000),
);

try {
  const result = await Promise.race([
    diagnoseRe3ArabiPlayback({
      type: 'series',
      tmdbId: 1396,
      season: 1,
      episode: 1,
    }),
    timeout,
  ]);

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

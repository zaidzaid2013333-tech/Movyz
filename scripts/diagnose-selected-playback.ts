import 'dotenv/config';

import { diagnoseRe3ArabiPlayback } from '../server/providers/re3arabi';

const result = await diagnoseRe3ArabiPlayback({
  type: 'series',
  tmdbId: 1396,
  season: 1,
  episode: 1,
});

console.log(JSON.stringify(result, null, 2));

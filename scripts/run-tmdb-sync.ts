import 'dotenv/config';
import { runTmdbSync, syncEpisodesForSeries } from '../server/tmdb';

const mode = process.argv[2] || 'catalog';
const value = Number(process.argv[3] || (mode === 'catalog' ? 1 : 10));

if (mode === 'catalog') {
  const pages = Math.min(Math.max(value, 1), 3);
  const result = await runTmdbSync({ pages });
  console.log(JSON.stringify(result, null, 2));
} else if (mode === 'episodes') {
  const seriesLimit = Math.min(Math.max(value, 1), 25);
  const result = await syncEpisodesForSeries(seriesLimit);
  console.log(JSON.stringify(result, null, 2));
} else {
  throw new Error(`Unknown sync mode: ${mode}`);
}

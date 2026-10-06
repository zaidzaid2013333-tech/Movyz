import 'dotenv/config';

import { curatedCatalogSeed } from '../server/curatedCatalog';
import { importCuratedCatalog } from '../server/tmdb';

const mediaType = process.env.CURATED_MEDIA_TYPE === 'series' ? 'series' : 'movie';
const batch = Math.max(0, Number(process.env.CURATED_BATCH || '0'));
const batchSize = Math.max(1, Number(process.env.CURATED_BATCH_SIZE || '36'));

const unique = new Map<string, (typeof curatedCatalogSeed)[number]>();
for (const item of curatedCatalogSeed) {
  if (item.mediaType !== mediaType) continue;
  const key = item.mediaType + '|' + item.title.toLowerCase().trim();
  if (!unique.has(key)) unique.set(key, item);
}

const items = [...unique.values()].sort((a, b) => a.rank - b.rank);
const start = batch * batchSize;
const chunk = items.slice(start, start + batchSize);

if (!chunk.length) {
  console.log(JSON.stringify({ mediaType, batch, start, count: 0, total: items.length, skipped: true }));
  process.exit(0);
}

console.log(JSON.stringify({
  mediaType,
  batch,
  start,
  count: chunk.length,
  total: items.length,
  ranks: [chunk[0].rank, chunk[chunk.length - 1].rank],
}));

const result = await importCuratedCatalog(chunk);
console.log(JSON.stringify(result, null, 2));
if (result.errors > 0) process.exitCode = 1;

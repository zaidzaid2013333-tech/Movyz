import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [indexXml, gscXml, workerSource] = await Promise.all([
  readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8'),
  readFile(new URL('../public/sitemap-gsc.xml', import.meta.url), 'utf8'),
  readFile(new URL('../worker.ts', import.meta.url), 'utf8'),
]);
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const numberConstant = (name) => {
  const match = workerSource.match(new RegExp('const ' + name + ' = (\\d+);'));
  assert.ok(match, 'Missing numeric sitemap constant: ' + name);
  return Number(match[1]);
};
const discoveryPages = numberConstant('SITEMAP_DISCOVERY_PAGES');
const discoveryBatchSize = numberConstant('SITEMAP_DISCOVERY_PAGES_PER_SITEMAP');
const episodeSourcePages = numberConstant('SITEMAP_EPISODE_PAGES');
const episodeBatchSize = numberConstant('SITEMAP_EPISODE_PAGES_PER_SITEMAP');
const expectedDiscoveryMaps = Math.ceil(discoveryPages / discoveryBatchSize);
const expectedEpisodeMaps = Math.ceil(episodeSourcePages / episodeBatchSize);

assert.match(indexXml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
assert.match(indexXml, /<sitemapindex[ >]/);
assert.match(indexXml, /<\/sitemapindex>/);
const indexLocs = locs(indexXml);
assert.equal(new Set(indexLocs).size, indexLocs.length, 'Sitemap index must not contain duplicate child maps');
assert.ok(indexLocs.every((url) => url.startsWith('https://movyza.sbs/sitemap/')));
assert.ok(indexLocs.every((url) => !url.includes('/watch/')), 'Playback URLs must not appear in sitemap index');

const localeCodes = [...workerSource.matchAll(/^  ([a-z]{2}): \{ tmdb:/gm)].map((match) => match[1]);
const staticMaps = indexLocs.filter((url) => /\/sitemap\/[a-z]{2}\/static\.xml$/.test(url));
const movieMaps = indexLocs.filter((url) => /\/sitemap\/en\/movies\/\d+\.xml$/.test(url));
const seriesMaps = indexLocs.filter((url) => /\/sitemap\/en\/series\/\d+\.xml$/.test(url));
const episodeMaps = indexLocs.filter((url) => /\/sitemap\/en\/episodes\/\d+\.xml$/.test(url));
assert.equal(localeCodes.length, 32, 'Worker must define 32 supported languages');
assert.equal(staticMaps.length, 32, 'All 32 localized static sitemaps must remain');
assert.equal(movieMaps.length, expectedDiscoveryMaps, 'Movie sitemap count must match batching configuration');
assert.equal(seriesMaps.length, expectedDiscoveryMaps, 'Series sitemap count must match batching configuration');
assert.equal(episodeMaps.length, expectedEpisodeMaps, 'Episode sitemap count must match batching configuration');
assert.equal(indexLocs.length, 32 + expectedDiscoveryMaps * 2 + expectedEpisodeMaps);

const suffixNumbers = (urls) => urls.map((url) => Number(url.match(/\/(\d+)\.xml$/)?.[1])).sort((a, b) => a - b);
assert.deepEqual(suffixNumbers(movieMaps), Array.from({ length: expectedDiscoveryMaps }, (_, i) => i + 1));
assert.deepEqual(suffixNumbers(seriesMaps), Array.from({ length: expectedDiscoveryMaps }, (_, i) => i + 1));
assert.deepEqual(suffixNumbers(episodeMaps), Array.from({ length: expectedEpisodeMaps }, (_, i) => i + 1));

assert.match(gscXml, /<urlset[ >]/);
assert.match(gscXml, /<\/urlset>/);
const homeLocs = locs(gscXml);
const expectedHomeLocs = ['https://movyza.sbs/', ...localeCodes.map((code) => 'https://movyza.sbs/' + code + '/')].sort();
assert.equal(new Set(homeLocs).size, homeLocs.length, 'Homepage sitemap must not contain duplicates');
assert.deepEqual([...homeLocs].sort(), expectedHomeLocs, 'Homepage-only GSC sitemap must keep root and all localized homepages');

console.log('Sitemap checks passed: ' + indexLocs.length + ' child maps; 32 localized static maps; ' + expectedDiscoveryMaps + ' movie maps; ' + expectedDiscoveryMaps + ' series maps; ' + expectedEpisodeMaps + ' episode maps; 33 homepage URLs.');

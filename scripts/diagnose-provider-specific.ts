import 'dotenv/config';
import { resolveRe3ArabiSeriesContext, resolveRe3ArabiProviderWithContext } from '../server/providers/re3arabi';

const context = await resolveRe3ArabiSeriesContext(1396);
const sources = await resolveRe3ArabiProviderWithContext(context, 1, 1, 'aflaam');
console.log(JSON.stringify({
  tmdbId: 1396,
  season: 1,
  episode: 1,
  count: sources.length,
  qualities: [...new Set(sources.map((x:any)=>x.quality))],
  types: [...new Set(sources.map((x:any)=>x.type))],
}, null, 2));

import 'dotenv/config';
import { resolveRe3ArabiSeriesContext, resolveRe3ArabiProviderWithContext } from '../server/providers/re3arabi';

const context = await resolveRe3ArabiSeriesContext(1396);

for (const [provider, season, episode] of [
  ['cimaclub', 1, 1],
  ['aflaam', 1, 1],
] as const) {
  const started = Date.now();
  try {
    const sources = await resolveRe3ArabiProviderWithContext(context, season, episode, provider);
    console.log(JSON.stringify({
      provider,
      season,
      episode,
      ms: Date.now() - started,
      count: sources.length,
      qualities: [...new Set(sources.map((x:any)=>x.quality))],
      types: [...new Set(sources.map((x:any)=>x.type))],
    }));
  } catch (error) {
    console.log(JSON.stringify({
      provider,
      season,
      episode,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

const movieContext = await resolveRe3ArabiMovieContext(27205);
const seriesContext = await resolveRe3ArabiSeriesContext(1396);

for (const [provider, type, context, season, episode] of [
  ['cimaclub', 'movie', movieContext, undefined, undefined],
  ['aflaam', 'movie', movieContext, undefined, undefined],
  ['cimaclub', 'episode', seriesContext, 1, 1],
  ['aflaam', 'episode', seriesContext, 1, 1],
] as const) {
  const started = Date.now();
  try {
    const sources = type === 'movie'
      ? await resolveRe3ArabiProvider({
          type: 'movie',
          tmdbId: 27205,
        }, provider)
      : await resolveRe3ArabiProviderWithContext(
          context,
          Number(season),
          Number(episode),
          provider,
        );

    console.log(JSON.stringify({
      provider,
      type,
      season,
      episode,
      ms: Date.now() - started,
      count: sources.length,
      qualities: [...new Set(sources.map((x:any)=>x.quality))],
      types: [...new Set(sources.map((x:any)=>x.type))],
      urls: sources.slice(0, 3).map((x:any)=>x.url),
    }));
  } catch (error) {
    console.log(JSON.stringify({
      provider,
      type,
      season,
      episode,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

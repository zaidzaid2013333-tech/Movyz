import { resolveRemotePlayback } from '../server/providers/remote-resolver.ts';

(async () => {
  const cases = [
    { type: 'movie' as const, tmdbId: 27205 },
    { type: 'series' as const, tmdbId: 1396, season: 1, episode: 1 },
    { type: 'series' as const, tmdbId: 1396, season: 5, episode: 16 },
  ];

  let failed = false;

  for (const request of cases) {
    try {
      const sources = await resolveRemotePlayback(request);
      console.log(JSON.stringify({
        request,
        count: sources.length,
        sources: sources.map((source) => ({
          type: source.type,
          quality: source.quality,
          provider: source.provider,
          url: source.url,
        })),
      }, null, 2));

      if (!sources.length) failed = true;
    } catch (error) {
      failed = true;
      console.error(JSON.stringify({
        request,
        error: error instanceof Error ? error.stack : String(error),
      }, null, 2));
    }
  }

  if (failed) process.exit(1);
})();

const BASE = 'https://movyz-api.sameranede.workers.dev';

const cases = [
  { type: 'movie', tmdbId: 27205, label: 'Inception' },
  { type: 'movie', tmdbId: 157336, label: 'Interstellar' },
  { type: 'movie', tmdbId: 278, label: 'The Shawshank Redemption' },
  { type: 'movie', tmdbId: 550, label: 'Fight Club' },
  { type: 'movie', tmdbId: 155, label: 'The Dark Knight' },
  { type: 'series', tmdbId: 1396, season: 1, episode: 1, label: 'Breaking Bad S01E01' },
  { type: 'series', tmdbId: 1396, season: 5, episode: 16, label: 'Breaking Bad S05E16' },
  { type: 'series', tmdbId: 60059, season: 1, episode: 1, label: 'Better Call Saul S01E01' },
  { type: 'series', tmdbId: 70523, season: 1, episode: 1, label: 'Dark S01E01' },
  { type: 'series', tmdbId: 2316, season: 1, episode: 1, label: 'The Office S01E01' },
  { type: 'series', tmdbId: 5920, season: 1, episode: 1, label: 'The Mentalist S01E01' },
];

for (const item of cases) {
  const url = new URL(BASE + '/api/v1/playback/resolve');
  url.searchParams.set('type', item.type);
  url.searchParams.set('tmdbId', String(item.tmdbId));
  if (item.season) url.searchParams.set('season', String(item.season));
  if (item.episode) url.searchParams.set('episode', String(item.episode));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();
    console.log(JSON.stringify({
      label: item.label,
      status: response.status,
      ok: response.ok,
      body: body.slice(0, 700),
    }));
  } catch (error) {
    console.log(JSON.stringify({
      label: item.label,
      status: 0,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
  } finally {
    clearTimeout(timer);
  }
  await new Promise((resolve) => setTimeout(resolve, 1800));
}

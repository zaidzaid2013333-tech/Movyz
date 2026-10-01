const targets = [
  'https://api.omegatech.app/api/movie/Akwam?action=search&query=Inception',
  'https://omegatech-api.dixonomega.tech/api/movie/Akwam?action=search&query=Inception',
];

for (const url of targets) {
  const started = Date.now();
  try {
    const response = await fetch(url);
    const body = await response.text();
    console.log(JSON.stringify({
      url,
      status: response.status,
      ms: Date.now() - started,
      body: body.slice(0, 1200),
    }));
  } catch (error) {
    console.log(JSON.stringify({
      url,
      status: 0,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

const production = 'https://movyz-api.sameranede.workers.dev/api/v1/playback/resolve?type=movie&tmdbId=27205';
try {
  const response = await fetch(production);
  const body = await response.text();
  console.log(JSON.stringify({
    url: production,
    status: response.status,
    body: body.slice(0, 1200),
  }));
} catch (error) {
  console.log(JSON.stringify({ url: production, status: 0, error: String(error) }));
}

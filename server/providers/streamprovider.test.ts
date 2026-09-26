import assert from 'node:assert/strict';
import test from 'node:test';
import { createStreamProviderAdapter } from './adapters/streamprovider';

test('StreamProvider adapter resolves a TMDB movie into an HLS source', async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.MOVYZA_STREAMPROVIDER_BASE_URL;

  process.env.MOVYZA_STREAMPROVIDER_BASE_URL = 'https://streamprovider.test';

  globalThis.fetch = (async (input) => {
    const url = String(input);
    assert.equal(url, 'https://streamprovider.test/?tmdbId=157336');

    return new Response(JSON.stringify({
      url: 'https://cdn.example/movie/index.m3u8',
      referer: 'https://provider.example/',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const adapter = createStreamProviderAdapter();
    const sources = await adapter.resolveMovie({ tmdbId: 157336 });

    assert.equal(sources.length, 1);
    assert.equal(sources[0].provider, 'streamprovider');
    assert.equal(sources[0].type, 'hls');
    assert.equal(sources[0].url, 'https://cdn.example/movie/index.m3u8');
  } finally {
    globalThis.fetch = originalFetch;

    if (originalBase === undefined) delete process.env.MOVYZA_STREAMPROVIDER_BASE_URL;
    else process.env.MOVYZA_STREAMPROVIDER_BASE_URL = originalBase;
  }
});

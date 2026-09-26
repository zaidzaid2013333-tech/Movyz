import assert from 'node:assert/strict';
import test from 'node:test';
import { createTmdbHlsAdapter } from './adapters/tmdb-hls';

test('TMDB HLS adapter normalizes a JSON source response', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';

  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      sources: [{ url: 'https://cdn.example.com/1080p.m3u8', quality: '1080p', language: 'ar' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const adapter = createTmdbHlsAdapter({
      key: 'test-provider',
      name: 'Test Provider',
      movieUrl: 'https://provider.example/movie/{{tmdbId}}',
      episodeUrl: 'https://provider.example/tv/{{tmdbId}}?season={{season}}&episode={{episode}}',
      timeoutMs: 1000,
      language: 'ar',
    });

    const movie = await adapter.resolveMovie({ tmdbId: 550 });
    assert.equal(requestedUrl, 'https://provider.example/movie/550');
    assert.equal(movie.length, 1);
    assert.equal(movie[0].type, 'hls');
    assert.equal(movie[0].quality, '1080p');
    assert.equal(movie[0].language, 'ar');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

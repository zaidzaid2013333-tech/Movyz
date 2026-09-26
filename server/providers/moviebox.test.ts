import assert from 'node:assert/strict';
import test from 'node:test';
import { createMovieBoxApiAdapter } from './adapters/moviebox';

test('MovieBox adapter resolves a direct MP4 stream from the dedicated worker', async () => {
  const originalFetch = globalThis.fetch;
  const originalProxy = process.env.MOVIEBOX_PROXY_PLAYBACK;
  let calls = 0;

  process.env.MOVIEBOX_PROXY_PLAYBACK = 'false';

  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls++;

    if (url.includes('/search?q=')) {
      return new Response(JSON.stringify({
        query: 'Fight Club',
        movies: [
          {
            name: 'Fight Club',
            slug: 'fight-club-x',
            year: 1999,
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.includes('/detail/fight-club-x')) {
      return new Response(JSON.stringify({
        metadata: { id: '12345' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.includes('/api/stream/12345?')) {
      return new Response(JSON.stringify({
        count: 1,
        sources: [
          {
            id: 's1',
            resolution: '1080p',
            format: 'mp4',
            url: 'https://cdn.example.com/fight-club-1080.mp4',
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error('Unexpected request: ' + url);
  }) as typeof fetch;

  try {
    const adapter = createMovieBoxApiAdapter();
    const sources = await adapter.resolveMovie({
      tmdbId: 550,
      title: 'Fight Club',
      originalTitle: 'Fight Club',
      releaseYear: 1999,
    });

    assert.equal(sources.length, 1);
    assert.equal(sources[0].provider, 'moviebox-api');
    assert.equal(sources[0].type, 'mp4');
    assert.equal(sources[0].quality, '1080p');
    assert.equal(sources[0].url, 'https://cdn.example.com/fight-club-1080.mp4');
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProxy === undefined) delete process.env.MOVIEBOX_PROXY_PLAYBACK;
    else process.env.MOVIEBOX_PROXY_PLAYBACK = originalProxy;
  }
});

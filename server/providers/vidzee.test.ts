import assert from 'node:assert/strict';
import test from 'node:test';
import { createVidZeeAdapter } from './adapters/vidzee';

test('VidZee adapter resolves an HLS source and wraps it in the Movyz proxy', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedReferer = '';

  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestedReferer = String((init?.headers as Record<string, string>)?.Referer || '');
    return new Response(JSON.stringify({
      url: 'https://cdn2.1shows.app/movie/test/index.m3u8',
      quality: '720p',
      language: 'en',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const adapter = createVidZeeAdapter();
    const sources = await adapter.resolveMovie({ tmdbId: 550 });
    assert.equal(requestedUrl, 'https://core.vidzee.wtf/streams/movie/550?s=dcloud&e=0');
    assert.equal(requestedReferer, 'https://player.vidzee.wtf/');
    assert.equal(sources.length, 1);
    assert.equal(sources[0].provider, 'vidzee');
    assert.equal(sources[0].type, 'hls');
    assert.ok(sources[0].url);
    assert.match(sources[0].url, /^\/api\/v1\/playback\/proxy\?url=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

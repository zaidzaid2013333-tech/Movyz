import assert from 'node:assert/strict';
import test from 'node:test';
import { createTmdbEmbedAdapter } from './adapters/tmdb-embed';

test('TMDB Embed adapter maps proxied HLS/MP4 streams and skips non-playable URLs', async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.MOVYZA_TMDB_EMBED_API_BASE_URL;

  process.env.MOVYZA_TMDB_EMBED_API_BASE_URL = 'https://tmdb-embed.test';

  globalThis.fetch = (async (input) => {
    const url = String(input);

    if (url === 'https://tmdb-embed.test/api/streams/movie/550') {
      return new Response(JSON.stringify({
        success: true,
        streams: [
          {
            name: 'Proxy HLS 1080p',
            quality: '1080p',
            provider: 'CastleTV',
            url: 'https://tmdb-embed.test/m3u8-proxy?url=https%3A%2F%2Fcdn.example%2Fmovie.m3u8',
          },
          {
            name: 'Proxy MP4 720p',
            quality: '720p',
            provider: 'Direct',
            url: 'https://tmdb-embed.test/ts-proxy?url=https%3A%2F%2Fcdn.example%2Fmovie.mp4',
          },
          {
            name: 'External embed',
            provider: 'Embed',
            url: 'https://player.example/watch/550',
          },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (url === 'https://tmdb-embed.test/api/health') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const adapter = createTmdbEmbedAdapter();
    const sources = await adapter.resolveMovie({ tmdbId: 550 });

    assert.equal(sources.length, 2);
    assert.deepEqual(sources.map((source) => source.type), ['hls', 'mp4']);
    assert.equal(sources[0].quality, '1080p');
    assert.equal(sources[0].provider, 'tmdbembed');
    assert.equal(sources[1].quality, '720p');
    assert.equal((await adapter.health()).status, 'healthy');
  } finally {
    globalThis.fetch = originalFetch;

    if (originalBase === undefined) delete process.env.MOVYZA_TMDB_EMBED_API_BASE_URL;
    else process.env.MOVYZA_TMDB_EMBED_API_BASE_URL = originalBase;
  }
});

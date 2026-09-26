import assert from 'node:assert/strict';
import test from 'node:test';
import { createMovieBoxApiAdapter } from './adapters/moviebox';

test('MovieBox adapter resolves a direct MP4 stream from the H5 API', async () => {
  const originalFetch = globalThis.fetch;
  const originalDomain = process.env.MOVIEBOX_STREAM_DOMAIN;
  let calls = 0;
  process.env.MOVIEBOX_STREAM_DOMAIN = 'https://stream.example';
  globalThis.fetch = (async (input) => {
    const url = String(input); calls++;
    if (url.includes('/subject/search')) return new Response(JSON.stringify({ data: { items: [{ title: 'Fight Club', detailPath: 'fight-club-x', releaseDate: '1999-10-15' }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/detail?detailPath=')) return new Response(JSON.stringify({ data: { subject: { subjectId: '12345' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/subject/play?')) return new Response(JSON.stringify({ data: { streams: [{ id: 's1', resolutions: 1080, format: 'mp4', url: 'https://cdn.example.com/fight-club-1080.mp4' }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error('Unexpected request: ' + url);
  }) as typeof fetch;
  try {
    const adapter = createMovieBoxApiAdapter();
    const sources = await adapter.resolveMovie({ tmdbId: 550, title: 'Fight Club', originalTitle: 'Fight Club', releaseYear: 1999 });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].provider, 'moviebox-api');
    assert.equal(sources[0].type, 'mp4');
    assert.equal(sources[0].quality, '1080p');
    assert.equal(sources[0].url, 'https://cdn.example.com/fight-club-1080.mp4');
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDomain === undefined) delete process.env.MOVIEBOX_STREAM_DOMAIN; else process.env.MOVIEBOX_STREAM_DOMAIN = originalDomain;
  }
});
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

test('MovieBox adapter chooses the exact release year and builds an HLS proxy URL', async () => {
  const originalFetch = globalThis.fetch;
  const originalProxy = process.env.MOVIEBOX_PROXY_PLAYBACK;
  process.env.MOVIEBOX_PROXY_PLAYBACK = 'true';
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('/search?q=')) return new Response(JSON.stringify({ movies: [
      { name: 'Interstellar', slug: 'interstellar-2023', year: 2023 },
      { name: 'Interstellar', slug: 'interstellar-2014', year: 2014 },
    ] }));
    if (url.includes('/detail/interstellar-2014')) return new Response(JSON.stringify({ metadata: { id: 4242 } }));
    if (url.includes('/api/stream/4242?')) return new Response(JSON.stringify({ sources: [{ id: 'hls', format: 'hls', resolutions: 1080, url: 'https://cdn.example.test/master.m3u8' }] }));
    throw new Error('Unexpected request: ' + url);
  }) as typeof fetch;
  try {
    const sources = await createMovieBoxApiAdapter().resolveMovie({ tmdbId: 157336, title: 'Interstellar', originalTitle: 'Interstellar', releaseYear: 2014 });
    assert.equal(sources.length, 1);
    const [source] = sources;
    assert.ok(source);
    assert.equal(source!.type, 'hls');
    assert.match(source!.url!, /\/watch\/4242\?detail_path=interstellar-2014/);
    assert.match(source!.url!, /resolution=1080/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProxy === undefined) delete process.env.MOVIEBOX_PROXY_PLAYBACK; else process.env.MOVIEBOX_PROXY_PLAYBACK = originalProxy;
  }
});

test('MovieBox adapter rejects an incorrect search result and an empty stream response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('/search?q=Wrong')) return new Response(JSON.stringify({ movies: [{ name: 'Entirely Different', slug: 'different', year: 2014 }] }));
    if (url.includes('/search?q=Fight')) return new Response(JSON.stringify({ movies: [{ name: 'Fight Club', slug: 'fight-club', year: 1999 }] }));
    if (url.includes('/detail/fight-club')) return new Response(JSON.stringify({ metadata: { id: 123 } }));
    if (url.includes('/api/stream/123?')) return new Response(JSON.stringify({ sources: [] }));
    throw new Error('Unexpected request: ' + url);
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => createMovieBoxApiAdapter().resolveMovie({ tmdbId: 1, title: 'Wrong Title', originalTitle: 'Wrong Title', releaseYear: 2014 }),
      /match resolution returned no result/,
    );
    await assert.rejects(
      () => createMovieBoxApiAdapter().resolveMovie({ tmdbId: 550, title: 'Fight Club', originalTitle: 'Fight Club', releaseYear: 1999 }),
      /returned no playable sources/,
    );
  } finally { globalThis.fetch = originalFetch; }
});

test('MovieBox adapter exposes upstream HTTP and malformed JSON failures', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('bad gateway', { status: 502 })) as typeof fetch;
  try {
    await assert.rejects(
      () => createMovieBoxApiAdapter().resolveMovie({ tmdbId: 550, title: 'Fight Club', originalTitle: 'Fight Club', releaseYear: 1999 }),
      /MovieBox search failed.*HTTP 502.*bad gateway/,
    );
  } finally { globalThis.fetch = originalFetch; }

  globalThis.fetch = (async () => new Response('{not json', { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(
      () => createMovieBoxApiAdapter().resolveMovie({ tmdbId: 550, title: 'Fight Club', originalTitle: 'Fight Club', releaseYear: 1999 }),
      /MovieBox search failed.*invalid JSON/,
    );
  } finally { globalThis.fetch = originalFetch; }
});

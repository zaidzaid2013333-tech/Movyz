import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveArProvPlayback } from './arprov';

test('ArProv resolves an Akwam download page into a direct video source', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.startsWith('https://akwam.ss/search') || url.startsWith('https://akwam.ss/?s=')) {
      return new Response('<a href="https://akwam.ss/movie/demo">Demo</a>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }

    if (url === 'https://akwam.ss/movie/demo') {
      return new Response('<a href="https://akwam.ss/download/quality1080">تحميل 1080p</a>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }

    if (url === 'https://akwam.ss/download/quality1080') {
      return new Response('<div class="btn-loader"><a href="https://cdn.example.test/demo/1080.mp4">تحميل</a></div>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }

    return new Response('', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }) as typeof fetch;

  try {
    const sources = await resolveArProvPlayback({
      tmdbId: 1,
      title: 'Demo',
      originalTitle: 'Demo',
    });

    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.provider, 'Akwam');
    assert.equal(sources[0]?.type, 'mp4');
    assert.equal(sources[0]?.url, 'https://cdn.example.test/demo/1080.mp4');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

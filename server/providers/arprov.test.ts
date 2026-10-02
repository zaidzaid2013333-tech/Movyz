import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveArProvPlayback } from './arprov';

test('ArProv resolves an Akwam download page into a direct video source', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.startsWith('https://ak.sv/search') || url.startsWith('https://ak.sv/?s=')) {
      return new Response('<a href="https://ak.sv/movie/demo">Demo</a>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }

    if (url === 'https://ak.sv/movie/demo') {
      return new Response('<a href="https://ak.sv/download/quality1080">تحميل 1080p</a>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }

    if (url === 'https://ak.sv/download/quality1080') {
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


test('ArProv follows iframe sources from provider pages', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.includes('ak.sv')) {
      return new Response('', { status: 200, headers: { 'content-type': 'text/html' } });
    }

    if (url.startsWith('https://cfu.cam/?s=DemoIframe') || url.startsWith('https://cfu.cam/search/?s=DemoIframe')) {
      return new Response('<a href="https://cfu.cam/watch/demo-iframe">DemoIframe</a>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }

    if (url === 'https://cfu.cam/watch/demo-iframe') {
      return new Response('<div class="player"><iframe data-src="https://cdn.example.test/demo/720.mp4"></iframe></div>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }

    if (url.includes('ciimaclub.us')) {
      return new Response('', { status: 200, headers: { 'content-type': 'text/html' } });
    }

    return new Response('', { status: 404, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;

  try {
    const sources = await resolveArProvPlayback({
      tmdbId: 2,
      title: 'DemoIframe',
      originalTitle: 'DemoIframe',
    });

    assert.equal(sources.some(source =>
      source.provider === 'Cima4U' &&
      source.type === 'mp4' &&
      source.url === 'https://cdn.example.test/demo/720.mp4'
    ), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

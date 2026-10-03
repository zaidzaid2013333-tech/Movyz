import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveArProvPlayback } from './arprov';

function mockResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

test('ArProv resolves an Akwam movie download into a direct MP4 source', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.startsWith('https://akwam.ss/search') || url.startsWith('https://akwam.ss/?s=')) {
      return mockResponse('<div class="entry-box"><a class="box" href="https://akwam.ss/movie/demo">Demo</a></div>');
    }

    if (url === 'https://akwam.ss/movie/demo') {
      return mockResponse('<a href="https://akwam.ss/download/quality1080">تحميل 1080p</a>');
    }

    if (url === 'https://akwam.ss/download/quality1080') {
      return mockResponse('<div class="btn-loader"><a href="https://cdn.example.test/demo/1080.mp4">تحميل</a></div>');
    }

    return mockResponse('', 404);
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

test('ArProv resolves an Akwam series episode page before extracting media', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.startsWith('https://akwam.ss/search') || url.startsWith('https://akwam.ss/?s=')) {
      return mockResponse('<div class="entry-box"><a class="box" href="https://akwam.ss/series/breaking-bad">Breaking Bad</a></div>');
    }

    if (url === 'https://akwam.ss/series/breaking-bad') {
      return mockResponse('<div class="bg-primary2 p-4 col-lg-4 col-md-6 col-12"><a class="text-white" href="https://akwam.ss/episode/breaking-bad-s01e01">الحلقة 1</a></div>');
    }

    if (url === 'https://akwam.ss/episode/breaking-bad-s01e01') {
      return mockResponse('<a href="https://akwam.ss/download/bb-s01e01">تحميل الحلقة</a>');
    }

    if (url === 'https://akwam.ss/download/bb-s01e01') {
      return mockResponse('<div class="btn-loader"><a href="https://cdn.example.test/bb/s01e01/720.mp4">تحميل</a></div>');
    }

    return mockResponse('', 404);
  }) as typeof fetch;

  try {
    const sources = await resolveArProvPlayback({
      tmdbId: 1396,
      title: 'Breaking Bad',
      originalTitle: 'Breaking Bad',
      seasonNumber: 1,
      episodeNumber: 1,
    });

    assert.equal(sources.some(source =>
      source.provider === 'Akwam' &&
      source.type === 'mp4' &&
      source.url === 'https://cdn.example.test/bb/s01e01/720.mp4'
    ), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('ArProv follows the current Akwam quality/link/download flow', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.startsWith('https://akwam.ss/search') || url.startsWith('https://akwam.ss/?s=')) {
      return mockResponse('<div class="entry-box"><a class="box" href="https://akwam.ss/movie/inception">Inception</a></div>');
    }

    if (url === 'https://akwam.ss/movie/inception') {
      return mockResponse('<div class="tab-content quality" id="quality-5"><a href="https://akwam.ss/link/abc">تحميل 1080p</a></div>');
    }

    if (url === 'https://akwam.ss/download/abc/inception') {
      return mockResponse('<div class="btn-loader"><a href="https://cdn.example.test/inception/1080.mp4">تحميل</a></div>');
    }

    return mockResponse('', 404);
  }) as typeof fetch;

  try {
    const sources = await resolveArProvPlayback({
      tmdbId: 27205,
      title: 'Inception',
      originalTitle: 'Inception',
    });

    assert.equal(sources.some(source =>
      source.provider === 'Akwam' &&
      source.type === 'mp4' &&
      source.quality === '1080p' &&
      source.url === 'https://cdn.example.test/inception/1080.mp4'
    ), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('ArProv accepts an Akwam loader URL without a file extension as a direct video source', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.startsWith('https://akwam.ss/search') || url.startsWith('https://akwam.ss/?s=')) {
      return mockResponse('<div class="entry-box"><a class="box" href="https://akwam.ss/movie/direct-loader-case">Demo</a></div>');
    }

    if (url === 'https://akwam.ss/movie/direct-loader-case') {
      return mockResponse('<div class="tab-content quality" id="quality-5"><a href="https://akwam.ss/link/direct-loader-case">تحميل 1080p</a></div>');
    }

    if (url === 'https://akwam.ss/download/direct-loader-case/direct-loader-case') {
      return mockResponse('<div class="btn-loader"><a href="https://stream.example.test/play/abc123?token=xyz">تحميل</a></div>');
    }

    return mockResponse('', 404);
  }) as typeof fetch;

  try {
    const sources = await resolveArProvPlayback({
      tmdbId: 27205,
      title: 'Demo Direct Loader',
      originalTitle: 'Demo Direct Loader',
    });

    assert.equal(sources.some(source =>
      source.provider === 'Akwam' &&
      source.type === 'direct' &&
      source.quality === '1080p' &&
      source.url === 'https://stream.example.test/play/abc123?token=xyz'
    ), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

    if (url.startsWith('https://ak.sv/search') || url.startsWith('https://ak.sv/?s=')) {
      return mockResponse('<a href="https://ak.sv/movie/demo">Demo</a>');
    }

    if (url === 'https://ak.sv/movie/demo') {
      return mockResponse('<a href="https://ak.sv/download/quality1080">تحميل 1080p</a>');
    }

    if (url === 'https://ak.sv/download/quality1080') {
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

    if (url.startsWith('https://ak.sv/search') || url.startsWith('https://ak.sv/?s=')) {
      return mockResponse('<a href="https://ak.sv/series/breaking-bad">Breaking Bad</a>');
    }

    if (url === 'https://ak.sv/series/breaking-bad') {
      return mockResponse('<a href="https://ak.sv/episode/breaking-bad-s01e01">الحلقة 1</a>');
    }

    if (url === 'https://ak.sv/episode/breaking-bad-s01e01') {
      return mockResponse('<a href="https://ak.sv/download/bb-s01e01">تحميل الحلقة</a>');
    }

    if (url === 'https://ak.sv/download/bb-s01e01') {
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

test('ArProv searches Akwam with alternate Arabic titles for series episodes', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.startsWith('https://ak.sv/search') || url.startsWith('https://ak.sv/?s=')) {
      const parsed = new URL(url);
      if (parsed.searchParams.get('q')?.includes('بريكنغ باد') || parsed.searchParams.get('s')?.includes('بريكنغ باد')) {
        return mockResponse('<a href="https://ak.sv/series/breaking-bad-ar">بريكنغ باد</a>');
      }
      return mockResponse('');
    }

    if (url === 'https://ak.sv/series/breaking-bad-ar') {
      return mockResponse('<a href="https://ak.sv/episode/breaking-bad-s01e01-ar">الحلقة 1</a>');
    }

    if (url === 'https://ak.sv/episode/breaking-bad-s01e01-ar') {
      return mockResponse('<a href="https://ak.sv/download/bb-s01e01-ar">تحميل</a>');
    }

    if (url === 'https://ak.sv/download/bb-s01e01-ar') {
      return mockResponse('<div class="btn-loader"><a href="https://cdn.example.test/bb/ar-s01e01/720.mp4">تحميل</a></div>');
    }

    return mockResponse('', 404);
  }) as typeof fetch;

  try {
    const sources = await resolveArProvPlayback({
      tmdbId: 1396,
      title: 'Breaking Bad',
      originalTitle: 'Breaking Bad',
      alternateTitles: ['بريكنغ باد'],
      seasonNumber: 1,
      episodeNumber: 1,
    });

    assert.equal(sources.some(source =>
      source.provider === 'Akwam' &&
      source.type === 'mp4' &&
      source.url === 'https://cdn.example.test/bb/ar-s01e01/720.mp4'
    ), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

const worker = (await import('../../moviebox-worker/src/index.js')).default as {
  fetch(request: Request): Promise<Response>;
};

async function responseFor(request: Request) {
  const response = await worker.fetch(request);
  return { response, body: await response.json() as any };
}

test('MovieBox worker sends browser H5 context and normalizes a search result', async () => {
  const originalFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = (async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ data: { items: [{ title: 'Interstellar', detailPath: 'interstellar-x', releaseDate: '2014-11-05' }] } }), { status: 200 });
  }) as typeof fetch;
  try {
    const { response, body } = await responseFor(new Request('https://worker.test/search?q=Interstellar'));
    assert.equal(response.status, 200);
    assert.equal(request!.method, 'POST');
    assert.equal(request!.headers.get('origin'), 'https://moviebox.ph');
    assert.equal(request!.headers.get('referer'), 'https://moviebox.ph/');
    assert.deepEqual(body.movies, [{ name: 'Interstellar', year: '2014-11-05', poster_url: null, url: 'https://moviebox.ph/detail/interstellar-x', slug: 'interstellar-x', badge: null, blurhash: null }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('MovieBox worker returns safe upstream search diagnostics instead of an ambiguous empty result', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('upstream unavailable', { status: 503 })) as typeof fetch;
  try {
    const { response, body } = await responseFor(new Request('https://worker.test/search?q=Interstellar'));
    assert.equal(response.status, 502);
    assert.equal(body.stage, 'search');
    assert.equal(body.upstreamStatus, 503);
    assert.match(body.responseSnippet, /unavailable/);
  } finally { globalThis.fetch = originalFetch; }
});

test('MovieBox worker resolves the H5 detail payload without scraping a MovieBox HTML page', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    assert.match(String(input), /wefeed-h5api-bff\/detail\?detailPath=interstellar-x/);
    return new Response(JSON.stringify({ data: { subject: { subjectId: 4242, title: 'Interstellar', releaseDate: '2014' } } }), { status: 200 });
  }) as typeof fetch;
  try {
    const { response, body } = await responseFor(new Request('https://worker.test/detail/interstellar-x'));
    assert.equal(response.status, 200);
    assert.equal(body.metadata.id, '4242');
    assert.equal(body.metadata.title, 'Interstellar');
  } finally { globalThis.fetch = originalFetch; }
});

test('MovieBox worker returns stream URLs from the current H5 stream response shape', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('get-domain')) return new Response(JSON.stringify({ data: 'https://play.example.test' }), { status: 200 });
    if (url.includes('/subject/caption')) return new Response(JSON.stringify({ data: { subtitles: [] } }), { status: 200 });
    assert.match(url, /subject\/play\?subjectId=4242&se=0&ep=0&detailPath=interstellar-x/);
    return new Response(JSON.stringify({ data: { sources: [{ id: 'one', resolutions: 1080, format: 'hls', url: 'https://cdn.example.test/master.m3u8' }] } }), { status: 200 });
  }) as typeof fetch;
  try {
    const { response, body } = await responseFor(new Request('https://worker.test/api/stream/4242?detail_path=interstellar-x&se=0&ep=0'));
    assert.equal(response.status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.sources[0].url, 'https://cdn.example.test/master.m3u8');
    assert.equal(body.sources[0].format, 'hls');
  } finally { globalThis.fetch = originalFetch; }
});

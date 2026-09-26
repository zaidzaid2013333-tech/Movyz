import assert from 'node:assert/strict';
import test from 'node:test';
import { createEgyBestAdapter } from './adapters/mapped-json';

test('EgyBest adapter calls /dls with the mapped content URL and bearer token', async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.EGYBEST_API_BASE_URL;
  const originalToken = process.env.EGYBEST_ACCESS_TOKEN;

  process.env.EGYBEST_API_BASE_URL = 'https://egybest-api.example';
  process.env.EGYBEST_ACCESS_TOKEN = 'test-token';

  let requestedUrl = '';
  let authorization = '';

  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    authorization = String((init?.headers as Record<string, string>)?.Authorization || '');
    return new Response(JSON.stringify({
      sources: [{ url: 'https://cdn.example.com/1080p.m3u8', quality: '1080p', language: 'ar' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const adapter = createEgyBestAdapter();
    assert.ok(adapter);

    const sources = await adapter.resolveMovie({
      providerId: 'https://www.egybest.org/movie/top-gun-maverick-2022',
    });

    assert.equal(
      requestedUrl,
      'https://egybest-api.example/dls?url=https%3A%2F%2Fwww.egybest.org%2Fmovie%2Ftop-gun-maverick-2022&v=2',
    );
    assert.equal(authorization, 'Bearer test-token');
    assert.equal(sources.length, 1);
    assert.equal(sources[0].type, 'hls');
    assert.equal(sources[0].language, 'ar');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.EGYBEST_API_BASE_URL;
    else process.env.EGYBEST_API_BASE_URL = originalBase;
    if (originalToken === undefined) delete process.env.EGYBEST_ACCESS_TOKEN;
    else process.env.EGYBEST_ACCESS_TOKEN = originalToken;
  }
});

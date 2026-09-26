import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractUniversalCandidates } from './universal-resolver';

describe('universal resolver', () => {
  it('extracts direct media URLs from HTML', () => {
    const html = `
      <video>
        <source src="https://cdn.example.com/movie/1080p.m3u8?token=abc" type="application/x-mpegURL">
      </video>
    `;

    const result = extractUniversalCandidates(html, 'https://player.example.com/embed/1');

    assert.deepEqual(result.direct, [
      'https://cdn.example.com/movie/1080p.m3u8?token=abc',
    ]);
  });

  it('extracts iframe sources as embed fallbacks', () => {
    const html = '<iframe src="/embed/video-123"></iframe>';

    const result = extractUniversalCandidates(html, 'https://player.example.com/page');

    assert.deepEqual(result.embeds, [
      'https://player.example.com/embed/video-123',
    ]);
  });
});

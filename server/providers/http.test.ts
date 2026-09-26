import assert from 'node:assert/strict';
import test from 'node:test';
import {
  absoluteHttpsUrl,
  extractPlaybackCandidates,
  inferPlaybackType,
  materializeTemplate,
} from './http';

test('accepts only HTTPS source URLs', () => {
  assert.equal(absoluteHttpsUrl('https://cdn.example.com/master.m3u8'), 'https://cdn.example.com/master.m3u8');
  assert.equal(absoluteHttpsUrl('http://cdn.example.com/master.m3u8'), null);
});

test('infers only supported playback formats', () => {
  assert.equal(inferPlaybackType('https://cdn.example.com/master.m3u8'), 'hls');
  assert.equal(inferPlaybackType('https://cdn.example.com/video.mp4'), 'mp4');
  assert.equal(inferPlaybackType('https://cdn.example.com/manifest.mpd'), 'dash');
  assert.equal(inferPlaybackType('https://cdn.example.com/player'), null);
  assert.equal(inferPlaybackType('https://cdn.example.com/player', 'hls'), 'hls');
});

test('extracts nested source arrays used by provider APIs', () => {
  const result = extractPlaybackCandidates({
    success: true,
    directLink: [
      { label: '1080p', url: 'https://cdn.example.com/1080p.m3u8' },
      { label: '720p', url: 'https://cdn.example.com/720p.m3u8' },
    ],
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].quality, '1080p');
  assert.equal(result[0].label, '1080p');
});

test('materializes provider URL templates safely', () => {
  const url = materializeTemplate(
    'https://provider.example/tv/{{tmdbId}}?season={{season}}&episode={{episode}}',
    { tmdbId: 1399, season: 1, episode: 3 },
  );
  assert.equal(url, 'https://provider.example/tv/1399?season=1&episode=3');
});

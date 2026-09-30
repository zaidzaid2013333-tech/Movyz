import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRemoteResolverUrl } from './remote-resolver';

test('builds a remote resolver URL with the default query contract', () => {
  const url = buildRemoteResolverUrl(
    { type: 'series', tmdbId: 65733, season: 1, episode: 1, episodeTmdbId: 1234 },
    'https://resolver.example.com/resolve',
  );

  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://resolver.example.com');
  assert.equal(parsed.pathname, '/resolve');
  assert.equal(parsed.searchParams.get('type'), 'series');
  assert.equal(parsed.searchParams.get('tmdb_id'), '65733');
  assert.equal(parsed.searchParams.get('season'), '1');
  assert.equal(parsed.searchParams.get('episode'), '1');
  assert.equal(parsed.searchParams.get('episode_tmdb_id'), '1234');
});

test('supports path templates while keeping missing values in the query', () => {
  const url = buildRemoteResolverUrl(
    { type: 'movie', tmdbId: 550 },
    'https://resolver.example.com/{{type}}/{{tmdbId}}/resolve',
  );

  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/movie/550/resolve');
  assert.equal(parsed.searchParams.get('type'), null);
  assert.equal(parsed.searchParams.get('tmdb_id'), null);
});

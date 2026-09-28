// Production E2E test using a real, public Akwam content page as a deterministic fixture.
// A passing run still requires the resolver and Watch API to return real direct media.
const RESOLVER_BASE = (process.env.AKWAM_RESOLVER_BASE ||
  'https://movyz-akwam-resolver.sameranede.workers.dev').replace(/\/+$/, '');
const WATCH_BASE = (process.env.WATCH_API_BASE ||
  'https://movyz-moviebox.sameranede.workers.dev').replace(/\/+$/, '');
const fixture = {
  title: 'Inception',
  year: 2010,
  type: 'movie',
  tmdb_id: 27205,
  content_url: 'https://akwam.it/movie/562/inception-1',
  source_url: 'https://akwam.it/movie/562/inception-1',
};

function isHttp(value) {
  return typeof value === 'string' && /^https:\/\//i.test(value);
}

function isDirectMediaUrl(value) {
  if (!isHttp(value) || /\/(?:download|file)\//i.test(value)) return false;
  return /(?:\.(?:mp4|m3u8|mpd)(?:[?#]|$)|(?:mp4|m3u8|mpd)(?:[?#=&]|$))/i.test(value);
}

function streamType(url) {
  if (/m3u8/i.test(url)) return 'hls';
  if (/mpd/i.test(url)) return 'dash';
  return 'mp4';
}

async function fetchWithTimeout(url, init = {}, ms = 60_000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms), redirect: 'follow' });
}

async function jsonResponse(response, name) {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch {
    throw new Error(`${name} returned non-JSON HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}: ${text.slice(0, 1600)}`);
  return body;
}

async function validateMedia(url, expectedType) {
  if (!isDirectMediaUrl(url)) throw new Error(`media_url is not a direct MP4/M3U8/MPD URL: ${url}`);
  const response = await fetchWithTimeout(url, {
    headers: { Accept: '*/*', Range: 'bytes=0-1023' },
  }, 60_000);
  const finalUrl = response.url || url;
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  let sample = '';
  let byteLength = 0;

  if (expectedType === 'hls' || expectedType === 'dash' ||
      /mpegurl|dash\+xml|text\//i.test(contentType)) {
    sample = await response.text();
    byteLength = sample.length;
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    byteLength = bytes.byteLength;
    sample = new TextDecoder().decode(bytes.slice(0, 512));
  }

  console.log('AKWAM_MEDIA_CHECK', response.status, finalUrl, contentType, 'bytes=' + byteLength);
  if (!response.ok || response.status === 204) throw new Error(`media_url is unavailable: HTTP ${response.status} ${finalUrl}`);
  if (!isDirectMediaUrl(finalUrl)) throw new Error(`media_url redirected to a non-media page: ${finalUrl}`);
  if (/text\/html|application\/xhtml|text\/plain/.test(contentType) ||
      /<\s*!doctype html|<\s*html\b/i.test(sample.slice(0, 512))) {
    throw new Error(`media_url returned HTML rather than media: ${finalUrl}`);
  }
  if (expectedType !== streamType(finalUrl) && expectedType !== streamType(url)) {
    throw new Error(`media type mismatch: resolver=${expectedType}, URL=${finalUrl}`);
  }
}
let resolverResponse = await fetchWithTimeout(RESOLVER_BASE + '/resolve', {
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  body: JSON.stringify(fixture),
}, 120_000);
let resolved;
try {
  resolved = await jsonResponse(resolverResponse, 'Akwam resolver');
} catch (error) {
  throw error;
}
console.log('AKWAM_RESOLVER_RESPONSE', JSON.stringify(resolved));

if (!resolved?.ok || !isHttp(resolved.source_url) || !isDirectMediaUrl(resolved.media_url) ||
    !['mp4', 'hls', 'dash'].includes(resolved.type)) {
  throw new Error('Resolver did not return ok:true plus a real source_url, media_url, and supported type');
}
await validateSource(resolved.source_url);
await validateMedia(resolved.media_url, resolved.type);

const watchResponse = await fetchWithTimeout(WATCH_BASE + '/watch/movie', {
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  body: JSON.stringify(fixture),
}, 120_000);
const watched = await jsonResponse(watchResponse, 'Watch API');
console.log('AKWAM_WATCH_RESPONSE', JSON.stringify(watched));
if (!watched?.ok || !isHttp(watched.source_url) || !isDirectMediaUrl(watched.media_url) ||
    !['mp4', 'hls', 'dash'].includes(watched.media_type)) {
  throw new Error('Watch API did not return a direct Akwam media contract');
}
await validateSource(watched.source_url);
await validateMedia(watched.media_url, watched.media_type);
console.log('AKWAM_PLAYBACK_E2E=PASS');

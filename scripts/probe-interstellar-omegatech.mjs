const base = 'https://api.omegatech.app';

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${body.slice(0, 500)}`);
  try { return JSON.parse(body); } catch { throw new Error('Non-JSON response: ' + body.slice(0, 500)); }
}

const searchUrl = new URL('/api/movie/Akwam', base);
searchUrl.searchParams.set('action', 'search');
searchUrl.searchParams.set('query', 'Interstellar');
const search = await getJson(searchUrl);
console.log('SEARCH');
console.log(JSON.stringify(search, null, 2));

function urls(value, depth = 0) {
  if (depth > 8 || value == null) return [];
  if (typeof value === 'string') return (value.match(/https?:\\/\\/[^\\s"'<>\\\\]+/gi) || []).map(x => x.replace(/[),.;]+$/g, ''));
  if (Array.isArray(value)) return value.flatMap(x => urls(x, depth + 1));
  if (typeof value !== 'object') return [];
  return Object.values(value).flatMap(x => urls(x, depth + 1));
}

const all = [...new Set(urls(search))];
const pages = all.filter(u => /^https?:\\/\\//i.test(u) && !/\\.(?:mp4|m3u8|mpd)(?:$|[?#])/i.test(u));
console.log('SEARCH_URLS');
console.log(JSON.stringify(pages, null, 2));

if (!pages.length) throw new Error('No Interstellar content URL found');
const contentUrl = pages[0];
const contentEndpoint = new URL('/api/movie/Akwam', base);
contentEndpoint.searchParams.set('action', 'content');
contentEndpoint.searchParams.set('url', contentUrl);
const content = await getJson(contentEndpoint);
console.log('CONTENT_URL=' + contentUrl);
console.log('CONTENT');
console.log(JSON.stringify(content, null, 2));

const downloads = [...new Set(urls(content))];
console.log('CONTENT_MEDIA_URLS');
console.log(JSON.stringify(downloads, null, 2));

for (const download of downloads.filter(u => /(?:download|file|dl)/i.test(u)).slice(0, 6)) {
  const resolve = new URL('/api/movie/Akwam', base);
  resolve.searchParams.set('action', 'resolve');
  resolve.searchParams.set('download', download);
  try {
    const payload = await getJson(resolve);
    console.log('RESOLVE_INPUT=' + download);
    console.log(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.log('RESOLVE_FAILED=' + download + ' :: ' + (error instanceof Error ? error.message : String(error)));
  }
}

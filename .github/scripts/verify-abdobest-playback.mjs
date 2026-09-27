const ABDO_BASE = (process.env.ABDOBEST_API_BASE || 'https://ogkushhh-abdobest.hf.space').replace(/\/+$/, '');
const WATCH_BASE = (process.env.WATCH_API_BASE || 'https://movyz-moviebox.sameranede.workers.dev').replace(/\/+$/, '');
const MAIN_BASE = (process.env.MAIN_API_BASE || 'https://movyz-api.sameranede.workers.dev').replace(/\/+$/, '');

const MOVIE_ENDPOINTS = [
  '/api/sorted/movies',
  '/api/sorted/dubbed-movies',
  '/api/sorted/hindi',
  '/api/sorted/asian-movies',
  '/api/sorted/anime-movies',
  '/api/sorted/arabic-movies',
];

const timeout = (ms) => AbortSignal.timeout(ms);

async function getJson(base, path, ms = 60000) {
  const response = await fetch(base + path, {
    headers: { Accept: 'application/json' },
    redirect: 'follow',
    signal: timeout(ms),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { response, json, text };
}

function collectObjects(value, out = [], depth = 0) {
  if (depth > 6 || value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, out, depth + 1);
    return out;
  }
  if (typeof value !== 'object') return out;
  out.push(value);
  for (const item of Object.values(value)) collectObjects(item, out, depth + 1);
  return out;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function tmdbIdOf(item) {
  const value = Number(item?.['TMDb ID'] ?? item?.tmdb_id ?? item?.tmdbId ?? item?.themoviedb_id);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function titleOf(item) {
  return firstString(item?.Title, item?.title, item?.name, item?.original_title, item?.original_name);
}

function yearOf(item) {
  const raw = firstString(item?.Year, item?.year, item?.ReleaseDate, item?.release_date, item?.first_air_date);
  const m = raw.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : undefined;
}

function sourceUrlsOf(item) {
  const found = [];
  const seen = new Set();
  const isHttp = (value) => value.startsWith('http://') || value.startsWith('https://');
  const isUsefulKey = (key) => ['source', 'stream', 'video', 'player', 'watch', 'link', 'url', 'href'].some(part =>
    String(key || '').toLowerCase().includes(part)
  );

  const visit = (value, key = '', depth = 0) => {
    if (depth > 6 || value == null) return;

    if (typeof value === 'string') {
      const url = value.trim();
      if (!isHttp(url)) return;
      const lower = url.toLowerCase();
      const useful =
        lower.includes('player_token=') ||
        lower.includes('video_player') ||
        lower.includes('akwam.it/watch/') ||
        lower.includes('.m3u8') ||
        lower.includes('.mp4') ||
        isUsefulKey(key);
      if (!useful || seen.has(url)) return;
      seen.add(url);
      found.push(url);
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, key, depth + 1);
      return;
    }

    if (typeof value !== 'object') return;
    for (const [childKey, childValue] of Object.entries(value)) {
      visit(childValue, childKey, depth + 1);
    }
  };

  visit(item);

  return found.sort((a, b) => {
    const score = (url) => {
      const lower = url.toLowerCase();
      return (
        (lower.includes('player_token=') || lower.includes('video_player') ? 100 : 0) +
        (lower.includes('akwam.it/watch/') ? 80 : 0) +
        (lower.includes('.m3u8') ? 60 : 0) +
        (lower.includes('.mp4') ? 50 : 0)
      );
    };
    return score(b) - score(a);
  });
}

function candidatesFrom(payload) {
  const seen = new Set();
  const candidates = [];
  for (const item of collectObjects(payload)) {
    const tmdbId = tmdbIdOf(item);
    const title = titleOf(item);
    const sources = sourceUrlsOf(item);
    if (!title || !sources.length) continue;
    const key = [tmdbId || '', title, sources[0]].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      tmdbId,
      title,
      year: yearOf(item),
      sources,
    });
  }
  candidates.sort((a, b) => b.sources.length - a.sources.length);
  return candidates;
}

async function discoverCandidates() {
  const all = [];
  for (const endpoint of MOVIE_ENDPOINTS) {
    try {
      const result = await getJson(ABDO_BASE, endpoint);
      console.log('ABDO_DISCOVERY', endpoint, result.response.status);
      if (!result.response.ok || !result.json) continue;
      all.push(...candidatesFrom(result.json));
    } catch (error) {
      console.log('ABDO_DISCOVERY_ERROR', endpoint, error instanceof Error ? error.message : String(error));
    }
  }

  const seen = new Set();
  return all.filter((item) => {
    const key = [item.tmdbId || '', item.title].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
}

async function postWatch(candidate) {
  for (const sourceUrl of candidate.sources.slice(0, 6)) {
    try {
      const response = await fetch(WATCH_BASE + '/watch/movie', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tmdb_id: candidate.tmdbId,
          title: candidate.title,
          year: candidate.year,
          source_url: sourceUrl,
        }),
        redirect: 'follow',
        signal: timeout(120000),
      });
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      const streamUrl = json?.stream?.url || json?.stream?.sources?.[0]?.url;
      const streamType = String(json?.stream?.type || '').toLowerCase();
      if (response.ok && json?.ok && /^https:\/\//i.test(String(streamUrl || '')) &&
          ['hls', 'mp4', 'dash', 'webm'].includes(streamType)) {
        return { candidate, sourceUrl, response: json };
      }
      console.log('ABDO_PLAYBACK_TRY', candidate.title, response.status, streamType || 'none');
    } catch (error) {
      console.log('ABDO_PLAYBACK_ERROR', candidate.title, error instanceof Error ? error.message : String(error));
    }
  }
  return null;
}

const root = await getJson(WATCH_BASE, '/', 30000);
if (!root.response.ok || root.json?.api !== 'Movyz Watch API' || root.json?.provider !== 'AbdoBest') {
  throw new Error('Watch API identity check failed');
}

const health = await getJson(WATCH_BASE, '/health', 30000);
if (!health.response.ok || health.json?.provider !== 'AbdoBest') {
  throw new Error('AbdoBest Watch API health check failed');
}

const candidates = await discoverCandidates();
if (!candidates.length) {
  throw new Error('AbdoBest metadata did not expose any pre-scraped movie Sources');
}

let watchPass = null;
for (const candidate of candidates) {
  if (!candidate.tmdbId) continue;
  watchPass = await postWatch(candidate);
  if (watchPass) break;
}

if (!watchPass) {
  throw new Error('No AbdoBest pre-scraped movie source produced a direct playable stream');
}

console.log('WATCH_API_PLAYBACK=PASS');
console.log(JSON.stringify({
  tmdbId: watchPass.candidate.tmdbId,
  title: watchPass.candidate.title,
  streamType: watchPass.response?.stream?.type,
  streamHost: (() => {
    try { return new URL(watchPass.response.stream.url).host; } catch { return ''; }
  })(),
}));

const search = await getJson(
  MAIN_BASE,
  '/api/v1/search?q=' + encodeURIComponent(watchPass.candidate.title),
  60000,
);
if (!search.response.ok) {
  throw new Error('Main API search failed: HTTP ' + search.response.status);
}

const movieMatches = Array.isArray(search.json?.data?.movies) ? search.json.data.movies : [];
const mainMatch = movieMatches.find((movie) =>
  Number(movie?.tmdbId) === Number(watchPass.candidate.tmdbId)
) || movieMatches.find((movie) =>
  String(movie?.titleEn || movie?.title || '').trim().toLowerCase() === watchPass.candidate.title.trim().toLowerCase()
);

if (!mainMatch?.tmdbId) {
  throw new Error('Chosen AbdoBest fixture is not present in the Movyz catalog');
}

const mainWatch = await getJson(MAIN_BASE, '/api/v1/watch/movie/' + encodeURIComponent(mainMatch.tmdbId), 120000);
if (!mainWatch.response.ok) {
  throw new Error('Main API AbdoBest playback failed: HTTP ' + mainWatch.response.status + ' ' + JSON.stringify(mainWatch.json).slice(0, 1600));
}

const mainSources = Array.isArray(mainWatch.json?.data) ? mainWatch.json.data : [];
const mainSource = mainSources.find((item) =>
  String(item?.providerKey || '').toLowerCase() === 'abdobest' &&
  ['hls', 'mp4', 'dash', 'webm'].includes(String(item?.type || '').toLowerCase()) &&
  /^https:\/\//i.test(String(item?.url || ''))
);

if (!mainSource) {
  throw new Error('Main API returned no supported direct AbdoBest source');
}

console.log('MAIN_API_PLAYBACK=PASS');
console.log(JSON.stringify({
  tmdbId: mainMatch.tmdbId,
  title: mainMatch.titleEn || mainMatch.title,
  provider: mainSource.provider,
  type: mainSource.type,
  sourceHost: new URL(mainSource.url).host,
}));

console.log('ABDOBEST_PLAYBACK_E2E=PASS');

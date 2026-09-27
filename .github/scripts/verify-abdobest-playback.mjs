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
  const value = Number(item?.['TMDb ID'] ?? item?.tmdb_id ?? item?.tmdbId ?? item?.themoviedb_id ?? item?.tmdb ?? 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function titleOf(item) {
  return firstString(
    item?.Title,
    item?.title,
    item?.TitleAr,
    item?.title_ar,
    item?.name,
    item?.name_ar,
    item?.original_title,
    item?.original_name,
  );
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
    if (!title) continue;
    const key = [tmdbId || '', title, sources[0] || ''].join('|');
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
  const searchSeeds = [];
  const seedSeen = new Set();

  for (const endpoint of MOVIE_ENDPOINTS) {
    try {
      const result = await getJson(ABDO_BASE, endpoint);
      console.log('ABDO_DISCOVERY', endpoint, result.response.status);
      if (!result.response.ok || !result.json) continue;

      all.push(...candidatesFrom(result.json));

      for (const item of collectObjects(result.json)) {
        const title = titleOf(item);
        if (!title) continue;
        const key = title.toLowerCase();
        if (seedSeen.has(key)) continue;
        seedSeen.add(key);
        searchSeeds.push({
          title,
          tmdbId: tmdbIdOf(item),
          year: yearOf(item),
        });
        if (searchSeeds.length >= 20) break;
      }
      if (searchSeeds.length >= 20) break;
    } catch (error) {
      console.log('ABDO_DISCOVERY_ERROR', endpoint, error instanceof Error ? error.message : String(error));
    }
  }

  if (!all.length) {
    console.log('ABDO_SEARCH_FALLBACK_START', searchSeeds.length);
  }

  for (const seed of searchSeeds.slice(0, 20)) {
    try {
      const result = await getJson(ABDO_BASE, '/api/search?q=' + encodeURIComponent(seed.title), 30000);
      if (!result.response.ok || !result.json) continue;
      all.push(...candidatesFrom(result.json));
    } catch (error) {
      console.log('ABDO_SEARCH_FALLBACK_ERROR', seed.title, error instanceof Error ? error.message : String(error));
    }
    if (all.length >= 30) break;
  }

  const seen = new Set();
  return all.filter((item) => {
    const key = [item.tmdbId || '', item.title].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
}

function catalogQueryTitle(title) {
  return String(title || '')
    .replace(/^\s*(فيلم|مسلسل)\s*/u, '')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b(?:مترجم|مدبلج)\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titlesCompatible(a, b) {
  const left = catalogQueryTitle(a).toLowerCase();
  const right = catalogQueryTitle(b).toLowerCase();
  return Boolean(left && right && (
    left === right ||
    left.includes(right) ||
    right.includes(left)
  ));
}

async function findCatalogFixture(candidates) {
  for (const candidate of candidates.slice(0, 12)) {
    const queryTitle = catalogQueryTitle(candidate.title);
    if (!queryTitle) continue;

    try {
      const search = await getJson(
        MAIN_BASE,
        '/api/v1/search?q=' + encodeURIComponent(queryTitle),
        60000,
      );
      if (!search.response.ok) continue;

      const movies = Array.isArray(search.json?.data?.movies)
        ? search.json.data.movies
        : [];

      const match = movies.find((movie) =>
        titlesCompatible(
          candidate.title,
          String(movie?.titleEn || movie?.title || movie?.originalTitle || ''),
        )
      );

      if (match?.tmdbId) {
        return { candidate, mainMatch: match };
      }
    } catch (error) {
      console.log(
        'MAIN_CATALOG_SEARCH_ERROR',
        candidate.title,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return null;
}

async function postWatch(candidate) {
  const attempts = [undefined, ...candidate.sources.slice(0, 6)];
  for (const sourceUrl of attempts) {
    try {
      const body = {
        tmdb_id: candidate.tmdbId,
        title: candidate.title,
        year: candidate.year,
      };
      if (sourceUrl) body.source_url = sourceUrl;

      const response = await fetch(WATCH_BASE + '/watch/movie', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: timeout(120000),
      });
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      const streamUrl = json?.stream?.url || json?.stream?.sources?.[0]?.url;
      const streamType = String(json?.stream?.type || '').toLowerCase();
      if (response.ok && json?.ok && /^https:\/\//i.test(String(streamUrl || '')) &&
          ['hls', 'mp4', 'dash', 'webm', 'web'].includes(streamType)) {
        return { candidate, sourceUrl, response: json };
      }
      console.log('ABDO_PLAYBACK_TRY', candidate.title, sourceUrl ? 'source' : 'auto', response.status, streamType || 'none');
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
  throw new Error('AbdoBest metadata did not expose usable movie candidates');
}

console.log('ABDO_CANDIDATES', JSON.stringify(candidates.slice(0, 8).map((candidate) => ({
  title: candidate.title,
  tmdbId: candidate.tmdbId,
  sourceCount: candidate.sources.length,
  sourceHosts: candidate.sources.slice(0, 3).map((url) => {
    try { return new URL(url).host; } catch { return ''; }
  }),
}))));

const fixture = await findCatalogFixture(candidates);
if (!fixture) {
  throw new Error('No AbdoBest candidate is currently present in the Movyz movie catalog');
}

console.log('MOVYZ_FIXTURE_SELECTED', JSON.stringify({
  abdoTitle: fixture.candidate.title,
  tmdbId: fixture.mainMatch.tmdbId,
  movyzTitle: fixture.mainMatch.titleEn || fixture.mainMatch.title,
}));

const watchPass = await postWatch(fixture.candidate);
if (!watchPass) {
  throw new Error('AbdoBest did not return a playable direct stream or source page for the selected Movyz fixture');
}

const watchMode = String(watchPass.response?.stream?.type || '').toLowerCase() === 'web'
  ? 'source-page'
  : 'direct-stream';

console.log(watchMode === 'direct-stream'
  ? 'WATCH_API_DIRECT_STREAM=PASS'
  : 'WATCH_API_SOURCE_PAGE=PASS');

console.log(JSON.stringify({
  tmdbId: fixture.mainMatch.tmdbId,
  title: fixture.mainMatch.titleEn || fixture.mainMatch.title,
  streamType: watchPass.response?.stream?.type,
  streamHost: (() => {
    try { return new URL(watchPass.response.stream.url).host; } catch { return ''; }
  })(),
}));

const mainWatch = await getJson(
  MAIN_BASE,
  '/api/v1/watch/movie/' + encodeURIComponent(fixture.mainMatch.tmdbId),
  120000,
);
if (!mainWatch.response.ok) {
  throw new Error(
    'Main API AbdoBest playback failed: HTTP ' +
    mainWatch.response.status +
    ' ' +
    JSON.stringify(mainWatch.json).slice(0, 1600),
  );
}

const mainSources = Array.isArray(mainWatch.json?.data) ? mainWatch.json.data : [];
const mainSource = mainSources.find((item) =>
  String(item?.providerKey || '').toLowerCase() === 'abdobest' &&
  ['hls', 'mp4', 'dash', 'webm', 'web'].includes(String(item?.type || '').toLowerCase()) &&
  /^https:\/\//i.test(String(item?.url || ''))
);

if (!mainSource) {
  throw new Error('Main API returned no supported AbdoBest playback source');
}

console.log(String(mainSource.type || '').toLowerCase() === 'web'
  ? 'MAIN_API_SOURCE_PAGE=PASS'
  : 'MAIN_API_DIRECT_STREAM=PASS');

console.log(JSON.stringify({
  tmdbId: fixture.mainMatch.tmdbId,
  title: fixture.mainMatch.titleEn || fixture.mainMatch.title,
  provider: mainSource.provider,
  type: mainSource.type,
  sourceHost: new URL(mainSource.url).host,
}));


console.log('ABDOBEST_PLAYBACK_E2E=PASS');

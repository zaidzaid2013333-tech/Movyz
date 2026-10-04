const TMDB_READ_TOKEN = globalThis.TMDB_READ_TOKEN_PLACEHOLDER ?? '';

const BINGR_SITE_URL = 'https://bingr.one';
const BINGR_API_URL = 'https://api.bingr.one/api';
const BINGR_SERVERS = ['s11', 's30', 's3', 's4'];

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function proxyUrl(origin, target, headers = {}) {
  return `${origin}/v1/proxy?data=${encodeURIComponent(JSON.stringify({ url: target, headers }))}`;
}

async function tmdb(type, id, env) {
  const url = `https://api.themoviedb.org/3/${type}/${encodeURIComponent(id)}?language=en-US`;
  const headers = env.TMDB_API_READ_ACCESS_TOKEN
    ? { Authorization: `Bearer ${env.TMDB_API_READ_ACCESS_TOKEN}` }
    : env.TMDB_API_KEY
      ? {}
      : {};

  const queryUrl = env.TMDB_API_READ_ACCESS_TOKEN ? url : `${url}&api_key=${encodeURIComponent(env.TMDB_API_KEY || '')}`;
  const response = await fetch(queryUrl, { headers });
  if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`);
  return response.json();
}

async function bingrStream(type, tmdbId, meta, season, episode, server, signal, queryOverride) {
  const query = queryOverride || {
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.year ? { year: meta.year } : {}),
    ...(type === 'tv' ? { season: String(season), episode: String(episode) } : {}),
  };

  const response = await fetch(`${BINGR_API_URL}/stream`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      Origin: BINGR_SITE_URL,
      Referer: `${BINGR_SITE_URL}/`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      srv: server,
      t: type,
      id: String(tmdbId),
      query,
    }),
    signal,
  });

  if (!response.ok) {
    return { sources: [], diagnostic: `Bingr/${server}: HTTP ${response.status}` };
  }

  const payload = await response.json();
  const raw = Array.isArray(payload?.sources) ? payload.sources : [];
  const sources = raw
    .filter((source) => typeof source?.url === 'string' && /^https?:\/\//i.test(source.url))
    .map((source) => ({
      url: source.url,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: BINGR_SITE_URL,
        Referer: `${BINGR_SITE_URL}/`,
        ...(source.headers || {}),
      },
      quality: source.quality || source.label || 'Auto',
      type: /\.mpd(?:$|\?)/i.test(source.url) ? 'dash' : /\.mp4(?:$|\?)/i.test(source.url) ? 'mp4' : 'hls',
      provider: `Bingr/${payload.scraperName || server}`,
    }));

  return { sources, diagnostic: raw.length && !sources.length ? `Bingr/${server}: unusable stream URLs` : undefined };
}

function rewriteManifest(text, upstreamUrl, headers, origin) {
  const lines = text.split(/\r?\n/);
  return lines.map((line) => {
    const uriAttr = line.match(/URI="([^"]+)"/i);
    if (uriAttr) {
      const resolved = new URL(uriAttr[1], upstreamUrl).toString();
      const proxied = proxyUrl(origin, resolved, headers);
      return line.replace(uriAttr[1], proxied);
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    try {
      const resolved = new URL(trimmed, upstreamUrl).toString();
      return proxyUrl(origin, resolved, headers);
    } catch {
      return line;
    }
  }).join('\n');
}


async function probePlayableSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const headers = new Headers(source.headers || {});
    headers.set('Range', 'bytes=0-2047');
    const response = await fetch(source.url, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!(response.status === 200 || response.status === 206)) return false;

    const isHls =
      source.type === 'hls' ||
      /mpegurl|m3u8|vnd\\.apple\\.mpegurl/i.test(response.headers.get('content-type') || '') ||
      /\\.m3u8(?:$|\\?)/i.test(source.url);

    if (isHls) {
      const reader = response.body?.getReader();
      if (!reader) return false;
      const first = await reader.read();
      try { await reader.cancel(); } catch {}
      const text = new TextDecoder().decode(first.value || new Uint8Array());
      return text.includes('#EXTM3U');
    }

    return true;
  } catch {
    return false;
  }
}

async function handleProxy(request) {
  const requestUrl = new URL(request.url);
  const data = requestUrl.searchParams.get('data');
  if (!data) return json({ error: 'MISSING_PARAMETER', message: 'Missing data parameter' }, 400);

  let parsed;
  try {
    parsed = JSON.parse(decodeURIComponent(data));
  } catch {
    return json({ error: 'INVALID_PARAMETER', message: 'Invalid data parameter' }, 400);
  }

  if (!parsed?.url) return json({ error: 'INVALID_PARAMETER', message: 'Missing url' }, 400);

  const headers = new Headers(parsed.headers || {});
  const range = request.headers.get('range');
  if (range) headers.set('Range', range);

  const upstream = await fetch(parsed.url, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
    redirect: 'follow',
  });

  const contentType = upstream.headers.get('content-type') || '';
  const isManifest =
    /mpegurl|m3u8|vnd\.apple\.mpegurl/i.test(contentType) ||
    /\.m3u8(?:$|\?)/i.test(parsed.url);

  if (isManifest && request.method !== 'HEAD') {
    const text = await upstream.text();
    if (text.trimStart().startsWith('#EXTM3U')) {
      const rewritten = rewriteManifest(text, parsed.url, Object.fromEntries(headers.entries()), requestUrl.origin);
      const outHeaders = new Headers(JSON_HEADERS);
      outHeaders.set('content-type', contentType || 'application/vnd.apple.mpegurl');
      outHeaders.set('cache-control', 'no-store');
      return new Response(rewritten, { status: upstream.status, headers: outHeaders });
    }
  }

  const outHeaders = new Headers();
  outHeaders.set('access-control-allow-origin', '*');
  outHeaders.set('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified');
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control']) {
    const value = upstream.headers.get(key);
    if (value) outHeaders.set(key, value);
  }

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

async function bingrStreamWithRetry(type, tmdbId, meta, season, episode, server) {
  const queryVariants = [
    {
      ...(meta.title ? { title: meta.title } : {}),
      ...(meta.year ? { year: meta.year } : {}),
      ...(type === 'tv' ? { season: String(season), episode: String(episode) } : {}),
    },
    {
      ...(meta.title ? { title: meta.title } : {}),
      ...(type === 'tv' ? { season: String(season), episode: String(episode) } : {}),
    },
  ];

  const diagnostics = [];
  for (let attempt = 0; attempt < queryVariants.length; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const result = await bingrStream(
        type,
        tmdbId,
        meta,
        season,
        episode,
        server,
        controller.signal,
        queryVariants[attempt],
      );
      if (result.sources.length) return result;
      if (result.diagnostic) diagnostics.push(result.diagnostic);
    } catch (error) {
      diagnostics.push(
        'Bingr/' + server + ': ' + (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      clearTimeout(timeout);
    }

    if (attempt + 1 < queryVariants.length) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  return {
    sources: [],
    diagnostic: diagnostics.join(' | ') || ('Bingr/' + server + ': no sources'),
  };
}

async function sourcesFor(type, id, season, episode, requestUrl, env) {
  const media = await tmdb(type === 'movie' ? 'movie' : 'tv', id, env);
  const meta = {
    title: type === 'movie' ? media.title : media.name,
    year: type === 'movie'
      ? String(media.release_date || '').slice(0, 4)
      : String(media.first_air_date || '').slice(0, 4),
  };

  try {
    const results = await Promise.all(
      BINGR_SERVERS.map((server) =>
        bingrStreamWithRetry(type, id, meta, season, episode, server),
      ),
    );

    const diagnostics = results.filter((r) => r.diagnostic).map((r) => ({
      code: 'PROVIDER_ERROR',
      message: r.diagnostic,
      field: '',
      severity: 'warning',
    }));

    const rawSources = [];
    const seen = new Set();
    for (const result of results) {
      for (const source of result.sources) {
        if (seen.has(source.url)) continue;
        seen.add(source.url);
        rawSources.push(source);
      }
    }

    // Prefer sources whose upstream playlist/file is reachable from the Worker.
    // Probe a small representative set so we stay well below Worker subrequest limits.
    const byProvider = new Map();
    for (const source of rawSources) {
      if (!byProvider.has(source.provider)) byProvider.set(source.provider, []);
      const list = byProvider.get(source.provider);
      if (list.length < 2) list.push(source);
    }
    const probeCandidates = [...byProvider.values()].flat();

    const probeResults = await Promise.all(
      probeCandidates.map(async (source) => [source, await probePlayableSource(source)]),
    );
    const playableUrls = new Set(
      probeResults.filter(([, ok]) => ok).map(([source]) => source.url),
    );

    const ranked = [
      ...rawSources.filter((source) => playableUrls.has(source.url)),
      ...rawSources.filter((source) => !playableUrls.has(source.url)),
    ];

    const sources = ranked.map((source) => ({
      id: crypto.randomUUID(),
      url: proxyUrl(requestUrl.origin, source.url, source.headers),
      streamable: true,
      type: source.type,
      quality: source.quality,
      provider: { id: 'bingr', name: source.provider },
      audioTracks: [],
    }));

    return {
      id: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      sources,
      subtitles: [],
      diagnostics: diagnostics.length ? diagnostics : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,HEAD,OPTIONS',
          'access-control-allow-headers': 'Content-Type, Authorization, Range, Accept',
        },
      });
    }

    if (url.pathname === '/' || url.pathname === '/v1' || url.pathname === '/v1/' || url.pathname === '/v1/health') {
      return json({
        name: 'Movyz Media Core',
        version: '1.0.0',
        status: 'ok',
        providers: [{ id: 'bingr', name: 'Bingr', capabilities: ['movies', 'tv'] }],
      });
    }

    try {
      if (url.pathname === '/v1/proxy') return await handleProxy(request);

      const movie = url.pathname.match(/^\/v1\/movies\/([^/]+)$/);
      if (movie) return json(await sourcesFor('movie', decodeURIComponent(movie[1]), undefined, undefined, url, env));

      const episode = url.pathname.match(/^\/v1\/tv\/([^/]+)\/seasons\/(\d+)\/episodes\/(\d+)$/);
      if (episode) {
        return json(
          await sourcesFor(
            'tv',
            decodeURIComponent(episode[1]),
            Number(episode[2]),
            Number(episode[3]),
            url,
            env,
          ),
        );
      }

      return json({ error: 'ENDPOINT_NOT_FOUND' }, 404);
    } catch (error) {
      console.error(error);
      return json({
        error: {
          code: 'MEDIA_CORE_RUNTIME_ERROR',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      }, 500);
    }
  },
};

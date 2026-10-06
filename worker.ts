type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

type MovyzEnvironment = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  TMDB_API_READ_ACCESS_TOKEN?: string;
  MOVYZ_BUILD_ID?: string;
  OPENSUBTITLES_API_KEY?: string;
  OPENSUBTITLES_TOKEN?: string;
};

const tmdbHeaders = (env: MovyzEnvironment) => ({
  Authorization: `Bearer ${env.TMDB_API_READ_ACCESS_TOKEN || ''}`,
  Accept: 'application/json',
});

const proxyTmdb = async (request: Request, env: MovyzEnvironment) => {
  if (!env.TMDB_API_READ_ACCESS_TOKEN) {
    return new Response(JSON.stringify({ status_message: 'TMDB token is not configured' }), {
      status: 503, headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const url = new URL(request.url);
  const suffix = url.pathname.slice('/tmdb'.length).replace(/^\/+/, '');
  if (!suffix || suffix.includes('..')) {
    return new Response('Bad TMDB path', { status: 400 });
  }
  const target = new URL(`https://api.themoviedb.org/3/${suffix}`);
  url.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers: tmdbHeaders(env),
  });
  const headers = new Headers(upstream.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  return new Response(upstream.body, { status: upstream.status, headers });
};


const subtitleHeaders = (env: MovyzEnvironment) => ({
  'Api-Key': env.OPENSUBTITLES_API_KEY || '',
  Authorization: env.OPENSUBTITLES_TOKEN ? `Bearer ${env.OPENSUBTITLES_TOKEN}` : '',
  'User-Agent': 'Movyz/1.0 subtitle service',
  Accept: 'application/json',
});

const noSubtitle = (status = 404, message = 'Arabic subtitle is not available') =>
  new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    },
  });

const proxyArabicSubtitle = async (request: Request, env: MovyzEnvironment) => {
  if (!env.OPENSUBTITLES_API_KEY || !env.OPENSUBTITLES_TOKEN) {
    return noSubtitle(404, 'Arabic subtitle backend is not configured');
  }

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'subtitle') return noSubtitle(400, 'Bad subtitle path');

  const kind = parts[1];
  const isMovie = kind === 'movie';
  const isTv = kind === 'tv';
  if (!isMovie && !isTv) return noSubtitle(400, 'Unsupported subtitle type');

  let tmdbId = '';
  let season = '';
  let episode = '';

  if (isMovie) {
    tmdbId = parts[2].replace(/\.srt$/i, '');
  } else {
    tmdbId = parts[2] || '';
    season = parts[3] || '';
    episode = (parts[4] || '').replace(/\.srt$/i, '');
  }

  if (!/^\d+$/.test(tmdbId) || (isTv && (!/^\d+$/.test(season) || !/^\d+$/.test(episode)))) {
    return noSubtitle(400, 'Bad subtitle identifier');
  }

  const params = new URLSearchParams();
  params.set('languages', 'ar');
  params.set('order_by', 'download_count');
  params.set('order_direction', 'desc');
  if (isMovie) {
    params.set('tmdb_id', tmdbId);
    params.set('type', 'movie');
  } else {
    params.set('parent_tmdb_id', tmdbId);
    params.set('season_number', season);
    params.set('episode_number', episode);
    params.set('type', 'episode');
  }

  const searchResponse = await fetch('https://api.opensubtitles.com/api/v1/subtitles?' + params.toString(), {
    method: 'GET',
    headers: subtitleHeaders(env),
  });
  if (!searchResponse.ok) {
    return noSubtitle(502, 'Subtitle provider search failed');
  }

  const search = await searchResponse.json() as {
    data?: Array<{
      attributes?: {
        language?: string;
        files?: Array<{
          file_id?: number;
          file_name?: string;
          fps?: number;
        }>;
      };
    }>;
  };

  const candidates = (search.data || []).flatMap((entry) => {
    const attrs = entry.attributes || {};
    const language = String(attrs.language || '').toLowerCase();
    if (language !== 'ar' && language !== 'ara') return [];
    return (attrs.files || [])
      .filter((file) => Number.isFinite(Number(file.file_id)))
      .map((file) => ({
        fileId: Number(file.file_id),
        fileName: String(file.file_name || ''),
        fps: Number(file.fps || 0),
      }));
  });

  const candidate = candidates[0];
  if (!candidate) return noSubtitle();

  const downloadResponse = await fetch('https://api.opensubtitles.com/api/v1/download', {
    method: 'POST',
    headers: {
      ...subtitleHeaders(env),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file_id: candidate.fileId,
      sub_format: 'srt',
      force_download: false,
    }),
  });

  if (!downloadResponse.ok) {
    return noSubtitle(502, 'Subtitle provider download failed');
  }

  const download = await downloadResponse.json() as { link?: string };
  if (!download.link || !/^https:\\/\\/([^/]+\\.)*opensubtitles\\.com\\//i.test(download.link)) {
    return noSubtitle(502, 'Invalid subtitle download URL');
  }

  const subtitleResponse = await fetch(download.link, {
    headers: { 'User-Agent': 'Movyz/1.0 subtitle service' },
  });
  if (!subtitleResponse.ok) return noSubtitle(502, 'Subtitle file fetch failed');

  const headers = new Headers();
  headers.set('content-type', 'application/x-subrip; charset=utf-8');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  headers.set('Cache-Control', 'public, max-age=3600');
  headers.set('X-Movyza-Subtitle', 'opensubtitles-ar');

  return new Response(subtitleResponse.body, { status: 200, headers });
};


const noCache = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

export default {
  async fetch(request: Request, env: MovyzEnvironment, _ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      }});
    }
    if (url.pathname === '/tmdb' || url.pathname.startsWith('/tmdb/')) {
      return proxyTmdb(request, env);
    }
    if (request.method === 'GET' && (url.pathname.startsWith('/subtitle/movie/') || url.pathname.startsWith('/subtitle/tv/'))) {
      return proxyArabicSubtitle(request, env);
    }
    const html = request.method === 'GET' && (url.pathname === '/' || !url.pathname.includes('.'));
    if (html) {
      const freshUrl = new URL(request.url);
      freshUrl.searchParams.set('__movyz_asset_version', env.MOVYZ_BUILD_ID || 'dev');
      const freshRequest = new Request(freshUrl.toString(), request);
      return noCache(await env.ASSETS.fetch(freshRequest));
    }
    return await env.ASSETS.fetch(request);
  },
};

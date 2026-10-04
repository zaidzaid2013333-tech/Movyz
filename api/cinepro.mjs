import { OMSSServer } from '@omss/framework';

import { MovieDownloader } from '@cinepro/core/src/providers/02moviedownloader/02moviedownloader.js';
import { AnyEmbed } from '@cinepro/core/src/providers/anyembed/anyembed.js';
import { CineSuProvider } from '@cinepro/core/src/providers/cinesu/cinesu.js';
import { Fmovies4U } from '@cinepro/core/src/providers/fmovies4u/fmovies4u.js';
import { FsharetvProvider } from '@cinepro/core/src/providers/fshare/fshare.js';
import { IcefyProvider } from '@cinepro/core/src/providers/icefy/icefy.js';
import { PeachifyProvider } from '@cinepro/core/src/providers/peachify/peachify.js';
import { PoprProvider } from '@cinepro/core/src/providers/popr/popr.js';
import { StreamMafiaProvider } from '@cinepro/core/src/providers/streammafia/streammafia.js';
import { TulnexProvider } from '@cinepro/core/src/providers/tulnex/tulnex.js';
import { VidApiProvider } from '@cinepro/core/src/providers/vidapi/vidapi.js';
import { VideasyProvider } from '@cinepro/core/src/providers/videasy/videasy.js';
import { VidNestProvider } from '@cinepro/core/src/providers/vidnest/vidnest.js';
import { VidRockProvider } from '@cinepro/core/src/providers/vidrock/vidrock.js';
import { VidSrcProvider } from '@cinepro/core/src/providers/vidsrc/vidsrc.js';
import { VidZeeProvider } from '@cinepro/core/src/providers/vidzee/vidzee.js';
import { VixSrcProvider } from '@cinepro/core/src/providers/vixsrc/vixsrc.js';
import { knownThirdPartyProxies } from '@cinepro/core/src/thirdPartyProxies.js';
import { streamPatterns } from '@cinepro/core/src/streamPatterns.js';

const PUBLIC_URL = 'https://movyz.vercel.app/api/cinepro';

const providers = [
  MovieDownloader, AnyEmbed, CineSuProvider, Fmovies4U, FsharetvProvider,
  IcefyProvider, PeachifyProvider, PoprProvider, StreamMafiaProvider, TulnexProvider,
  VidApiProvider, VideasyProvider, VidNestProvider, VidRockProvider, VidSrcProvider,
  VidZeeProvider, VixSrcProvider,
];

let activeToken = '';
let appPromise = null;

async function tmdbRequest(token, path) {
  const response = await fetch('https://api.themoviedb.org/3' + path, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'User-Agent': 'Movyz-CinePro-Vercel/1.0',
    },
  });
  if (!response.ok) throw new Error('TMDB request failed (' + response.status + ')');
  return response.json();
}

async function createApp(token) {
  const cinepro = new OMSSServer({
    name: 'Movyz CinePro',
    version: '1.0.0',
    host: '127.0.0.1',
    port: 8787,
    publicUrl: PUBLIC_URL,
    cache: { type: 'memory', ttl: { sources: 60 * 60, subtitles: 60 * 60 * 24 } },
    tmdb: { apiKey: token, cacheTTL: 24 * 60 * 60 },
    proxyConfig: { knownThirdPartyProxies, streamPatterns },
    cors: {
      origin: '*',
      methods: ['GET', 'OPTIONS', 'HEAD'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept'],
      exposedHeaders: ['Content-Length', 'Content-Type', 'Content-Range', 'Accept-Ranges', 'ETag'],
      credentials: false,
    },
    stremio: { enableNativeAddon: false, stremioAddons: [] },
    mcp: { enabled: false },
  });

  const tmdbService = cinepro['tmdbService'];
  const tmdbJson = (path) => tmdbRequest(token, path);

  tmdbService.validateMovie = async (id) => {
    const movie = await tmdbJson('/movie/' + encodeURIComponent(id));
    const date = new Date(movie.release_date);
    return { exists: true, released: date <= new Date() && movie.status === 'Released', releaseDate: movie.release_date || '', title: movie.title || '' };
  };

  tmdbService.validateTV = async (id) => {
    const tv = await tmdbJson('/tv/' + encodeURIComponent(id));
    const date = new Date(tv.first_air_date);
    return { exists: true, released: date <= new Date(), releaseDate: tv.first_air_date || '', title: tv.name || '' };
  };

  tmdbService.validateTVEpisode = async (id, season, episode) => {
    const tv = await tmdbService.validateTV(id);
    if (!tv.exists || !tv.released) return tv;
    const seasonData = await tmdbJson('/tv/' + encodeURIComponent(id) + '/season/' + season);
    const ep = Array.isArray(seasonData.episodes)
      ? seasonData.episodes.find((entry) => Number(entry.episode_number) === episode)
      : undefined;
    if (!ep) return { exists: false, released: false };
    const date = ep.air_date ? new Date(ep.air_date) : null;
    return { exists: true, released: !!date && date <= new Date(), releaseDate: ep.air_date || '', title: ep.name || '' };
  };

  tmdbService.getImdbId = async (id, type) => {
    try {
      const endpoint = type === 'movie' ? 'movie' : 'tv';
      const data = await tmdbJson('/' + endpoint + '/' + encodeURIComponent(id) + '/external_ids');
      return data.imdb_id || undefined;
    } catch {
      return undefined;
    }
  };

  const registry = cinepro.getRegistry();
  for (const Provider of providers) registry.register(new Provider());

  const app = cinepro.getInstance();
  await app.ready();
  return app;
}

async function getApp(token) {
  const effectiveToken = token || 'proxy-runtime';
  if (!appPromise || activeToken !== effectiveToken) {
    activeToken = effectiveToken;
    appPromise = createApp(effectiveToken);
  }
  return appPromise;
}

export default async function handler(req, res) {
  const originalUrl = req.url || '/';
  const prefix = '/api/cinepro';
  const strippedUrl = originalUrl.startsWith(prefix)
    ? originalUrl.slice(prefix.length) || '/'
    : originalUrl;

  const needsToken = /^\/v1\/(movies|tv)\//.test(strippedUrl);
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';

  if (needsToken && !token) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Missing TMDB Bearer token' }));
    return;
  }

  try {
    req.url = strippedUrl;
    const app = await getApp(token);
    app.routing(req, res);
  } catch (error) {
    console.error('[Movyz CinePro Vercel]', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: {
          code: 'CINEPRO_VERCEL_RUNTIME_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  } finally {
    req.url = originalUrl;
  }
}


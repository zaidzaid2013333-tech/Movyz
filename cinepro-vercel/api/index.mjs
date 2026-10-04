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

const PUBLIC_URL =
  process.env.PUBLIC_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

const providers = [
  MovieDownloader,
  AnyEmbed,
  CineSuProvider,
  Fmovies4U,
  FsharetvProvider,
  IcefyProvider,
  PeachifyProvider,
  PoprProvider,
  StreamMafiaProvider,
  TulnexProvider,
  VidApiProvider,
  VideasyProvider,
  VidNestProvider,
  VidRockProvider,
  VidSrcProvider,
  VidZeeProvider,
  VixSrcProvider,
];

let activeToken = '';
let appPromise = null;

async function tmdbRequest(token, path) {
  const response = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'Movyz-CinePro-Vercel/1.0',
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TMDB request failed (${response.status}): ${body.slice(0, 500)}`);
  }
  return response.json();
}

async function createApp(token) {
  const cinepro = new OMSSServer({
    name: 'Movyz CinePro',
    version: '1.0.0',
    host: '127.0.0.1',
    port: 8787,
    publicUrl: PUBLIC_URL,
    cache: {
      type: 'memory',
      ttl: { sources: 60 * 60, subtitles: 60 * 60 * 24 },
    },
    tmdb: { apiKey: token, cacheTTL: 24 * 60 * 60 },
    proxyConfig: { knownThirdPartyProxies, streamPatterns },
    cors: {
      origin: '*',
      methods: ['GET', 'OPTIONS', 'HEAD'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept'],
      exposedHeaders: ['Content-Length', 'Content-Type', 'Content-Range', 'Accept-Ranges', 'ETag'],
      credentials: false,
    },
    stremio: { enableNativeAddon: true, stremioAddons: [] },
    mcp: { enabled: false },
  });

  const tmdbService = cinepro.tmdbService || cinepro['tmdbService'];
  const tmdbJson = (path) => tmdbRequest(token, path);

  tmdbService.validateMovie = async (tmdbId) => {
    const movie = await tmdbJson(`/movie/${encodeURIComponent(tmdbId)}`);
    const releaseDate = new Date(movie.release_date);
    return {
      exists: true,
      released: releaseDate <= new Date() && movie.status === 'Released',
      releaseDate: movie.release_date || '',
      title: movie.title || '',
    };
  };

  tmdbService.validateTV = async (tmdbId) => {
    const tv = await tmdbJson(`/tv/${encodeURIComponent(tmdbId)}`);
    const firstAirDate = new Date(tv.first_air_date);
    return {
      exists: true,
      released: firstAirDate <= new Date(),
      releaseDate: tv.first_air_date || '',
      title: tv.name || '',
    };
  };

  tmdbService.validateTVEpisode = async (tmdbId, season, episode) => {
    const tv = await tmdbService.validateTV(tmdbId);
    if (!tv.exists || !tv.released) return tv;
    const seasonData = await tmdbJson(
      `/tv/${encodeURIComponent(tmdbId)}/season/${season}`,
    );
    const episodeData = Array.isArray(seasonData.episodes)
      ? seasonData.episodes.find((entry) => Number(entry.episode_number) === episode)
      : undefined;

    if (!episodeData) {
      return { exists: false, released: false, message: 'Episode does not exist' };
    }

    const airDate = episodeData.air_date ? new Date(episodeData.air_date) : null;
    return {
      exists: true,
      released: !!airDate && airDate <= new Date(),
      releaseDate: episodeData.air_date || '',
      title: episodeData.name || '',
    };
  };

  tmdbService.getImdbId = async (tmdbId, type) => {
    try {
      const endpoint = type === 'movie' ? 'movie' : 'tv';
      const data = await tmdbJson(
        `/${endpoint}/${encodeURIComponent(tmdbId)}/external_ids`,
      );
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
  if (!appPromise || activeToken !== token) {
    activeToken = token;
    appPromise = createApp(token);
  }
  return appPromise;
}

export default async function handler(req, res) {
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';

  if (!token) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Missing TMDB Bearer token' }));
    return;
  }

  try {
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
  }
}

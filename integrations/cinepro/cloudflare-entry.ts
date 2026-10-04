import { OMSSServer } from '@omss/framework';
import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { knownThirdPartyProxies } from './src/thirdPartyProxies';
import { streamPatterns } from './src/streamPatterns';

import { MovieDownloader } from './src/providers/02moviedownloader/02moviedownloader';
import { AnyEmbed } from './src/providers/anyembed/anyembed';
import { CineSuProvider } from './src/providers/cinesu/cinesu';
import { Fmovies4U } from './src/providers/fmovies4u/fmovies4u';
import { FsharetvProvider } from './src/providers/fshare/fshare';
import { IcefyProvider } from './src/providers/icefy/icefy';
import { PeachifyProvider } from './src/providers/peachify/peachify';
import { PoprProvider } from './src/providers/popr/popr';
import { StreamMafiaProvider } from './src/providers/streammafia/streammafia';
import { TulnexProvider } from './src/providers/tulnex/tulnex';
import { VidApiProvider } from './src/providers/vidapi/vidapi';
import { VideasyProvider } from './src/providers/videasy/videasy';
import { VidNestProvider } from './src/providers/vidnest/vidnest';
import { VidRockProvider } from './src/providers/vidrock/vidrock';
import { VidSrcProvider } from './src/providers/vidsrc/vidsrc';
import { VidZeeProvider } from './src/providers/vidzee/vidzee';
import { VixSrcProvider } from './src/providers/vixsrc/vixsrc';

// Final CI trigger: verify Worker-safe Fastify/Avvio startup path.
const PORT = 8787;
const PUBLIC_URL = 'https://movyz-cinepro.sameranede.workers.dev';

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

const tmdbApiKey = process.env.TMDB_API_KEY;
if (!tmdbApiKey) {
  throw new Error('TMDB_API_KEY is required');
}

// Fastify/find-my-way uses new Function() while registering routes.
// Production CI uses a standard hosted runner; compile all CinePro routes during Worker startup. Keep this adapter side-effect-free after boot; final production smoke follows immediately. The memory cache
// cleanup timer is not essential for correctness because cache reads enforce TTL,
// so suppress only that timer while the server graph is constructed.
const nativeSetInterval = globalThis.setInterval;
globalThis.setInterval = (() => ({ unref() {} })) as unknown as typeof setInterval;

let cinepro: OMSSServer;
try {
  cinepro = new OMSSServer({
    name: 'CinePro',
    version: '1.0.0',
    host: '0.0.0.0',
    port: PORT,
    publicUrl: PUBLIC_URL,
    cache: {
      type: 'memory',
      ttl: {
        sources: 60 * 60,
        subtitles: 60 * 60 * 24,
      },
    },
    tmdb: {
      apiKey: tmdbApiKey,
      cacheTTL: 24 * 60 * 60,
    },
    proxyConfig: {
      knownThirdPartyProxies,
      streamPatterns,
    },
    cors: {
      origin: '*',
      methods: ['GET', 'OPTIONS', 'HEAD'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept'],
      exposedHeaders: ['Content-Length', 'Content-Type', 'Content-Range', 'Accept-Ranges'],
      credentials: false,
    },
    stremio: {
      enableNativeAddon: true,
      stremioAddons: [],
    },
    mcp: {
      enabled: false,
    },
  });
} finally {
  globalThis.setInterval = nativeSetInterval;
}

const app = cinepro.getInstance();

// OMSSServer registers CinePro routes synchronously in its constructor.
// In Workers, waiting on Fastify/Avvio's full boot queue can deadlock on Node
// lifecycle ticks. The HTTP bridge can safely enter Fastify's request listener
// directly because the route graph is already registered.
const bridgeServer = createServer((request, response) => {
  try {
    app.server.emit('request', request, response);
  } catch (error) {
    console.error('[CinePro] request dispatch failed', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    }
    response.end(JSON.stringify({
      error: 'CINEPRO_RUNTIME_ERROR',
      message: error instanceof Error ? error.message : String(error),
    }));
  }
});

export default httpServerHandler(bridgeServer);

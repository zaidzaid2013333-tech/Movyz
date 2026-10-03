import { OMSSServer } from '@omss/framework';
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
let ready: Promise<void> | undefined;
let handler: ReturnType<typeof httpServerHandler> | undefined;

async function getHandler() {
  if (!ready) {
    ready = app.ready();
  }
  await ready;

  if (!handler) {
    handler = httpServerHandler(app.server);
  }

  return handler;
}

export default {
  async fetch(request: Request, env: { TMDB_API_KEY?: string }, ctx: ExecutionContext) {
    // env is intentionally accepted for Worker compatibility; CinePro reads the same secret
    // from process.env during startup via nodejs_compat_populate_process_env.
    void env;
    return (await getHandler()).fetch(request, env, ctx);
  },
};

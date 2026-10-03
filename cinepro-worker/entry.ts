import { httpServerHandler } from 'cloudflare:node';
import { OMSSServer } from '@omss/framework';

import { IcefyProvider } from './core/src/providers/icefy/icefy.js';
import { CineSuProvider } from './core/src/providers/cinesu/cinesu.js';
import { TulnexProvider } from './core/src/providers/tulnex/tulnex.js';
import { VidApiProvider } from './core/src/providers/vidapi/vidapi.js';
import { FshareProvider } from './core/src/providers/fshare/fshare.js';
import { PoprProvider } from './core/src/providers/popr/popr.js';
import { AnyEmbedProvider } from './core/src/providers/anyembed/anyembed.js';
import { VidSrcProvider } from './core/src/providers/vidsrc/vidsrc.js';
import { VidZeeProvider } from './core/src/providers/vidzee/vidzee.js';
import { VidRockProvider } from './core/src/providers/vidrock/vidrock.js';
import { VidNestProvider } from './core/src/providers/vidnest/vidnest.js';
import { Fmovies4uProvider } from './core/src/providers/fmovies4u/fmovies4u.js';
import { VideasyProvider } from './core/src/providers/videasy/videasy.js';
import { VixSrcProvider } from './core/src/providers/vixsrc/vixsrc.js';
import { PeachifyProvider } from './core/src/providers/peachify/peachify.js';
import { StreamMafiaProvider } from './core/src/providers/streammafia/streammafia.js';
import { TwoMovieDownloaderProvider } from './core/src/providers/02moviedownloader/02moviedownloader.js';

const cinepro = new OMSSServer({
  name: 'Movyz CinePro',
  version: '1.0.0',
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 8787),
  publicUrl: process.env.PUBLIC_URL,
  cache: {
    type: (process.env.CACHE_TYPE as 'memory' | 'redis') ?? 'memory',
    ttl: {
      sources: 60 * 60,
      subtitles: 60 * 60 * 24
    },
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD
    }
  },
  tmdb: {
    apiKey: process.env.TMDB_API_KEY,
    cacheTTL: Number(process.env.TMDB_CACHE_TTL ?? 86400)
  },
  proxyConfig: {
    knownThirdPartyProxies: {},
    streamPatterns: [
      /\\.(?:m3u8|mpd|mp4|webm)(?:\\?.*)?$/i
    ]
  },
  cors: {
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept'],
    exposedHeaders: ['Content-Length', 'Content-Type', 'Content-Range', 'Accept-Ranges'],
    preflightContinue: false,
    optionsSuccessStatus: 204
  },
  stremio: {
    enableNativeAddon: process.env.STREMIO_ADDON === 'true',
    stremioAddons: []
  },
  mcp: {
    enabled: process.env.MCP_ENABLED === 'true'
  }
});

const registry = cinepro.getRegistry();
const providers = [
  new IcefyProvider(),
  new CineSuProvider(),
  new TulnexProvider(),
  new VidApiProvider(),
  new FshareProvider(),
  new PoprProvider(),
  new AnyEmbedProvider(),
  new VidSrcProvider(),
  new VidZeeProvider(),
  new VidRockProvider(),
  new VidNestProvider(),
  new Fmovies4uProvider(),
  new VideasyProvider(),
  new VixSrcProvider(),
  new PeachifyProvider(),
  new StreamMafiaProvider(),
  new TwoMovieDownloaderProvider()
];

for (const provider of providers) {
  registry.register(provider);
}

const app = cinepro.getInstance();
const port = Number(process.env.PORT ?? 8787);

await app.listen({ host: process.env.HOST ?? '0.0.0.0', port });

export default httpServerHandler({ port });

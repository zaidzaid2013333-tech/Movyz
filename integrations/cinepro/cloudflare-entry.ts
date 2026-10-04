import { OMSSServer } from '@omss/framework';
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

// OMSSServer builds the entire CinePro service graph synchronously.
const nativeSetInterval = globalThis.setInterval;
globalThis.setInterval = (() => ({ unref() {} })) as unknown as typeof setInterval;

const cinepro = new OMSSServer({
  name: 'CinePro',
  version: '1.0.0',
  host: '0.0.0.0',
  port: 8787,
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

globalThis.setInterval = nativeSetInterval;

const registry = cinepro.getRegistry();
for (const Provider of providers) {
  registry.register(new Provider());
}

const sourceService = (cinepro as any).sourceService as {
  getMovieSources(tmdbId: string): Promise<unknown>;
  getTVSources(tmdbId: string, season: number, episode: number): Promise<unknown>;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,OPTIONS,HEAD',
          'access-control-allow-headers': 'Content-Type, Authorization, Range, Accept',
        },
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    }

    try {
      if (url.pathname === '/' || url.pathname === '/v1' || url.pathname === '/v1/' || url.pathname === '/v1/health') {
        return json({
          name: 'CinePro',
          version: '1.0.0',
          status: 'ok',
          providers: registry.getEnabledProviders().map((provider: any) => provider.name),
        });
      }

      const movieMatch = url.pathname.match(/^\/v1\/movies\/([^/]+)$/);
      if (movieMatch) {
        return json(await sourceService.getMovieSources(decodeURIComponent(movieMatch[1])));
      }

      const episodeMatch = url.pathname.match(/^\/v1\/tv\/([^/]+)\/seasons\/(\d+)\/episodes\/(\d+)$/);
      if (episodeMatch) {
        return json(
          await sourceService.getTVSources(
            decodeURIComponent(episodeMatch[1]),
            Number.parseInt(episodeMatch[2], 10),
            Number.parseInt(episodeMatch[3], 10),
          ),
        );
      }

      return json(
        {
          error: {
            code: 'ENDPOINT_NOT_FOUND',
            message: 'The requested endpoint does not exist',
            path: url.pathname,
          },
        },
        404,
      );
    } catch (error) {
      console.error('[CinePro] request failed', error);
      return json(
        {
          error: {
            code: 'CINEPRO_RUNTIME_ERROR',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          },
        },
        500,
      );
    }
  },
};

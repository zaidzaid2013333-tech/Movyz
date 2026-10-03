import { OMSSServer } from '@omss/framework';
import { handleAsNodeRequest } from 'cloudflare:node';
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

let initialization: Promise<void> | undefined;

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

async function initializeCinePro(tmdbApiKey: string) {
  if (!initialization) {
    initialization = (async () => {
      if (!tmdbApiKey) {
        throw new Error('TMDB_API_KEY is required');
      }

      const server = new OMSSServer({
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

      const registry = server.getRegistry();
      for (const Provider of providers) {
        registry.register(new Provider());
      }

      const app = server.getInstance();
      await app.ready();

      await new Promise<void>((resolve, reject) => {
        const nodeServer = app.server;
        const onError = (error: unknown) => {
          nodeServer.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          nodeServer.off('error', onError);
          resolve();
        };

        nodeServer.once('error', onError);
        nodeServer.once('listening', onListening);
        nodeServer.listen(PORT);
      });
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }

  return initialization;
}

export default {
  async fetch(request: Request, env: { TMDB_API_KEY?: string }) {
    await initializeCinePro(env?.TMDB_API_KEY || '');
    return handleAsNodeRequest(PORT, request);
  },
};

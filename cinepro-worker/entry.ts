import { Readable } from 'node:stream';
import { OMSSServer } from '@omss/framework';
import { debugAkwamMovie, resolveAkwamPlayback } from './arprov/arprov-akwam.js';

import { IcefyProvider } from './core/src/providers/icefy/icefy.js';
import { CineSuProvider } from './core/src/providers/cinesu/cinesu.js';
import { TulnexProvider } from './core/src/providers/tulnex/tulnex.js';
import { VidApiProvider } from './core/src/providers/vidapi/vidapi.js';
import { FsharetvProvider } from './core/src/providers/fshare/fshare.js';
import { PoprProvider } from './core/src/providers/popr/popr.js';
import { VidSrcProvider } from './core/src/providers/vidsrc/vidsrc.js';
import { VidZeeProvider } from './core/src/providers/vidzee/vidzee.js';
import { VidRockProvider } from './core/src/providers/vidrock/vidrock.js';
import { VidNestProvider } from './core/src/providers/vidnest/vidnest.js';
import { VideasyProvider } from './core/src/providers/videasy/videasy.js';
import { VixSrcProvider } from './core/src/providers/vixsrc/vixsrc.js';
import { PeachifyProvider } from './core/src/providers/peachify/peachify.js';
import { StreamMafiaProvider } from './core/src/providers/streammafia/streammafia.js';

const nativeSetInterval = globalThis.setInterval;
globalThis.setInterval = (() => ({ unref() {} })) as unknown as typeof setInterval;

const cinepro = new OMSSServer({
  name: 'Movyz CinePro',
  version: '1.0.0',
  host: '0.0.0.0',
  port: 8787,
  publicUrl: process.env.PUBLIC_URL,
  cache: {
    type: (process.env.CACHE_TYPE as 'memory' | 'redis') ?? 'memory',
    ttl: {
      sources: 60 * 60,
      subtitles: 60 * 60 * 24,
    },
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD,
    },
  },
  tmdb: {
    apiKey: process.env.TMDB_API_KEY,
    cacheTTL: Number(process.env.TMDB_CACHE_TTL ?? 86400),
  },
  proxyConfig: {
    knownThirdPartyProxies: {},
    streamPatterns: [/\.(?:m3u8|mpd|mp4|webm)(?:\?.*)?$/i],
  },
  cors: {
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept'],
    exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  },
  stremio: {
    enableNativeAddon: false,
    stremioAddons: [],
  },
  mcp: {
    enabled: false,
  },
});

globalThis.setInterval = nativeSetInterval;

const registry = cinepro.getRegistry();
const providers = [
  new IcefyProvider(),
  new CineSuProvider(),
  new TulnexProvider(),
  new VidApiProvider(),
  new FsharetvProvider(),
  new PoprProvider(),
  new VidSrcProvider(),
  new VidZeeProvider(),
  new VidRockProvider(),
  new VidNestProvider(),
  new VideasyProvider(),
  new VixSrcProvider(),
  new PeachifyProvider(),
  new StreamMafiaProvider(),
];

for (const provider of providers) {
  registry.register(provider);
}

const sourceService = (cinepro as any).sourceService as {
  getMovieSources(tmdbId: string): Promise<unknown>;
  getTVSources(tmdbId: string, season: number, episode: number): Promise<unknown>;
  refreshSource(responseId: string): Promise<void>;
};

const proxyService = (cinepro as any).proxyService as {
  proxyRequest(encodedData: string): Promise<any>;
};

const json = (body: unknown, status = 200, extraHeaders?: Record<string, string>) => {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    ...extraHeaders,
  });

  return new Response(JSON.stringify(body), { status, headers });
};

async function resolveAkwamMovieOrEpisode(
  media: any,
  episode?: { season: number; episode: number },
  seriesTitle?: string,
) {
  const context: any = {
    tmdbId: Number(media.tmdbId),
    title: seriesTitle || media.title,
    originalTitle: seriesTitle || media.title,
    releaseYear: Number(media.releaseYear) || undefined,
    imdbId: media.imdbId,
  };

  if (episode) {
    context.seasonNumber = episode.season;
    context.episodeNumber = episode.episode;
    context.episodeTitle = media.title;
  }

  const resolved = await resolveAkwamPlayback(context, {
    tmdbApiToken: process.env.TMDB_API_READ_ACCESS_TOKEN,
  });

  const sources = resolved
    .filter((source: any) => typeof source?.url === 'string' && /^https:\/\//i.test(source.url))
    .map((source: any, index: number) => {
      const lower = source.url.toLowerCase();
      const type =
        source.type === 'hls' || lower.includes('.m3u8') ? 'hls' :
        source.type === 'dash' || lower.includes('.mpd') ? 'dash' :
        source.type === 'mp4' || lower.includes('.mp4') ? 'mp4' :
        source.type === 'webm' || lower.includes('.webm') ? 'webm' :
        'embed';

      return {
        url: source.url,
        type,
        quality: source.quality || 'auto',
        audioTracks: [
          {
            language: source.language || 'und',
            label: source.language || 'Unknown',
          },
        ],
        provider: {
          id: 'arprov-akwam',
          name: source.provider || 'Akwam',
        },
        _index: index,
      };
    })
    .filter((source: any, index: number, all: any[]) =>
      all.findIndex((item: any) => item.url === source.url) === index
    );

  return sources.map(({ _index, ...source }: any) => source);
}

const errorResponse = (error: unknown, status = 500) =>
  json(
    {
      error: {
        code: 'CINEPRO_RUNTIME_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    },
    status,
  );

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,OPTIONS,HEAD',
          'access-control-allow-headers': 'Content-Type, Authorization, Range, Accept',
          'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
        },
      });
    }

    if (!['GET', 'HEAD'].includes(request.method)) {
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    }

    try {
      if (
        url.pathname === '/' ||
        url.pathname === '/v1' ||
        url.pathname === '/v1/' ||
        url.pathname === '/v1/health'
      ) {
        return json({
          name: 'CinePro',
          version: '1.0.0',
          status: 'ok',
          providers: registry.getEnabledProviders().map((provider: any) => provider.name),
        });
      }

      const debugTvMatch = url.pathname.match(/^\/v1\/debug\/tv\/([^/]+)\/seasons\/(\d+)\/episodes\/(\d+)$/);
      if (debugTvMatch) {
        const tmdbId = decodeURIComponent(debugTvMatch[1]);
        const season = Number.parseInt(debugTvMatch[2], 10);
        const episode = Number.parseInt(debugTvMatch[3], 10);
        const tmdbService = (cinepro as any).tmdbService;
        const media = await tmdbService.getMediaObject('tv', tmdbId, season, episode);
        const seriesMeta = await tmdbService.validateTV(tmdbId);
        const context = {
          tmdbId: Number(tmdbId),
          title: seriesMeta.title || media.title,
          originalTitle: seriesMeta.title || media.title,
          releaseYear: Number(seriesMeta.releaseYear) || undefined,
          imdbId: media.imdbId,
          seasonNumber: season,
          episodeNumber: episode,
          episodeTitle: media.title,
        };
        return json({
          context,
          trace: await debugAkwamMovie(context, {
            tmdbApiToken: process.env.TMDB_API_READ_ACCESS_TOKEN,
          }),
        });
      }

      const debugMovieMatch = url.pathname.match(/^\/v1\/debug\/movie\/([^/]+)$/);
      if (debugMovieMatch) {
        const tmdbId = decodeURIComponent(debugMovieMatch[1]);
        const tmdbService = (cinepro as any).tmdbService;
        const media = await tmdbService.getMediaObject('movie', tmdbId);
        media.imdbId = (await tmdbService.getImdbId(tmdbId, 'movie')) ?? '';
        const results = [];
        for (const provider of registry.getEnabledProviders()) {
          const started = Date.now();
          try {
            const result = await provider.getMovieSources(media);
            results.push({
              id: provider.id,
              name: provider.name,
              enabled: provider.enabled,
              sources: Array.isArray(result?.sources) ? result.sources.length : 0,
              diagnostics: result?.diagnostics ?? [],
              ms: Date.now() - started,
            });
          } catch (error) {
            results.push({
              id: provider.id,
              name: provider.name,
              enabled: provider.enabled,
              sources: 0,
              diagnostics: [{ message: error instanceof Error ? error.message : String(error) }],
              ms: Date.now() - started,
            });
          }
        }
        return json({ tmdbId, media, results });
      }

      const movieMatch = url.pathname.match(/^\/v1\/movies\/([^/]+)$/);
      if (movieMatch) {
        const tmdbId = decodeURIComponent(movieMatch[1]);
        const tmdbService = (cinepro as any).tmdbService;
        const media = await tmdbService.getMediaObject('movie', tmdbId);
        media.imdbId = (await tmdbService.getImdbId(tmdbId, 'movie')) ?? '';

        const akwamSources = await resolveAkwamMovieOrEpisode(media);
        if (akwamSources.length) {
          return json({
            responseId: crypto.randomUUID(),
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            sources: akwamSources,
            subtitles: [],
            diagnostics: [],
          });
        }

        return json(await sourceService.getMovieSources(tmdbId));
      }


      if (movieMatch) {
        return json(await sourceService.getMovieSources(decodeURIComponent(movieMatch[1])));
      }

      const episodeMatch = url.pathname.match(/^\/v1\/tv\/([^/]+)\/seasons\/(\d+)\/episodes\/(\d+)$/);
      if (episodeMatch) {
        const tmdbId = decodeURIComponent(episodeMatch[1]);
        const season = Number.parseInt(episodeMatch[2], 10);
        const episode = Number.parseInt(episodeMatch[3], 10);
        const tmdbService = (cinepro as any).tmdbService;
        const media = await tmdbService.getMediaObject('tv', tmdbId, season, episode);
        media.imdbId = (await tmdbService.getImdbId(tmdbId, 'tv')) ?? '';
        const seriesMeta = await tmdbService.validateTV(tmdbId);

        const akwamSources = await resolveAkwamMovieOrEpisode(
          media,
          { season, episode },
          seriesMeta.title || media.title,
        );
        if (akwamSources.length) {
          return json({
            responseId: crypto.randomUUID(),
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            sources: akwamSources,
            subtitles: [],
            diagnostics: [],
          });
        }

        return json(await sourceService.getTVSources(tmdbId, season, episode));
      }


      if (episodeMatch) {
        return json(
          await sourceService.getTVSources(
            decodeURIComponent(episodeMatch[1]),
            Number.parseInt(episodeMatch[2], 10),
            Number.parseInt(episodeMatch[3], 10),
          ),
        );
      }

      const refreshMatch = url.pathname.match(/^\/v1\/refresh\/([^/]+)$/);
      if (refreshMatch) {
        await sourceService.refreshSource(decodeURIComponent(refreshMatch[1]));
        return json({ refreshed: true });
      }

      if (url.pathname === '/v1/proxy') {
        const proxyData = url.searchParams.get('data');
        if (!proxyData) {
          return json(
            {
              error: {
                code: 'INVALID_PARAMETER',
                message: 'Missing data parameter',
              },
            },
            400,
          );
        }

        let parsed: any;
        try {
          parsed = JSON.parse(decodeURIComponent(proxyData));
        } catch (error) {
          return json(
            {
              error: {
                code: 'INVALID_PARAMETER',
                message: error instanceof Error ? error.message : 'Invalid data parameter',
              },
            },
            400,
          );
        }

        const range = request.headers.get('range');
        parsed.headers = {
          ...(parsed.headers ?? {}),
          ...(range ? { range } : {}),
        };

        const result = await proxyService.proxyRequest(
          encodeURIComponent(JSON.stringify(parsed)),
        );

        const headers = new Headers({
          'access-control-allow-origin': '*',
          'access-control-expose-headers':
            'Content-Length, Content-Range, Accept-Ranges, Last-Modified, ETag',
          'content-type': result.contentType || 'application/octet-stream',
          'cache-control': 'no-store',
        });

        for (const [key, value] of Object.entries(result.headers ?? {})) {
          headers.set(key, String(value));
        }

        if ('stream' in result && result.stream) {
          const stream = (Readable as any).toWeb
            ? (Readable as any).toWeb(result.stream)
            : result.stream;
          return new Response(stream, {
            status: result.statusCode,
            headers,
          });
        }

        const data = result.data;
        const body =
          typeof data === 'string'
            ? data
            : data instanceof Uint8Array
              ? data
              : data;

        return new Response(body, {
          status: result.statusCode,
          headers,
        });
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
      console.error('[Movyz CinePro] request failed:', error);
      return errorResponse(error, 500);
    }
  },
};

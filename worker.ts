// MediaMash Core is the only playback source backend; Movyz only bridges catalog metadata to it.
// Production playback core: MediaMash Core -> prepared API -> Worker proxy -> HLS playback.
import { app } from './server/index';
import type { WorkerEnvironment } from './server/mini-http';

type ServiceBinding = {
  fetch(request: Request, init?: RequestInit): Promise<Response>;
};

type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void;
};

type MovyzEnvironment = WorkerEnvironment & {
  ASSETS: { fetch(request: Request): Promise<Response> };
  WATCH_API?: ServiceBinding;
  MEDIAMASH_CORE?: ServiceBinding;
};



const noCacheHeaders = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Pragma', 'no-cache');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export default {
  async fetch(request: Request, env: MovyzEnvironment, ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/__debug/mediamash') {
      const core = env.MEDIAMASH_CORE;
      if (!core) return new Response(JSON.stringify({ ok: false, error: 'MEDIAMASH_CORE_MISSING' }), { status: 500, headers: { 'content-type': 'application/json' } });
      try {
        const coreResponse = await core.fetch(new Request('https://movyz-media-core.sameranede.workers.dev/v1/movies/157336', {
          headers: {
            'accept': 'application/json',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
          },
        }));
        const body = await coreResponse.text();
        return new Response(JSON.stringify({ ok: coreResponse.ok, status: coreResponse.status, body: body.slice(0, 10000) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      return app.handle(request, env, ctx);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const isHtml = request.method === 'GET' && (
      url.pathname === '/' ||
      url.pathname.endsWith('.html')
    );
    const isLegacyPwaAsset = url.pathname.endsWith('/sw.js') ||
      url.pathname.endsWith('/registerSW.js');

    if (isHtml || isLegacyPwaAsset) {
      return noCacheHeaders(assetResponse);
    }

    return assetResponse;
  },

};


// Playback backend is CinePro Core; CI deploys and smoke-tests the upstream backend before Movyz verification.
// CI concurrency: only the newest production verification should run.

import { app } from './server/index';
import { runMaintenanceTick } from './server/maintenance';
import type { WorkerEnvironment } from './server/mini-http';

type ServiceBinding = {
  fetch(request: Request, init?: RequestInit): Promise<Response>;
};

type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void;
};

type MovyzEnvironment = WorkerEnvironment & {
  ASSETS: { fetch(request: Request): Promise<Response> };
  BROWSER?: unknown;
  WATCH_API?: ServiceBinding;
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

  async scheduled(_controller: unknown, env: MovyzEnvironment, ctx: ExecutionContextLike) {
    ctx.waitUntil(
      runMaintenanceTick('primary_sources', env.BROWSER).catch((error) => {
        console.error('[movyz-scheduled-maintenance]', error instanceof Error ? error.message : String(error));
      }),
    );
  },
};

// Playback architecture marker: external resolver returns links; Movyz never proxies video bytes.

// General playback transport: all playable providers use the same signed redirect path; Akwam remains on-demand.
// Smoke coverage order: Interstellar -> Inception -> Fight Club -> The Shawshank Redemption.
// CI trigger: production smoke verification follows workflow-only fixes
import { app } from './server/index';
import { getCineProSources } from './server/cinepro-adapter';
import { z } from 'zod';
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
  CINEPRO_BASE_URL?: string;
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

    if (url.pathname === '/api/v1/playback/prepared' && request.method === 'POST' && env.CINEPRO_BASE_URL) {
      try {
        const body = await request.clone().json();
        const parsed = z.object({
          contentType: z.enum(['movie', 'episode']),
          contentId: z.string().uuid(),
        }).safeParse(body);

        if (parsed.success) {
          try {
            const sources = await getCineProSources(
              parsed.data.contentType,
              parsed.data.contentId,
              request.url,
              env,
            );
            if (sources.length) {
              return new Response(JSON.stringify({ success: true, data: sources }), {\n                status: 200,\n                headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },\n              });
            }
          } catch (error) {
            console.warn('[cinepro-playback]', error instanceof Error ? error.message : String(error));
          }
        }
      } catch (error) {
        console.warn('[cinepro-playback-request]', error instanceof Error ? error.message : String(error));
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


// CI concurrency: only the newest production verification should run.

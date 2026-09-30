import { app } from './server/index';
import type { WorkerEnvironment } from './server/mini-http';

type ServiceBinding = {
  fetch(request: Request, init?: RequestInit): Promise<Response>;
};

type MovyzEnvironment = WorkerEnvironment & {
  ASSETS: { fetch(request: Request): Promise<Response> };
  BROWSER?: unknown;
  WATCH_API?: ServiceBinding;
};
export default {
  async fetch(request: Request, env: MovyzEnvironment): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      return app.handle(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

// Deployment verification marker: VidCore iframe player.

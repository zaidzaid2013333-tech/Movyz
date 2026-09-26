import { app } from './server/index';

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      return app.handle(request);
    }

    const watchMatch = url.pathname.match(/^\/watch\/([^/]+)$/);
    if (watchMatch) {
      const target = new URL(request.url);
      target.pathname = `/api/v1/watch/${watchMatch[1]}/stream`;
      return app.handle(new Request(target, request));
    }

    return env.ASSETS.fetch(request);
  },
};

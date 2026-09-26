import { app } from './server/index';
import { setFaselHdBrowserBinding } from './server/providers/faselhd-browser';

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> }; BROWSER?: unknown }): Promise<Response> {
    setFaselHdBrowserBinding(env.BROWSER);
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      return app.handle(request);
    }

    return env.ASSETS.fetch(request);
  },
};

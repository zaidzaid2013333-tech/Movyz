import { httpServerHandler } from 'cloudflare:node';
import { app } from './server/index';

app.listen(8787);
const apiHandler = httpServerHandler({ port: 8787 });

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      return apiHandler(request);
    }

    return env.ASSETS.fetch(request);
  },
};

import { app, setWatchApiFetch } from './server/index';
export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> }; BROWSER?: unknown; WATCH_API?: { fetch(request: Request, init?: RequestInit): Promise<Response> } }): Promise<Response> {
    if (env.WATCH_API) {
      setWatchApiFetch((input, init) => {
        const requestToWatchApi =
          input instanceof Request
            ? new Request(input)
            : new Request(input, init);
        return env.WATCH_API!.fetch(requestToWatchApi);
      });
    }
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      return app.handle(request);
    }

    return env.ASSETS.fetch(request);
  },
};

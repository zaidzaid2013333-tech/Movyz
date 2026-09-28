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

    if (url.pathname === '/akwam-iframe-test') {
      const akwamEpisode = 'https://akwam.ss/watch/22879/9725/the-mentalist-%D8%A7%D9%84%D9%85%D9%88%D8%B3%D9%85-%D8%A7%D9%84%D8%A7%D9%88%D9%84/%D8%A7%D9%84%D8%AD%D9%84%D9%82%D8%A9-1';
      return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Akwam iframe test — The Mentalist S01E01</title><style>html,body{margin:0;background:#050505;color:#fff;font-family:system-ui,sans-serif}main{padding:16px}h1{font-size:18px}iframe{display:block;width:100%;height:80vh;border:0;border-radius:12px;background:#000}</style></head><body><main><h1>Akwam iframe test — The Mentalist S01E01</h1><iframe src="${akwamEpisode}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></main></body></html>`, {status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
    }

    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      return app.handle(request);
    }

    return env.ASSETS.fetch(request);
  },
};

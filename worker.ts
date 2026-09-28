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
      return new Response(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MOVYZA · Akwam iframe test</title>
<style>
html,body{margin:0;background:#050505;color:#fff;font-family:system-ui,sans-serif}
body{min-height:100vh}
main{padding:16px;box-sizing:border-box}
h1{font-size:18px;margin:0 0 12px}
p{font-size:12px;color:#aaa;margin:0 0 14px}
iframe{display:block;width:100%;height:80vh;min-height:420px;border:0;border-radius:12px;background:#000}
</style>
</head>
<body>
<main>
<h1>اختبار Akwam داخل iframe</h1>
<p>إذا ظهر محتوى Akwam هنا فالـiframe يعمل من داخل Worker بدون مشغل Movyza.</p>
<iframe
  src="${akwamEpisode}"
  title="Akwam playback test"
  allow="autoplay; fullscreen; picture-in-picture"
  allowfullscreen
  referrerpolicy="strict-origin-when-cross-origin"></iframe>
</main>
</body>
</html>`, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store, no-cache, must-revalidate',
          'pragma': 'no-cache',
          'content-security-policy': "default-src 'self'; frame-src https://akwam.ss https://*.akwam.ss; img-src 'self' data: https:; style-src 'unsafe-inline'",
          'x-frame-options': 'SAMEORIGIN',
        },
      });
    }

    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      return app.handle(request);
    }

    return env.ASSETS.fetch(request);
  },
};

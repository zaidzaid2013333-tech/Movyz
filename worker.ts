import { setFaselHdBrowserBinding } from './server/providers/adapters/faselhd';
import { app } from './server/index';
export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> }; BROWSER?: unknown }): Promise<Response> {
    setFaselHdBrowserBinding(env.BROWSER);
    const url = new URL(request.url);

    if (url.pathname === '/api/debug/fasel-browser') {
      const browser = env.BROWSER as { quickAction?: (action: string, options: Record<string, unknown>) => Promise<Response> } | undefined;
      if (!browser?.quickAction) {
        return Response.json({ ok: false, error: 'BROWSER binding unavailable' }, { status: 503 });
      }

      const target = url.searchParams.get('url') || 'https://www.faselhd.tech/';
      if (!/^https:\/\/(?:www\.)?faselhd\.tech(?:\/|$)/i.test(target)) {
        return Response.json({ ok: false, error: 'Target not allowed' }, { status: 400 });
      }

      try {
        const response = await browser.quickAction('content', {
          url: target,
          gotoOptions: { waitUntil: 'networkidle2', timeout: 45_000 },
          userAgent: 'MovyzBrowserProbe/1.0',
        });
        const body = await response.text();
        return new Response(JSON.stringify({
          ok: response.ok,
          status: response.status,
          contentType: response.headers.get('content-type'),
          length: body.length,
          head: body.slice(0, 6000),
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      } catch (error) {
        return Response.json({ ok: false, error: String(error) }, { status: 502 });
      }
    }

    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      return app.handle(request);
    }

    return env.ASSETS.fetch(request);
  },
};

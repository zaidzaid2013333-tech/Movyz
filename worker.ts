type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

type MovyzEnvironment = {
  ASSETS: { fetch(request: Request): Promise<Response> };
};

const noCache = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

export default {
  async fetch(request: Request, env: MovyzEnvironment, _ctx: ExecutionContextLike): Promise<Response> {
    const response = await env.ASSETS.fetch(request);
    const url = new URL(request.url);
    const html = request.method === 'GET' && (url.pathname === '/' || !url.pathname.includes('.'));
    return html ? noCache(response) : response;
  },
};

import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 10000);
const UPSTREAM = (process.env.UPSTREAM_BASE_URL || 'https://movyz-api.sameranede.workers.dev').replace(/\/$/, '');
const cache = new Map();
const TTL = 5 * 60 * 1000;
const CATALOG_TTL = 60 * 60 * 1000;

function allowed(pathname) {
  return pathname === '/tmdb' || pathname.startsWith('/tmdb/') || pathname === '/catalog/top1000';
}

async function handle(req, res) {
  const method = req.method || 'GET';
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'Authorization,Content-Type'
    });
    return res.end();
  }

  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', 'http://' + host);

  if (method === 'GET' && url.pathname === '/health') {
    const body = Buffer.from(JSON.stringify({ ok: true, service: 'movyza-edge-cache', cacheEntries: cache.size }));
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=10, s-maxage=30',
      'content-length': String(body.length)
    });
    return res.end(body);
  }

  if (method !== 'GET' || !allowed(url.pathname)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'Not found' }));
  }

  const key = url.pathname + url.search;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    res.writeHead(cached.status, {
      'content-type': cached.contentType,
      'cache-control': 'public, max-age=60, s-maxage=300',
      'access-control-allow-origin': '*',
      'x-movyza-edge-cache': 'HIT',
      'content-length': String(cached.body.length)
    });
    return res.end(cached.body);
  }

  const target = new URL(UPSTREAM);
  target.pathname = url.pathname;
  target.search = url.search;

  try {
    const upstream = await fetch(target);
    const body = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    const ttl = url.pathname === '/catalog/top1000' ? CATALOG_TTL : TTL;

    if (upstream.ok) {
      cache.set(key, { status: upstream.status, contentType, body, expiresAt: now + ttl });
      if (cache.size > 300) cache.delete(cache.keys().next().value);
    }

    res.writeHead(upstream.status, {
      'content-type': contentType,
      'cache-control': 'public, max-age=60, s-maxage=300',
      'access-control-allow-origin': '*',
      'x-movyza-edge-cache': 'MISS',
      'content-length': String(body.length)
    });
    res.end(body);
  } catch {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Upstream unavailable' }));
  }
}

http.createServer((req, res) => void handle(req, res)).listen(PORT, '0.0.0.0', () => {
  console.log('Movyza edge cache listening on ' + PORT);
});

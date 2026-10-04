import { Readable } from 'node:stream';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'origin',
  'range',
  'referer',
  'user-agent',
]);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 'no-store');
  res.end(payload);
}

function publicOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || process.env.VERCEL_URL || '');
  return host ? proto.split(',')[0].trim() + '://' + host.split(',')[0].trim() : '';
}

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'local' ||
    host.endsWith('.local') ||
    host === '::1'
  ) return true;

  const ipv4 = host.match(/^\d{1,3}(?:\.\d{1,3}){3}$/)?.[0];
  if (!ipv4) return false;

  const parts = ipv4.split('.').map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0 ||
    (a === 169 && b === 254)
  );
}

function validateTarget(raw) {
  let target;
  try {
    target = new URL(raw);
  } catch {
    throw new Error('Invalid target URL');
  }

  if (target.protocol !== 'https:') {
    throw new Error('Only HTTPS upstream URLs are allowed');
  }

  if (isPrivateHostname(target.hostname)) {
    throw new Error('Private or local upstream hosts are not allowed');
  }

  return target;
}

function parseHeaders(raw) {
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid headers parameter');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid headers parameter');
  }

  const output = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!FORWARDED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    if (typeof value !== 'string' || value.length > 4096) continue;
    output[key] = value;
  }
  return output;
}

function proxyUrl(req, target, headers) {
  const origin = publicOrigin(req);
  const query = new URLSearchParams({
    url: target,
  });
  if (headers && Object.keys(headers).length) {
    query.set('headers', JSON.stringify(headers));
  }
  return origin + '/api/relay?' + query.toString();
}

function rewriteManifest(text, upstreamUrl, req, headers) {
  return text.split(/\r?\n/).map((line) => {
    const uri = line.match(/URI="([^"]+)"/i);
    if (uri) {
      try {
        const resolved = new URL(uri[1], upstreamUrl).toString();
        return line.replace(uri[1], proxyUrl(req, resolved, headers));
      } catch {
        return line;
      }
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;

    try {
      const resolved = new URL(trimmed, upstreamUrl).toString();
      return proxyUrl(req, resolved, headers);
    } catch {
      return line;
    }
  }).join('\n');
}

function requestHeaders(req, upstreamHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(upstreamHeaders || {})) {
    if (!FORWARDED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    if (typeof value === 'string') headers.set(key, value);
  }

  for (const name of ['range', 'if-range', 'if-none-match', 'if-modified-since']) {
    const value = req.headers[name];
    if (typeof value === 'string' && value) headers.set(name, value);
  }

  return headers;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET,HEAD,OPTIONS');
    res.setHeader('access-control-allow-headers', 'Range, Content-Type, Accept, Origin, Referer');
    return res.end();
  }

  const rawUrl = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  const rawHeaders = Array.isArray(req.query?.headers) ? req.query.headers[0] : req.query?.headers;

  if (!rawUrl) {
    return sendJson(res, 200, {
      name: 'Movyz Media Relay',
      status: 'ok',
      runtime: 'vercel-node',
    });
  }

  try {
    const target = validateTarget(String(rawUrl));
    const upstreamRequestHeaders = parseHeaders(rawHeaders ? String(rawHeaders) : '');
    const upstream = await fetch(target, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: requestHeaders(req, upstreamRequestHeaders),
      redirect: 'follow',
    });

    const contentType = upstream.headers.get('content-type') || '';
    const isManifest =
      /mpegurl|vnd\.apple\.mpegurl/i.test(contentType) ||
      /\.m3u8(?:$|\?)/i.test(target.toString());

    if (isManifest && req.method !== 'HEAD') {
      const body = await upstream.text();
      if (body.trimStart().startsWith('#EXTM3U')) {
        const headers = new Headers();
        headers.set('content-type', contentType || 'application/vnd.apple.mpegurl');
        headers.set('access-control-allow-origin', '*');
        headers.set('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified');
        headers.set('cache-control', 'no-store');
        res.statusCode = upstream.status;
        for (const [key, value] of headers.entries()) res.setHeader(key, value);
        return res.end(rewriteManifest(body, target.toString(), req, upstreamRequestHeaders));
      }
    }

    res.statusCode = upstream.status;
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified');

    for (const [key, value] of upstream.headers.entries()) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      if (key.toLowerCase() === 'content-encoding') continue;
      if (
        [
          'content-type',
          'content-length',
          'content-range',
          'accept-ranges',
          'cache-control',
          'etag',
          'last-modified',
        ].includes(key.toLowerCase())
      ) {
        res.setHeader(key, value);
      }
    }

    if (req.method === 'HEAD' || !upstream.body) return res.end();
    return Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    return sendJson(res, 502, {
      error: 'MEDIA_RELAY_ERROR',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

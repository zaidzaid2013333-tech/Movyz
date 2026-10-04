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

const preferredModeByOrigin = new Map();

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

function requestHeaders(req, upstreamHeaders, mode = 'original', target = null) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(upstreamHeaders || {})) {
    if (!FORWARDED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    if (typeof value === 'string') headers.set(key, value);
  }

  if (mode === 'relaxed') {
    headers.delete('origin');
    headers.delete('referer');
    headers.set('accept', '*/*');
  }

  if (mode === 'same-origin' && target) {
    headers.delete('origin');
    headers.set('referer', target.origin + '/');
    headers.set('accept', '*/*');
  }

  if (mode === 'browser') {
    headers.delete('origin');
    headers.delete('referer');
    headers.set('accept', '*/*');
    headers.set('accept-language', 'en-US,en;q=0.9');
    headers.set(
      'user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    );
  }

  for (const name of ['range', 'if-range', 'if-none-match', 'if-modified-since']) {
    const value = req.headers[name];
    if (typeof value === 'string' && value) headers.set(name, value);
  }

  return headers;
}

function retryModesFor(target) {
  const preferred = preferredModeByOrigin.get(target.origin);
  const modes = ['original', 'relaxed', 'same-origin', 'browser'];
  return preferred ? [preferred, ...modes.filter((mode) => mode !== preferred)] : modes;
}

function probeHeaders(forwardedHeaders, mode, target, range) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(forwardedHeaders || {})) {
    if (!FORWARDED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    if (typeof value === 'string') headers.set(key, value);
  }

  if (mode === 'relaxed') {
    headers.delete('origin');
    headers.delete('referer');
    headers.set('accept', '*/*');
  }

  if (mode === 'same-origin') {
    headers.delete('origin');
    headers.set('referer', target.origin + '/');
    headers.set('accept', '*/*');
  }

  if (mode === 'browser') {
    headers.delete('origin');
    headers.delete('referer');
    headers.set('accept', '*/*');
    headers.set('accept-language', 'en-US,en;q=0.9');
    headers.set(
      'user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    );
  }

  if (range) headers.set('range', range);
  return headers;
}

async function fetchProbeTarget(target, forwardedHeaders, range = '') {
  const modes = ['original', 'relaxed'];
  let lastError = null;

  for (const mode of modes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(target, {
        method: 'GET',
        headers: probeHeaders(forwardedHeaders, mode, target, range),
        redirect: 'follow',
        cache: 'no-store',
        signal: controller.signal,
      });

      if (response.ok || response.status === 206) return response;
      if (![403, 408, 429, 500, 502, 503, 504, 522, 524].includes(response.status)) return response;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('Probe upstream request failed');
}

async function probePlayableTarget(rawTarget, forwardedHeaders, depth = 0) {
  if (depth > 2) return { playable: false, reason: 'max-depth' };
  const target = validateTarget(rawTarget);
  const response = await fetchProbeTarget(target, forwardedHeaders);

  if (!(response.status === 200 || response.status === 206)) {
    return { playable: false, reason: 'status-' + response.status };
  }

  const contentType = response.headers.get('content-type') || '';
  const manifestLike =
    /mpegurl|m3u8|vnd\.apple\.mpegurl/i.test(contentType) ||
    /\.m3u8(?:$|\?)/i.test(target.toString());

  if (!manifestLike) {
    const sample = await response.arrayBuffer();
    return { playable: sample.byteLength > 64, reason: 'media-bytes-' + sample.byteLength };
  }

  const body = await response.text();
  if (!body.trimStart().startsWith('#EXTM3U')) {
    return { playable: false, reason: 'invalid-manifest' };
  }

  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (!lines.length) return { playable: false, reason: 'empty-manifest' };

  const child = new URL(lines[0], target.toString());
  if (/\.m3u8(?:$|\?)/i.test(child.toString())) {
    return probePlayableTarget(child.toString(), forwardedHeaders, depth + 1);
  }

  const segmentResponse = await fetchProbeTarget(child, forwardedHeaders, 'bytes=0-65535');
  if (!(segmentResponse.status === 200 || segmentResponse.status === 206)) {
    return { playable: false, reason: 'segment-status-' + segmentResponse.status };
  }

  const sample = await segmentResponse.arrayBuffer();
  return {
    playable: sample.byteLength > 64,
    reason: 'segment-bytes-' + sample.byteLength,
  };
}

async function fetchUpstream(req, target, forwardedHeaders) {
  const modes = retryModesFor(target);
  let lastResponse = null;
  let lastError = null;

  for (const mode of modes) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let response;
      try {
        response = await fetch(target, {
          method: req.method === 'HEAD' ? 'HEAD' : 'GET',
          headers: requestHeaders(req, forwardedHeaders, mode, target),
          redirect: 'follow',
          cache: 'no-store',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      lastResponse = response;
      if (response.ok || response.status < 400) {
        preferredModeByOrigin.set(target.origin, mode);
        return response;
      }

      // Retry an upstream failure with progressively safer CDN headers.
      if (![400, 401, 403, 404, 408, 409, 425, 429, 500, 502, 503, 504, 522, 524].includes(response.status)) {
        return response;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error('Upstream request failed');
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
  const probe = String(Array.isArray(req.query?.probe) ? req.query.probe[0] : req.query?.probe || '') === '1';

  if (!rawUrl) {
    return sendJson(res, 200, {
      name: 'Movyz Media Relay',
      version: '1.0.3',
      status: 'ok',
      runtime: 'vercel-node',
    });
  }

  try {
    const target = validateTarget(String(rawUrl));
    const upstreamRequestHeaders = parseHeaders(rawHeaders ? String(rawHeaders) : '');

    if (probe) {
      const result = await probePlayableTarget(target.toString(), upstreamRequestHeaders);
      return sendJson(res, result.playable ? 200 : 422, {
        status: result.playable ? 'ok' : 'unplayable',
        playable: result.playable,
        reason: result.reason,
      });
    }

    const upstream = await fetchUpstream(req, target, upstreamRequestHeaders);

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

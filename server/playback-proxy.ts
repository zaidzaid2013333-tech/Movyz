import type { NormalizedPlaybackSource } from './providers/types';

type ProxyPayload = {
  url: string;
  referer?: string;
  headers?: Record<string, string>;
  type?: string;
  exp: number;
};

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

async function keyFor(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function sign(payload: string, secret: string) {
  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    await keyFor(secret),
    new TextEncoder().encode(payload),
  ));
  return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function secretFromEnv(env: Record<string, unknown>) {
  return String(
    env.PLAYBACK_PROXY_SECRET ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    '',
  ).trim();
}

export async function createPlaybackProxyUrl(
  source: NormalizedPlaybackSource,
  requestUrl: string,
  env: Record<string, unknown>,
  ttlMs = 30 * 24 * 60 * 60 * 1000,
) {
  if (!source.url || !source.referer) return source.url || '';

  const secret = secretFromEnv(env);
  if (!secret) return source.url;

  const payload: ProxyPayload = {
    url: source.url,
    referer: source.referer,
    headers: source.headers,
    type: source.type,
    exp: Date.now() + Math.max(30_000, ttlMs),
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await sign(encoded, secret);
  const origin = new URL(requestUrl).origin;

  return `${origin}/api/v1/playback/stream?token=${encoded}.${signature}`;
}

async function verifyToken(token: string, env: Record<string, unknown>): Promise<ProxyPayload | null> {
  const secret = secretFromEnv(env);
  if (!secret) return null;

  const [encoded, signature] = token.split('.', 2);
  if (!encoded || !signature) return null;

  try {
    const signatureBytes = hexToBytes(signature);
    if (!signatureBytes) return null;

    const valid = await crypto.subtle.verify(
      'HMAC',
      await keyFor(secret),
      signatureBytes,
      new TextEncoder().encode(encoded),
    );
    if (!valid) return null;

    const payload = JSON.parse(base64UrlDecode(encoded)) as ProxyPayload;
    if (!payload || typeof payload.url !== 'string' || !/^https:\/\//i.test(payload.url)) return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function refreshStoredPlaybackProxyUrl(
  storedUrl: string,
  requestUrl: string,
  env: Record<string, unknown>,
) {
  try {
    const parsed = new URL(storedUrl);
    if (!parsed.pathname.endsWith('/api/v1/playback/stream')) return null;
    const token = parsed.searchParams.get('token') || '';
    if (!token) return null;

    const secret = secretFromEnv(env);
    if (!secret) return null;
    const [encoded, signature] = token.split('.', 2);
    if (!encoded || !signature) return null;
    const signatureBytes = hexToBytes(signature);
    if (!signatureBytes) return null;

    const valid = await crypto.subtle.verify(
      'HMAC',
      await keyFor(secret),
      signatureBytes,
      new TextEncoder().encode(encoded),
    );
    if (!valid) return null;

    const payload = JSON.parse(base64UrlDecode(encoded)) as ProxyPayload;
    if (!payload || typeof payload.url !== 'string' || !/^https:\/\//i.test(payload.url)) return null;

    const source: NormalizedPlaybackSource = {
      provider: 'arprov',
      type: (payload.type || 'direct') as NormalizedPlaybackSource['type'],
      url: payload.url,
      providerReference: 'arprov',
      quality: 'source',
      language: 'und',
      label: 'Prepared Playback',
      referer: payload.referer,
      headers: payload.headers,
    };

    return createPlaybackProxyUrl(source, requestUrl, env);
  } catch {
    return null;
  }
}

export async function handlePlaybackProxy(
  request: Request,
  env: Record<string, unknown>,
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const token = new URL(request.url).searchParams.get('token') || '';
  const payload = await verifyToken(token, env);
  if (!payload) {
    return new Response(JSON.stringify({
      success: false,
      error: { code: 'INVALID_PLAYBACK_TOKEN', message: 'Playback token is invalid or expired.' },
    }), {
      status: 403,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  // Redirect-only playback: Movyz resolves and validates the source, but never
  // streams the video bytes. The media remains hosted by Akwam.
  return new Response(null, {
    status: 302,
    headers: {
      Location: payload.url,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

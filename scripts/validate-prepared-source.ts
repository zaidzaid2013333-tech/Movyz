import type { NormalizedPlaybackSource } from '../server/providers/types';

const ALLOWED_TYPES = new Set(['mp4', 'hls', 'dash', 'webm', 'direct']);

function expectedContentType(type: string) {
  switch (type) {
    case 'mp4': return /^video\/(?:mp4|mpeg|quicktime)|application\/mp4|application\/octet-stream/i;
    case 'webm': return /^video\/webm|application\/octet-stream/i;
    case 'hls': return /^application\/vnd\.apple\.mpegurl|application\/x-mpegurl|audio\/mpegurl|text\/vtt|application\/octet-stream/i;
    case 'dash': return /^application\/dash\+xml|application\/octet-stream/i;
    case 'direct': return /^video\//i;
    default: return null;
  }
}

export async function validatePreparedMediaSource(
  source: NormalizedPlaybackSource,
): Promise<(NormalizedPlaybackSource & { url: string }) | null> {
  const url = String(source.url || '').trim();
  const type = String(source.type || '').trim().toLowerCase();
  const quality = String(source.quality || '').trim().toLowerCase();

  if (!/^https:\/\//i.test(url)) return null;
  if (!ALLOWED_TYPES.has(type)) return null;
  if (!/^\d{3,4}p$/i.test(quality)) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (/\/embed(?:\/|$)/i.test(parsed.pathname)) return null;

  const headers: Record<string, string> = {
    Accept: '*/*',
    Range: 'bytes=0-1',
    'User-Agent': 'Movyz-Prepared-Source/1.0',
  };
  if (source.referer) headers.Referer = source.referer;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });

    const status = response.status;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();

    try {
      await response.body?.cancel();
    } catch {}

    if (status !== 200 && status !== 206) return null;
    if (!contentType) return null;
    if (/text\/html|application\/json|text\/json/i.test(contentType)) return null;

    const matcher = expectedContentType(type);
    const path = response.url ? new URL(response.url).pathname.toLowerCase() : parsed.pathname.toLowerCase();
    const looksLikeMediaPath = /\.(?:mp4|webm|m3u8|mpd|m4v|mov|mkv|avi|mpeg|mpg|ts|m2ts|flv|3gp|3g2)(?:$|[?#])/i.test(path);

    if (matcher && matcher.test(contentType)) {
      return { ...source, url: response.url || url };
    }

    if (type === 'direct' && /^video\//i.test(contentType)) {
      return { ...source, url: response.url || url };
    }

    if (contentType === 'application/octet-stream' && looksLikeMediaPath) {
      return { ...source, url: response.url || url };
    }

    return null;
  } catch {
    return null;
  }
}

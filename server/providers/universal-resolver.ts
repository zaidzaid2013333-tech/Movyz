import { fetchWithTimeout, inferPlaybackType, inferQuality } from './http';

export type UniversalPlaybackType = 'hls' | 'mp4' | 'dash' | 'webm' | 'direct' | 'embed';

export interface UniversalPlaybackResult {
  type: UniversalPlaybackType;
  url: string;
  quality: string;
  label: string;
  resolvedFrom: string;
}

export interface UniversalResolverOptions {
  timeoutMs?: number;
  maxDepth?: number;
  maxHtmlBytes?: number;
}

function normalizeUrl(value: string, baseUrl?: string): string | null {
  if (!value.trim()) return null;

  const cleaned = value
    .trim()
    .replaceAll('\\/', '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/gi, '&')
    .replace(/^['\`"]|['\`"]$/g, '');

  try {
    const url = new URL(cleaned, baseUrl);
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isSafeExternalUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;

    const hostname = url.hostname.toLowerCase();
    const privateIpv4 =
      /^10\./.test(hostname) ||
      /^127\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);

    if (
      hostname === 'localhost' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.includes(':') ||
      privateIpv4
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function candidateUrlsFromText(text: string, baseUrl: string) {
  const found: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const normalized = normalizeUrl(raw, baseUrl);
    if (!normalized || !isSafeExternalUrl(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    found.push(normalized);
  };

  const streamRegex = /https?:\/\/[^\s"'<>]+(?:\.(?:m3u8|mpd|mp4|webm|m4v|mov|mkv|avi|mpeg|mpg|ogg|ogv|ts|m2ts|flv|3gp|3g2))(?:[?#][^\s"'<>]*)?/gi;
  for (const match of text.match(streamRegex) || []) add(match);

  const attributeRegex = /(?:src|data-src|file|url|stream|source|hls|dash)\s*[:=]\s*["'\x60]([^"'\x60]+)["'\x60]/gi;
  let attributeMatch: RegExpExecArray | null;
  while ((attributeMatch = attributeRegex.exec(text))) add(attributeMatch[1]);

  return found;
}

export function extractUniversalCandidates(text: string, baseUrl: string) {
  const direct: string[] = [];
  const embeds: string[] = [];
  const seenDirect = new Set<string>();
  const seenEmbed = new Set<string>();

  for (const url of candidateUrlsFromText(text, baseUrl)) {
    const type = inferPlaybackType(url);
    if (type && !seenDirect.has(url)) {
      seenDirect.add(url);
      direct.push(url);
    }
  }

  const iframeRegex = /<(?:iframe|embed)[^>]+(?:src|data-src)\s*=\s*["'\x60]([^"'\x60]+)["'\x60]/gi;
  let iframeMatch: RegExpExecArray | null;
  while ((iframeMatch = iframeRegex.exec(text))) {
    const url = normalizeUrl(iframeMatch[1], baseUrl);
    if (!url || !isSafeExternalUrl(url) || seenEmbed.has(url)) continue;
    seenEmbed.add(url);
    embeds.push(url);
  }

  return { direct, embeds };
}

function resultFromUrl(url: string, resolvedFrom: string): UniversalPlaybackResult | null {
  const type = inferPlaybackType(url);
  if (!type) return null;

  return {
    type,
    url,
    quality: inferQuality('', url),
    label: type === 'hls' ? 'Universal HLS' : type === 'dash' ? 'Universal DASH' : 'Universal MP4',
    resolvedFrom,
  };
}

async function resolveUrl(
  rawUrl: string,
  depth: number,
  options: Required<UniversalResolverOptions>,
  visited: Set<string>,
): Promise<UniversalPlaybackResult> {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized || !isSafeExternalUrl(normalized)) {
    throw new Error('Only safe HTTPS playback sources are supported');
  }

  const direct = resultFromUrl(normalized, normalized);
  if (direct) return direct;

  if (visited.has(normalized)) {
    return {
      type: 'embed',
      url: normalized,
      quality: 'auto',
      label: 'Embedded source',
      resolvedFrom: normalized,
    };
  }
  visited.add(normalized);

  let response: Response;
  try {
    response = await fetchWithTimeout(normalized, {
      method: 'GET',
      redirect: 'follow',
      timeoutMs: options.timeoutMs,
      headers: {
        Accept: 'text/html,application/json,application/vnd.apple.mpegurl,application/dash+xml,video/mp4,*/*;q=0.8',
        Referer: normalized,
        'User-Agent': 'Movyza-Universal-Resolver/1.0',
      },
    });
  } catch {
    return {
      type: 'embed',
      url: normalized,
      quality: 'auto',
      label: 'Embedded source',
      resolvedFrom: normalized,
    };
  }

  const finalUrl = normalizeUrl(response.url || normalized) || normalized;
  const directFinal = resultFromUrl(finalUrl, normalized);
  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  if (directFinal) return directFinal;
  if (contentType.includes('mpegurl')) {
    return {
      type: 'hls',
      url: finalUrl,
      quality: inferQuality('', finalUrl),
      label: 'Universal HLS',
      resolvedFrom: normalized,
    };
  }
  if (contentType.includes('dash+xml')) {
    return {
      type: 'dash',
      url: finalUrl,
      quality: inferQuality('', finalUrl),
      label: 'Universal DASH',
      resolvedFrom: normalized,
    };
  }
  if (contentType.includes('video/mp4')) {
    return {
      type: 'mp4',
      url: finalUrl,
      quality: inferQuality('', finalUrl),
      label: 'Universal MP4',
      resolvedFrom: normalized,
    };
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > options.maxHtmlBytes) {
    return {
      type: 'embed',
      url: finalUrl,
      quality: 'auto',
      label: 'Embedded source',
      resolvedFrom: normalized,
    };
  }

  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  if (body.length > options.maxHtmlBytes) body = body.slice(0, options.maxHtmlBytes);

  const { direct: directCandidates, embeds } = extractUniversalCandidates(body, finalUrl);
  for (const candidate of directCandidates) {
    const result = resultFromUrl(candidate, normalized);
    if (result) return result;
  }

  if (depth < options.maxDepth) {
    for (const embed of embeds.slice(0, 3)) {
      const nested = await resolveUrl(embed, depth + 1, options, visited);
      if (nested.type !== 'embed') return nested;
      if (nested.url !== finalUrl) {
        return nested;
      }
    }
  }

  return {
    type: 'embed',
    url: finalUrl,
    quality: 'auto',
    label: 'Embedded source',
    resolvedFrom: normalized,
  };
}

export async function resolveUniversalSource(
  rawUrl: string,
  options: UniversalResolverOptions = {},
): Promise<UniversalPlaybackResult> {
  const resolvedOptions: Required<UniversalResolverOptions> = {
    timeoutMs: Math.max(1_500, options.timeoutMs ?? Number(process.env.MOVYZA_UNIVERSAL_RESOLVER_TIMEOUT_MS || 7_000)),
    maxDepth: Math.max(0, Math.min(2, options.maxDepth ?? 2)),
    maxHtmlBytes: Math.max(64_000, options.maxHtmlBytes ?? 1_500_000),
  };

  return resolveUrl(
    rawUrl,
    0,
    resolvedOptions,
    new Set<string>(),
  );
}

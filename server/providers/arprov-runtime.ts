import { fetchWithTimeout } from './http';

export type ArProvBrowserBinding = unknown;

export interface ArProvPage {
  body: string;
  url: string;
  status: number;
  contentType: string;
  via: 'http';
}

const pageCache = new Map<string, { expiresAt: number; value: ArProvPage }>();
const negativeCache = new Map<string, number>();

const PAGE_TTL_MS = 90_000;
const NEGATIVE_TTL_MS = 8_000;

function cacheKey(url: string) {
  return url.trim();
}

function cached(url: string) {
  const entry = pageCache.get(cacheKey(url));
  if (!entry || entry.expiresAt <= Date.now()) {
    pageCache.delete(cacheKey(url));
    return null;
  }
  return entry.value;
}

function save(url: string, value: ArProvPage) {
  pageCache.set(cacheKey(url), { expiresAt: Date.now() + PAGE_TTL_MS, value });
}

async function fetchHttp(url: string, referer?: string, timeoutMs = 9_000): Promise<ArProvPage> {
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    redirect: 'follow',
    timeoutMs,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
      'Accept-Language': 'ar,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Referer: referer || new URL(url).origin + '/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  const finalUrl = response.url || url;

  const result: ArProvPage = {
    body,
    url: finalUrl,
    status: response.status,
    contentType,
    via: 'http',
  };

  if (response.ok && body) save(url, result);
  return result;
}

/**
 * HTTP-only page fetcher.
 *
 * Browser Run is intentionally not part of the Akwam path anymore. The
 * compatibility options remain so older callers compile, but they are ignored.
 */
export async function fetchArProvPage(
  url: string,
  options: {
    referer?: string;
    browserBinding?: ArProvBrowserBinding;
    timeoutMs?: number;
    forceBrowser?: boolean;
  } = {},
): Promise<ArProvPage | null> {
  void options.browserBinding;
  void options.forceBrowser;

  const cachedValue = cached(url);
  if (cachedValue) return cachedValue;

  const negativeUntil = negativeCache.get(cacheKey(url)) || 0;
  if (negativeUntil > Date.now()) return null;

  const timeoutMs = Math.max(3_000, Math.min(20_000, options.timeoutMs ?? 9_000));

  try {
    const page = await fetchHttp(url, options.referer, timeoutMs);
    if (page.status >= 200 && page.status < 400 && page.body) return page;

    negativeCache.set(cacheKey(url), Date.now() + NEGATIVE_TTL_MS);
    return page.body ? page : null;
  } catch (error) {
    console.warn('[arprov-http]', error instanceof Error ? error.message : String(error));
    negativeCache.set(cacheKey(url), Date.now() + NEGATIVE_TTL_MS);
    return null;
  }
}

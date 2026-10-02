import { fetchWithTimeout } from './http';

export type ArProvBrowserBinding = any;

export interface ArProvPage {
  body: string;
  url: string;
  status: number;
  contentType: string;
  via: 'http' | 'browser';
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

  if (response.ok) save(url, result);
  return result;
}

async function fetchBrowser(
  url: string,
  referer?: string,
  browserBinding?: ArProvBrowserBinding,
  timeoutMs = 14_000,
): Promise<ArProvPage | null> {
  if (!browserBinding) return null;

  try {
    const { launch } = await import('@cloudflare/playwright');
    const browser = await launch(browserBinding);
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'ar,en;q=0.8',
        Referer: referer || new URL(url).origin + '/',
      },
    });
    const page = await context.newPage();

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    }).catch(() => null);

    await page.waitForLoadState('networkidle', { timeout: Math.min(5_000, timeoutMs) }).catch(() => {});

    const body = await page.content();
    const finalUrl = page.url() || url;
    const status = response?.status() || 200;

    await context.close().catch(() => {});
    await browser.close().catch(() => {});

    const result: ArProvPage = {
      body,
      url: finalUrl,
      status,
      contentType: 'text/html',
      via: 'browser',
    };

    if (body) save(url, result);
    return result;
  } catch (error) {
    console.warn('[arprov-browser]', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function fetchArProvPage(
  url: string,
  options: {
    referer?: string;
    browserBinding?: ArProvBrowserBinding;
    timeoutMs?: number;
    forceBrowser?: boolean;
  } = {},
): Promise<ArProvPage | null> {
  const cachedValue = cached(url);
  if (cachedValue && !options.forceBrowser) return cachedValue;

  const negativeUntil = negativeCache.get(cacheKey(url)) || 0;
  if (negativeUntil > Date.now() && !options.forceBrowser) return null;

  const timeoutMs = Math.max(3_000, Math.min(20_000, options.timeoutMs ?? 9_000));

  if (!options.forceBrowser) {
    try {
      const http = await fetchHttp(url, options.referer, timeoutMs);
      if (http.status >= 200 && http.status < 400 && http.body) return http;

      const shouldEscalate = Boolean(options.browserBinding) && [401, 403, 408, 409, 425, 429, 451, 500, 502, 503, 504].includes(http.status);
      if (!shouldEscalate) {
        negativeCache.set(cacheKey(url), Date.now() + NEGATIVE_TTL_MS);
        return http.body ? http : null;
      }
    } catch {
      // Escalate to Browser Run when available.
    }
  }

  const browser = await fetchBrowser(url, options.referer, options.browserBinding, timeoutMs + 4_000);
  if (browser?.body) return browser;

  negativeCache.set(cacheKey(url), Date.now() + NEGATIVE_TTL_MS);
  return null;
}

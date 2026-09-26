import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import {
  absoluteHttpsUrl,
  fetchWithTimeout,
  inferPlaybackType,
  inferQuality,
} from '../http';

const DEFAULT_HOSTS = [
  'https://web31818x.faselhdx.bid',
  'https://web6712x.faselhdx.bid',
  'https://www.fasel-hd.cam',
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const PAGE_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
  'User-Agent': USER_AGENT,
  'Cache-Control': 'no-cache',
};

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/^(?:ال|the)\s+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreTitle(candidate: string, target: string) {
  const a = normalizeText(candidate);
  const b = normalizeText(target);
  if (!a || !b) return 0;
  if (a === b) return 1000;
  if (a.includes(b) || b.includes(a)) return 800;

  const tokens = b.split(' ').filter((token) => token.length >= 2);
  if (!tokens.length) return 0;
  const hits = tokens.filter((token) => a.includes(token)).length;
  return Math.round((hits / tokens.length) * 700);
}

function resolveUrl(raw: string, baseUrl: string) {
  const cleaned = decodeHtml(raw).replaceAll('\\/', '/').trim();
  try {
    return new URL(cleaned, baseUrl).toString();
  } catch {
    return null;
  }
}

function isBlockedHtml(html: string) {
  const sample = stripTags(html).slice(0, 20_000).toLowerCase();
  return (
    sample.includes('just a moment') ||
    sample.includes('performing security verification') ||
    sample.includes('verifying you are not a bot') ||
    sample.includes('access denied') ||
    sample.includes('cloudflare')
  );
}

async function getHtml(url: string, timeoutMs: number, referer?: string) {
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    redirect: 'follow',
    timeoutMs,
    headers: {
      ...PAGE_HEADERS,
      ...(referer ? { Referer: referer } : {}),
      ...(referer ? { Origin: new URL(referer).origin } : {}),
    },
  });

  const html = await response.text();
  if (!response.ok || isBlockedHtml(html)) return null;

  return { html, finalUrl: response.url || url };
}

type SearchResult = { title: string; url: string };

function extractSearchResults(html: string, baseUrl: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,1800}?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html))) {
    const url = resolveUrl(match[1], baseUrl);
    if (!url) continue;

    let parsed: URL;
    try { parsed = new URL(url); } catch { continue; }
    if (parsed.hostname !== new URL(baseUrl).hostname) continue;
    if (parsed.searchParams.has('s') || /\/page\/\d+\/?$/i.test(parsed.pathname)) continue;

    const title = stripTags(match[2]);
    if (!title || title.length > 140) continue;
    if (!/(movie|film|series|episode|episodes|tv|anime|season|مسلسل|فيلم|حلقة|الموسم)/i.test(parsed.pathname + ' ' + title)) {
      continue;
    }

    const key = parsed.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ title, url: key });
  }

  return results;
}

function extractMediaUrls(html: string, baseUrl: string) {
  const found = new Set<string>();
  const add = (raw: string) => {
    const resolved = resolveUrl(raw, baseUrl);
    if (!resolved || !absoluteHttpsUrl(resolved)) return;
    const lower = resolved.toLowerCase();
    if (lower.includes('.m3u8') || lower.includes('.mp4')) found.add(resolved);
  };

  const absoluteRe = /https?:\/\/[^\s"'<>\\]+?(?:\.m3u8(?:\?[^"'<>\\]*)?|\.mp4(?:\?[^"'<>\\]*)?)/gi;
  for (const match of html.match(absoluteRe) || []) add(match);

  const relativeRe = /["'\x60]((?:\\\/|\/)\s*[^"'\x60]+?(?:\.m3u8(?:\?[^"'\x60]*)?|\.mp4(?:\?[^"'\x60]*)?))["'\x60]/gi;
  let match: RegExpExecArray | null;
  while ((match = relativeRe.exec(html))) add(match[1]);

  const jsonRe = /["'](?:file|src)["']\s*[:=]\s*["']([^"']+?(?:\.m3u8(?:\?[^"'\\]*)?|\.mp4(?:\?[^"'\\]*)?))["']/gi;
  while ((match = jsonRe.exec(html))) add(match[1]);

  return [...found];
}

function extractPlayerUrls(html: string, pageUrl: string) {
  const candidates = new Set<string>();
  const add = (raw: string) => {
    const resolved = resolveUrl(raw, pageUrl);
    if (resolved && /videoplayer|video_player/i.test(resolved)) candidates.add(resolved);
  };

  const iframeRe = /<iframe\b[^>]+(?:data-src|src)\s*=\s*["']([^"']*(?:videoplayer|video_player)[^"']*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = iframeRe.exec(html))) add(match[1]);

  const tokenRe = /(?:playertoken|player_token)=([^\s'"&<]+)/gi;
  while ((match = tokenRe.exec(html))) add('/videoplayer?playertoken=' + match[1]);

  const locationRe = /playeriframe\.location\.href\s*=\s*["']([^"']+)["']/gi;
  while ((match = locationRe.exec(html))) add(match[1]);

  return [...candidates];
}

function episodeNumberScore(titleOrUrl: string, episode: number) {
  const value = normalizeText(titleOrUrl);
  const exact = new RegExp('(?:^|\\s)(?:e|ep|episode|الحلقة)\\s*0*' + episode + '(?:\\s|$)', 'i');
  const compact = new RegExp('(?:episode|ep|-|_)0*' + episode + '(?:\\D|$)', 'i');
  if (exact.test(value)) return 1000;
  if (compact.test(value)) return 900;
  if (value.includes(' 0' + episode) || value.includes(' ' + episode)) return 300;
  return 0;
}

function seasonNumberFromText(value: string) {
  const normalized = normalizeText(value);
  const match = normalized.match(/(?:season|s|الموسم|موسم)\s*0*(\d{1,2})/i);
  return match ? Number(match[1]) : null;
}

function extractAnchors(html: string, baseUrl: string) {
  const out: SearchResult[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,2200}?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const url = resolveUrl(match[1], baseUrl);
    if (!url) continue;
    try {
      if (new URL(url).hostname !== new URL(baseUrl).hostname) continue;
    } catch { continue; }
    const title = stripTags(match[2]);
    if (!title || title.length > 160) continue;
    out.push({ title, url });
  }
  return out;
}

async function resolveHost(timeoutMs: number) {
  for (const host of DEFAULT_HOSTS) {
    try {
      const result = await getHtml(host + '/', Math.min(timeoutMs, 7000));
      if (result) return new URL(result.finalUrl).origin;
    } catch {
      // Keep trying the next known host.
    }
  }
  return null;
}

async function findContentPage(host: string, context: ProviderContext, timeoutMs: number, episodeMode: boolean) {
  const queries = [context.title, context.originalTitle]
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index) as string[];

  let best: { score: number; url: string } | null = null;

  for (const query of queries) {
    const searchUrl = host + '/?s=' + encodeURIComponent(query);
    const result = await getHtml(searchUrl, timeoutMs, host);
    if (!result) continue;

    for (const item of extractSearchResults(result.html, result.finalUrl)) {
      let score = Math.max(
        scoreTitle(item.title, query),
        scoreTitle(item.title, context.originalTitle || query),
      );
      const episodeLike = /\/episodes?\//i.test(item.url);
      if (episodeMode && episodeLike) score += 100;
      if (!episodeMode && episodeLike) score -= 150;
      if (!best || score > best.score) best = { score, url: item.url };
    }
  }

  return best && best.score >= 180 ? best.url : null;
}

async function findEpisodePage(host: string, context: ProviderContext, timeoutMs: number) {
  const seriesUrl = await findContentPage(host, context, timeoutMs, false);
  if (!seriesUrl) return null;

  const seriesPage = await getHtml(seriesUrl, timeoutMs, host);
  if (!seriesPage) return null;

  const seasonLinks = extractAnchors(seriesPage.html, seriesPage.finalUrl)
    .map((item) => ({
      ...item,
      season: seasonNumberFromText(item.title) ?? seasonNumberFromText(item.url),
    }))
    .filter((item) => item.season != null);

  const selectedSeason = seasonLinks.find((item) => item.season === context.seasonNumber);
  const pages = [selectedSeason?.url, seriesPage.finalUrl]
    .filter((value, index, all) => value && all.indexOf(value) === index) as string[];

  let best: { score: number; url: string } | null = null;

  for (const pageUrl of pages) {
    const page = pageUrl === seriesPage.finalUrl
      ? seriesPage
      : await getHtml(pageUrl, timeoutMs, seriesPage.finalUrl);
    if (!page) continue;

    for (const item of extractAnchors(page.html, page.finalUrl)) {
      const text = item.title + ' ' + item.url;
      if (!/episode|episodes|الحلقة/i.test(text)) continue;

      const score = episodeNumberScore(text, context.episodeNumber ?? 0);
      if (!best || score > best.score) best = { score, url: item.url };
    }

    if (best && best.score >= 900) break;
  }

  return best ? best.url : null;
}

async function resolveDirectFromPage(pageUrl: string, timeoutMs: number): Promise<string[]> {
  const page = await getHtml(pageUrl, timeoutMs);
  if (!page) return [];

  const direct = extractMediaUrls(page.html, page.finalUrl);
  if (direct.length) return direct;

  const players = extractPlayerUrls(page.html, page.finalUrl);
  for (const playerUrl of players.slice(0, 4)) {
    const player = await getHtml(playerUrl, timeoutMs, page.finalUrl);
    if (!player) continue;

    const media = extractMediaUrls(player.html, player.finalUrl);
    if (media.length) return media;
  }

  return [];
}


function isMediaUrl(url: string) {
  const lower = url.toLowerCase();
  return lower.includes('.m3u8') || lower.includes('.mp4') || lower.includes('.mpd');
}

async function extractWithBrowser(
  host: string,
  context: ProviderContext,
  kind: 'movie' | 'episode',
  timeoutMs: number,
): Promise<string[]> {
  const { getFaselHdBrowserBinding } = await import('../faselhd-browser');
  const binding = getFaselHdBrowserBinding();
  if (!binding) return [];

  try {
    const { launch } = await import('@cloudflare/playwright');
    const browser = await launch(binding as any);
    const page = await browser.newPage();
    const mediaUrls = new Set<string>();

    const capture = (raw: string) => {
      const resolved = resolveUrl(raw, page.url());
      if (resolved && absoluteHttpsUrl(resolved) && isMediaUrl(resolved)) {
        mediaUrls.add(resolved);
      }
    };

    page.on('response', async (response: any) => {
      try {
        const url = response.url();
        const headers = response.headers ? response.headers() : {};
        const type = String(headers?.['content-type'] || '').toLowerCase();
        if (isMediaUrl(url) || type.includes('mpegurl') || type.includes('dash+xml') || type.startsWith('video/')) {
          capture(url);
        }
      } catch {
        // Ignore a single network event.
      }
    });

    const visit = async (url: string) => {
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: Math.max(20_000, Math.min(45_000, timeoutMs * 4)),
        });
      } catch {
        // A challenge/navigation timeout may still leave useful page state.
      }

      try {
        await page.waitForTimeout(8_000);
      } catch {
        // Ignore wait failures.
      }

      try {
        const html = await page.content();
        for (const media of extractMediaUrls(html, page.url())) capture(media);

        const domUrls = await page.evaluate(() =>
          Array.from(document.querySelectorAll('video,source,iframe,a'))
            .map((node) => node.getAttribute('src') || node.getAttribute('data-src') || node.getAttribute('href') || '')
            .filter(Boolean),
        );

        for (const raw of domUrls) capture(String(raw));
        return html;
      } catch {
        return '';
      }
    };

    const queries = [context.title, context.originalTitle]
      .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index) as string[];

    let contentPage: string | null = null;

    for (const query of queries) {
      const html = await visit(host + '/?s=' + encodeURIComponent(query));
      if (mediaUrls.size) break;

      const candidates = [
        ...extractSearchResults(html, page.url()),
        ...extractAnchors(html, page.url()),
      ];

      let best: { score: number; url: string } | null = null;
      for (const item of candidates) {
        const episodeLike = /\/episodes?\//i.test(item.url);
        const score = Math.max(
          scoreTitle(item.title, query),
          scoreTitle(item.title, context.originalTitle || query),
        ) + (kind === 'episode' ? (episodeLike ? 100 : 0) : (episodeLike ? -150 : 0));

        if (!best || score > best.score) best = { score, url: item.url };
      }

      if (best && best.score >= 120) {
        contentPage = best.url;
        break;
      }
    }

    if (!contentPage || mediaUrls.size) {
      await browser.close();
      return [...mediaUrls];
    }

    if (kind === 'episode') {
      const seriesHtml = await visit(contentPage);
      const seasons = extractAnchors(seriesHtml, page.url())
        .map((item) => ({
          ...item,
          season: seasonNumberFromText(item.title) ?? seasonNumberFromText(item.url),
        }))
        .filter((item) => item.season != null);

      const seasonUrl = seasons.find((item) => item.season === context.seasonNumber)?.url;
      const episodeContainer = seasonUrl || contentPage;
      const episodeHtml = await visit(episodeContainer);

      let bestEpisode: { score: number; url: string } | null = null;
      for (const item of extractAnchors(episodeHtml, page.url())) {
        const combined = item.title + ' ' + item.url;
        if (!/episode|episodes|الحلقة/i.test(combined)) continue;
        const score = episodeNumberScore(combined, context.episodeNumber ?? 0);
        if (!bestEpisode || score > bestEpisode.score) bestEpisode = { score, url: item.url };
      }

      contentPage = bestEpisode?.url || episodeContainer;
    }

    const contentHtml = await visit(contentPage);
    const playerUrls = new Set(extractPlayerUrls(contentHtml, page.url()));

    const frameUrls = await page.locator('iframe').evaluateAll((frames: Element[]) =>
      frames
        .map((frame) => frame.getAttribute('src') || frame.getAttribute('data-src') || '')
        .filter(Boolean),
    );
    for (const raw of frameUrls) {
      const resolved = resolveUrl(String(raw), page.url());
      if (resolved && /videoplayer|video_player/i.test(resolved)) playerUrls.add(resolved);
    }

    for (const playerUrl of [...playerUrls].slice(0, 5)) {
      await visit(playerUrl);
      if (mediaUrls.size) break;
    }

    await browser.close();
    return [...mediaUrls];
  } catch (error) {
    console.error('[faselhd-browser]', error instanceof Error ? error.message : error);
    return [];
  }
}

export function createFaselHdAdapter(): ProviderAdapter {
  const timeoutMs = Math.max(4_000, Number(process.env.MOVYZA_PROVIDER_TIMEOUT_MS || 10_000));
  let cachedHost: string | null = null;

  const getHost = async () => {
    if (cachedHost) return cachedHost;
    cachedHost = await resolveHost(timeoutMs);
    return cachedHost || DEFAULT_HOSTS[0] || null;
  };

  const resolve = async (context: ProviderContext, kind: 'movie' | 'episode') => {
    const host = await getHost();
    if (!host || (!context.title && !context.originalTitle)) return [];

    const pageUrl = kind === 'episode'
      ? await findEpisodePage(host, context, timeoutMs)
      : await findContentPage(host, context, timeoutMs, false);

    let urls = pageUrl ? await resolveDirectFromPage(pageUrl, timeoutMs) : [];
    if (!urls.length) {
      urls = await extractWithBrowser(host, context, kind, timeoutMs);
    }
    return urls.flatMap((url, index): NormalizedPlaybackSource[] => {
      const type = inferPlaybackType(url);
      if (!type) return [];
      return [{
        provider: 'faselhd',
        type,
        url,
        providerReference: [
          String(context.tmdbId ?? ''),
          String(context.seasonNumber ?? ''),
          String(context.episodeNumber ?? ''),
        ].join(':'),
        quality: inferQuality('server-' + (index + 1), url),
        language: 'ar',
        label: index === 0 ? 'FaselHD' : 'FaselHD ' + (index + 1),
      }];
    });
  };

  return {
    key: 'faselhd',
    name: 'FaselHD',
    enabled: true,
    requiresMapping: false,
    resolveMovie: (context) => resolve(context, 'movie'),
    resolveEpisode: (context) => resolve(context, 'episode'),
    health: async () => {
      const started = Date.now();
      const host = await getHost();
      return host
        ? { status: 'healthy' as const, latencyMs: Date.now() - started }
        : {
            status: 'offline' as const,
            latencyMs: Date.now() - started,
            message: 'FaselHD host is unreachable or returned a verification page',
          };
    },
  };
}

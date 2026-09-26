import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from '../types';
import {
  absoluteHttpsUrl,
  fetchWithTimeout,
  inferPlaybackType,
  inferQuality,
} from '../http';

const DEFAULT_HOSTS = [
  'https://faselhd.vip',
  'https://www.faselhd.vip',
  'https://faselhd.one',
  'https://www.faselhd.one',
  'https://faselhd.ac',
  'https://www.faselhd.ac',
  'https://faselhd.live',
  'https://www.faselhd.live',
  'https://faselhd.pro',
  'https://www.faselhd.pro',
  'https://faselhd.express',
  'https://www.faselhd.express',
  'https://web31818x.faselhdx.bid',
  'https://web6712x.faselhdx.bid',
  'https://www.fasel-hd.cam',
  'https://faselhd.io',
  'https://www.faselhd.club',
  'https://faselhd.club',
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const PAGE_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
  'User-Agent': USER_AGENT,
  'Cache-Control': 'no-cache',
};


const FASELHD_CONTENT_API =
  'https://netcore.faselhd.pro/api/v1.0/Content/GetContent';
const FASELHD_PLAYER_API = 'https://faselhd-embed.scdns.io/video_player';

const FASELHD_UPSTREAM_TOKEN = 'CMrdhDW04Ce9ZcWFsNCAgTKCMHKD88bjgxomBVOL+VDippsR9/YvclNOKrYwRSRYYwP0uJ6AXtUFMk1iNdQgGsFC2G/5fO05l4hGbODXi41X91/TbE117NdC0fl/ZRKBu1kn08dQIoG4GvW9ypci03/DxjqPHzVffnegq4WRy+NZ0BPbob3pf2TODnKj1Zc7iR+fSQVE479J/V3dMm46N41AjfJuXFpyj1wxg0husAnVpj647nv0EDBc+kOC+CtdLOV/LFvzoxj+fEKkzhEJ1wC9IqI3J6+DIkoYg8Skvjm+yfIHewNGmAhrb0MMi+v28AeimhfMIHq28QgyKI0Sulkm8coU+a/O';

async function fetchFaselContent(id: number, timeoutMs: number) {
  const url = FASELHD_CONTENT_API + '?ContentId=' + encodeURIComponent(String(id));
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs,
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + FASELHD_UPSTREAM_TOKEN,
      'User-Agent': USER_AGENT,
    },
  });

  const text = await response.text();
  if (!response.ok) return null;

  try {
    const payload = JSON.parse(text);
    return payload?.statusCode === 1 ? payload.result ?? null : null;
  } catch {
    return null;
  }
}

function decodeBase64Ascii(value: string) {
  try {
    const binary = atob(value);
    let output = '';
    for (let index = 0; index < binary.length; index += 1) {
      output += String.fromCharCode(binary.charCodeAt(index));
    }
    return output;
  } catch {
    return '';
  }
}

async function resolveUpstreamVideoId(videoId: string, timeoutMs: number): Promise<string[]> {
  const url = FASELHD_PLAYER_API + '?uid=0&vid=' + encodeURIComponent(videoId);
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs,
    headers: {
      Accept: 'text/plain,text/html,*/*;q=0.8',
      Referer: 'https://faselhd.io/',
      'User-Agent': USER_AGENT,
    },
  });

  const script = await response.text();
  if (!response.ok || !script) return [];

  const code = [...script.matchAll(/\/g.....(.*?)\)/gm)][0]?.[1] || null;
  if (!code) return [];

  const cleanedScript = script.replace(/['+\n]/g, '');
  const chunks = cleanedScript.split('.');
  let page = '';

  for (const chunk of chunks) {
    const decoded = decodeBase64Ascii(chunk + '==');
    const digits = decoded.match(/\d+/g);
    if (digits?.length) {
      const next = Number.parseInt(digits[0], 10) + Number.parseInt(code, 10);
      if (Number.isFinite(next)) page += String.fromCharCode(next);
    }
  }

  const directListUrl = page.match(/file":"(.+?)"/s)?.[1] || '';
  if (!directListUrl) return [];

  const playlistResponse = await fetchWithTimeout(directListUrl, {
    method: 'GET',
    timeoutMs,
    headers: {
      Accept: 'application/vnd.apple.mpegurl,text/plain,*/*;q=0.8',
      Referer: FASELHD_PLAYER_API,
      'User-Agent': USER_AGENT,
    },
  });

  const playlist = await playlistResponse.text();
  if (!playlistResponse.ok || !playlist) return [];

  const urls = new Map<string, string>();
  let pendingQuality = 'auto';

  for (const line of playlist.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const resolution = trimmed.match(/RESOLUTION=\d+x(\d+)/i);
    if (resolution) pendingQuality = resolution[1] + 'p';

    if (/^https:\/\//i.test(trimmed) && /\.m3u8(?:\?|$)/i.test(trimmed)) {
      const quality = inferQuality(pendingQuality, trimmed);
      urls.set(trimmed, quality);
      pendingQuality = 'auto';
    }
  }

  if (!urls.size) {
    for (const raw of playlist.match(/https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?/gi) || []) {
      if (/^https:\/\//i.test(raw)) urls.set(raw, inferQuality('', raw));
    }
  }

  return [...urls.entries()].map(([url]) => url);
}

async function resolveDirectFromFaselUpstream(
  context: ProviderContext,
  kind: 'movie' | 'episode',
  timeoutMs: number,
): Promise<string[]> {
  if (!context.tmdbId) return [];

  const content = await fetchFaselContent(Number(context.tmdbId), timeoutMs);
  if (!content) return [];

  if (kind === 'movie') {
    const videoId = content.videoId ? String(content.videoId) : '';
    return videoId ? resolveUpstreamVideoId(videoId, timeoutMs) : [];
  }

  const targetEpisode = Number(context.episodeNumber || 0);
  if (!targetEpisode || !Array.isArray(content.episodesVideosIds)) return [];

  const episode = content.episodesVideosIds[targetEpisode - 1];
  const videoId = episode?.videoId ? String(episode.videoId) : '';
  return videoId ? resolveUpstreamVideoId(videoId, timeoutMs) : [];
}

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
function looksLikeFaselSite(html: string) {
  const lower = html.toLowerCase();
  const markers = [
    'faselhd',
    'فاصل',
    'postdiv',
    'posterimg',
    'player_iframe',
    'episodes',
    'serverslist',
  ];
  return markers.filter((marker) => lower.includes(marker)).length >= 2;
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

  const dataUrlRe = /(?:data-url|data-src|src)\s*=\s*["']([^"']+?(?:\.m3u8(?:\?[^"'\\]*)?|\.mp4(?:\?[^"'\\]*)?))["']/gi;
  while ((match = dataUrlRe.exec(html))) add(match[1]);

  return [...found];
}

function extractPlayerUrls(html: string, pageUrl: string) {
  const candidates = new Set<string>();
  const add = (raw: string) => {
    const resolved = resolveUrl(raw, pageUrl);
    if (resolved && /videoplayer|video_player/i.test(resolved)) candidates.add(resolved);
  };

  const iframeRe = /<iframe\b[^>]+(?:name\s*=\s*["']player_iframe["'][^>]*|(?:data-src|src)\s*=\s*["']([^"']*(?:videoplayer|video_player|player_iframe)[^"']*)["'])/gi;
  let match: RegExpExecArray | null;
  while ((match = iframeRe.exec(html))) {
    const raw = match[1] || match[0].match(/(?:data-src|src)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (raw) add(raw);
  }

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
      if (result && looksLikeFaselSite(result.html)) return new URL(result.finalUrl).origin;
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

    let urls = await resolveDirectFromFaselUpstream(context, kind, timeoutMs);

    if (!urls.length) {
      const pageUrl = kind === 'episode'
        ? await findEpisodePage(host, context, timeoutMs)
        : await findContentPage(host, context, timeoutMs, false);

      urls = pageUrl ? await resolveDirectFromPage(pageUrl, timeoutMs) : [];
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

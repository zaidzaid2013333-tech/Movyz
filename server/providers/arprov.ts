import { fetchWithTimeout, inferPlaybackType, inferQuality } from './http';
import { resolveUniversalSource, extractUniversalCandidates } from './universal-resolver';
import type { NormalizedPlaybackSource, ProviderContext } from './types';

type Site = {
  key: string;
  name: string;
  base: string;
  searches: (q: string) => string[];
};

const timeoutMs = Math.min(Math.max(Number(process.env.MOVYZ_ARPROV_TIMEOUT_MS || 7000), 3000), 12000);
const inflight = new Map<string, Promise<NormalizedPlaybackSource[]>>();

const sites: Site[] = [
  {
    key: 'akwam',
    name: 'Akwam',
    base: 'https://akwam.ss',
    searches: q => [
      'https://akwam.ss/search?q=' + encodeURIComponent(q),
      'https://akwam.ss/?s=' + encodeURIComponent(q),
    ],
  },
  {
    key: 'cima4u',
    name: 'Cima4U',
    base: 'https://cfu.cam',
    searches: q => [
      'https://cfu.cam/?s=' + encodeURIComponent(q),
      'https://cfu.cam/search/?s=' + encodeURIComponent(q),
    ],
  },
  {
    key: 'cimaclub',
    name: 'CimaClub',
    base: 'https://ciimaclub.us',
    searches: q => [
      'https://ciimaclub.us/?s=' + encodeURIComponent(q),
      'https://ciimaclub.us/search?s=' + encodeURIComponent(q),
    ],
  },
];

function https(raw: string, base?: string) {
  try {
    const u = new URL(raw.trim(), base);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function clean(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function norm(value: string) {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function identity(value: string) {
  const text = String(value || '');
  const x =
    text.match(/(?:^|[^a-z])s(?:eason)?[\s._-]*(\d{1,3})[\s._-]*e(?:pisode)?[\s._-]*(\d{1,3})(?:[^0-9]|$)/i) ||
    text.match(/(?:season|الموسم)[^0-9]*(\d{1,3})[^0-9]+(?:episode|الحلقة|حلقه|ep)[^0-9]*(\d{1,3})/i);
  if (x) return { season: Number(x[1]), episode: Number(x[2]) };
  const e = text.match(/(?:episode|الحلقة|حلقه|ep)[^0-9]*(\d{1,3})/i);
  const s = text.match(/(?:season|الموسم)[^0-9]*(\d{1,3})/i);
  return { season: s ? Number(s[1]) : undefined, episode: e ? Number(e[1]) : undefined };
}

function score(text: string, url: string, ctx: ProviderContext) {
  const hay = norm(text + ' ' + url);
  const titles = [ctx.title, ctx.originalTitle, ...(ctx.alternateTitles || [])]
    .filter((x): x is string => Boolean(x && x.trim())).map(norm).filter(Boolean);

  let n = 0;
  for (const title of titles) {
    if (hay === title) n += 1800;
    else if (hay.includes(title)) n += 1000;
    else n += title.split(' ').filter(x => x.length > 2 && hay.includes(x)).length * 60;
  }
  if (ctx.releaseYear && hay.includes(String(ctx.releaseYear))) n += 100;

  const id = identity(text + ' ' + url);
  if (ctx.episodeNumber !== undefined) n += id.episode === ctx.episodeNumber ? 900 : id.episode !== undefined ? -900 : 0;
  if (ctx.seasonNumber !== undefined) n += id.season === ctx.seasonNumber ? 500 : id.season !== undefined ? -400 : 0;
  return n;
}

function anchors(html: string, base: string) {
  const out: Array<{url: string; text: string}> = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = https(m[1], base);
    if (!url || seen.has(url)) continue;
    const text = clean(m[2] || '');
    if (!text && !/(watch|download|مشاهدة|تحميل|episode|الحلقة)/i.test(url)) continue;
    seen.add(url);
    out.push({ url, text });
  }
  return out;
}

async function html(url: string, referer?: string) {
  const r = await fetchWithTimeout(url, {
    method: 'GET',
    redirect: 'follow',
    timeoutMs,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8',
      'User-Agent': 'Movyz-ArProv/1.0',
      ...(referer ? { Referer: referer } : {}),
    },
  });
  const body = await r.text();
  if (!r.ok) throw new Error('ArProv HTTP ' + r.status);
  return { url: r.url || url, body };
}

function direct(body: string, base: string) {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const u = https(raw, base);
    if (!u || seen.has(u) || !inferPlaybackType(u)) return;
    seen.add(u);
    found.push(u);
  };
  for (const u of extractUniversalCandidates(body, base).direct) add(u);
  const re = /(?:file|source|src|videoUrl|video_url|hls|m3u8|dash|mp4)\s*[:=]\s*["'`](.*?)["'`]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) add(m[1]);
  return found;
}

async function resolveLink(url: string, referer: string, provider: string) {
  const type = inferPlaybackType(url);
  if (type) {
    return [{
      provider,
      type,
      url,
      quality: inferQuality('', url),
      language: 'und',
      label: provider,
      providerReference: provider.toLowerCase(),
    } satisfies NormalizedPlaybackSource];
  }

  const page = await html(url, referer);
  const media = direct(page.body, page.url).slice(0, 4);
  if (media.length) {
    return media.map(u => ({
      provider,
      type: inferPlaybackType(u) || 'direct',
      url: u,
      quality: inferQuality('', u),
      language: 'und',
      label: provider,
      providerReference: provider.toLowerCase(),
    } satisfies NormalizedPlaybackSource));
  }

  try {
    const u = await resolveUniversalSource(url, { timeoutMs, maxDepth: 1 });
    if (u.type !== 'embed') {
      return [{
        provider,
        type: u.type,
        url: u.url,
        quality: u.quality,
        language: 'und',
        label: provider,
        providerReference: provider.toLowerCase(),
      }];
    }
  } catch {}
  return [];
}

async function search(site: Site, ctx: ProviderContext) {
  const q = (ctx.title || ctx.originalTitle || '').trim();
  if (!q) return [];
  const queries = [q];
  if (ctx.episodeNumber !== undefined) {
    queries.unshift(
      q + ' S' + String(ctx.seasonNumber || 1).padStart(2, '0') + 'E' + String(ctx.episodeNumber).padStart(2, '0'),
      q + ' الحلقة ' + ctx.episodeNumber,
    );
  }

  const candidates: Array<{url: string; score: number}> = [];
  const seen = new Set<string>();

  for (const query of queries.slice(0, 2)) {
    for (const searchUrl of site.searches(query)) {
      try {
        const page = await html(searchUrl);
        for (const link of anchors(page.body, page.url)) {
          if (!link.url.includes(new URL(site.base).hostname) || seen.has(link.url)) continue;
          const s = score(link.text, link.url, ctx);
          if (s < 100) continue;
          seen.add(link.url);
          candidates.push({ url: link.url, score: s });
        }
      } catch {}
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 4);
}

async function resolveAkwam(pageUrl: string, body: string, site: Site) {
  const downloads = anchors(body, pageUrl)
    .filter(x => /\/download(?:\/|$)|\/link(?:\/|$)|تحميل/i.test(x.url + ' ' + x.text))
    .slice(0, 10);

  const out: NormalizedPlaybackSource[] = [];
  for (const item of downloads) {
    let target = item.url;
    if (/\/link/i.test(target) && !/\/download/i.test(target)) {
      try {
        const u = new URL(target);
        const tailMatch = pageUrl.match(/\/(?:movie|episode|shows|show\/episode)(\/.*)$/i);
        target = site.base + '/download' + (u.pathname.split(/\/link/i)[1] || '') + (tailMatch?.[1] || '');
      } catch { continue; }
    }

    try {
      const d = await html(target, pageUrl);
      const m = d.body.match(/btn-loader[\s\S]{0,3000}?<a\b[^>]*href=["']([^"']+)["']/i);
      const candidates = [m?.[1], ...anchors(d.body, d.url)
        .filter(x => /\.(?:mp4|m3u8|mpd|webm)(?:[?#]|$)/i.test(x.url) || /(dood|filemoon|streamtape|mixdrop|voe|gostream)/i.test(x.url))
        .map(x => x.url)].filter(Boolean) as string[];
      for (const candidate of [...new Set(candidates)].slice(0, 4)) {
        out.push(...await resolveLink(candidate, d.url, site.name));
      }
    } catch {}
  }
  return out;
}

function pageLinks(body: string, base: string) {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const u = https(raw, base);
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };

  const iframeRe = /<(?:iframe|embed)\\b[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = iframeRe.exec(body))) add(m[1]);

  const dataRe = /(?:data-url|data-src|data-source|data-watch|data-embed|url)=["']([^"']+)["']/gi;
  while ((m = dataRe.exec(body))) add(m[1]);

  for (const link of anchors(body, base)) {
    if (/(watch|embed|download|server|\u0633\u064a\u0631\u0641\u0631|تحميل|مشاهدة|dood|filemoon|streamtape|mixdrop|voe)/i.test(link.url + ' ' + link.text)) {
      add(link.url);
    }
  }

  return out.slice(0, 12);
}

async function resolveSite(site: Site, ctx: ProviderContext) {
  const pages = await search(site, ctx);
  for (const p of pages) {
    try {
      const page = await html(p.url);

      if (site.key === 'akwam') {
        const sources = await resolveAkwam(page.url, page.body, site);
        if (sources.length) return sources;
        continue;
      }

      const output: NormalizedPlaybackSource[] = [];
      for (const directUrl of direct(page.body, page.url).slice(0, 6)) {
        output.push(...await resolveLink(directUrl, page.url, site.name));
      }

      const links = pageLinks(page.body, page.url);
      for (const link of links) {
        try {
          output.push(...await resolveLink(link, page.url, site.name));
        } catch {}
        if (output.length >= 12) break;
      }

      const unique = new Map<string, NormalizedPlaybackSource>();
      for (const source of output) {
        if (source.url) unique.set(source.type + '|' + source.url, source);
      }
      if (unique.size) return [...unique.values()];
    } catch {}
  }
  return [];
}

export async function resolveArProvPlayback(ctx: ProviderContext): Promise<NormalizedPlaybackSource[]> {
  const key = JSON.stringify(ctx);
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = Promise.allSettled(sites.map(s => resolveSite(s, ctx))).then(results => {
    const unique = new Map<string, NormalizedPlaybackSource>();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const s of r.value) if (s.url) unique.set(s.provider + '|' + s.type + '|' + s.url, s);
    }
    return [...unique.values()].sort((a, b) => (Number.parseInt(b.quality, 10) || 0) - (Number.parseInt(a.quality, 10) || 0)).slice(0, 12);
  });

  inflight.set(key, promise);
  try { return await promise; } finally { inflight.delete(key); }
}

export function createArProvAdapter() {
  return {
    key: 'arprov',
    name: 'ArProv',
    enabled: true,
    requiresMapping: false,
    resolveMovie: (ctx: ProviderContext) => resolveArProvPlayback(ctx),
    resolveEpisode: (ctx: ProviderContext) => resolveArProvPlayback(ctx),
    async health() {
      const started = Date.now();
      try {
        const r = await fetchWithTimeout('https://akwam.ss/', {
          method: 'GET',
          timeoutMs: 5000,
          headers: { 'User-Agent': 'Movyz-ArProv/1.0' },
        });
        return {
          status: r.ok ? 'healthy' as const : 'degraded' as const,
          latencyMs: Date.now() - started,
          message: r.ok ? undefined : 'HTTP ' + r.status,
        };
      } catch (e) {
        return {
          status: 'offline' as const,
          latencyMs: Date.now() - started,
          message: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}

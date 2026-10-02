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
    base: 'https://ak.sv',
    searches: q => [
      'https://ak.sv/search?q=' + encodeURIComponent(q),
      'https://ak.sv/?s=' + encodeURIComponent(q),
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
  const compactHay = hay.replace(/[^\\p{L}\\p{N}]+/gu, '');
  for (const title of titles) {
    const compactTitle = title.replace(/[^\\p{L}\\p{N}]+/gu, '');
    if (hay === title || compactHay === compactTitle) n += 1800;
    else if (hay.includes(title) || compactHay.includes(compactTitle)) n += 1000;
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
  const titles = [ctx.title, ...(ctx.alternateTitles || []), ctx.originalTitle]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map(value => value.trim())
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 3);

  if (!titles.length) return [];

  const queries: string[] = [];
  for (const title of titles) {
    if (ctx.episodeNumber !== undefined) {
      queries.push(
        title + ' S' + String(ctx.seasonNumber || 1).padStart(2, '0') + 'E' + String(ctx.episodeNumber).padStart(2, '0'),
        title + ' الحلقة ' + ctx.episodeNumber,
      );
    }
    queries.push(title);
  }

  const searchUrls = [...new Set(
    queries.slice(0, ctx.episodeNumber !== undefined ? 4 : 3)
      .flatMap(query => site.searches(query)),
  )].slice(0, 6);

  const candidates: Array<{url: string; score: number}> = [];
  const seen = new Set<string>();

  const pages = await Promise.allSettled(searchUrls.map(url => html(url)));
  for (const result of pages) {
    if (result.status !== 'fulfilled') continue;
    const page = result.value;

    for (const link of anchors(page.body, page.url)) {
      if (!link.url.includes(new URL(site.base).hostname) || seen.has(link.url)) continue;
      const s = score(link.text, link.url, ctx);
      if (s < 100) continue;
      seen.add(link.url);
      candidates.push({ url: link.url, score: s });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 4);
}

function akwamQuality(value: string) {
  const id = value.match(/(?:quality|(?:^|[^0-9]))([2-5])(?:$|[^0-9])/i)?.[1];
  return id === '5' ? '1080p' : id === '4' ? '720p' : id === '3' ? '480p' : id === '2' ? '360p' : inferQuality('', value);
}

function akwamDownloadTarget(pageUrl: string, rawHref: string, site: Site) {
  const href = https(rawHref, pageUrl);
  if (!href) return null;

  if (/\/download(?:\/|$)/i.test(href)) return href;
  if (!/\/link(?:\/|$)/i.test(href)) return null;

  try {
    const source = new URL(href);
    const match = pageUrl.match(/\/(?:movies?|series?|episode|shows|show\/episode)(\/.*)$/i);
    const tail = match?.[1] || '';
    const linkPart = source.pathname.split(/\/link/i)[1] || '';
    return site.base + '/download' + linkPart + tail;
  } catch {
    return null;
  }
}

async function resolveAkwam(pageUrl: string, body: string, site: Site) {
  const downloads: Array<{ url: string; quality: string }> = [];
  const seen = new Set<string>();

  for (const match of body.matchAll(/<div\b[^>]*class=["'][^"']*tab-content[^"']*quality[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const block = match[0];
    const quality = akwamQuality(block);
    for (const anchor of anchors(block, pageUrl)) {
      if (!/تحميل|download/i.test(anchor.text + ' ' + anchor.url)) continue;
      const target = akwamDownloadTarget(pageUrl, anchor.url, site) || anchor.url;
      if (!seen.has(target)) {
        seen.add(target);
        downloads.push({ url: target, quality });
      }
    }
  }

  for (const anchor of anchors(body, pageUrl)) {
    if (!/\/download(?:\/|$)|\/link(?:\/|$)|تحميل/i.test(anchor.url + ' ' + anchor.text)) continue;
    const target = akwamDownloadTarget(pageUrl, anchor.url, site) || anchor.url;
    if (!seen.has(target)) {
      seen.add(target);
      downloads.push({ url: target, quality: akwamQuality(anchor.text + ' ' + anchor.url) });
    }
  }

  const out: NormalizedPlaybackSource[] = [];
  const results = await Promise.allSettled(
    downloads.slice(0, 10).map(async item => {
      const d = await html(item.url, pageUrl);
      const media: string[] = [];
      const loader = d.body.match(/(?:btn-loader|download)[\s\S]{0,3000}?<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
      if (loader) media.push(loader);

      for (const anchor of anchors(d.body, d.url)) {
        if (/\.(?:mp4|m3u8|mpd|webm)(?:[?#]|$)/i.test(anchor.url)) media.push(anchor.url);
      }

      return [...new Set(media)].slice(0, 4).map(url => ({
        url,
        quality: item.quality,
        referer: d.url,
      }));
    }),
  );

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const media of result.value) {
      try {
        const resolved = await resolveLink(media.url, media.referer, site.name);
        out.push(...resolved.map(source => ({ ...source, quality: media.quality || source.quality })));
      } catch {}
    }
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

  const mediaTagRe = /<(?:iframe|embed|source|video)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = mediaTagRe.exec(body))) {
    const attr = m[0].match(/(?:src|data-src|data-url)\\s*=\\s*["']([^"']+)["']/i);
    if (attr?.[1]) add(attr[1]);
  }

  const dataRe = /(?:data-url|data-src|data-source|data-watch|data-embed|url)=["']([^"']+)["']/gi;
  while ((m = dataRe.exec(body))) add(m[1]);

  for (const link of anchors(body, base)) {
    if (/(watch|embed|download|server|\u0633\u064a\u0631\u0641\u0631|تحميل|مشاهدة|dood|filemoon|streamtape|mixdrop|voe)/i.test(link.url + ' ' + link.text)) {
      add(link.url);
    }
  }

  return out.slice(0, 12);
}

async function formHtml(url: string, data: Record<string, string>, referer?: string) {
  const r = await fetchWithTimeout(url, {
    method: 'POST',
    redirect: 'follow',
    timeoutMs,
    headers: {
      Accept: 'application/json,text/html,text/plain,*/*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Movyz-ArProv/1.0',
      ...(referer ? { Referer: referer } : {}),
    },
    body: new URLSearchParams(data).toString(),
  });
  const body = await r.text();
  if (!r.ok) throw new Error('ArProv POST HTTP ' + r.status);
  return { url: r.url || url, body };
}

function arabSeedToken(html: string, key: string) {
  return html.match(new RegExp(
    key + "[\\'\\\"]?\\s*(?::|=)\\s*[\\'\\\"]([^'\\\"]+)",
    'i',
  ))?.[1] || null;
}

async function resolveArabSeedPage(pageUrl: string, ctx: ProviderContext, site: Site) {
  const page = await html(pageUrl);
  const watch = anchors(page.body, page.url)
    .find(link => /watch__btn|مشاهدة|watch/i.test(link.url + ' ' + link.text));

  const watchPage = watch?.url ? await html(watch.url, page.url).catch(() => null) : null;
  const current = watchPage || page;
  const out: NormalizedPlaybackSource[] = [];

  const addCandidate = async (url: string, referer: string, qualityHint = '') => {
    try {
      out.push(...await resolveLink(url, referer, site.name).then(items =>
        items.map(item => ({ ...item, quality: inferQuality(qualityHint, item.url) }))
      ));
    } catch {}
  };

  if (watchPage) {
    for (const link of anchors(watchPage.body, watchPage.url)) {
      if (!link.url.startsWith('https://')) continue;
      if (/\.(?:mp4|m3u8|mpd|webm)(?:[?#]|$)/i.test(link.url) || /\/watch\/\?url=|dood|filemoon|streamtape|mixdrop|voe|gofile|uqload/i.test(link.url)) {
        await addCandidate(link.url, page.url, link.text + ' ' + link.url);
      }
    }

    const liRe = /<li\b[^>]*data-src=["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/gi;
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(watchPage.body))) {
      const src = https(m[1], watchPage.url);
      if (src) await addCandidate(src, page.url, m[2] || '');
    }

    const postId = arabSeedToken(watchPage.body, 'post_id');
    const csrf = arabSeedToken(watchPage.body, 'csrf__token');

    if (postId && csrf) {
      for (const quality of ['480', '720', '1080']) {
        try {
          const q = await formHtml(site.base + '/get__quality__servers/', {
            post_id: postId,
            quality,
            csrf_token: csrf,
          }, watchPage.url);

          const qRe = /<li\b[^>]*data-src=["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/gi;
          let qm: RegExpExecArray | null;
          while ((qm = qRe.exec(q.body))) {
            const src = https(qm[1], q.url);
            if (src) await addCandidate(src, page.url, quality);
          }
        } catch {}
      }
    }
  }

  for (const directUrl of direct(current.body, current.url).slice(0, 8)) {
    await addCandidate(directUrl, page.url);
  }

  const unique = new Map<string, NormalizedPlaybackSource>();
  for (const source of out) {
    if (source.url) unique.set(source.type + '|' + source.url, source);
  }
  return [...unique.values()];
}

async function resolveArabSeed(site: Site, ctx: ProviderContext) {
  const pages = await search(site, ctx);
  for (const p of pages) {
    try {
      const page = await html(p.url);
      const candidates: Array<{ url: string; body: string }> = [{ url: page.url, body: page.body }];

      if (ctx.episodeNumber !== undefined) {
        for (const ep of episodeLinks(page.body, page.url, ctx)) {
          try {
            const epPage = await html(ep.url, page.url);
            candidates.push({ url: epPage.url, body: epPage.body });
          } catch {}
        }
      }

      for (const candidate of candidates) {
        const sources = await resolveArabSeedPage(candidate.url, ctx, site);
        if (sources.length) return sources;
      }
    } catch {}
  }
  return [];
}

function episodeLinks(body: string, base: string, ctx: ProviderContext) {
  if (ctx.episodeNumber === undefined) return [] as Array<{ url: string; score: number }>;

  const candidates: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();
  for (const link of anchors(body, base)) {
    if (seen.has(link.url)) continue;
    const id = identity(link.text + ' ' + link.url);
    if (id.episode !== ctx.episodeNumber) continue;
    if (ctx.seasonNumber !== undefined && id.season !== undefined && id.season !== ctx.seasonNumber) continue;
    const s = score(link.text, link.url, ctx) + 700;
    if (s < 700) continue;
    seen.add(link.url);
    candidates.push({ url: link.url, score: s });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 5);
}

async function resolveSite(site: Site, ctx: ProviderContext) {
  const pages = await search(site, ctx);
  if (!pages.length) return [];

  const resolveCandidate = async (candidate: {url: string; score: number}) => {
    try {
      const page = await html(candidate.url);

      const pageCandidates: Array<{ url: string; body: string }> = [{ url: page.url, body: page.body }];

      if (ctx.episodeNumber !== undefined) {
        const episodeCandidates = episodeLinks(page.body, page.url, ctx).slice(0, 3);
        const episodes = await Promise.allSettled(
          episodeCandidates.map(item => html(item.url, page.url)),
        );
        for (const ep of episodes) {
          if (ep.status === 'fulfilled') pageCandidates.push({ url: ep.value.url, body: ep.value.body });
        }
      }

      for (const candidatePage of pageCandidates) {
        const sources = await resolveAkwam(candidatePage.url, candidatePage.body, site);
        if (sources.length) return sources;
      }
    } catch {}
    return [];
  };

  const results = await Promise.allSettled(pages.map(resolveCandidate));
  const unique = new Map<string, NormalizedPlaybackSource>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const source of result.value) {
      if (source.url) unique.set(source.type + '|' + source.url, source);
    }
  }
  return [...unique.values()];
}

export async function resolveArProvPlayback(ctx: ProviderContext): Promise<NormalizedPlaybackSource[]> {
  const key = JSON.stringify(ctx);
  const existing = inflight.get(key);
  if (existing) return existing;

  const totalTimeoutMs = Math.min(
    Math.max(Number(process.env.MOVYZ_ARPROV_TOTAL_TIMEOUT_MS || 12000), 5000),
    18000,
  );

  const timeout = new Promise<NormalizedPlaybackSource[]>(resolve => {
    setTimeout(() => resolve([]), totalTimeoutMs);
  });

  const promise = Promise.race([
    resolveSite(sites[0]!, ctx).then(sources =>
      sources
        .sort((a, b) => (Number.parseInt(b.quality, 10) || 0) - (Number.parseInt(a.quality, 10) || 0))
        .slice(0, 12),
    ),
    timeout,
  ]);

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
        const r = await fetchWithTimeout('https://ak.sv/', {
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

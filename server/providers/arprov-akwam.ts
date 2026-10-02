import { fetchWithTimeout, inferPlaybackType, inferQuality } from './http';
import type { NormalizedPlaybackSource, ProviderContext } from './types';
import { fetchArProvPage, type ArProvBrowserBinding } from './arprov-runtime';
import { resolveArProvExtractor } from './arprov-extractors';
import { resolveUniversalSource } from './universal-resolver';

const AKWAM_BASES = [
  'https://akwam.ss',
  'https://akwam.net',
  'https://ak.sv',
] as const;

type AkwamRuntime = {
  browserBinding?: ArProvBrowserBinding;
};

type SearchCandidate = {
  url: string;
  title: string;
  score: number;
};

function cleanText(value: string) {
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

function normalize(value: string) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function enrichAkwamTitles(context: ProviderContext): Promise<ProviderContext> {
  if (context.episodeNumber === undefined || !context.tmdbId) return context;

  const token = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  if (!token) return context;

  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };

    const [details, alternatives] = await Promise.all([
      fetchWithTimeout(`https://api.themoviedb.org/3/tv/${context.tmdbId}?language=ar`, {
        method: 'GET',
        timeoutMs: 7_000,
        headers,
      }),
      fetchWithTimeout(`https://api.themoviedb.org/3/tv/${context.tmdbId}/alternative_titles`, {
        method: 'GET',
        timeoutMs: 7_000,
        headers,
      }),
    ]);

    const names: string[] = [];
    if (details.ok) {
      const payload = await details.json() as Record<string, unknown>;
      for (const key of ['name', 'original_name']) {
        if (typeof payload[key] === 'string' && payload[key].trim()) names.push(payload[key].trim());
      }
    }

    if (alternatives.ok) {
      const payload = await alternatives.json() as Record<string, unknown>;
      const results = Array.isArray(payload.results) ? payload.results : [];
      for (const item of results) {
        if (!item || typeof item !== 'object') continue;
        const name = (item as Record<string, unknown>).name;
        const country = (item as Record<string, unknown>).iso_3166_1;
        if (typeof name === 'string' && name.trim() && (country === 'EG' || /[\u0600-\u06ff]/u.test(name))) {
          names.push(name.trim());
        }
      }
    }

    if (!names.length) return context;

    return {
      ...context,
      alternateTitles: [...new Set([...(context.alternateTitles || []), ...names])],
    };
  } catch {
    return context;
  }
}

function decodeUrl(raw: string, base: string) {
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function anchors(body: string, base: string) {
  const output: Array<{ url: string; text: string; tag: string; index: number }> = [];
  const seen = new Set<string>();

  for (const match of body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = decodeUrl(match[1], base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push({
      url,
      text: cleanText(match[2] || ''),
      tag: match[0],
      index: match.index ?? 0,
    });
  }
  return output;
}

function titleScore(candidate: { text: string; url: string }, ctx: ProviderContext) {
  const hay = normalize(candidate.text + ' ' + candidate.url);
  const titles = [ctx.title, ctx.originalTitle, ...(ctx.alternateTitles || [])]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalize)
    .filter(Boolean);

  let score = 0;
  for (const title of titles) {
    if (!title) continue;
    if (hay === title) score += 2_000;
    else if (hay.includes(title)) score += 1_000;
    else {
      const words = title.split(' ').filter(word => word.length > 2);
      score += words.filter(word => hay.includes(word)).length * 80;
    }
  }

  if (ctx.releaseYear && hay.includes(String(ctx.releaseYear))) score += 120;

  if (ctx.episodeNumber !== undefined) {
    const requestedSeason = ctx.seasonNumber ?? 1;
    const episode = ctx.episodeNumber;
    const id = extractSeasonEpisode(candidate.text + ' ' + candidate.url);
    if (id.episode === episode) score += 500;
    if (id.season === requestedSeason) score += 400;
    if (id.episode !== undefined && id.episode !== episode) score -= 1_000;
  }

  return score;
}

function extractSeasonEpisode(value: string) {
  const text = value
    .replace(/%20/gi, ' ')
    .replace(/[_-]+/g, ' ');

  const se = /(?:s|season|الموسم)\s*(\d{1,3})\s*(?:e|episode|ep|الحلقة)\s*(\d{1,3})/i.exec(text);
  if (se) return { season: Number(se[1]), episode: Number(se[2]) };

  const x = /(?:^|\s)(\d{1,2})x(\d{1,3})(?:\s|$)/i.exec(text);
  if (x) return { season: Number(x[1]), episode: Number(x[2]) };

  const ep = /(?:episode|ep|الحلقة|حلقه|حلقة)[^0-9٠-٩]*([0-9٠-٩]{1,3})/i.exec(text);
  const season = /(?:season|الموسم)[^0-9٠-٩]*([0-9٠-٩]{1,3})/i.exec(text);
  return {
    season: season ? Number(season[1]) : undefined,
    episode: ep ? Number(ep[1]) : undefined,
  };
}

function searchUrls(base: string, query: string) {
  return [
    `${base}/search?q=${encodeURIComponent(query)}`,
    `${base}/?s=${encodeURIComponent(query)}`,
  ];
}

function looksBlocked(page: { body: string; status: number } | null) {
  if (!page) return true;
  const body = page.body.toLowerCase();
  return page.status === 403 ||
    page.status === 429 ||
    /just a moment|verify you are human|access denied|captcha|cf-chl-|challenge-platform/i.test(body);
}

async function search(base: string, ctx: ProviderContext, runtime: AkwamRuntime) {
  const titles = [...new Set([
    ctx.title,
    ctx.originalTitle,
    ...(ctx.alternateTitles || []),
  ].filter((value): value is string => Boolean(value?.trim())))].slice(0, 3);

  const queries = new Set<string>();
  for (const title of titles) {
    queries.add(title);
    if (ctx.episodeNumber !== undefined) {
      const season = String(ctx.seasonNumber ?? 1).padStart(2, '0');
      const episode = String(ctx.episodeNumber).padStart(2, '0');
      queries.add(`${title} S${season}E${episode}`);
      queries.add(`${title} الحلقة ${ctx.episodeNumber}`);
    }
  }

  const searchRequestUrls = [...queries].flatMap(query => searchUrls(base, query).slice(0, 2));
  const pages = await Promise.allSettled(
    searchRequestUrls.map(url => fetchArProvPage(url, {
      browserBinding: runtime.browserBinding,
      timeoutMs: 9_000,
    })),
  );

  const candidates: SearchCandidate[] = [];
  const seen = new Set<string>();

  const collect = (page: { body: string; url: string } | null) => {
    if (!page) return;
    for (const anchor of anchors(page.body, page.url)) {
      if (!anchor.url.includes(new URL(base).hostname)) continue;
      if (seen.has(anchor.url)) continue;
      const score = titleScore(anchor, ctx);
      if (score < 100) continue;
      seen.add(anchor.url);
      candidates.push({ url: anchor.url, title: anchor.text, score });
    }
  };

  for (const page of pages) {
    if (page.status === 'fulfilled') collect(page.value);
  }

  if (!candidates.length && runtime.browserBinding) {
    const browserPages = await Promise.allSettled(
      searchRequestUrls.map(url => fetchArProvPage(url, {
        browserBinding: runtime.browserBinding,
        timeoutMs: 11_000,
        forceBrowser: true,
      })),
    );
    for (const page of browserPages) {
      if (page.status === 'fulfilled') collect(page.value);
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 6);
}

function episodeCandidates(body: string, base: string, ctx: ProviderContext) {
  if (ctx.episodeNumber === undefined) return [];

  const requestedSeason = ctx.seasonNumber ?? 1;
  const requestedEpisode = ctx.episodeNumber;
  const results: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();

  for (const anchor of anchors(body, base)) {
    const id = extractSeasonEpisode(anchor.url + ' ' + anchor.text);
    const hay = normalize(anchor.text + ' ' + anchor.url);

    let score = 100;
    if (id.episode === requestedEpisode) score += 500;
    if (id.season === requestedSeason) score += 400;
    if (id.episode !== undefined && id.episode !== requestedEpisode) score -= 1_000;
    if (/(episode|ep|الحلقة|حلقه|حلقة)/i.test(hay)) score += 80;

    if (score < 100 || seen.has(anchor.url)) continue;
    seen.add(anchor.url);
    results.push({ url: anchor.url, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

function qualityFromBlock(block: string) {
  const text = cleanText(block);
  const explicit = /(?:2160|1440|1080|720|576|480|360|240)\s*p?/i.exec(text)?.[0];
  if (explicit) {
    const normalized = explicit.replace(/\s+/g, '').toLowerCase();
    return normalized.endsWith('p') ? normalized : `${normalized}p`;
  }

  const dataQuality = /(?:data-quality|data-resolution|quality|resolution|res)[\s:=\"']+(2160|1440|1080|720|576|480|360|240)/i.exec(block)?.[1];
  if (dataQuality) return `${dataQuality}p`;

  const id = /(?:^|[-_\s])([2-5])(?:[-_\s]|$)/i.exec(
    /(?:id|data-id|quality-id|res)[=:"'\s-]+([^\s"' >]+)/i.exec(block)?.[1] || '',
  )?.[1];
  if (id === '5') return '1080p';
  if (id === '4') return '720p';
  if (id === '3') return '480p';
  if (id === '2') return '360p';

  const attributeId = /id=["'](?:[^"']*?)([2-5])(?:[^"']*)["']/i.exec(block)?.[1];
  if (attributeId === '5') return '1080p';
  if (attributeId === '4') return '720p';
  if (attributeId === '3') return '480p';
  if (attributeId === '2') return '360p';

  return inferQuality(text, block); 
}

function downloadTarget(pageUrl: string, href: string, base: string) {
  const absoluteHref = decodeUrl(href, pageUrl);
  if (!absoluteHref) return null;
  if (/\/download(?:\/|$)/i.test(absoluteHref)) return absoluteHref;
  if (!/\/link(?:\/|$)/i.test(absoluteHref)) return null;

  try {
    const parsed = new URL(absoluteHref);
    const tail = pageUrl.match(/\/(?:movies?|series?|episode|shows|show\/episode)(\/.*)$/i)?.[1] || '';
    const linkPart = parsed.pathname.split(/\/link/i)[1] || '';
    return base + '/download' + linkPart + tail;
  } catch {
    return null;
  }
}

function directCandidates(page: { body: string; url: string }) {
  const values = new Set<string>();

  for (const match of page.body.matchAll(/<(?:video|source|embed|iframe)\b[^>]*(?:src|data-src)=["']([^"']+)["']/gi)) {
    const value = decodeUrl(match[1], page.url);
    if (value) values.add(value);
  }

  for (const match of page.body.matchAll(/(?:file|source|src|url|stream|hls|dash)\s*[:=]\s*["']([^"']+)["']/gi)) {
    const value = decodeUrl(match[1], page.url);
    if (value) values.add(value);
  }

  return [...values];
}

async function resolveDownload(
  target: string,
  quality: string,
  pageUrl: string,
  runtime: AkwamRuntime,
): Promise<NormalizedPlaybackSource[]> {
  const page = await fetchArProvPage(target, {
    referer: pageUrl,
    browserBinding: runtime.browserBinding,
    timeoutMs: 10_000,
  });
  if (!page) return [];

  const candidates = new Set<string>();

  const loader = /btn-loader[\s\S]{0,5000}?<a\b[^>]*href=["']([^"']+)["']/i.exec(page.body)?.[1];
  if (loader) {
    const value = decodeUrl(loader, page.url);
    if (value) candidates.add(value);
  }

  for (const value of directCandidates(page)) candidates.add(value);

  const output: NormalizedPlaybackSource[] = [];

  for (const value of [...candidates].slice(0, 8)) {
    const extractor = await resolveArProvExtractor(value, {
      referer: page.url,
      browserBinding: runtime.browserBinding,
    });

    if (extractor.length) {
      output.push(...extractor.map(item => {
        const inferredQuality =
          quality !== 'auto'
            ? quality
            : inferQuality(item.label || '', item.url || '') !== 'auto'
              ? inferQuality(item.label || '', item.url || '')
              : item.quality;
        return {
          ...item,
          provider: 'Akwam',
          providerReference: 'akwam',
          quality: inferredQuality,
          language: item.language || 'und',
          label: item.label || `Akwam ${inferredQuality || ''}`.trim(),
        };
      }));
      continue;
    }

    if (inferPlaybackType(value) || /\/play\//i.test(value) || !/\/embed(?:\/|$)/i.test(value)) {
      output.push({
        provider: 'Akwam',
        providerReference: 'akwam',
        type: inferPlaybackType(value) || 'direct',
        url: value,
        quality: quality !== 'auto' ? quality : inferQuality('', value),
        language: 'und',
        label: `Akwam ${quality !== 'auto' ? quality : ''}`.trim(),
      });
      continue;
    }

    try {
      const nested = await resolveUniversalSource(value, { timeoutMs: 7_000, maxDepth: 1 });
      if (nested.type !== 'embed') {
        output.push({
          provider: 'Akwam',
          providerReference: 'akwam',
          type: nested.type,
          url: nested.url,
          quality: quality !== 'auto' ? quality : nested.quality,
          language: 'und',
          label: `Akwam ${quality !== 'auto' ? quality : nested.quality}`.trim(),
        });
      }
    } catch {}
  }

  return output;
}

async function resolvePage(page: { body: string; url: string }, ctx: ProviderContext, runtime: AkwamRuntime) {
  const output: NormalizedPlaybackSource[] = [];
  const pageAnchors = anchors(page.body, page.url);

  for (const anchor of pageAnchors) {
    if (!/تحميل|download|\/download|\/link/i.test(anchor.text + ' ' + anchor.url)) continue;

    const prefix = page.body.slice(Math.max(0, anchor.index - 12_000), anchor.index);
    const qualityMarkers = [
      ...prefix.matchAll(/<div\b[^>]*class=["'][^"']*tab-content[^"']*quality[^"']*["'][^>]*>/gi),
    ];
    const latestQualityMarker = qualityMarkers.at(-1)?.[0] || '';
    const quality =
      latestQualityMarker
        ? qualityFromBlock(latestQualityMarker)
        : qualityFromBlock(anchor.text + ' ' + anchor.tag);

    const target = downloadTarget(page.url, anchor.url, new URL(page.url).origin) || anchor.url;
    if (!/^https:\/\//i.test(target)) continue;

    output.push(...await resolveDownload(target, quality, page.url, runtime));
  }

  return dedupe(output);
}

function dedupe(values: NormalizedPlaybackSource[]) {
  const map = new Map<string, NormalizedPlaybackSource>();
  for (const value of values) {
    if (!value.url) continue;
    map.set(value.type + '|' + value.url, value);
  }
  return [...map.values()]
    .map((value) => ({
      ...value,
      provider: value.provider || 'Akwam',
      providerReference: 'akwam',
      language: value.language || 'und',
      label: value.label || `Akwam ${value.quality || ''}`.trim(),
    }))
    .sort((a, b) => qualityValue(b.quality) - qualityValue(a.quality))
    .slice(0, 12);
}

function qualityValue(value: unknown) {
  const text = String(value || '').toLowerCase();
  if (/2160|4k/.test(text)) return 4000;
  if (/1440/.test(text)) return 3000;
  if (/1080/.test(text)) return 2000;
  if (/720/.test(text)) return 1500;
  if (/576/.test(text)) return 1200;
  if (/480/.test(text)) return 1000;
  if (/360/.test(text)) return 800;
  if (/240/.test(text)) return 600;
  return 0;
}

export async function resolveAkwamPlayback(
  context: ProviderContext,
  runtime: AkwamRuntime = {},
): Promise<NormalizedPlaybackSource[]> {
  const bases = [...AKWAM_BASES];
  let searchContext = context;

  const titleVariants = [context.title, context.originalTitle, ...(context.alternateTitles || [])]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(value => value.trim())
    .filter((value, index, all) => all.indexOf(value) === index);

  for (const base of bases) {
    let candidates = await search(base, searchContext, runtime);
    if (!candidates.length && searchContext === context) {
      searchContext = await enrichAkwamTitles(context);
      if (searchContext !== context) {
        candidates = await search(base, searchContext, runtime);
      }
    }
    if (!candidates.length) continue;

    const detailResults = await Promise.allSettled(
      candidates.map(async candidate => {
        let detail = await fetchArProvPage(candidate.url, {
          browserBinding: runtime.browserBinding,
          timeoutMs: 10_000,
        });
        if (looksBlocked(detail) && runtime.browserBinding) {
          detail = await fetchArProvPage(candidate.url, {
            browserBinding: runtime.browserBinding,
            timeoutMs: 12_000,
            forceBrowser: true,
          });
        }
        if (!detail) return [];

        let target = candidate.url;
        if (context.episodeNumber !== undefined) {
          const identity = extractSeasonEpisode(candidate.url + ' ' + candidate.title);
          if (identity.episode !== context.episodeNumber || (identity.season !== undefined && identity.season !== (context.seasonNumber ?? 1))) {
            target = '';
          }

          if (!target) {
            const eps = episodeCandidates(detail.body, detail.url, context);
            const episode = eps[0]?.url;
            if (!episode) return [];
            let episodePage = await fetchArProvPage(episode, {
              referer: detail.url,
              browserBinding: runtime.browserBinding,
              timeoutMs: 10_000,
            });
            if (looksBlocked(episodePage) && runtime.browserBinding) {
              episodePage = await fetchArProvPage(episode, {
                referer: detail.url,
                browserBinding: runtime.browserBinding,
                timeoutMs: 12_000,
                forceBrowser: true,
              });
            }
            if (!episodePage) return [];
            target = episodePage.url;
            const episodeSources = await resolvePage(episodePage, context, runtime);
            if (episodeSources.length || !runtime.browserBinding) return episodeSources;

            const browserEpisode = await fetchArProvPage(episodePage.url, {
              referer: detail.url,
              browserBinding: runtime.browserBinding,
              timeoutMs: 12_000,
              forceBrowser: true,
            });
            if (!browserEpisode) return episodeSources;
            return resolvePage(browserEpisode, context, runtime);
          }
        }

        return resolvePage(detail, context, runtime);
      }),
    );

    const merged: NormalizedPlaybackSource[] = [];
    for (const result of detailResults) {
      if (result.status === 'fulfilled') merged.push(...result.value);
    }

    const output = dedupe(merged);
    if (output.length) return output;
  }

  return [];
}

import { fetchWithTimeout, inferPlaybackType, inferQuality } from './http';
import type { NormalizedPlaybackSource, ProviderContext } from './types';
import { fetchArProvPage, type ArProvBrowserBinding } from './arprov-runtime';
import { resolveArProvExtractor } from './arprov-extractors';
import { resolveUniversalSource } from './universal-resolver';

const AKWAM_BASES = ['https://akwam.ss'] as const;
// [akwam-smoke] V2 verification trigger
// [akwam-robot] episode candidate filtering retest trigger
// Trigger the prepared-source workers without changing runtime playback behavior.

type AkwamRuntime = {
  browserBinding?: ArProvBrowserBinding;
  tmdbApiToken?: string;
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
  let decoded = String(value || '');
  try {
    decoded = decodeURIComponent(decoded.replace(/\\+/g, ' '));
  } catch {
    // Keep the original value when it is not valid URI encoding.
  }

  return cleanText(decoded)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAkwamContentUrl(value: string) {
  try {
    const path = new URL(value).pathname.toLowerCase();
    return /\/(?:movies?|series|episodes?|show|shows)(?:\/|$)/i.test(path);
  } catch {
    return false;
  }
}

function anchorSearchText(anchor: { text: string; tag: string; url: string }) {
  const altOrTitle = /(?:alt|title)=["']([^"']+)["']/i.exec(anchor.tag)?.[1];
  return cleanText([anchor.text, altOrTitle || '', anchor.url].join(' '));
}

async function enrichAkwamTitles(
  context: ProviderContext,
  allowSeriesWithoutEpisode = false,
  tmdbApiToken?: string,
): Promise<ProviderContext> {
  if (!context.tmdbId || (context.episodeNumber === undefined && !allowSeriesWithoutEpisode)) return context;

  const token = (tmdbApiToken || process.env.TMDB_API_READ_ACCESS_TOKEN || '').trim();
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

  const requestedSeason = ctx.seasonNumber;
  const identity = extractSeasonEpisode(candidate.text + ' ' + candidate.url);

  if (requestedSeason !== undefined && identity.season !== undefined) {
    if (identity.season === requestedSeason) score += 1_500;
    else score -= 5_000;
  }

  if (ctx.episodeNumber !== undefined) {
    const episode = ctx.episodeNumber;
    if (identity.episode === episode) score += 500;
    if (identity.episode !== undefined && identity.episode !== episode) score -= 1_000;
  }

  return score;
}

function extractSeasonEpisode(value: string) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value.replace(/%20/gi, ' ');
  }
  const text = decoded
    .replace(/[_-]+/g, ' ');

  const se = /(?:s|season|الموسم)\s*(\d{1,3})\s*(?:e|episode|ep|الحلقة)\s*(\d{1,3})/i.exec(text);
  if (se) return { season: Number(se[1]), episode: Number(se[2]) };

  const x = /(?:^|\s)(\d{1,2})x(\d{1,3})(?:\s|$)/i.exec(text);
  if (x) return { season: Number(x[1]), episode: Number(x[2]) };

  const ep = /(?:episode|ep|الحلقة|حلقه|حلقة)[^0-9٠-٩]*([0-9٠-٩]{1,3})/i.exec(text);
  const season = /(?:season|الموسم)[^0-9٠-٩]*([0-9٠-٩]{1,3})/i.exec(text);
  if (season) {
    return {
      season: Number(String(season[1]).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))),
      episode: ep ? Number(String(ep[1]).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))) : undefined,
    };
  }

  const arabicOrdinals: Array<[RegExp, number]> = [
    [/الموسم\s+(?:الأول|الاول|الاولى|الأولى)/i, 1],
    [/الموسم\s+(?:الثاني|الثانية)/i, 2],
    [/الموسم\s+(?:الثالث|الثالثة)/i, 3],
    [/الموسم\s+(?:الرابع|الرابعة)/i, 4],
    [/الموسم\s+(?:الخامس|الخامسة)/i, 5],
    [/الموسم\s+(?:السادس|السادسة)/i, 6],
    [/الموسم\s+(?:السابع|السابعة)/i, 7],
    [/الموسم\s+(?:الثامن|الثامنة)/i, 8],
    [/الموسم\s+(?:التاسع|التاسعة)/i, 9],
    [/الموسم\s+(?:العاشر)/i, 10],
    [/الموسم\s+(?:الحادي\s+عشر|الحادية\s+عشرة)/i, 11],
    [/الموسم\s+(?:الثاني\s+عشر|الثانية\s+عشرة)/i, 12],
    [/الموسم\s+(?:الثالث\s+عشر|الثالثة\s+عشرة)/i, 13],
    [/الموسم\s+(?:الرابع\s+عشر|الرابعة\s+عشرة)/i, 14],
    [/الموسم\s+(?:الخامس\s+عشر|الخامسة\s+عشرة)/i, 15],
    [/الموسم\s+(?:السادس\s+عشر|السادسة\s+عشرة)/i, 16],
    [/الموسم\s+(?:السابع\s+عشر|السابعة\s+عشرة)/i, 17],
    [/الموسم\s+(?:الثامن\s+عشر|الثامنة\s+عشرة)/i, 18],
    [/الموسم\s+(?:التاسع\s+عشر|التاسعة\s+عشرة)/i, 19],
    [/الموسم\s+(?:العشرون|العشرين)/i, 20],
  ];
  for (const [pattern, number] of arabicOrdinals) {
    if (pattern.test(text)) {
      return { season: number, episode: ep ? Number(String(ep[1]).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))) : undefined };
    }
  }

  return { season: undefined, episode: ep ? Number(String(ep[1]).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))) : undefined };
}

function arabicSeasonName(value: number) {
  const names: Record<number, string> = {
    1: 'الاول',
    2: 'الثاني',
    3: 'الثالث',
    4: 'الرابع',
    5: 'الخامس',
    6: 'السادس',
    7: 'السابع',
    8: 'الثامن',
    9: 'التاسع',
    10: 'العاشر',
    11: 'الحادي عشر',
    12: 'الثاني عشر',
    13: 'الثالث عشر',
    14: 'الرابع عشر',
    15: 'الخامس عشر',
    16: 'السادس عشر',
    17: 'السابع عشر',
    18: 'الثامن عشر',
    19: 'التاسع عشر',
    20: 'العشرون',
  };
  return names[value] || String(value);
}

function searchUrls(base: string, query: string) {
  const encoded = encodeURIComponent(query);
  return [
    `${base}/search?q=${encoded}`,
    `${base}/?s=${encoded}`,
    `${base}/search/${encoded}`,
  ];
}

function looksBlocked(page: { body: string; status: number } | null) {
  if (!page) return true;
  const body = page.body.toLowerCase();
  return page.status === 403 ||
    page.status === 429 ||
    /just a moment|verify you are human|access denied|captcha|cf-chl-|challenge-platform/i.test(body);
}

function pageBodiesForFallback(pages: PromiseSettledResult<any>[]) {
  return pages
    .filter((page): page is PromiseFulfilledResult<any> => page.status === 'fulfilled' && Boolean(page.value))
    .map(page => page.value as { body: string; url: string });
}

function extractRawContentCandidates(body: string, base: string) {
  const out: Array<{ url: string; text: string }> = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi)) {
    const url = decodeUrl(match[1], base);
    if (!url || seen.has(url)) continue;
    if (!/\/(?:series|episode)(?:\/|$)/i.test(new URL(url).pathname)) continue;
    seen.add(url);
    out.push({ url, text: cleanText(match[0]).slice(0, 240) });
  }
  return out;
}

async function search(base: string, ctx: ProviderContext, runtime: AkwamRuntime) {
  const titles = [...new Set([
    ctx.originalTitle,
    ctx.title,
    ...(ctx.alternateTitles || []),
  ].filter((value): value is string => Boolean(value?.trim())))].slice(0, 3);

  const queries = new Set<string>();
  const seasonNumber = ctx.seasonNumber ?? 1;
  const seasonName = arabicSeasonName(seasonNumber);

  if (ctx.episodeNumber !== undefined) {
    const season = String(seasonNumber).padStart(2, '0');
    const episode = String(ctx.episodeNumber).padStart(2, '0');
    const numericEpisode = String(ctx.episodeNumber);
    for (const title of titles.slice(0, 3)) {
      queries.add(`${title} S${season}E${episode}`);
      queries.add(`${title} S${season} E${episode}`);
      queries.add(`${title} season ${seasonNumber} episode ${numericEpisode}`);
      queries.add(`${title} episode ${numericEpisode}`);
      queries.add(`${title} الموسم ${seasonName} الحلقة ${numericEpisode}`);
      queries.add(`${title} الحلقة ${numericEpisode}`);
      queries.add(`${title} ${numericEpisode}`);
      if (ctx.episodeTitle?.trim()) {
        queries.add(`${title} ${ctx.episodeTitle.trim()}`);
        queries.add(`${title} الموسم ${seasonName} ${ctx.episodeTitle.trim()}`);
      }
    }
  } else {
    for (const title of titles) {
      queries.add(title);
      if (ctx.seasonNumber !== undefined) {
        queries.add(`${title} season ${seasonNumber}`);
        queries.add(`${title} S${seasonNumber}`);
        queries.add(`${title} الموسم ${seasonName}`);
        queries.add(`${title} الموسم ${seasonNumber}`);
      }
    }
  }

  const queryList = [...queries].slice(0, 2);
  const candidates: SearchCandidate[] = [];
  const seen = new Set<string>();

  const collect = (page: { body: string; url: string } | null) => {
    if (!page) return;
    const pageHost = (() => {
      try { return new URL(page.url).hostname; } catch { return new URL(base).hostname; }
    })();
    const baseHost = new URL(base).hostname;
    for (const anchor of anchors(page.body, page.url)) {
      let anchorHost = '';
      try { anchorHost = new URL(anchor.url).hostname; } catch {}
      if (anchorHost && anchorHost !== pageHost && anchorHost !== baseHost) continue;
      const anchorPath = new URL(anchor.url).pathname.toLowerCase();
      if (/\/(?:games|programs)(?:\/|$)/i.test(anchorPath)) continue;
      // Episode discovery must never rank movie/legacy pages just because
      // their title contains the series name. Akwam's current TV pages use
      // /series/... and /episode/... paths.
      if (ctx.episodeNumber !== undefined && !/\/(?:series|episode)(?:\/|$)/i.test(anchorPath)) continue;
      if (ctx.episodeNumber === undefined && ctx.seasonNumber !== undefined && !/\/series(?:\/|$)/i.test(anchorPath)) continue;
      // Never treat search/index pages as content candidates. Query URLs such
      // as /old/search/Breaking%20Bad%20S01E01 contain S01E01 themselves and
      // can otherwise score higher than the real episode page.
      if (/\/(?:old\/)?(?:search|advanced-search)(?:\/|$)/i.test(anchorPath)) continue;
      if (seen.has(anchor.url)) continue;

      const imageAlt = /<img\b[^>]*(?:alt)=["']([^"']+)["'][^>]*>/i.exec(anchor.tag)?.[1] || '';
      const text = anchorSearchText(anchor);
      const searchableText = cleanText([text, imageAlt].filter(Boolean).join(' '));
      const score = titleScore({ ...anchor, text: searchableText }, ctx);
      const cardHint =
        /class=["'][^"']*\bbox\b[^"']*["']/i.test(anchor.tag) ? 300 :
        /class=["'][^"']*\bentry-box\b[^"']*["']/i.test(anchor.tag) ? 200 :
        /\b(?:entry-title|watch|details)\b/i.test(anchor.tag) ? 100 : 0;
      const finalScore = score + cardHint;

      // Mirror Akwam/ArProv's actual search card contract: entry-box -> a.box.
      // The visible title can live only in the nested poster's alt attribute.
      if (finalScore < 40) continue;

      seen.add(anchor.url);
      candidates.push({ url: anchor.url, title: text, score: finalScore });
    }
  };

  const searchForms = [
    (query: string) => `${base}/old/search/${encodeURIComponent(query)}`,
    (query: string) => `${base}/search?q=${encodeURIComponent(query)}`,
  ];

  let pages: PromiseSettledResult<any>[] = [];
  for (const makeUrl of searchForms) {
    const urls = queryList.map(makeUrl);
    pages = await Promise.allSettled(
      urls.map(url => fetchArProvPage(url, {
        browserBinding: runtime.browserBinding,
        timeoutMs: 9_000,
      })),
    );
    for (const page of pages) {
      if (page.status === 'fulfilled') collect(page.value);
    }
    if (candidates.length) break;
  }

  if (!candidates.length) {
    const contentLinks = [...pageBodiesForFallback(pages)].flatMap(page => extractRawContentCandidates(page.body, page.url));
    for (const item of contentLinks) {
      if (seen.has(item.url)) continue;
      const anchorPath = (() => { try { return new URL(item.url).pathname.toLowerCase(); } catch { return ''; } })();
      if (ctx.episodeNumber !== undefined && !/\/(?:series|episode)(?:\/|$)/i.test(anchorPath)) continue;
      if (ctx.episodeNumber === undefined && ctx.seasonNumber !== undefined && !/\/series(?:\/|$)/i.test(anchorPath)) continue;
      const searchableText = cleanText(item.url);
      const score = titleScore({ text: searchableText, url: item.url }, ctx);
      if (score < 40) continue;
      seen.add(item.url);
      candidates.push({ url: item.url, title: searchableText.slice(0, 240), score });
    }
  }

  // Akwam's legacy query form is only a fallback; avoid firing it alongside the primary search.
  if (!candidates.length) {
    const fallbackUrls = queryList.map(query => `${base}/?s=${encodeURIComponent(query)}`);
    pages = await Promise.allSettled(
      fallbackUrls.map(url => fetchArProvPage(url, {
        browserBinding: runtime.browserBinding,
        timeoutMs: 9_000,
      })),
    );
    for (const page of pages) {
      if (page.status === 'fulfilled') collect(page.value);
    }
  }

  // Search fanout is intentionally bounded. If the primary routes and one
  // legacy route fail, the caller switches strategy instead of hammering the
  // same domain with more equivalent URLs.

  if (!candidates.length && runtime.browserBinding) {
    const browserUrls = searchForms.flatMap(makeUrl => queryList.map(makeUrl));
    const browserPages = await Promise.allSettled(
      browserUrls.map(url => fetchArProvPage(url, {
        browserBinding: runtime.browserBinding,
        timeoutMs: 11_000,
        forceBrowser: true,
      })),
    );
    for (const page of browserPages) {
      if (page.status === 'fulfilled') collect(page.value);
    }
  }

  if (!candidates.length) {
    console.warn(JSON.stringify({
      provider: 'akwam',
      stage: 'search-empty',
      base,
      queries: queryList,
      pages: pages.map((page) => {
        if (page.status !== 'fulfilled') {
          return { ok: false, reason: page.reason instanceof Error ? page.reason.message : String(page.reason) };
        }
        if (!page.value) return { ok: false, reason: 'empty-response' };
        return { ok: true, url: page.value.url, status: page.value.status, bytes: page.value.body.length };
      }),
    }));
  }

  const sorted = candidates.sort((a, b) => b.score - a.score);
  if (ctx.seasonNumber !== undefined) {
    const exactSeason = sorted.find((candidate) => {
      const identity = extractSeasonEpisode(candidate.title + ' ' + candidate.url);
      return identity.season === ctx.seasonNumber;
    });
    if (exactSeason) {
      return [
        exactSeason,
        ...sorted.filter((candidate) => candidate.url !== exactSeason.url),
      ].slice(0, 3);
    }
  }
  return sorted.slice(0, 3);
}
function episodeCandidates(body: string, base: string, ctx: ProviderContext) {
  if (ctx.episodeNumber === undefined) return [];

  const requestedSeason = ctx.seasonNumber ?? 1;
  const requestedEpisode = ctx.episodeNumber;
  const results: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();

  for (const anchor of anchors(body, base)) {
    let pathname = '';
    try { pathname = new URL(anchor.url).pathname.toLowerCase(); } catch { continue; }
    const isEpisodeAnchor =
      /\/episode(?:\/|$)/i.test(pathname) ||
      /class=["'][^"']*text-white[^"']*["']/i.test(anchor.tag);
    if (!isEpisodeAnchor) continue;
    if (/\/(?:old\/)?(?:search|advanced-search)(?:\/|$)/i.test(pathname)) continue;

    const neighborhood = body.slice(
      Math.max(0, anchor.index - 1_600),
      Math.min(body.length, anchor.index + 500),
    );
    const hay = normalize(anchor.text + ' ' + anchor.url + ' ' + neighborhood);
    const id = extractSeasonEpisode(hay);
    const explicitEpisode = /(?:^|\s)(?:الحلقة|episode|ep)?\s*([0-9٠-٩]{1,3})\s*$/i.exec(cleanText(anchor.text || ''));
    const normalizedId = {
      season: id.season,
      episode: id.episode ?? (explicitEpisode
        ? Number(String(explicitEpisode[1]).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))))
        : undefined),
    };

    let score = 0;
    if (normalizedId.season !== undefined && normalizedId.season !== requestedSeason) continue;
    if (/class=["'][^"']*text-white[^"']*["']/i.test(anchor.tag)) score += 200;
    if (normalizedId.episode === requestedEpisode) score += 1_000;
    if (normalizedId.season === requestedSeason) score += 600;
    if (normalizedId.episode !== undefined && normalizedId.episode !== requestedEpisode) score -= 2_000;
    if (/(episode|ep|الحلقة|حلقه|حلقة)/i.test(hay)) score += 120;

    if (score <= 0 || seen.has(anchor.url)) continue;
    seen.add(anchor.url);
    results.push({ url: anchor.url, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

function inferAkwamQuality(value: string) {
  const match = String(value || '').match(/(?:^|[^0-9])(2160|1440|1080|720|576|480|360|240)(?:p)?(?=(?:[^0-9]|$))/i);
  return match ? `${match[1]}p` : 'auto';
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
  akwamBase: string,
  pageUrl: string,
  runtime: AkwamRuntime,
): Promise<NormalizedPlaybackSource[]> {
  let page = await fetchArProvPage(target, {
    referer: pageUrl,
    browserBinding: runtime.browserBinding,
    timeoutMs: 10_000,
  });

  if (looksBlocked(page) && runtime.browserBinding) {
    page = await fetchArProvPage(target, {
      referer: pageUrl,
      browserBinding: runtime.browserBinding,
      timeoutMs: 12_000,
      forceBrowser: true,
    });
  }

  if (!page) return [];

  let raw = /btn-loader[\s\S]*?<a\b[^>]*href=["']([^"']+)["']/i.exec(page.body)?.[1];

  if (!raw && runtime.browserBinding && page.via === 'http') {
    const browserPage = await fetchArProvPage(target, {
      referer: pageUrl,
      browserBinding: runtime.browserBinding,
      timeoutMs: 14_000,
      forceBrowser: true,
    });
    if (browserPage) {
      page = browserPage;
      raw = /btn-loader[\s\S]*?<a\b[^>]*href=["']([^"']+)["']/i.exec(page.body)?.[1];
    }
  }

  // Legacy /old/download pages no longer render the direct URL in the GET
  // response. Their own JavaScript POSTs the same URL and receives JSON with
  // direct_link/hash_data. Reproduce that lightweight request without a
  // browser; this keeps the resolver fast and works for the old movie pages.
  if (!raw && /\/old\/download(?:\/|$)/i.test(target)) {
    try {
      const response = await fetchWithTimeout(target, {
        method: 'POST',
        timeoutMs: 10_000,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'Movyza/1.0',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: pageUrl,
        },
        body: '',
      });
      if (response.ok) {
        const payload = await response.text();
        try {
          const parsed = JSON.parse(payload) as Record<string, unknown>;
          if (typeof parsed.direct_link === 'string' && parsed.direct_link.trim()) {
            raw = parsed.direct_link.trim().replace(/^http:\/\//i, 'https://');
          }
        } catch {
          // Some legacy Akwam responses advertise text/html while returning JSON.
        }
      }
    } catch {
      // Keep the normal extraction fallbacks below.
    }
  }

  if (!raw) return [];

  const finalUrl = decodeUrl(raw, page.url);
  if (!finalUrl) return [];

  const referer = akwamBase.endsWith('/') ? akwamBase : `${akwamBase}/`;
  const effectiveQuality =
    quality !== 'auto'
      ? quality
      : inferAkwamQuality(finalUrl) !== 'auto'
        ? inferAkwamQuality(finalUrl)
        : quality;

  const extracted = await resolveArProvExtractor(finalUrl, {
    referer,
    browserBinding: runtime.browserBinding,
  });

  if (extracted.length) {
    return extracted.map((source) => ({
      ...source,
      provider: 'Akwam',
      providerReference: 'akwam',
      quality: effectiveQuality !== 'auto' ? effectiveQuality : source.quality,
      language: source.language || 'und',
      label: source.label || `Akwam ${effectiveQuality !== 'auto' ? effectiveQuality : source.quality || ''}`.trim(),
      referer: source.referer || referer,
    })).filter((source): source is typeof source & { url: string } => typeof source.url === 'string' && /^https:\/\//i.test(source.url));
  }

  // ArProv's CloudStream provider passes the btn-loader URL to its extractor
  // layer. Never persist the intermediate /download/ page itself as a
  // playback source. Try the shared universal resolver during PREPARATION
  // so the DB stores only a real media URL (mp4/hls/dash/webm/direct).
  const resolved = await resolveUniversalSource(finalUrl, {
    timeoutMs: 10_000,
    maxDepth: 2,
    maxHtmlBytes: 1_000_000,
  }).catch(() => null);

  if (resolved && resolved.type !== 'embed' && /^https:\/\//i.test(resolved.url)) {
    return [{
      provider: 'Akwam',
      providerReference: 'akwam',
      type: resolved.type,
      url: resolved.url,
      quality: effectiveQuality !== 'auto' && effectiveQuality !== 'source'
        ? effectiveQuality
        : (resolved.quality || inferQuality('', resolved.url)),
      language: 'und',
      label: `Akwam ${effectiveQuality !== 'auto' ? effectiveQuality : resolved.quality || ''}`.trim(),
      referer,
    }];
  }

  const directType = inferPlaybackType(finalUrl) || 'direct';
  if (directType && !/\/embed(?:\/|$)/i.test(finalUrl) && !/\/download(?:\/|$)/i.test(finalUrl)) {
    return [{
      provider: 'Akwam',
      providerReference: 'akwam',
      type: directType,
      url: finalUrl,
      quality: effectiveQuality,
      language: 'und',
      label: `Akwam ${effectiveQuality !== 'auto' ? effectiveQuality : ''}`.trim(),
      referer,
    }];
  }

  return [];
}

function normalizeAkwamQuality(raw: string, url: string) {
  const value = String(raw || '').trim().toLowerCase();
  const explicit = value.match(/(?:^|\D)(2160|1440|1080|720|576|480|360|240)p?(?:\D|$)/i)?.[1];
  if (explicit) return explicit + 'p';

  const inferred = inferQuality(value, url);
  return /^\d{3,4}p$/i.test(inferred) ? inferred.toLowerCase() : '';
}

async function resolveRe3ArabiStyleSourcePage(
  page: { body: string; url: string },
  runtime: AkwamRuntime,
  providerLabel = 'Akwam',
): Promise<NormalizedPlaybackSource[]> {
  // Mirrors the Akwam flow used by the referenced re-3arabi provider:
  // content page -> a.link-show -> watch page -> <source src>.
  const watchAnchor = anchors(page.body, page.url)
    .find((anchor) => /(?:^|\s)link-show(?:\s|$)/i.test(anchor.tag));

  if (!watchAnchor) return [];

  const rawWatchUrl = watchAnchor.url.trim();
  if (!/^https:\/\//i.test(rawWatchUrl)) return [];

  let watchPage = await fetchArProvPage(rawWatchUrl, {
    referer: page.url,
    browserBinding: runtime.browserBinding,
    timeoutMs: 10_000,
  });

  if (!watchPage) return [];

  if (looksBlocked(watchPage) && runtime.browserBinding) {
    watchPage = await fetchArProvPage(rawWatchUrl, {
      referer: page.url,
      browserBinding: runtime.browserBinding,
      timeoutMs: 12_000,
      forceBrowser: true,
    });
  }

  if (!watchPage) return [];

  const output: NormalizedPlaybackSource[] = [];
  const seen = new Set<string>();

  for (const match of watchPage.body.matchAll(
    /<(?:source|video)\b[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*>/gi,
  )) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    let mediaUrl: string;
    try {
      mediaUrl = new URL(raw.replaceAll('\\/', '/').replace(/&amp;/gi, '&'), watchPage.url).toString();
    } catch {
      continue;
    }

    if (!/^https:\/\//i.test(mediaUrl)) continue;
    if (/(?:\/)(?:embed|iframe)(?:\/|$)/i.test(new URL(mediaUrl).pathname)) continue;
    if (seen.has(mediaUrl)) continue;

    const tag = match[0];
    const size = /\bsize=["']([^"']+)["']/i.exec(tag)?.[1] || '';
    const label = /\blabel=["']([^"']+)["']/i.exec(tag)?.[1] || '';
    const quality = normalizeAkwamQuality(size || label, mediaUrl);
    if (!quality) continue;

    const type =
      /\.m3u8(?:$|[?#])/i.test(mediaUrl) ? 'hls' as const :
      /\.mpd(?:$|[?#])/i.test(mediaUrl) ? 'dash' as const :
      /\.webm(?:$|[?#])/i.test(mediaUrl) ? 'webm' as const :
      /\.mp4(?:$|[?#])/i.test(mediaUrl) ? 'mp4' as const :
      inferPlaybackType(mediaUrl) || 'direct';

    seen.add(mediaUrl);
    output.push({
      provider: providerLabel,
      providerReference: 'akwam',
      type,
      url: mediaUrl,
      quality,
      language: 'und',
      label: `Akwam ${quality}`,
      referer: page.url,
    });
  }

  return dedupe(output);
}

async function resolvePage(page: { body: string; url: string }, ctx: ProviderContext, runtime: AkwamRuntime) {
  const direct = await resolveRe3ArabiStyleSourcePage(page, runtime);
  if (direct.length) return direct;

  const output: NormalizedPlaybackSource[] = [];
  const pageAnchors = anchors(page.body, page.url);

  let downloadCount = 0;
  for (const anchor of pageAnchors) {
    if (downloadCount >= 4) break;
    if (!/تحميل|download|\/download|\/link/i.test(anchor.text + ' ' + anchor.url)) continue;
    downloadCount += 1;

    const prefix = page.body.slice(Math.max(0, anchor.index - 12_000), anchor.index);
    const qualityMarkers = [
      ...prefix.matchAll(/<div\b[^>]*class=["'][^"']*tab-content[^"']*quality[^"']*["'][^>]*>/gi),
    ];
    const latestQualityMarker = qualityMarkers.at(-1);
    const qualityContext = latestQualityMarker
      ? prefix.slice(latestQualityMarker.index || 0) + ' ' + page.body.slice(anchor.index, anchor.index + 2_000)
      : anchor.text + ' ' + anchor.tag;
    const detectedQuality = qualityFromBlock(qualityContext);
    const target = downloadTarget(page.url, anchor.url, new URL(page.url).origin) || anchor.url;
    if (!/^https:\/\//i.test(target)) continue;

    // Legacy Akwam download anchors often carry the only reliable
    // resolution marker in the target filename (e.g. 720p/1080p).
    const quality = detectedQuality === 'auto'
      ? inferAkwamQuality(target)
      : detectedQuality;

    output.push(...await resolveDownload(target, quality, new URL(page.url).origin, page.url, runtime));
  }

  return dedupe(output);
}

function matchesRequestedEpisodeSource(source: NormalizedPlaybackSource, context: ProviderContext) {
  if (context.episodeNumber === undefined || !source.url) return true;
  const identity = extractSeasonEpisode([source.url, source.label || ''].join(' '));
  const requestedSeason = context.seasonNumber ?? 1;
  if (identity.season !== undefined && identity.season !== requestedSeason) return false;
  if (identity.episode !== undefined && identity.episode !== context.episodeNumber) return false;
  return true;
}

function playbackTypeValue(value: unknown) {
  switch (String(value || '').toLowerCase()) {
    case 'mp4': return 50;
    case 'hls': return 45;
    case 'dash': return 40;
    case 'webm': return 35;
    case 'direct': return 30;
    default: return 0;
  }
}

function dedupe(values: NormalizedPlaybackSource[]) {
  const byQuality = new Map<string, NormalizedPlaybackSource>();

  for (const value of values) {
    if (!value.url) continue;

    const quality = String(value.quality || '').trim().toLowerCase();
    if (!quality || quality === 'auto' || quality === 'source') continue;

    const current = byQuality.get(quality);
    if (!current || playbackTypeValue(value.type) > playbackTypeValue(current.type)) {
      byQuality.set(quality, {
        ...value,
        provider: 'Akwam',
        providerReference: 'akwam',
        quality,
        language: value.language || 'und',
        label: value.label || `Akwam ${quality}`.trim(),
      });
    }
  }

  return [...byQuality.values()]
    .sort((a, b) => qualityValue(b.quality) - qualityValue(a.quality))
    .slice(0, 8);
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

export async function debugAkwamEpisode(
  context: ProviderContext,
  runtime: AkwamRuntime = {},
) {
  const trace: Array<Record<string, unknown>> = [];

  for (const base of AKWAM_BASES) {
    const candidates = await search(base, context, runtime);
    trace.push({
      stage: 'search',
      base,
      candidates: candidates.slice(0, 5).map(item => ({ url: item.url, title: item.title, score: item.score })),
    });

    const prioritizedCandidates = [...candidates].sort((a, b) => {
      const score = (item: SearchCandidate) => {
        try {
          const path = new URL(item.url).pathname.toLowerCase();
          let bonus = 0;
          if (/(?:^|\/)series(?:\/|$)|(?:^|\/)shows?(?:\/|$)/i.test(path)) bonus += 900;
          if (/\/(?:movies?|film)(?:\/|$)/i.test(path)) bonus -= 300;
          return bonus;
        } catch {
          return 0;
        }
      };
      return (b.score + score(b)) - (a.score + score(a));
    });

    for (const candidate of prioritizedCandidates.slice(0, 8)) {
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

      if (!detail) {
        trace.push({ stage: 'detail', url: candidate.url, result: 'null' });
        continue;
      }

      trace.push({
        stage: 'detail',
        url: candidate.url,
        via: detail.via,
        status: detail.status,
        finalUrl: detail.url,
        bytes: detail.body.length,
        excerpt: detail.body.slice(0, 1200),
      });

      const episodeUrls = episodeCandidates(detail.body, detail.url, context);
      trace.push({ stage: 'episode-candidates', count: episodeUrls.length, urls: episodeUrls.slice(0, 5) });

      for (const episodeItem of episodeUrls.slice(0, 3)) {
        const episodeUrl = episodeItem.url;
        let episodePage = await fetchArProvPage(episodeUrl, {
          referer: detail.url,
          browserBinding: runtime.browserBinding,
          timeoutMs: 10_000,
        });

        if (looksBlocked(episodePage) && runtime.browserBinding) {
          episodePage = await fetchArProvPage(episodeUrl, {
            referer: detail.url,
            browserBinding: runtime.browserBinding,
            timeoutMs: 12_000,
            forceBrowser: true,
          });
        }

        if (!episodePage) {
          trace.push({ stage: 'episode-page', url: episodeUrl, result: 'null' });
          continue;
        }

        trace.push({
          stage: 'episode-page',
          url: episodeUrl,
          via: episodePage.via,
          status: episodePage.status,
          finalUrl: episodePage.url,
          bytes: episodePage.body.length,
          qualityBlocks: [...episodePage.body.matchAll(/<div\b[^>]*class=["'][^"']*tab-content[^"']*quality[^"']*["'][^>]*>/gi)].length,
          downloadAnchors: anchors(episodePage.body, episodePage.url)
            .filter(anchor => /تحميل|download/i.test(anchor.text + ' ' + anchor.url))
            .slice(0, 12)
            .map(anchor => ({ url: anchor.url, text: anchor.text, tag: anchor.tag })),
          excerpt: episodePage.body.slice(0, 1800),
        });

        const downloadAnchors = anchors(episodePage.body, episodePage.url)
          .filter(anchor => /تحميل|download/i.test(anchor.text + ' ' + anchor.url))
          .slice(0, 6);

        for (const anchor of downloadAnchors) {
          const target = downloadTarget(episodePage.url, anchor.url, new URL(episodePage.url).origin) || anchor.url;
          trace.push({ stage: 'download-target', href: anchor.url, target });

          if (!/^https:\/\//i.test(target)) continue;

          let downloadPage = await fetchArProvPage(target, {
            referer: episodePage.url,
            browserBinding: runtime.browserBinding,
            timeoutMs: 10_000,
          });

          if ((!downloadPage || !/btn-loader/i.test(downloadPage.body)) && runtime.browserBinding) {
            downloadPage = await fetchArProvPage(target, {
              referer: episodePage.url,
              browserBinding: runtime.browserBinding,
              timeoutMs: 14_000,
              forceBrowser: true,
            });
          }

          if (!downloadPage) {
            trace.push({ stage: 'download-page', target, result: 'null' });
            continue;
          }

          const loader = /btn-loader[\s\S]*?<a\b[^>]*href=["']([^"']+)["']/i.exec(downloadPage.body)?.[1] || null;
          trace.push({
            stage: 'download-page',
            target,
            via: downloadPage.via,
            status: downloadPage.status,
            finalUrl: downloadPage.url,
            bytes: downloadPage.body.length,
            hasBtnLoader: /btn-loader/i.test(downloadPage.body),
            loader,
            anchors: anchors(downloadPage.body, downloadPage.url).slice(0, 12).map(item => ({ url: item.url, text: item.text, tag: item.tag })),
            excerpt: downloadPage.body.slice(0, 1800),
          });
        }

        return trace;
      }
    }
  }

  return trace;
}

export type AkwamIndexedEpisode = {
  url: string;
  episode: number;
  season?: number;
};

function indexEpisodeCandidates(body: string, base: string, requestedSeason?: number) {
  const values = new Map<string, AkwamIndexedEpisode & { score: number }>();

  for (const anchor of anchors(body, base)) {
    let pathname = '';
    try { pathname = new URL(anchor.url).pathname.toLowerCase(); } catch { continue; }
    const isEpisodeAnchor =
      /\/episode(?:\/|$)/i.test(pathname) ||
      /class=["'][^"']*text-white[^"']*["']/i.test(anchor.tag);
    if (!isEpisodeAnchor) continue;
    if (/\/(?:old\/)?(?:search|advanced-search)(?:\/|$)/i.test(pathname)) continue;

    // ArProv's original Akwam provider reads the episode number from the
    // containing episode card, not from the "مشاهدة" anchor text itself.
    // Parse the episode's own label first. The surrounding series HTML contains
    // other-season links, so using the first season match from a wide neighborhood
    // can assign the wrong season to an otherwise correct episode.
    const localHay = normalize(anchor.url + ' ' + anchor.text + ' ' + (
      /<img\b[^>]*(?:alt)=["']([^"']+)["']/i.exec(anchor.tag)?.[1] || ''
    ));
    const localIdentity = extractSeasonEpisode(localHay);

    const neighborhood = body.slice(
      Math.max(0, anchor.index - 1_600),
      Math.min(body.length, anchor.index + 500),
    );
    const neighborhoodIdentity = extractSeasonEpisode(normalize(anchor.url + ' ' + neighborhood));

    const explicitEpisode = /class=["'][^"']*text-white[^"']*["']/i.test(anchor.tag)
      ? /^\s*(?:الحلقة|حلقة|episode|ep)?\s*([0-9٠-٩]{1,3})\s*:/i.exec(cleanText(anchor.text))?.[1]
        || /^\s*(?:الحلقة|حلقة|episode|ep)?\s*([0-9٠-٩]{1,3})\s*$/i.exec(cleanText(anchor.text))?.[1]
      : undefined;

    const identity = {
      season: localIdentity.season ?? neighborhoodIdentity.season,
      episode: localIdentity.episode
        ?? (explicitEpisode ? Number(explicitEpisode.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))) : undefined)
        ?? neighborhoodIdentity.episode,
    };
    if (identity.episode === undefined) continue;

    if (requestedSeason !== undefined && identity.season !== undefined && identity.season !== requestedSeason) continue;

    let score = 0;
    if (/class=["'][^"']*text-white[^"']*["']/i.test(anchor.tag)) score += 100;
    if (requestedSeason !== undefined && identity.season === requestedSeason) score += 500;
    if (/(episode|ep|الحلقة|حلقه|حلقة)/i.test(localHay)) score += 50;

    const key = (identity.season === undefined ? '' : String(identity.season) + ':') + identity.episode;
    const current = values.get(key);
    const item = {
      url: anchor.url,
      episode: identity.episode,
      season: identity.season,
      score,
    };
    if (!current || score > current.score) values.set(key, item);
  }

  return [...values.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...item }) => item);
}

async function crawlAkwamEpisodeChain(
  startUrls: string[],
  context: ProviderContext,
  runtime: AkwamRuntime,
) {
  const queue = [...startUrls];
  const visited = new Set<string>();
  const results = new Map<string, AkwamIndexedEpisode>();
  const maxPages = 160;

  while (queue.length && visited.size < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const page = await fetchArProvPage(url, {
      browserBinding: runtime.browserBinding,
      timeoutMs: 10_000,
    });
    if (!page) continue;

    const identity = extractSeasonEpisode(cleanText(page.body.slice(0, 30_000)));
    if (
      identity.episode !== undefined &&
      (identity.season === undefined || context.seasonNumber === undefined || identity.season === context.seasonNumber)
    ) {
      results.set(page.url, {
        url: page.url,
        episode: identity.episode,
        season: identity.season ?? context.seasonNumber,
      });
    }

    for (const anchor of anchors(page.body, page.url)) {
      if (!/\/episode(?:\/|$)/i.test(new URL(anchor.url).pathname)) continue;

      const neighborhood = page.body.slice(
        Math.max(0, anchor.index - 500),
        Math.min(page.body.length, anchor.index + 500),
      );
      const navText = normalize(anchor.text + ' ' + anchor.tag + ' ' + neighborhood);
      const isNavigation =
        /(?:الحلقة التالية|الحلقة السابقة|التالي|السابق|next|previous)/i.test(navText) ||
        /(?:episode|ep)\b/i.test(navText);

      if (isNavigation && !visited.has(anchor.url) && !queue.includes(anchor.url)) {
        queue.push(anchor.url);
      }
    }
  }

  return [...results.values()].sort((a, b) => {
    if ((a.season ?? 0) !== (b.season ?? 0)) return (a.season ?? 0) - (b.season ?? 0);
    return a.episode - b.episode;
  });
}

export async function discoverAkwamSeasonEpisodes(
  context: ProviderContext,
  runtime: AkwamRuntime = {},
): Promise<AkwamIndexedEpisode[]> {
  // Primary lane: search the series title and index its episode cards.
  // Fallback lane: if the series page is not indexed, find an individual
  // episode page and walk its next/previous links to rebuild the season index.
  const enrichedContext = await enrichAkwamTitles(context, true, runtime.tmdbApiToken);
  const seriesSearchContext: ProviderContext = {
    ...enrichedContext,
    episodeNumber: undefined,
    episodeTitle: undefined,
  };

  for (const base of AKWAM_BASES) {
    const candidates = await search(base, seriesSearchContext, runtime);

    for (const candidate of candidates.slice(0, 5)) {
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
      if (!detail) continue;

      const indexed = indexEpisodeCandidates(detail.body, detail.url, context.seasonNumber);
      if (indexed.length) {
        return indexed;
      }

      if (/\/episode(?:\/|$)/i.test(new URL(candidate.url).pathname)) {
        const walked = await crawlAkwamEpisodeChain([candidate.url], context, runtime);
        if (walked.length) return walked;
      }
    }

    // Last fallback: search for the first requested episode using its actual
    // episode title/number, then walk the neighboring episode links.
    const seedCandidates = await search(base, enrichedContext, runtime);
    const episodeStarts = seedCandidates
      .filter((candidate) => /\/episode(?:\/|$)/i.test(new URL(candidate.url).pathname))
      .slice(0, 6)
      .map((candidate) => candidate.url);

    if (episodeStarts.length) {
      const walked = await crawlAkwamEpisodeChain(episodeStarts, context, runtime);
      if (walked.length) return walked;
    }
  }

  return [];
}

export async function resolveAkwamEpisodeFromSeriesPage(
  seriesUrl: string,
  context: ProviderContext,
  runtime: AkwamRuntime = {},
): Promise<{ episodeUrl: string | null; sources: NormalizedPlaybackSource[]; indexed: AkwamIndexedEpisode[] }> {
  let parsed: URL;
  try {
    parsed = new URL(seriesUrl);
  } catch {
    return { episodeUrl: null, sources: [], indexed: [] };
  }

  if (parsed.origin !== 'https://akwam.ss' || !/\/series(?:\/|$)/i.test(parsed.pathname)) {
    return { episodeUrl: null, sources: [], indexed: [] };
  }

  let page = await fetchArProvPage(seriesUrl, {
    browserBinding: runtime.browserBinding,
    timeoutMs: 10_000,
  });

  if (looksBlocked(page) && runtime.browserBinding) {
    page = await fetchArProvPage(seriesUrl, {
      browserBinding: runtime.browserBinding,
      timeoutMs: 12_000,
      forceBrowser: true,
    });
  }

  if (!page) return { episodeUrl: null, sources: [], indexed: [] };

  const indexed = indexEpisodeCandidates(page.body, page.url, context.seasonNumber)
    .filter(item => item.episode === context.episodeNumber)
    .filter(item => context.seasonNumber === undefined || item.season === undefined || item.season === context.seasonNumber)
    .slice(0, 8);

  for (const item of indexed) {
    const sources = await resolveAkwamEpisodePage(item.url, context, runtime);
    if (sources.length) {
      return { episodeUrl: item.url, sources, indexed };
    }
  }

  return { episodeUrl: null, sources: [], indexed };
}

export async function resolveAkwamEpisodePage(
  url: string,
  context: ProviderContext,
  runtime: AkwamRuntime = {},
): Promise<NormalizedPlaybackSource[]> {
  let page = await fetchArProvPage(url, {
    browserBinding: runtime.browserBinding,
    timeoutMs: 10_000,
  });

  if (looksBlocked(page) && runtime.browserBinding) {
    page = await fetchArProvPage(url, {
      browserBinding: runtime.browserBinding,
      timeoutMs: 12_000,
      forceBrowser: true,
    });
  }

  if (!page) return [];
  return resolvePage(page, context, runtime);
}

export async function debugAkwamMovie(
  context: ProviderContext,
  runtime: AkwamRuntime = {},
) {
  const trace: Array<Record<string, unknown>> = [];
  for (const base of AKWAM_BASES) {
    const candidates = await search(base, context, runtime);
    trace.push({ stage: 'search', candidates: candidates.slice(0, 4) });
    for (const candidate of candidates.slice(0, 2)) {
      const detail = await fetchArProvPage(candidate.url, {
        browserBinding: runtime.browserBinding,
        timeoutMs: 10_000,
      });
      trace.push({
        stage: 'detail',
        url: candidate.url,
        status: detail?.status,
        bytes: detail?.body.length,
        downloads: detail
          ? anchors(detail.body, detail.url)
              .filter(a => /تحميل|download|\/download|\/link/i.test(a.text + ' ' + a.url))
              .slice(0, 6)
              .map(a => ({ url: a.url, text: a.text, tag: a.tag }))
          : [],
      });
      if (!detail) continue;

      for (const anchor of anchors(detail.body, detail.url)
        .filter(a => /تحميل|download|\/download|\/link/i.test(a.text + ' ' + a.url))
        .slice(0, 4)) {
        const prefix = detail.body.slice(Math.max(0, anchor.index - 12_000), anchor.index);
        const qualityMarkers = [
          ...prefix.matchAll(/<div\b[^>]*class=["'][^"']*tab-content[^"']*quality[^"']*["'][^>]*>/gi),
        ];
        const latestQualityMarker = qualityMarkers.at(-1);
        const qualityContext = latestQualityMarker
          ? prefix.slice(latestQualityMarker.index || 0) + ' ' + detail.body.slice(anchor.index, anchor.index + 2_000)
          : anchor.text + ' ' + anchor.tag;
        const quality = qualityFromBlock(qualityContext);
        const target = downloadTarget(detail.url, anchor.url, new URL(detail.url).origin) || anchor.url;
        let sources: NormalizedPlaybackSource[] = [];
        let error = '';
        try {
          sources = await resolveDownload(target, quality, new URL(detail.url).origin, detail.url, runtime);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        trace.push({
          stage: 'download',
          href: anchor.url,
          target,
          quality,
          sourceCount: sources.length,
          sources,
          error,
        });
      }
      if (trace.some(item => item.stage === 'download' && Number(item.sourceCount) > 0)) return trace;
    }
  }
  return trace;
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

    // Only pay for a series-level fallback when the precise episode
    // search produced no useful candidate. This keeps the free Worker path
    // comfortably below its external-subrequest ceiling on normal hits.
    if (
      context.episodeNumber !== undefined &&
      (!candidates.length || (candidates[0]?.score ?? 0) < 80)
    ) {
      const seriesSearchContext: ProviderContext = {
        ...searchContext,
        episodeNumber: undefined,
        episodeTitle: undefined,
      };
      const seriesCandidates = await search(base, seriesSearchContext, runtime);
      const mergedCandidates = [...candidates, ...seriesCandidates];
      const seen = new Set<string>();
      candidates = mergedCandidates.filter((candidate) => {
        if (seen.has(candidate.url)) return false;
        seen.add(candidate.url);
        return true;
      });
    }

    if (!candidates.length && searchContext === context) {
      searchContext = await enrichAkwamTitles(context, false, runtime.tmdbApiToken);
      if (searchContext !== context) {
        candidates = await search(base, searchContext, runtime);
      }
    }
    if (!candidates.length) continue;

    const detailResults = await Promise.allSettled(
      candidates.slice(0, context.episodeNumber !== undefined ? 4 : 2).map(async candidate => {
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

    const output = dedupe(merged).filter((source) => matchesRequestedEpisodeSource(source, context));
    if (output.length) return output;
  }

  return [];
}

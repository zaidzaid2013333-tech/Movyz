import { fetchWithTimeout, inferPlaybackType, inferQuality } from './http';
import type { NormalizedPlaybackSource, PlaybackKind } from './types';
import { fetchArProvPage, type ArProvBrowserBinding } from './arprov-runtime';

type ExtractorContext = {
  referer?: string;
  browserBinding?: ArProvBrowserBinding;
};

type ArProvExtractor = {
  key: string;
  hosts: RegExp[];
  resolve(url: string, context: ExtractorContext): Promise<NormalizedPlaybackSource[]>;
};

function absolute(raw: string, base: string) {
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function source(provider: string, url: string, pageUrl: string, quality?: string, type?: PlaybackKind): NormalizedPlaybackSource {
  return {
    provider,
    providerReference: provider.toLowerCase(),
    type: type || inferPlaybackType(url) || 'direct',
    url,
    quality: quality || inferQuality('', url),
    language: 'und',
    label: provider,
    expiresAt: undefined,
    ...({ referer: pageUrl } as any),
  };
}

function extractScriptUrls(body: string, patterns: RegExp[]) {
  const urls = new Set<string>();
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const value = decodeHtml(match[1] || '');
      if (/^https:\/\//i.test(value)) urls.add(value);
    }
  }
  return [...urls];
}

function extractAnchors(body: string, pageUrl: string) {
  const anchors: Array<{ href: string; text: string }> = [];
  for (const match of body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    anchors.push({
      href: absolute(decodeHtml(match[1]), pageUrl) || decodeHtml(match[1]),
      text: decodeHtml((match[2] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
    });
  }
  return anchors;
}

const goStream: ArProvExtractor = {
  key: 'gostream',
  hosts: [/gostream(?:\.pro|\.net)$/i],
  async resolve(url, context) {
    const page = await fetchArProvPage(url, { referer: context.referer, browserBinding: context.browserBinding });
    if (!page) return [];
    const output: NormalizedPlaybackSource[] = [];

    for (const value of extractScriptUrls(page.body, [
      /file\s*:\s*["']([^"']+)["']/gi,
      /source\s*:\s*["']([^"']+)["']/gi,
    ])) {
      output.push(source('GoStream', value, page.url));
    }

    for (const tag of page.body.matchAll(/<(?:video|source)\b[^>]*src=["']([^"']+)["']/gi)) {
      const value = absolute(tag[1], page.url);
      if (value) output.push(source('GoStream', value, page.url));
    }
    return dedupeSources(output);
  },
};

const govad: ArProvExtractor = {
  key: 'govad',
  hosts: [/govad\.xyz$/i],
  async resolve(url, context) {
    const code = /\/embed-([^/?#]+)/i.exec(url)?.[1];
    const target = code ? `https://govad.xyz/${code}` : url;
    const page = await fetchArProvPage(target, { referer: context.referer, browserBinding: context.browserBinding });
    if (!page) return [];

    const values = extractScriptUrls(page.body, [
      /file\s*[:=]\s*["']([^"']+)["']/gi,
      /src\s*[:=]\s*["']([^"']+)["']/gi,
    ]);

    return dedupeSources(values.map(value => source('Govad', value, page.url)));
  },
};

const jwPlayer: ArProvExtractor = {
  key: 'jwplayer',
  hosts: [/jwplayer\.com$/i, /vidhd\.fun$/i, /vidbom\.com$/i, /vadbam\.com$/i, /vidshar\.org$/i],
  async resolve(url, context) {
    const page = await fetchArProvPage(url, { referer: context.referer, browserBinding: context.browserBinding });
    if (!page) return [];
    const output: NormalizedPlaybackSource[] = [];

    for (const value of extractScriptUrls(page.body, [
      /file\s*:\s*["']([^"']+)["']/gi,
      /sources\s*:\s*\[[\s\S]*?file\s*["']?\s*:\s*["']([^"']+)["']/gi,
      /['"]file['"]\s*:\s*['"]([^'"]+)['"]/gi,
    ])) {
      output.push(source('JWPlayer', value, page.url));
    }

    for (const tag of page.body.matchAll(/<(?:video|source)\b[^>]*(?:src|data-src)=["']([^"']+)["']/gi)) {
      const value = absolute(tag[1], page.url);
      if (value) output.push(source('JWPlayer', value, page.url));
    }
    return dedupeSources(output);
  },
};

const linkBox: ArProvExtractor = {
  key: 'linkbox',
  hosts: [/linkbox\.to$/i],
  async resolve(url, context) {
    try {
      const parsed = new URL(url);
      const itemId = parsed.pathname.split('/file/')[1];
      if (!itemId) return [];
      const api = `https://${parsed.hostname}/api/file/detail?itemId=${encodeURIComponent(itemId)}`;
      const response = await fetchWithTimeout(api, {
        timeoutMs: 8_000,
        headers: { Accept: 'application/json', 'User-Agent': 'Movyza-ArProv/1.0', Referer: url },
      });
      if (!response.ok) return [];
      const json = await response.json() as any;
      const list = json?.data?.itemInfo?.resolutionList;
      if (!Array.isArray(list)) return [];

      return dedupeSources(list.map((item: any) => {
        const value = absolute(String(item?.url || ''), url);
        if (!value) return null;
        return source(
          `LinkBox ${item?.resolution || ''}`.trim(),
          value,
          url,
          String(item?.resolution || '').match(/\\d{3,4}p/i)?.[0] || inferQuality('', value),
        );
      }).filter(Boolean));
    } catch {
      return [];
    }
  },
};

const moshahda: ArProvExtractor = {
  key: 'moshahda',
  hosts: [/moshahda\.net$/i],
  async resolve(url, context) {
    const code = /\/embed-([^/?#]+)/i.exec(url)?.[1];
    if (!code) return [];
    const base = `https://moshahda.net/${code}.html?`;
    const qualities: Record<string, string> = {
      download_l: '240p',
      download_n: '360p',
      download_h: '480p',
      download_x: '720p',
      download_o: '1080p',
    };
    return Object.entries(qualities).map(([key, quality]) =>
      source('Moshahda', base + key, url, quality, 'direct'),
    );
  },
};

const myVid: ArProvExtractor = {
  key: 'myvid',
  hosts: [/myviid\.com$/i],
  async resolve(url, context) {
    const page = await fetchArProvPage(url, { referer: context.referer, browserBinding: context.browserBinding });
    if (!page) return [];
    const text = page.body.match(/<script[^>]*>([\s\S]*?)<\/script>/gi)?.[1] || page.body;
    const payload = text.substringAfter('||||').split('|');
    if (payload.length < 84) return [];
    const candidate = `${payload[7]}://${payload[24]}.${payload[6]}.${payload[5]}/${payload[83]}/v.${payload[82]}`;
    const value = absolute(candidate, page.url);
    return value ? [source('MyVid', value, page.url)] : [];
  },
};

const vidHd: ArProvExtractor = {
  key: 'vidhd',
  hosts: [/vidhd\.fun$/i],
  async resolve(url, context) {
    const page = await fetchArProvPage(url, { referer: context.referer, browserBinding: context.browserBinding });
    if (!page) return [];
    const body = page.body;
    const payload = body.substringAfter('||||');
    const parts = payload.split('|');
    if (parts.length < 22) return [];

    const images = payload.substringAfter('|image|').split('|');
    const label = payload.substringAfter('|label|').split('|file|')[0];
    const raw = `${parts[6]}://${parts[21]}.e-${parts[20]}-${parts[19]}.${parts[18]}`;
    const qualityA = images[0] ? inferQuality(images[0], raw) : 'auto';
    const urlA = absolute(raw + `/${images[1] || ''}/v.${label}`, page.url);
    const urlB = images[3] ? absolute(raw + `/${images[3]}/v.${label}`, page.url) : null;

    return dedupeSources([
      urlA ? source('VidHD', urlA, page.url, qualityA) : null,
      urlB ? source('VidHD', urlB, page.url, images[2] ? inferQuality(images[2], urlB) : qualityA) : null,
    ]);
  },
};

const voeSx: ArProvExtractor = {
  key: 'voesx',
  hosts: [/voe\.sx$/i],
  async resolve(url, context) {
    const page = await fetchArProvPage(url, { referer: context.referer, browserBinding: context.browserBinding });
    if (!page) return [];

    const hls = /['"]hls['"]\s*:\s*['"]([^'"]+)['"]/i.exec(page.body)?.[1];
    const mp4 = /['"]mp4['"]\s*:\s*['"]([^'"]+)['"]/i.exec(page.body)?.[1];

    return dedupeSources([
      hls ? source('Voe.sx m3u8', hls, page.url, inferQuality('', hls), 'hls') : null,
      mp4 ? source('Voe.sx mp4', mp4, page.url, inferQuality('', mp4), 'mp4') : null,
    ]);
  },
};

const aflamy: ArProvExtractor = {
  key: 'aflamy',
  hosts: [/aflamy\.pro$/i, /shadwo\.pro$/i, /dazzwo\.pro$/i, /dazwo\.pro$/i],
  async resolve(url, context) {
    const page = await fetchArProvPage(url, { referer: context.referer, browserBinding: context.browserBinding });
    if (!page) return [];

    const serverLinks = extractAnchors(page.body, page.url)
      .filter(item => item.text || /aplr-link/i.test(item.href))
      .map(item => item.href)
      .filter(item => /^https:\/\//i.test(item));

    const pages = [...new Set([page.url, ...serverLinks])].slice(0, 8);
    const output: NormalizedPlaybackSource[] = [];

    for (const target of pages) {
      const server = target === page.url
        ? page
        : await fetchArProvPage(target, { referer: page.url, browserBinding: context.browserBinding });
      if (!server) continue;

      for (const value of extractScriptUrls(server.body, [
        /(?:hls|playlist|file)\s*:\s*["']([^"']+)["']/gi,
        /src["']\s*:\s*["']([^"']+)["']/gi,
      ])) {
        if (/\.(?:vtt|js)(?:$|[?#])/i.test(value)) continue;
        output.push(source('Aflamy', value, server.url, inferQuality('', value)));
      }

      for (const iframe of server.body.matchAll(/<iframe\b[^>]*src=["']([^"']+)["']/gi)) {
        const value = absolute(iframe[1], server.url);
        if (!value || !/(?:\.cyou|embed|player)/i.test(value)) continue;
        const nested = await fetchArProvPage(value, { referer: server.url, browserBinding: context.browserBinding });
        if (!nested) continue;
        for (const media of extractScriptUrls(nested.body, [
          /(?:hls|playlist|file)\s*:\s*["']([^"']+)["']/gi,
          /src["']\s*:\s*["']([^"']+)["']/gi,
        ])) {
          output.push(source('Aflamy', media, nested.url, inferQuality('', media)));
        }
      }
    }

    return dedupeSources(output);
  },
};

function cleanUrl(value: string) {
  return value.trim().replaceAll('\\/', '/').replace(/&amp;/gi, '&');
}

function dedupeSources(values: Array<NormalizedPlaybackSource | null>) {
  const map = new Map<string, NormalizedPlaybackSource>();
  for (const value of values) {
    if (!value?.url) continue;
    map.set(value.type + '|' + value.url, value);
  }
  return [...map.values()];
}

const EXTRACTORS = [
  goStream,
  govad,
  jwPlayer,
  linkBox,
  moshahda,
  myVid,
  vidHd,
  voeSx,
  aflamy,
];

export async function resolveArProvExtractor(
  url: string,
  context: ExtractorContext = {},
): Promise<NormalizedPlaybackSource[]> {
  let parsed: URL;
  try {
    parsed = new URL(cleanUrl(url));
  } catch {
    return [];
  }

  const extractor = EXTRACTORS.find(item => item.hosts.some(pattern => pattern.test(parsed.hostname)));
  if (!extractor) return [];

  try {
    return await extractor.resolve(parsed.toString(), context);
  } catch {
    return [];
  }
}

export function getArProvExtractorKeys() {
  return EXTRACTORS.map(extractor => extractor.key);
}

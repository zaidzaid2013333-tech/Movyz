export interface HttpRequestOptions extends RequestInit {
  timeoutMs?: number;
}

export async function fetchWithTimeout(
  input: string | URL,
  options: HttpRequestOptions = {},
): Promise<Response> {
  const { timeoutMs = 8_000, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function absoluteHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function inferPlaybackType(url: string, explicit?: unknown) {
  const type = typeof explicit === 'string' ? explicit.toLowerCase() : '';
  if (type === 'hls' || type === 'm3u8') return 'hls' as const;
  if (type === 'mp4') return 'mp4' as const;
  if (type === 'dash' || type === 'mpd') return 'dash' as const;

  const pathname = (() => {
    try { return new URL(url).pathname.toLowerCase(); } catch { return url.toLowerCase(); }
  })();

  if (pathname.includes('.m3u8')) return 'hls' as const;
  if (pathname.includes('.mpd')) return 'dash' as const;
  if (pathname.includes('.mp4')) return 'mp4' as const;
  return 'hls' as const;
}

export function inferQuality(value: unknown, url: string) {
  const text = typeof value === 'string' ? value : url;
  const match = text.match(/(?:^|[^0-9])(2160|1440|1080|720|576|480|360|240)p(?:\b|[^0-9])/i);
  return match ? `${match[1]}p` : 'auto';
}

export function materializeTemplate(template: string, values: Record<string, string | number | undefined>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, encodeURIComponent(String(value ?? ''))),
    template,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface ExtractedCandidate {
  url: string;
  type?: string;
  quality?: string;
  language?: string;
  label?: string;
  providerReference?: string;
  expiresAt?: string;
}

export function extractPlaybackCandidates(payload: unknown): ExtractedCandidate[] {
  const output: ExtractedCandidate[] = [];
  const seen = new Set<string>();

  const add = (candidate: ExtractedCandidate) => {
    const url = absoluteHttpsUrl(candidate.url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    output.push({ ...candidate, url });
  };

  const visit = (value: unknown, depth = 0) => {
    if (depth > 4 || value == null) return;

    if (typeof value === 'string') {
      const url = absoluteHttpsUrl(value);
      if (url) add({ url });
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    if (!isObject(value)) return;

    const urlKeys = ['url', 'stream_url', 'streamUrl', 'video_url', 'videoUrl', 'file', 'directLink', 'src'];
    for (const key of urlKeys) {
      const raw = value[key];
      if (typeof raw === 'string') {
        add({
          url: raw,
          type: typeof value.type === 'string' ? value.type : typeof value.format === 'string' ? value.format : undefined,
          quality: typeof value.quality === 'string' ? value.quality : typeof value.label === 'string' ? value.label : undefined,
          language: typeof value.language === 'string' ? value.language : undefined,
          label: typeof value.label === 'string' ? value.label : undefined,
          providerReference: typeof value.id === 'string' ? value.id : undefined,
          expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : undefined,
        });
      }
    }

    for (const key of ['sources', 'streams', 'data', 'results', 'links']) {
      if (key in value) visit(value[key], depth + 1);
    }
  };

  visit(payload);
  return output;
}

export async function fetchJsonOrText(url: string, timeoutMs = 8_000) {
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs,
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'Movyza/1.0',
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Provider HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try { return JSON.parse(text) as unknown; } catch {}
  }
  return text;
}

export function resolveSourcesFromPayload(
  payload: unknown,
  defaults: { language?: string; label?: string },
) {
  return extractPlaybackCandidates(payload).map((candidate) => ({
    ...candidate,
    type: candidate.type,
    quality: candidate.quality,
    language: candidate.language || defaults.language,
    label: candidate.label || defaults.label,
  }));
}

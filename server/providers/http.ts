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
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function inferPlaybackType(url: string, explicit?: unknown): 'hls' | 'mp4' | 'dash' | null {
  const type = typeof explicit === 'string' ? explicit.toLowerCase() : '';
  if (type === 'hls' || type === 'm3u8') return 'hls';
  if (type === 'mp4') return 'mp4';
  if (type === 'dash' || type === 'mpd') return 'dash';

  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.includes('.m3u8')) return 'hls';
  if (pathname.includes('.mpd')) return 'dash';
  if (pathname.includes('.mp4')) return 'mp4';
  return null;
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
    if (depth > 5 || value == null) return;

    if (typeof value === 'string') {
      add({ url: value });
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    if (!isObject(value)) return;

    const explicitType = typeof value.type === 'string' ? value.type
      : typeof value.format === 'string' ? value.format
      : undefined;
    const quality = typeof value.quality === 'string' ? value.quality
      : typeof value.label === 'string' ? value.label
      : undefined;
    const language = typeof value.language === 'string' ? value.language : undefined;
    const label = typeof value.label === 'string' ? value.label : undefined;
    const providerReference = value.id !== undefined ? String(value.id) : undefined;
    const expiresAt = typeof value.expiresAt === 'string' ? value.expiresAt
      : typeof value.expires_at === 'string' ? value.expires_at
      : undefined;

    for (const key of ['url', 'stream_url', 'streamUrl', 'stream', 'video_url', 'videoUrl', 'hls_url', 'hlsUrl', 'm3u8', 'file', 'directLink', 'source', 'src']) {
      const raw = value[key];
      if (typeof raw === 'string') {
        add({ url: raw, type: explicitType, quality, language, label, providerReference, expiresAt });
      }
    }

    for (const key of ['sources', 'streams', 'data', 'result', 'response', 'results', 'links', 'playlist', 'directLink']) {
      if (key in value) visit(value[key], depth + 1);
    }
  };

  visit(payload);
  return output;
}

export async function fetchJsonOrText(url: string, timeoutMs = 8_000, requestHeaders: Record<string, string> = {}) {
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    timeoutMs,
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'Movyza/1.0',
      ...requestHeaders,
    },
  });

  const text = await response.text();
  if (!response.ok) {
    let host = url;
    try { host = new URL(url).hostname; } catch {}
    throw new Error(`Provider HTTP ${response.status} from ${host}`);
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
    language: candidate.language || defaults.language,
    label: candidate.label || defaults.label,
  }));
}

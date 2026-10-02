import type { ProviderContext, NormalizedPlaybackSource } from './types';

type DoodFile = {
  file_code?: string;
  filecode?: string;
  title?: string;
  canplay?: number | string;
  status?: string;
  protected_embed?: string;
  embed_url?: string;
  download_url?: string;
};

const API_BASE = 'https://doodapi.co/api';

function key() {
  return String(process.env.DOODSTREAM_API_KEY || '').trim();
}

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}]+/gu, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function quality(title: string) {
  const m = title.match(/(?:^|[^0-9])(2160|1440|1080|720|576|480|360)(?:p)?(?:\\b|[^0-9])/i);
  return m ? `${m[1]}p` : 'source';
}

function episodeIdentity(value: string) {
  const text = String(value || '');
  const m =
    text.match(/(?:^|[^a-z])s(?:eason)?[\\s._-]*(\\d{1,3})[\\s._-]*e(?:pisode)?[\\s._-]*(\\d{1,3})(?:[^0-9]|$)/i) ||
    text.match(/(?:^|[^0-9])(\\d{1,2})x(\\d{1,3})(?:[^0-9]|$)/i);
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : {};
}

function apiUrl(path: string, params: Record<string, string | number>) {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set('key', key());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}

async function doodFetch(path: string, params: Record<string, string | number>, timeoutMs = 8_000): Promise<any> {
  const apiKey = key();
  if (!apiKey) throw new Error('DOODSTREAM_API_KEY is not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl(path, params), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Movyza/1.0',
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = { msg: text, status: response.status }; }
    if (!response.ok) throw new Error(`Dood API HTTP ${response.status}`);
    if (payload?.status !== undefined && Number(payload.status) !== 200) {
      throw new Error(String(payload?.msg || 'Dood API request failed'));
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function extractFiles(payload: any): DoodFile[] {
  const candidates = [
    payload?.result?.files,
    payload?.result,
    payload?.files,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const files = candidate.filter((item) => item && typeof item === 'object') as DoodFile[];
    if (files.length) return files;
  }
  return [];
}

function codeOf(file: DoodFile) {
  return String(file.file_code || file.filecode || '').trim();
}

function scoreFile(file: DoodFile, context: ProviderContext, requestedSearch: string) {
  const title = String(file.title || '');
  const n = normalize(title);
  const baseTitles = [context.title, context.originalTitle, ...(context.alternateTitles || [])]
    .filter((x): x is string => !!x?.trim())
    .map(normalize);
  const search = normalize(requestedSearch);

  const wantedEpisode = context.episodeNumber;
  const wantedSeason = context.seasonNumber;
  const identity = episodeIdentity(title);

  let score = 0;
  if (search && n === search) score += 1600;
  if (search && n.includes(search)) score += 1100;
  for (const base of baseTitles) {
    if (base && n === base) score += 900;
    else if (base && n.includes(base)) score += 600;
  }

  if (wantedEpisode !== undefined) {
    if (identity.episode === wantedEpisode) score += 900;
    else if (identity.episode !== undefined) score -= 1200;
  }
  if (wantedSeason !== undefined) {
    if (identity.season === wantedSeason) score += 500;
    else if (identity.season !== undefined) score -= 900;
  }

  const q = quality(title);
  if (q !== 'source') score += Number(q.replace('p', '')) / 10;
  if (String(file.canplay) === '1' || String(file.status).toLowerCase() === 'active') score += 50;
  return score;
}

function buildEmbed(file: DoodFile) {
  const raw = String(file.protected_embed || file.embed_url || '').trim();
  if (raw) {
    try {
      return new URL(raw, 'https://dood.watch').toString();
    } catch {}
  }
  const code = codeOf(file);
  return code ? `https://dood.watch/e/${encodeURIComponent(code)}` : '';
}

async function enrichEmbed(file: DoodFile, timeoutMs: number) {
  const code = codeOf(file);
  if (!code) return '';
  if (file.protected_embed || file.embed_url) return buildEmbed(file);

  try {
    const payload = await doodFetch('/file/info', { file_code: code }, timeoutMs);
    const info = Array.isArray(payload?.result) ? payload.result[0] : payload?.result;
    return buildEmbed({ ...file, ...(info || {}) });
  } catch {
    return buildEmbed(file);
  }
}

async function listFilesFallback(timeoutMs: number) {
  const out: DoodFile[] = [];
  for (let page = 1; page <= 5; page += 1) {
    try {
      const payload = await doodFetch('/file/list', { page, per_page: 200 }, timeoutMs);
      const files = extractFiles(payload);
      out.push(...files);
      const totalPages = Number(payload?.result?.total_pages || 0);
      if (!files.length || (totalPages > 0 && page >= totalPages)) break;
    } catch {
      break;
    }
  }
  return out;
}

export async function resolveDoodStreamPlayback(context: ProviderContext): Promise<NormalizedPlaybackSource[]> {
  if (!key()) return [];

  const title = String(context.title || context.originalTitle || '').trim();
  if (!title) return [];

  const season = context.seasonNumber;
  const episode = context.episodeNumber;
  const timeoutMs = Math.min(Math.max(Number(process.env.DOODSTREAM_TIMEOUT_MS || 6_000), 3_000), 10_000);
  const pool = new Map<string, DoodFile>();

  for (const file of await listFilesFallback(timeoutMs)) {
    const code = codeOf(file);
    if (code) pool.set(code, file);
  }

  const ranked = [...pool.values()]
    .map((file) => ({ file, score: scoreFile(file, context, `${title} ${season !== undefined && episode !== undefined ? `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}` : ''}`.trim()) }))
    .filter((item) => item.score >= 450)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const output: NormalizedPlaybackSource[] = [];
  const seen = new Set<string>();

  for (const item of ranked) {
    const url = await enrichEmbed(item.file, timeoutMs);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const fileTitle = String(item.file.title || title);
    output.push({
      provider: 'DoodStream',
      type: 'embed',
      url,
      providerReference: codeOf(item.file),
      quality: quality(fileTitle),
      language: 'multi',
      label: `DoodStream ${quality(fileTitle)}`,
    });
  }

  return output;
}

export function createDoodStreamAdapter() {
  return {
    key: 'doodstream',
    name: 'DoodStream',
    enabled: true,
    requiresMapping: false,
    async resolveMovie(context: ProviderContext) {
      return resolveDoodStreamPlayback(context);
    },
    async resolveEpisode(context: ProviderContext) {
      return resolveDoodStreamPlayback(context);
    },
    async health() {
      const started = Date.now();
      try {
        await doodFetch('/account/info', {}, 4_000);
        return { status: 'healthy' as const, latencyMs: Date.now() - started };
      } catch (error) {
        return {
          status: 'offline' as const,
          latencyMs: Date.now() - started,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

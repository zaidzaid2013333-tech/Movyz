export type VidLinkContext = {
  contentType: "movie" | "episode";
  contentId: string;
  seasonNumber?: number;
  episodeNumber?: number;
};

export type VidLinkSource = {
  url: string;
  type: "hls" | "mp4" | "dash" | "webm" | "direct";
  quality?: string;
  referer: string;
  provider: "VidLink";
  providerKey: "vidlink";
};

const VIDLINK_ORIGIN = "https://vidlink.pro";
const VIDLINK_API_ORIGIN = "https://enc-dec.app";
const VIDLINK_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const VIDLINK_MIN_INTERVAL_MS = 450;

let vidlinkGate = Promise.resolve();
let nextVidlinkRequestAt = 0;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function runVidLinkSerialized<T>(task: () => Promise<T>): Promise<T> {
  const previous = vidlinkGate;
  let release!: () => void;
  vidlinkGate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    const waitMs = Math.max(0, nextVidlinkRequestAt - Date.now());
    if (waitMs) await sleep(waitMs);
    const value = await task();
    nextVidlinkRequestAt = Date.now() + VIDLINK_MIN_INTERVAL_MS;
    return value;
  } finally {
    release();
  }
}

function inferType(url: string): VidLinkSource["type"] {
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return "hls";
  if (/\.mpd(?:[?#]|$)/i.test(url)) return "dash";
  if (/\.mp4(?:[?#]|$)/i.test(url)) return "mp4";
  if (/\.webm(?:[?#]|$)/i.test(url)) return "webm";
  return "direct";
}

function qualityToNumber(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "4k") return 2160;
  const match = raw.match(/(2160|1440|1080|720|576|480|360|240)/);
  return match?.[1] ? Number(match[1]) : 0;
}

function qualityLabel(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  if (raw.toLowerCase() === "4k") return "2160p";
  const numeric = qualityToNumber(raw);
  return numeric ? numeric + "p" : undefined;
}

function qualityOfUrl(url: string) {
  const match = url.match(
    /(?:^|[^0-9])(2160|1440|1080|720|576|480|360|240)(?:p)?(?:[^0-9]|$)/i,
  );
  return match?.[1] ? match[1] + "p" : undefined;
}

function addCandidate(output: VidLinkSource[], url: unknown, quality?: unknown) {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return;
  if (/^https:\/\/(?:www\.)?vidlink\.pro\//i.test(url)) return;
  const clean = url.trim();
  if (!clean || output.some((source) => source.url === clean)) return;
  output.push({
    url: clean,
    type: inferType(clean),
    quality: qualityLabel(quality) ?? qualityOfUrl(clean),
    referer: VIDLINK_ORIGIN + "/",
    provider: "VidLink",
    providerKey: "vidlink",
  });
}

function extractGenericSources(value: unknown, output: VidLinkSource[], depth = 0) {
  if (depth > 6 || output.length >= 8 || value == null) return;
  if (typeof value === "string") {
    if (/^https:\/\//i.test(value)) addCandidate(output, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      extractGenericSources(item, output, depth + 1);
      if (output.length >= 8) break;
    }
    return;
  }
  if (typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  for (const key of [
    "url", "src", "stream_url", "streamUrl", "file", "link", "m3u8",
    "manifest", "playUrl", "play_url",
  ]) {
    if (typeof object[key] === "string") {
      addCandidate(output, object[key], object.quality ?? object.label ?? object.name);
    }
  }
  for (const key of [
    "sources", "streams", "links", "data", "result", "results",
    "playlist", "playlists", "videos",
  ]) {
    if (object[key] !== undefined) {
      extractGenericSources(object[key], output, depth + 1);
      if (output.length >= 8) break;
    }
  }
}

async function requestJson(url: string, headers: Record<string, string>, timeoutMs = 12_000) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(Math.max(3_000, timeoutMs)),
    redirect: "follow",
  });
  const body = await response.text();
  if (!response.ok) throw new Error("VIDLINK_HTTP_" + response.status);
  try { return JSON.parse(body); }
  catch { throw new Error("VIDLINK_INVALID_JSON"); }
}

async function requestVidLinkJson(url: string) {
  return runVidLinkSerialized(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await requestJson(url, {
          accept: "application/json,text/plain,*/*",
          origin: VIDLINK_ORIGIN,
          referer: VIDLINK_ORIGIN + "/",
          "user-agent": VIDLINK_USER_AGENT,
          "cache-control": "no-cache",
        });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (message !== "VIDLINK_HTTP_429" || attempt === 2) throw error;
        await sleep(700 * 2 ** attempt + Math.floor(Math.random() * 250));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  });
}

async function encryptTmdbId(tmdbId: string) {
  const response = await requestJson(
    VIDLINK_API_ORIGIN + "/api/enc-vidlink?text=" + encodeURIComponent(tmdbId),
    { accept: "application/json,text/plain,*/*", "user-agent": VIDLINK_USER_AGENT },
    8_000,
  );
  const status = Number(response?.status ?? 200);
  const result = response?.result;
  if (status !== 200 || typeof result !== "string" || !result.trim()) {
    throw new Error("VIDLINK_ENCRYPTION_FAILED");
  }
  return result.trim();
}

function extractQualitySources(payload: unknown) {
  const output: VidLinkSource[] = [];
  const stream = (payload as Record<string, unknown> | null)?.stream;
  if (stream && typeof stream === "object") {
    const qualities = (stream as Record<string, unknown>).qualities;
    if (qualities && typeof qualities === "object") {
      for (const [quality, entry] of Object.entries(qualities as Record<string, unknown>)) {
        if (!entry || typeof entry !== "object") continue;
        addCandidate(output, (entry as Record<string, unknown>).url, quality);
      }
    }
  }
  output.sort((a, b) => qualityToNumber(b.quality) - qualityToNumber(a.quality));
  return output.slice(0, 8);
}

export async function resolveVidLink(context: VidLinkContext): Promise<VidLinkSource[]> {
  const tmdbId = String(context.contentId || "").trim();
  if (!/^\d+$/.test(tmdbId)) throw new Error("VIDLINK_TMDB_ID_REQUIRED");
  const encodedTmdb = await encryptTmdbId(tmdbId);
  const endpoint = context.contentType === "movie"
    ? VIDLINK_ORIGIN + "/api/b/movie/" + encodedTmdb + "?multiLang=0"
    : VIDLINK_ORIGIN + "/api/b/tv/" + encodedTmdb + "/" +
      encodeURIComponent(String(context.seasonNumber ?? 1)) + "/" +
      encodeURIComponent(String(context.episodeNumber ?? 1)) + "?multiLang=0";
  const payload = await requestVidLinkJson(endpoint);
  const sources = extractQualitySources(payload);
  if (sources.length) return sources;
  const generic: VidLinkSource[] = [];
  extractGenericSources(payload, generic);
  if (generic.length) return generic.slice(0, 8);
  throw new Error("VIDLINK_NO_PLAYABLE_SOURCES");
}
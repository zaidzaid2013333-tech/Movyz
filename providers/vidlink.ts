import nacl from "tweetnacl";

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

const DEFAULT_KEY_HEX =
  "c75136c5668bbfe65a7ecad431a745db68b5f381555b38d8f6c699449cf11fcd";

const VIDLINK_ORIGIN = "https://vidlink.pro";
const VIDLINK_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

function keyBytes() {
  const raw = String(
    process.env.VIDLINK_KEY_HEX || DEFAULT_KEY_HEX,
  )
    .trim()
    .replace(/^0x/i, "");

  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error("VIDLINK_KEY_INVALID");
  }

  return Uint8Array.from(Buffer.from(raw, "hex"));
}

function encryptToken(mediaId: string) {
  const nonce = new Uint8Array(24);
  const timestamp = BigInt(Math.floor(Date.now() / 1000) + 480);
  const timestampBytes = Buffer.allocUnsafe(8);
  timestampBytes.writeBigUInt64BE(timestamp, 0);

  const message = Buffer.concat([
    Buffer.from(mediaId, "utf8"),
    timestampBytes,
  ]);

  const encrypted = nacl.secretbox(
    new Uint8Array(message),
    nonce,
    keyBytes(),
  );

  return Buffer.from(
    Buffer.concat([Buffer.from(nonce), Buffer.from(encrypted)]),
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function inferType(url: string): VidLinkSource["type"] {
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return "hls";
  if (/\.mpd(?:[?#]|$)/i.test(url)) return "dash";
  if (/\.mp4(?:[?#]|$)/i.test(url)) return "mp4";
  if (/\.webm(?:[?#]|$)/i.test(url)) return "webm";
  return "direct";
}

function qualityOf(value: unknown, url: string) {
  const raw = String(value ?? "").trim();
  if (raw) {
    const match = raw.match(/(2160|1440|1080|720|576|480|360|240)\s*p?/i);
    if (match?.[1]) return match[1] + "p";
  }

  const fromUrl = url.match(/(?:^|[^0-9])(2160|1440|1080|720|576|480|360|240)(?:p)?(?:[^0-9]|$)/i);
  return fromUrl?.[1] ? fromUrl[1] + "p" : undefined;
}

function addCandidate(
  output: VidLinkSource[],
  url: unknown,
  quality?: unknown,
) {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return;
  if (/^https:\/\/(?:www\.)?vidlink\.pro\//i.test(url)) return;

  const clean = url.trim();
  if (!clean || output.some((source) => source.url === clean)) return;

  output.push({
    url: clean,
    type: inferType(clean),
    quality: qualityOf(quality, clean),
    referer: VIDLINK_ORIGIN + "/",
    provider: "VidLink",
    providerKey: "vidlink",
  });
}

function extractSources(value: unknown, output: VidLinkSource[], depth = 0) {
  if (depth > 5 || output.length >= 4 || value == null) return;

  if (typeof value === "string") {
    if (/^https:\/\//i.test(value)) addCandidate(output, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractSources(item, output, depth + 1);
      if (output.length >= 4) break;
    }
    return;
  }

  if (typeof value !== "object") return;

  const object = value as Record<string, unknown>;
  for (const key of [
    "url",
    "src",
    "stream_url",
    "streamUrl",
    "file",
    "link",
    "m3u8",
    "manifest",
    "playUrl",
    "play_url",
  ]) {
    if (typeof object[key] === "string") {
      addCandidate(output, object[key], object.quality ?? object.label ?? object.name);
    }
  }

  for (const key of [
    "sources",
    "streams",
    "links",
    "data",
    "result",
    "results",
    "playlist",
    "playlists",
    "videos",
  ]) {
    if (object[key] !== undefined) {
      extractSources(object[key], output, depth + 1);
      if (output.length >= 4) break;
    }
  }
}

async function requestJson(url: string) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/plain,*/*",
      origin: VIDLINK_ORIGIN,
      referer: VIDLINK_ORIGIN + "/",
      "user-agent": VIDLINK_USER_AGENT,
    },
    signal: AbortSignal.timeout(
      Math.max(3_000, Number(process.env.VIDLINK_REQUEST_TIMEOUT_MS || 12_000)),
    ),
    redirect: "follow",
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error("VIDLINK_HTTP_" + response.status);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("VIDLINK_INVALID_JSON");
  }
}

export async function resolveVidLink(
  context: VidLinkContext,
): Promise<VidLinkSource[]> {
  if (!context.contentId) throw new Error("VIDLINK_CONTENT_ID_MISSING");

  const token = encryptToken(context.contentId);
  const endpoint =
    context.contentType === "movie"
      ? `${VIDLINK_ORIGIN}/api/b/movie/${token}?multiLang=1`
      : `${VIDLINK_ORIGIN}/api/b/tv/${token}/${encodeURIComponent(
          String(context.seasonNumber ?? 1),
        )}/${encodeURIComponent(String(context.episodeNumber ?? 1))}?multiLang=1`;

  const payload = await requestJson(endpoint);
  const sources: VidLinkSource[] = [];
  extractSources(payload, sources);

  if (!sources.length) {
    throw new Error("VIDLINK_NO_PLAYABLE_SOURCES");
  }

  return sources;
}

/**
 * Signed MovieBox Android/mobile API client for Cloudflare Workers.
 * Playback uses the mobile subject/resource API and returns direct MP4 URLs.
 */

const HOST_POOL = [
  "https://api6.aoneroom.com",
  "https://api5.aoneroom.com",
  "https://api4.aoneroom.com",
  "https://api4sg.aoneroom.com",
  "https://api3.aoneroom.com",
  "https://api6sg.aoneroom.com",
  "https://api.inmoviebox.com",
];

const SECRET_KEY_B64 = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const VERSION_CODE = 50020044;
const VERSION_NAME = "3.0.03.0529.03";
const ANDROID_VERSION = "13";
const ANDROID_BUILD = "TQ2A.230405.003";
const DEVICE_MODEL = "23078RKD5C";
const DEVICE_BRAND = "Redmi";
const USER_AGENT =
  `com.community.oneroom/${VERSION_CODE} (Linux; U; Android ${ANDROID_VERSION}; en_US; ${DEVICE_MODEL}; Build/${ANDROID_BUILD}; Cronet/135.0.7012.3)`;

const BOOTSTRAP_PATH = "/wefeed-mobile-bff/tab-operating";
const SEARCH_PATH = "/wefeed-mobile-bff/subject-api/search";
const DETAIL_PATH = "/wefeed-mobile-bff/subject-api/get";
const SEASON_PATH = "/wefeed-mobile-bff/subject-api/season-info";
const RESOURCE_PATH = "/wefeed-mobile-bff/subject-api/resource";
const RESOLUTIONS = [360, 480, 720, 1080];
const REQUEST_TIMEOUT_MS = 12000;

let authToken = null;
let authExpiresAt = 0;
let bootstrapPromise = null;
let clientInfo = null;
let deviceId = null;
let gaid = null;

function md5Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const originalLength = bytes.length;
  const bitLength = originalLength * 8;
  const paddedLength = ((originalLength + 8) >> 6 << 6) + 64;
  const message = new Uint8Array(paddedLength);
  message.set(bytes);
  message[originalLength] = 0x80;

  const view = new DataView(message.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const s = [
    7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
    5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
    6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21,
  ];
  const k = Array.from({ length: 64 }, (_, i) =>
    Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0
  );
  const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

  for (let offset = 0; offset < message.length; offset += 64) {
    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(offset + i * 4, true);

    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }

      const next = d;
      d = c;
      c = b;
      b = (b + rotl((a + f + k[i] + m[g]) >>> 0, s[i])) >>> 0;
      a = next;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  let hex = "";
  for (const word of [a0, b0, c0, d0]) {
    for (let i = 0; i < 4; i++) {
      hex += ((word >>> (8 * i)) & 0xff).toString(16).padStart(2, "0");
    }
  }
  return hex;
}

function hexToBytes(hex) {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function base64Decode(value) {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function base64Encode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function hmacMd5(keyBytes, message) {
  let key = keyBytes;
  if (key.length > 64) key = hexToBytes(md5Hex(key));

  const block = new Uint8Array(64);
  block.set(key);
  const innerPad = new Uint8Array(64);
  const outerPad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    innerPad[i] = block[i] ^ 0x36;
    outerPad[i] = block[i] ^ 0x5c;
  }

  const messageBytes = new TextEncoder().encode(message);
  const inner = hexToBytes(md5Hex(concatBytes(innerPad, messageBytes)));
  return base64Encode(hexToBytes(md5Hex(concatBytes(outerPad, inner))));
}

function generateClientToken(timestamp) {
  const ts = String(timestamp);
  return `${ts},${md5Hex(ts.split("").reverse().join(""))}`;
}

function sortedQueryString(url) {
  const parsed = new URL(url);
  return [...parsed.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function generateSignature(method, accept, contentType, url, body, timestamp) {
  const parsed = new URL(url);
  const query = sortedQueryString(url);
  const canonicalUrl = query ? `${parsed.pathname}?${query}` : parsed.pathname;

  let bodyHash = "";
  let bodyLength = "";
  if (body !== null) {
    const bodyBytes = new TextEncoder().encode(body);
    bodyHash = md5Hex(bodyBytes.slice(0, 102400));
    bodyLength = String(bodyBytes.length);
  }

  const canonical = [
    method.toUpperCase(),
    accept,
    contentType,
    bodyLength,
    timestamp,
    bodyHash,
    canonicalUrl,
  ].join("\n");

  return `${timestamp}|2|${base64Encode(hmacMd5(base64Decode(SECRET_KEY_B64), canonical))}`;
}

function resetClientIdentity() {
  deviceId = null;
  gaid = null;
  clientInfo = null;
}

function getClientIdentity() {
  if (!deviceId) {
    deviceId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  if (!gaid) gaid = crypto.randomUUID();
  if (!clientInfo) {
    clientInfo = JSON.stringify({
      package_name: "com.community.oneroom",
      version_name: VERSION_NAME,
      version_code: VERSION_CODE,
      os: "android",
      os_version: ANDROID_VERSION,
      install_ch: "ps",
      device_id: deviceId,
      install_store: "ps",
      gaid,
      brand: DEVICE_BRAND,
      model: DEVICE_MODEL,
      system_language: "en",
      net: "NETWORK_WIFI",
      region: "US",
      timezone: "America/New_York",
      sp_code: "40401",
      "X-Play-Mode": "2",
    });
  }
  return clientInfo;
}

function extractXUserToken(response) {
  const raw = response.headers.get("x-user");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.token === "string" && parsed.token ? parsed.token : null;
  } catch {
    return null;
  }
}

function decodeJwtExpSeconds(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded));
    return typeof parsed.exp === "number" ? parsed.exp : null;
  } catch {
    return null;
  }
}

function cacheAuthToken(token) {
  authToken = token;
  const exp = decodeJwtExpSeconds(token);
  authExpiresAt = exp ? exp * 1000 : Date.now() + 86400000;
}

function usableAuthToken() {
  return authToken && Date.now() < authExpiresAt - 60000 ? authToken : null;
}

function buildHeaders(method, url, body, bearerToken) {
  const accept = "application/json";
  const contentType = body !== null ? "application/json; charset=utf-8" : "application/json";
  const timestamp = Date.now();

  const headers = {
    "User-Agent": USER_AGENT,
    Accept: accept,
    "Content-Type": contentType,
    Connection: "keep-alive",
    "X-Client-Token": generateClientToken(timestamp),
    "x-tr-signature": generateSignature(method, accept, contentType, url, body, timestamp),
    "X-Client-Info": getClientIdentity(),
    "X-Client-Status": "0",
    "X-Play-Mode": "2",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };

  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  return headers;
}

async function readResponse(response) {
  const raw = await response.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  return { raw, parsed };
}

async function bootstrapAuthToken() {
  if (usableAuthToken()) return usableAuthToken();
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    resetClientIdentity();
    const params = new URLSearchParams({ page: "1", tabId: "0", version: "" });
    let lastFailure = "no x-user token returned";

    for (const host of HOST_POOL) {
      const url = `${host}${BOOTSTRAP_PATH}?${params.toString()}`;
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: buildHeaders("GET", url, null, null),
          redirect: "follow",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const rotated = extractXUserToken(response);
        if (rotated) {
          cacheAuthToken(rotated);
          return rotated;
        }
        const { raw } = await readResponse(response);
        lastFailure = `${host} HTTP ${response.status}${raw ? " " + raw.replace(/\s+/g, " ").slice(0, 180) : ""}`;
      } catch (error) {
        lastFailure = `${host}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    throw new Error(`MovieBox mobile auth bootstrap failed: ${lastFailure}`);
  })().finally(() => {
    bootstrapPromise = null;
  });

  return bootstrapPromise;
}

async function requestOnce(host, path, method, params, body, bearerToken) {
  const url = new URL(`${host}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }

  const bodyText = body == null ? null : JSON.stringify(body);
  const headers = buildHeaders(method, url.toString(), bodyText, bearerToken);
  const response = await fetch(url.toString(), {
    method,
    headers,
    body: bodyText ?? undefined,
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const { raw, parsed } = await readResponse(response);
  const rotated = extractXUserToken(response);
  if (rotated) cacheAuthToken(rotated);

  return {
    ok: response.ok && parsed?.code === 0,
    status: response.status,
    raw,
    parsed,
    authFailure:
      response.status === 401 ||
      response.status === 403 ||
      /token|auth|login/i.test(String(parsed?.message || "")),
  };
}

async function requestMobile(path, method = "GET", params, body) {
  let bearer = await bootstrapAuthToken();
  let lastFailure = "all MovieBox mobile hosts failed";
  let authFailureSeen = false;

  for (const host of HOST_POOL) {
    try {
      const result = await requestOnce(host, path, method, params, body, bearer);
      if (result.ok) return result.parsed.data ?? null;
      if (result.authFailure) authFailureSeen = true;
      lastFailure = `${host} HTTP ${result.status}${result.raw ? " " + result.raw.replace(/\s+/g, " ").slice(0, 220) : ""}`;
    } catch (error) {
      lastFailure = `${host}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  if (authFailureSeen) {
    authToken = null;
    authExpiresAt = 0;
    resetClientIdentity();
    bearer = await bootstrapAuthToken();

    for (const host of HOST_POOL) {
      try {
        const result = await requestOnce(host, path, method, params, body, bearer);
        if (result.ok) return result.parsed.data ?? null;
        lastFailure = `${host} HTTP ${result.status}${result.raw ? " " + result.raw.replace(/\s+/g, " ").slice(0, 220) : ""}`;
      } catch (error) {
        lastFailure = `${host}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  throw new Error(`MovieBox mobile request failed for ${path}: ${lastFailure}`);
}

function mapSearchItem(item) {
  const subjectId = item?.subjectId;
  return {
    name: item?.title || item?.name || "",
    year: item?.releaseDate || null,
    poster_url: item?.cover?.url || item?.thumbnail || null,
    url: subjectId != null ? `https://moviebox.pk/detail/${encodeURIComponent(String(subjectId))}` : null,
    slug: subjectId != null ? String(subjectId) : null,
    badge: item?.corner || null,
    blurhash: item?.cover?.blurHash || null,
  };
}

export async function mobileSearch(query) {
  const data = await requestMobile(
    SEARCH_PATH,
    "POST",
    undefined,
    { keyword: query, page: 1, perPage: 30, subjectType: 0 },
  );
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    query,
    count: items.length,
    movies: items.map(mapSearchItem).filter((item) => item.slug && item.name),
  };
}

export async function mobileDetail(subjectId) {
  const data = await requestMobile(DETAIL_PATH, "GET", { subjectId });
  if (!data?.subjectId) throw new Error(`MovieBox detail returned no subject id for ${subjectId}`);
  return {
    id: String(data.subjectId),
    title: data.title || "",
    description: data.description || null,
    release_date: data.releaseDate || null,
    duration: data.duration || null,
    genre: data.genre || [],
    country: data.countryName || null,
    imdb_rating: data.imdbRatingValue || null,
    poster: data.cover?.url || null,
    badge: data.corner || null,
    dubs: data.dubs || [],
    top_cast: data.staffList || [],
    has_resource: Boolean(data.hasResource),
    language: data.language || null,
  };
}

export async function mobileSeasons(subjectId) {
  const data = await requestMobile(SEASON_PATH, "GET", { subjectId });
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  return seasons.map((season) => ({
    season: Number(season.se || 0),
    episode_count: Number(season.maxEp || 0),
    episodes_available: Array.isArray(season.resolutions) && season.resolutions.length
      ? Math.max(...season.resolutions.map((resolution) => Number(resolution.epNum || 0)))
      : Number(season.maxEp || 0),
  }));
}

async function fetchResourcePage(subjectId, se, ep, resolution, page) {
  return requestMobile(
    RESOURCE_PATH,
    "GET",
    { subjectId, se, ep, resolution, page, perPage: 10 },
  );
}

export async function mobileStreams(subjectId, se = 0, ep = 0) {
  const seen = new Map();
  const failures = [];

  for (const resolution of RESOLUTIONS) {
    let page = 1;
    while (page <= 100) {
      try {
        const data = await fetchResourcePage(subjectId, se, ep, resolution, page);
        const list = Array.isArray(data?.list) ? data.list : [];

        for (const item of list) {
          if (item?.resourceId && item?.resourceLink) {
            seen.set(String(item.resourceId), item);
          }
        }

        if (!data?.pager?.hasMore) break;
        page++;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        break;
      }
    }
  }

  const items = [...seen.values()].sort(
    (a, b) => Number(b.resolution || 0) - Number(a.resolution || 0),
  );

  if (!items.length) {
    throw new Error(
      `MovieBox returned no resources for subject ${subjectId} se=${se} ep=${ep}${failures.length ? ": " + failures.join(" | ").slice(0, 700) : ""}`,
    );
  }

  return items.map((item) => ({
    id: String(item.resourceId),
    resolution: Number(item.resolution || 0),
    format: "mp4",
    url: String(item.resourceLink),
    size_bytes: item.size ? Number(item.size) || null : null,
    size: item.size || null,
    title: item.title || null,
    se: Number(item.se ?? se),
    ep: Number(item.ep ?? ep),
    captions: Array.isArray(item.extCaptions)
      ? item.extCaptions
          .map((caption) => ({
            language: caption.lanName || caption.lan || "und",
            language_code: caption.lan || null,
            url: caption.url || null,
          }))
          .filter((caption) => caption.url)
      : [],
  }));
}

export function __resetMobileAuthForTests() {
  authToken = null;
  authExpiresAt = 0;
  bootstrapPromise = null;
  resetClientIdentity();
}

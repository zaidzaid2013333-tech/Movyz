const RESOLVER_BASE = (process.env.AKWAM_RESOLVER_BASE ||
  "https://movyz-akwam-resolver.sameranede.workers.dev").replace(/\/+$/, "");
const WATCH_BASE = (process.env.WATCH_API_BASE ||
  "https://movyz-moviebox.sameranede.workers.dev").replace(/\/+$/, "");

const movieFixture = {
  title: "Inception",
  year: 2010,
  type: "movie",
  tmdb_id: 27205,
  content_url: "https://ak.sv/movie/562/inception-1",
  source_url: "https://ak.sv/movie/562/inception-1",
  mode: "iframe",
};

const episodeFixture = {
  mode: "iframe",
  title: "The Mentalist",
  title_en: "The Mentalist",
  original_title: "The Mentalist",
  year: 2008,
  tmdb_id: 4020,
  season: 1,
  episode: 1,
};

function isHttp(value) {
  return typeof value === "string" && /^https:\/\//i.test(value);
}

function validateSource(value) {
  if (!isHttp(value)) throw new Error("source_url is not HTTPS: " + value);
  const host = new URL(value).hostname.toLowerCase();
  const allowed = [
    "ak.sv", "akwam.it", "go.akwam.it", "akwam.ss",
    "akwam.ee", "akwam.com.co", "go.akwam.com.co", "downet.net",
  ];
  if (!allowed.some((base) => host === base || host.endsWith("." + base))) {
    throw new Error("source_url is not an allowed Akwam host: " + host);
  }
}

function hasMp4Signature(bytes) {
  return bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70;
}

function inferType(url, contentType, contentDisposition, sample, bytes) {
  const ct = String(contentType || "").toLowerCase();
  const u = String(url || "").toLowerCase();
  const cd = String(contentDisposition || "").toLowerCase();
  if (/mpegurl|vnd\.apple\.mpegurl/.test(ct) || /#extm3u/i.test(sample)) return "hls";
  if (/dash\+xml|application\/dash/.test(ct) || /<\s*mpd\b/i.test(sample)) return "dash";
  if (/^video\//.test(ct) ||
      /\.(?:mp4|m4v|webm)(?:[?#]|$)/.test(u) ||
      /\.(?:mp4|m4v|webm)(?:[?#]|$)/.test(cd) ||
      hasMp4Signature(bytes)) return "mp4";
  return "";
}

async function readProbeBytes(response, limit = 65_536) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < limit) {
      const part = await reader.read();
      if (part.done) break;
      if (!part.value || !part.value.byteLength) continue;
      const remaining = limit - total;
      const chunk = part.value.slice(0, remaining);
      chunks.push(chunk);
      total += chunk.byteLength;
      if (chunk.byteLength < part.value.byteLength) break;
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function jsonResponse(response, name) {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch {
    throw new Error(name + " returned non-JSON HTTP " + response.status + ": " + text.slice(0, 800));
  }
  if (!response.ok) throw new Error(name + " HTTP " + response.status + ": " + text.slice(0, 1600));
  return body;
}

async function validateMedia(url, expectedType, referer) {
  if (!isHttp(url)) throw new Error("media_url is not HTTPS: " + url);

  const response = await fetch(url, {
    headers: {
      Accept: "*/*",
      Range: "bytes=0-65535",
      ...(referer ? { Referer: referer } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });

  const finalUrl = response.url || url;
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const contentDisposition = response.headers.get("content-disposition") || "";
  const bytes = await readProbeBytes(response);
  const sample = new TextDecoder().decode(bytes.slice(0, 4096));

  console.log(
    "AKWAM_MEDIA_CHECK",
    response.status,
    finalUrl,
    contentType,
    "bytes=" + bytes.byteLength,
  );

  if (!response.ok || response.status === 204) {
    throw new Error("media_url unavailable: HTTP " + response.status + " " + finalUrl);
  }

  if (/text\/html|application\/xhtml/.test(contentType) ||
      /<\s*(?:!doctype\s+html|html)\b/i.test(sample.slice(0, 512))) {
    throw new Error("media_url returned HTML/challenge: " + finalUrl);
  }

  const actualType = inferType(
    finalUrl,
    contentType,
    contentDisposition,
    sample,
    bytes,
  );

  if (!actualType) {
    throw new Error("media_url response is not recognized media: " + finalUrl);
  }

  if (expectedType !== actualType) {
    throw new Error(
      "media type mismatch: resolver=" + expectedType +
      " actual=" + actualType +
      " url=" + finalUrl,
    );
  }

  return {
    finalUrl,
    contentType,
    actualType,
    bytes: bytes.byteLength,
  };
}


const resolverResponse = await fetch(RESOLVER_BASE + "/resolve", {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify(movieFixture),
  signal: AbortSignal.timeout(120_000),
});
const resolved = await jsonResponse(resolverResponse, "Akwam resolver");
console.log("AKWAM_RESOLVER_RESPONSE", JSON.stringify(resolved));

if (!resolved?.ok || !isHttp(resolved.source_url) ||
    !isHttp(resolved.media_url) ||
    !["mp4", "hls", "dash"].includes(resolved.type)) {
  throw new Error("Resolver did not return a valid direct-media contract");
}
validateSource(resolved.source_url);
await validateMedia(resolved.media_url, resolved.type, resolved.source_url);

const watchResponse = await fetch(WATCH_BASE + "/watch/movie", {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify(fixture),
  signal: AbortSignal.timeout(120_000),
});
const watched = await jsonResponse(watchResponse, "Watch API movie iframe");
console.log("AKWAM_WATCH_MOVIE_IFRAME_RESPONSE", JSON.stringify(watched));

if (!watched?.ok || !isHttp(watched.source_url) ||
    !isHttp(watched.media_url) ||
    watched.media_type !== "web" ||
    watched.stream?.type !== "web" ||
    watched.stream?.iframe_url !== watched.media_url) {
  throw new Error("Watch API movie did not return the expected iframe contract");
}
validateSource(watched.source_url);
validateSource(watched.media_url);

const episodeFixture = {
  title: "The Mentalist",
  year: 2008,
  type: "series",
  tmdb_id: 5920,
  season: 1,
  episode: 1,
  mode: "iframe",
};

const episodeResponse = await fetch(WATCH_BASE + "/watch/episode", {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify(episodeFixture),
  signal: AbortSignal.timeout(120_000),
});
const episode = await jsonResponse(episodeResponse, "Watch API episode iframe");
console.log("AKWAM_WATCH_EPISODE_IFRAME_RESPONSE", JSON.stringify(episode));

if (!episode?.ok || episode.type !== "episode" ||
    Number(episode.season) !== 1 || Number(episode.episode) !== 1 ||
    !isHttp(episode.source_url) || !isHttp(episode.media_url) ||
    episode.media_type !== "web" ||
    episode.stream?.type !== "web" ||
    episode.stream?.iframe_url !== episode.media_url) {
  throw new Error("Watch API episode did not return the expected iframe contract");
}
validateSource(episode.source_url);
validateSource(episode.media_url);

console.log("AKWAM_PLAYBACK_E2E=PASS");

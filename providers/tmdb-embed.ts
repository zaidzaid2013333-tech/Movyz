export type TmdbEmbedContext = {
  tmdbId?: number;
  contentType: "movie" | "episode";
  seasonNumber?: number;
  episodeNumber?: number;
};

export type TmdbEmbedSource = {
  url: string;
  type: "hls" | "mp4" | "dash" | "webm" | "direct";
  quality?: string;
  referer?: string;
  provider: string;
  providerKey: string;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function inferType(url: string): TmdbEmbedSource["type"] {
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return "hls";
  if (/\.mpd(?:[?#]|$)/i.test(url)) return "dash";
  if (/\.mp4(?:[?#]|$)/i.test(url)) return "mp4";
  if (/\.webm(?:[?#]|$)/i.test(url)) return "webm";
  return "direct";
}

function normalizeQuality(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  if (/^4k$/i.test(raw)) return "2160p";
  const match = raw.match(/(2160|1440|1080|720|576|480|360|240)/);
  return match?.[1] ? match[1] + "p" : raw;
}

function providerSlug(value: unknown) {
  return String(value ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

async function requestJson(url: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Movyz-TMDB-Embed/1.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(Math.max(3_000, timeoutMs)),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error("TMDB_EMBED_HTTP_" + response.status);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("TMDB_EMBED_INVALID_JSON");
  }
}

export async function resolveTmdbEmbed(
  context: TmdbEmbedContext,
): Promise<TmdbEmbedSource[]> {
  const base = String(process.env.TMDB_EMBED_API_URL || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("TMDB_EMBED_CONFIG_MISSING");

  if (!Number.isFinite(context.tmdbId) || Number(context.tmdbId) <= 0) {
    throw new Error("TMDB_EMBED_TMDB_ID_REQUIRED");
  }

  const tmdbId = String(Math.trunc(Number(context.tmdbId)));
  const provider = String(process.env.TMDB_EMBED_PROVIDER || "vidlink").trim();
  const routeType = context.contentType === "movie" ? "movie" : "series";

  const endpoint = provider
    ? base + "/api/streams/" + encodeURIComponent(provider) + "/" +
      routeType + "/" + encodeURIComponent(tmdbId)
    : base + "/api/streams/" + routeType + "/" + encodeURIComponent(tmdbId);

  const params = new URLSearchParams();
  if (context.contentType === "episode") {
    if (Number.isFinite(context.seasonNumber)) {
      params.set("season", String(Math.trunc(Number(context.seasonNumber))));
    }
    if (Number.isFinite(context.episodeNumber)) {
      params.set("episode", String(Math.trunc(Number(context.episodeNumber))));
    }
  }

  const response = await requestJson(
    endpoint + (params.toString() ? "?" + params.toString() : ""),
  );
  if (response?.success !== true) throw new Error("TMDB_EMBED_UNSUCCESSFUL");

  const streams = Array.isArray(response?.streams) ? response.streams : [];
  const output: TmdbEmbedSource[] = [];

  for (const stream of streams) {
    const url = typeof stream?.url === "string" ? stream.url.trim() : "";
    if (!/^https:\/\//i.test(url)) continue;
    if (output.some((item) => item.url === url)) continue;

    const upstreamProvider = String(stream?.provider || provider || "unknown").trim();
    const headers = stream?.headers && typeof stream.headers === "object"
      ? stream.headers as Record<string, unknown>
      : {};
    const headerReferer = typeof headers.referer === "string"
      ? headers.referer
      : typeof headers.Referer === "string"
        ? headers.Referer
        : "";

    output.push({
      url,
      type: inferType(url),
      quality: normalizeQuality(stream?.quality),
      referer: /^https:\/\//i.test(headerReferer) ? headerReferer : undefined,
      provider: "TMDB-Embed/" + upstreamProvider,
      providerKey: "tmdb-embed:" + providerSlug(upstreamProvider),
    });

    if (output.length >= 8) break;
  }

  if (!output.length) throw new Error("TMDB_EMBED_NO_PLAYABLE_SOURCES");
  return output;
}

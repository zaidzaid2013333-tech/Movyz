import { createServer } from "node:http";
import { resolveAkwamWithContext } from "./workers/akwam-prefill/src/index.ts";
import { resolveVidLink, type VidLinkContext } from "./providers/vidlink.ts";

const port = Number(process.env.PORT || 8787);
const sharedKey = String(process.env.PLAYBACK_RESOLVER_KEY || "").trim();
function positiveEnv(name: string, fallback: number, minimum: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

const maxConcurrent = positiveEnv("PLAYBACK_RESOLVER_MAX_CONCURRENCY", 8, 1);
const maxQueued = positiveEnv("PLAYBACK_RESOLVER_MAX_QUEUE", 32, 1);
const queueWaitMs = positiveEnv("PLAYBACK_RESOLVER_QUEUE_WAIT_MS", 15000, 1000);
const cacheTtlMs = positiveEnv("PLAYBACK_RESOLVER_CACHE_TTL_MS", 45_000, 5_000);
const cacheMaxKeys = positiveEnv("PLAYBACK_RESOLVER_CACHE_MAX_KEYS", 256, 32);

type MediaSource = {
  url: string;
  type: string;
  quality?: string | null;
  referer?: string;
  provider?: string;
  providerKey?: string;
};

type Context = {
  contentType: "movie" | "episode";
  contentId: string;
  titles: string[];
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  tmdbId?: number;
};

let activeResolutions = 0;
let queuedResolutions = 0;
const inflight = new Map<string, Promise<MediaSource[]>>();
const resolutionCache = new Map<string, { expiresAt: number; sources: MediaSource[] }>();

function trimCaches() {
  const now = Date.now();
  for (const [key, value] of resolutionCache) {
    if (value.expiresAt <= now) resolutionCache.delete(key);
  }
  while (resolutionCache.size > cacheMaxKeys) {
    const first = resolutionCache.keys().next().value;
    if (!first) break;
    resolutionCache.delete(first);
  }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function requestKey(context: Context) {
  // Cache by canonical content identity, not by title spelling. UUID/TMDB
  // entry points and Arabic/English variants therefore share one resolution.
  return JSON.stringify([
    context.contentType,
    context.contentId,
    context.seasonNumber ?? null,
    context.episodeNumber ?? null,
    context.tmdbId ?? null,
  ]);
}

function normalizeSources(sources: any[]): MediaSource[] {
  return sources
    .filter((source) => /^https:\/\//i.test(String(source?.url || "")))
    .slice(0, 1)
    .map((source) => ({
      url: String(source.url),
      type: String(source.type || "direct").toLowerCase(),
      quality: source.quality ? String(source.quality) : null,
      referer:
        typeof source.referer === "string" && /^https:\/\//i.test(source.referer)
          ? source.referer
          : source.providerKey === "vidlink"
            ? "https://vidlink.pro/"
            : "https://akwam.ss/",
      provider: String(source.provider || "Akwam"),
      providerKey: String(source.providerKey || "akwam"),
    }));
}

async function resolve(context: Context): Promise<MediaSource[]> {
  trimCaches();
  const key = requestKey(context);

  const cached = resolutionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.sources;

  const running = inflight.get(key);
  if (running) return running;

  if (activeResolutions >= maxConcurrent) {
    if (queuedResolutions >= maxQueued) throw new Error("RESOLVER_BUSY");
    queuedResolutions += 1;
    const deadline = Date.now() + queueWaitMs;
    try {
      while (activeResolutions >= maxConcurrent) {
        if (Date.now() >= deadline) throw new Error("RESOLVER_BUSY");
        await new Promise((resolve) => setTimeout(resolve, 125));
      }
    } finally {
      queuedResolutions -= 1;
    }
  }

  const promise = (async () => {
    activeResolutions += 1;
    try {
      const startedAt = Date.now();
      let akwamError = "";

      try {
        const sources = await resolveAkwamWithContext(
          {
            SUPABASE_URL: "",
            SUPABASE_SERVICE_ROLE_KEY: "",
            AKWAM_BASE_URL: "https://akwam.ss",
            MAX_JOBS_PER_RUN: "1",
            PREFILL_CONCURRENCY: "1",
          },
          {
            content_type: context.contentType,
            content_id: context.contentId,
            season_number: context.seasonNumber,
            episode_number: context.episodeNumber,
          },
          {
            titles: context.titles,
            year: context.year,
            seasonNumber: context.seasonNumber,
            episodeNumber: context.episodeNumber,
          },
        );

        const normalized = normalizeSources(sources);
        if (normalized.length) {
          resolutionCache.set(key, {
            expiresAt: Date.now() + cacheTtlMs,
            sources: normalized,
          });

          console.log(
            JSON.stringify({
              event: "resolution_success",
              provider: normalized[0]?.providerKey || "akwam",
              contentType: context.contentType,
              contentId: context.contentId,
              sourceCount: normalized.length,
              durationMs: Date.now() - startedAt,
              cacheTtlMs,
            }),
          );

          return normalized;
        }

        akwamError = "NO_PLAYABLE_SOURCES";
      } catch (error) {
        akwamError = error instanceof Error ? error.message : String(error);
      }

      const vidlinkContentId = Number.isFinite(context.tmdbId)
        ? String(context.tmdbId)
        : context.contentId;

      const vidlinkContext: VidLinkContext = {
        contentType: context.contentType,
        contentId: vidlinkContentId,
        seasonNumber: context.seasonNumber,
        episodeNumber: context.episodeNumber,
      };

      try {
        const vidlinkSources = await resolveVidLink(vidlinkContext);
        const normalized = normalizeSources(vidlinkSources);
        if (!normalized.length) throw new Error("VIDLINK_NO_PLAYABLE_SOURCES");

        resolutionCache.set(key, {
          expiresAt: Date.now() + cacheTtlMs,
          sources: normalized,
        });

        console.log(
          JSON.stringify({
            event: "resolution_success",
            provider: normalized[0]?.providerKey || "vidlink",
            fallbackFrom: akwamError || "akwam-empty",
            contentType: context.contentType,
            contentId: context.contentId,
            sourceCount: normalized.length,
            durationMs: Date.now() - startedAt,
            cacheTtlMs,
          }),
        );

        return normalized;
      } catch (vidlinkError) {
        const vidlinkMessage =
          vidlinkError instanceof Error ? vidlinkError.message : String(vidlinkError);
        throw new Error(
          `NO_PLAYABLE_SOURCES akwam=${akwamError || "unknown"} vidlink=${vidlinkMessage}`,
        );
      }
    } finally {
      activeResolutions -= 1;
    }
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json(200, {
      ok: true,
      service: "movyz-live-resolver",
      mode: "akwam-primary-vidlink-fallback",
      providers: ["akwam", "vidlink"],
      active: activeResolutions,
      queued: queuedResolutions,
      maxConcurrent,
      maxQueued,
    });
  }

  if (url.pathname !== "/resolve" || request.method !== "POST") {
    return json(404, { ok: false, error: "NOT_FOUND" });
  }

  if (sharedKey && request.headers.get("x-movyz-resolver-key") !== sharedKey) {
    return json(401, { ok: false, error: "UNAUTHORIZED" });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: "INVALID_JSON" });
  }

  const contentType =
    body?.contentType === "movie" || body?.contentType === "episode"
      ? body.contentType
      : null;

  const contentId =
    typeof body?.contentId === "string" ? body.contentId.trim() : "";
  const tmdbId = Number.isFinite(Number(body?.tmdbId))
    ? Number(body.tmdbId)
    : undefined;

  const titles: string[] = Array.isArray(body?.titles)
    ? Array.from(
        new Set<string>(
          body.titles
            .filter((x: unknown): x is string => typeof x === "string")
            .map((x: string) => x.trim())
            .filter((x: string) => x.length > 0),
        ),
      ).slice(0, 12)
    : [];

  if (!contentType || !contentId || !titles.length) {
    return json(400, { ok: false, error: "INVALID_RESOLUTION_CONTEXT" });
  }

  const year = Number.isFinite(Number(body?.year)) ? Number(body.year) : undefined;
  const seasonNumber = Number.isFinite(Number(body?.seasonNumber))
    ? Number(body.seasonNumber)
    : undefined;
  const episodeNumber = Number.isFinite(Number(body?.episodeNumber))
    ? Number(body.episodeNumber)
    : undefined;

  const context: Context = {
    contentType,
    contentId,
    titles,
    year,
    seasonNumber,
    episodeNumber,
    tmdbId,
  };

  try {
    const startedAt = Date.now();
    const key = requestKey(context);
    const cachedBefore = resolutionCache.get(key);
    const hadCached = Boolean(cachedBefore && cachedBefore.expiresAt > Date.now());
    const hadInflight = inflight.has(key);
    const sources = await resolve(context);

    return json(200, {
      ok: true,
      contentType,
      contentId,
      mode: hadCached ? "cache" : hadInflight ? "inflight" : "live",
      provider: sources[0]?.providerKey || null,
      sourceCount: sources.length,
      durationMs: Date.now() - startedAt,
      sources,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "RESOLVER_BUSY" ? 429 : 502;
    return json(status, {
      ok: false,
      contentType,
      contentId,
      error: message,
      ...(status === 429 ? { retryAfterMs: 750 } : {}),
    });
  }
}

createServer(async (req, res) => {
  try {
    const protocol =
      (req.headers["x-forwarded-proto"] as string) || "http";
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", protocol + "://" + host);
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const request = new Request(url, {
      method: req.method || "GET",
      headers: Object.entries(req.headers).flatMap(([key, value]) => {
        if (Array.isArray(value))
          return value.map((v) => [key, v] as [string, string]);
        if (value === undefined) return [];
        return [[key, value] as [string, string]];
      }),
      body:
        ["GET", "HEAD"].includes(req.method || "GET")
          ? undefined
          : Buffer.concat(chunks),
    });

    const response = await handle(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}).listen(port, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      event: "resolver_started",
      port,
      maxConcurrent,
      cacheTtlMs,
      cacheMaxKeys,
      keyProtected: Boolean(sharedKey),
    }),
  );
});

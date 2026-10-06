import { createServer } from "node:http";
import { resolveAkwamWithContext } from "./workers/akwam-prefill/src/index.ts";

const port = Number(process.env.PORT || 8787);
const sharedKey = String(process.env.PLAYBACK_RESOLVER_KEY || "").trim();

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json(200, { ok: true, service: "movyz-live-resolver", mode: "akwam-live" });
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

  const contentType = body?.contentType === "movie" || body?.contentType === "episode"
    ? body.contentType
    : null;
  const contentId = typeof body?.contentId === "string" ? body.contentId.trim() : "";
  const titles = Array.isArray(body?.titles)
    ? Array.from(new Set(body.titles.filter((x: unknown) => typeof x === "string").map((x: string) => x.trim()).filter(Boolean))).slice(0, 12)
    : [];

  if (!contentType || !contentId || !titles.length) {
    return json(400, { ok: false, error: "INVALID_RESOLUTION_CONTEXT" });
  }

  const year = Number.isFinite(Number(body?.year)) ? Number(body.year) : undefined;
  const seasonNumber = Number.isFinite(Number(body?.seasonNumber)) ? Number(body.seasonNumber) : undefined;
  const episodeNumber = Number.isFinite(Number(body?.episodeNumber)) ? Number(body.episodeNumber) : undefined;

  try {
    const sources = await resolveAkwamWithContext(
      {
        SUPABASE_URL: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
        AKWAM_BASE_URL: "https://akwam.ss",
        MAX_JOBS_PER_RUN: "1",
        PREFILL_CONCURRENCY: "1",
      },
      { content_type: contentType, content_id: contentId, season_number: seasonNumber, episode_number: episodeNumber },
      { titles, year, seasonNumber, episodeNumber },
    );

    return json(200, {
      ok: true,
      contentType,
      contentId,
      sources: sources.map((source) => ({
        url: source.url,
        type: source.type,
        quality: source.quality || null,
        referer: source.referer || "https://akwam.ss/",
      })),
    });
  } catch (error) {
    return json(502, {
      ok: false,
      contentType,
      contentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

createServer(async (req, res) => {
  try {
    const protocol = (req.headers["x-forwarded-proto"] as string) || "http";
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `${protocol}://${host}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const request = new Request(url, {
      method: req.method || "GET",
      headers: Object.entries(req.headers).flatMap(([key, value]) => {
        if (Array.isArray(value)) return value.map((v) => [key, v] as [string, string]);
        if (value === undefined) return [];
        return [[key, value] as [string, string]];
      }),
      body: ["GET", "HEAD"].includes(req.method || "GET") ? undefined : Buffer.concat(chunks),
    });

    const response = await handle(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Movyz live resolver listening on port ${port}`);
});

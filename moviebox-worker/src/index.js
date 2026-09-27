/**
 * Movyz AbdoBest API — Cloudflare Worker
 *
 * This Worker exposes the AbdoBest API only.
 */

const ABdobest = "https://ogkushhh-abdobest.hf.space";
const TIMEOUT_MS = 120_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "Content-Type, Content-Length",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

async function upstream(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = new Headers(init.headers || {});
    headers.set("Accept", headers.get("Accept") || "application/json, text/plain, */*");

    return await fetch(ABdobest + path, {
      ...init,
      headers,
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function proxyJson(path, init = {}) {
  const response = await upstream(path, init);
  const text = await response.text();

  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return json({
      error: "AbdoBest returned invalid JSON",
      upstreamStatus: response.status,
      response: text.slice(0, 500),
    }, 502);
  }

  return json(body, response.status);
}

async function handleExtract(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "JSON body required" }, 400);
  }

  const sourceUrl = payload?.url;
  if (!sourceUrl || typeof sourceUrl !== "string" || !/^https?:\\/\\//i.test(sourceUrl)) {
    return json({ error: "A valid source URL is required" }, 400);
  }

  return proxyJson("/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: sourceUrl }),
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const p = url.pathname.replace(/\\/+$/, "") || "/";

    try {
      // Service info
      if (p === "/") {
        return json({
          api: "Movyz AbdoBest API",
          version: "1.0.0",
          provider: "AbdoBest",
          upstream: ABdobest,
          endpoints: {
            health: "/health",
            search: "/api/search?q={query}",
            episodes: "/api/episodes/{category}/{id}",
            extract: "POST /extract",
            metadata: "/api/sorted/{category}",
          },
        });
      }

      if (p === "/health") {
        const response = await upstream("/health", { method: "GET" });
        let body = {};
        try { body = await response.json(); } catch {}
        return json({
          ok: response.ok,
          provider: "AbdoBest",
          upstreamStatus: response.status,
          ...body,
        }, response.ok ? 200 : 502);
      }

      // Video extraction
      if (p === "/extract" && request.method === "POST") {
        return handleExtract(request);
      }

      // Search
      if (p === "/api/search" && request.method === "GET") {
        const q = url.searchParams.get("q");
        if (!q) return json({ error: "q parameter required" }, 400);
        return proxyJson("/api/search?q=" + encodeURIComponent(q));
      }

      // Episodes
      let m = p.match(/^\\/api\\/episodes\\/([^/]+)\\/([^/]+)$/);
      if (m && request.method === "GET") {
        return proxyJson("/api/episodes/" + encodeURIComponent(m[1]) + "/" + encodeURIComponent(m[2]));
      }

      // Arabic-series has a dedicated endpoint in AbdoBest.
      m = p.match(/^\\/api\\/arabic-series\\/episodes\\/([^/]+)$/);
      if (m && request.method === "GET") {
        return proxyJson("/api/arabic-series/episodes/" + encodeURIComponent(m[1]));
      }

      // Metadata categories
      m = p.match(/^\\/api\\/sorted\\/([^/]+)$/);
      if (m && request.method === "GET") {
        const allowed = new Set([
          "movies", "dubbed-movies", "hindi", "asian-movies",
          "anime", "anime-movies", "series", "tvshows",
          "asian-series", "arabic-series",
        ]);
        const category = decodeURIComponent(m[1]);
        if (!allowed.has(category)) return json({ error: "Unknown category" }, 404);
        return proxyJson("/api/sorted/" + encodeURIComponent(category));
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      console.error("AbdoBest Worker request failed", p, message);
      return json({ error: message, provider: "AbdoBest" }, 502);
    }
  },
};

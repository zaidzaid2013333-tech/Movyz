import assert from "node:assert/strict";
import test from "node:test";

const worker = (await import("../../moviebox-worker/src/index.js")).default as {
  fetch(request: Request): Promise<Response>;
};

async function responseFor(path: string) {
  const response = await worker.fetch(new Request("https://worker.test" + path));
  const text = await response.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch {}
  return { response, body, text };
}

test("MovieBox Worker proxies search to the Supabase resolver", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    calls.push(url.toString());

    assert.equal(
      url.origin,
      "https://btrjguegbmusijsyylwl.supabase.co",
    );
    assert.equal(
      url.pathname,
      "/functions/v1/movyz-moviebox/search",
    );
    assert.equal(url.searchParams.get("q"), "Interstellar");

    return new Response(JSON.stringify({
      query: "Interstellar",
      count: 1,
      movies: [{
        name: "Interstellar",
        year: "2014-11-05",
        poster_url: "https://img.example.test/interstellar.jpg",
        url: "https://moviebox.pk/detail/4242",
        slug: "4242",
        badge: null,
        blurhash: null,
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const { response, body } = await responseFor("/search?q=Interstellar");
    assert.equal(response.status, 200);
    assert.equal(body.movies[0].slug, "4242");
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MovieBox Worker proxies detail and stream requests to Supabase", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    calls.push(url.toString());

    if (url.pathname.endsWith("/detail/4242")) {
      return new Response(JSON.stringify({
        slug: "4242",
        metadata: { id: "4242", title: "Interstellar" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.pathname.endsWith("/api/stream/4242")) {
      return new Response(JSON.stringify({
        subject_id: "4242",
        count: 1,
        sources: [{
          id: "resource-1080",
          resolution: "1080p",
          format: "mp4",
          url: "https://cdn.example.test/interstellar-1080.mp4",
        }],
        subtitles: [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.hostname === "cdn.example.test") {
      return new Response(new Uint8Array([0, 1, 2, 3]), {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-3/4",
          "content-length": "4",
        },
      });
    }

    throw new Error("Unexpected request " + url.toString());
  }) as typeof fetch;

  try {
    const detail = await responseFor("/detail/4242");
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.metadata.title, "Interstellar");

    const stream = await responseFor("/api/stream/4242?se=0&ep=0");
    assert.equal(stream.response.status, 200);
    assert.equal(stream.body.sources[0].url, "https://cdn.example.test/interstellar-1080.mp4");

    const watch = await worker.fetch(new Request(
      "https://worker.test/watch/4242?se=0&ep=0",
      { headers: { Range: "bytes=0-3" } },
    ));
    assert.equal(watch.status, 206);
    assert.equal(watch.headers.get("content-type"), "video/mp4");

    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MovieBox Worker returns safe upstream diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("upstream exploded", {
    status: 503,
    headers: { "content-type": "text/plain" },
  })) as typeof fetch;

  try {
    const { response, body } = await responseFor("/search?q=Interstellar");
    assert.equal(response.status, 502);
    assert.match(body.error, /Supabase MovieBox resolver HTTP 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

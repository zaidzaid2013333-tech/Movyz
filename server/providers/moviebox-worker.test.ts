import assert from "node:assert/strict";
import test from "node:test";

const workerModule = await import("../../moviebox-worker/src/index.js");
const worker = workerModule.default as {
  fetch(request: Request): Promise<Response>;
};
const { __resetMobileAuthForTests } = await import("../../moviebox-worker/src/mobile-api.js");

async function responseFor(path: string) {
  const response = await worker.fetch(new Request("https://worker.test" + path));
  const text = await response.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch {}
  return { response, body, text };
}

function mobileMockFetch() {
  const originalFetch = globalThis.fetch;
  let calls: string[] = [];

  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.toString());

    if (url.pathname === "/wefeed-mobile-bff/tab-operating") {
      return new Response(JSON.stringify({ code: 0, data: {} }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-user": JSON.stringify({
            token: "eyJhbGciOiJub25lIn0.eyJleHAiOjQ3MzM1NTIwMDB9.test",
            userId: "test-user",
            userType: 0,
          }),
        },
      });
    }

    if (url.pathname === "/wefeed-mobile-bff/subject-api/search") {
      const headers = new Headers(init?.headers);
      assert.match(headers.get("authorization") || "", /^Bearer /);
      assert.match(headers.get("x-client-token") || "", /^\d{13},[0-9a-f]{32}$/);
      assert.ok(headers.get("x-tr-signature"));
      return new Response(JSON.stringify({
        code: 0,
        data: {
          pager: { page: "1", perPage: 30, totalCount: 1 },
          items: [{
            subjectId: "4242",
            title: "Interstellar",
            releaseDate: "2014-11-05",
            cover: { url: "https://img.example.test/interstellar.jpg" },
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/wefeed-mobile-bff/subject-api/get") {
      assert.equal(url.searchParams.get("subjectId"), "4242");
      return new Response(JSON.stringify({
        code: 0,
        data: {
          subjectId: "4242",
          title: "Interstellar",
          description: "A test detail",
          releaseDate: "2014-11-05",
          duration: 10140,
          genre: "Adventure, Drama",
          countryName: "United States",
          imdbRatingValue: "8.7",
          cover: { url: "https://img.example.test/interstellar.jpg" },
          hasResource: true,
          staffList: [{ name: "Matthew McConaughey", role: "Actor" }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/wefeed-mobile-bff/subject-api/season-info") {
      return new Response(JSON.stringify({
        code: 0,
        data: { seasons: [{ se: 1, maxEp: 2, resolutions: [{ resolution: 1080, epNum: 2 }] }] },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/wefeed-mobile-bff/subject-api/resource") {
      const resolution = Number(url.searchParams.get("resolution"));
      return new Response(JSON.stringify({
        code: 0,
        data: {
          pager: { hasMore: false, totalCount: 1 },
          list: [{
            resourceId: "resource-" + resolution,
            resourceLink: "https://cdn.example.test/interstellar-" + resolution + ".mp4",
            resolution,
            size: "1048576",
            title: "Interstellar",
            se: Number(url.searchParams.get("se") || "0"),
            ep: Number(url.searchParams.get("ep") || "0"),
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    throw new Error("Unexpected MovieBox request: " + url.toString());
  }) as typeof fetch;

  return { originalFetch, calls };
}

test("MovieBox worker authenticates with the mobile API and normalizes search", async () => {
  __resetMobileAuthForTests();
  const { originalFetch, calls } = mobileMockFetch();

  try {
    const { response, body } = await responseFor("/search?q=Interstellar");
    assert.equal(response.status, 200);
    assert.deepEqual(body.movies, [{
      name: "Interstellar",
      year: "2014-11-05",
      poster_url: "https://img.example.test/interstellar.jpg",
      url: "https://moviebox.pk/detail/4242",
      slug: "4242",
      badge: null,
      blurhash: null,
    }]);
    assert.equal(calls.length, 2);
    assert.match(calls[0]!, /tab-operating\?page=1&tabId=0&version=/);
    assert.match(calls[1]!, /subject-api\/search$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MovieBox worker resolves mobile detail data without H5 scraping", async () => {
  __resetMobileAuthForTests();
  const { originalFetch } = mobileMockFetch();

  try {
    const { response, body } = await responseFor("/detail/4242");
    assert.equal(response.status, 200);
    assert.equal(body.slug, "4242");
    assert.equal(body.metadata.id, "4242");
    assert.equal(body.metadata.title, "Interstellar");
    assert.equal(body.metadata.imdb_rating, "8.7");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MovieBox worker returns direct MP4 sources from mobile resources", async () => {
  __resetMobileAuthForTests();
  const { originalFetch, calls } = mobileMockFetch();

  try {
    const { response, body } = await responseFor("/api/stream/4242?detail_path=4242&se=0&ep=0");
    assert.equal(response.status, 200);
    assert.equal(body.subject_id, "4242");
    assert.equal(body.count, 4);
    assert.equal(body.sources[0].format, "mp4");
    assert.equal(body.sources[0].url, "https://cdn.example.test/interstellar-1080.mp4");
    assert.equal(calls.filter((url) => url.includes("/subject-api/resource?")).length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MovieBox worker exposes upstream bootstrap failures as safe diagnostics", async () => {
  __resetMobileAuthForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ code: 429, reason: "RESOURCE_EXHAUSTED" }),
    { status: 429, headers: { "content-type": "application/json" } },
  )) as typeof fetch;

  try {
    const { response, body } = await responseFor("/search?q=Interstellar");
    assert.equal(response.status, 502);
    assert.equal(body.stage, "request");
    assert.match(body.error, /MovieBox mobile auth bootstrap failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

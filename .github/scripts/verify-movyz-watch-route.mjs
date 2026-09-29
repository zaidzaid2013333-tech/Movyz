const API_BASE = (process.env.MOVYZ_API_BASE ||
  "https://movyz-api.sameranede.workers.dev/api/v1").replace(/\/+$/, "");

const fixtures = [
  {
    label: "Movyz API movie",
    url: API_BASE + "/watch/movie/27205",
    kind: "movie",
  },
  {
    label: "Movyz API series episode",
    url: API_BASE + "/watch/series/5920?season=1&episode=1",
    kind: "episode",
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertPlayableUrl(value, label) {
  assert(
    typeof value === "string" && /^https:\/\//i.test(value),
    label + " is not a valid HTTPS media URL: " + value,
  );
}

async function fetchJson(url, label, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();

  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(label + " returned non-JSON HTTP " + response.status + ": " + text.slice(0, 800));
  }

  if (!response.ok) {
    throw new Error(label + " HTTP " + response.status + ": " + text.slice(0, 1600));
  }

  return body;
}

const WATCH_API_BASE = (process.env.WATCH_API_BASE ||
  "https://movyz-moviebox.sameranede.workers.dev").replace(/\/+$/, "");

const directEpisodeProbe = await fetchJson(WATCH_API_BASE + "/watch/episode", "Direct Watch API episode probe", {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify({
    mode: "direct",
    tmdb_id: 5920,
    title: "The Mentalist",
    title_en: "The Mentalist",
    original_title: "The Mentalist",
    year: 2008,
    season: 1,
    episode: 1,
    type: "series",
  }),
});
assert(directEpisodeProbe?.ok === true, "Direct Watch API episode probe failed: " + JSON.stringify(directEpisodeProbe));

for (const fixture of fixtures) {
  const body = await fetchJson(fixture.url, fixture.label);
  assert(body?.success === true, fixture.label + " success !== true");
  assert(Array.isArray(body?.data), fixture.label + " data is not an array");
  assert(body.data.length > 0, fixture.label + " returned no playback sources");

  const source = fixture.kind === "episode"
    ? body.data.find((item) =>
        String(item?.providerKey || "").toLowerCase() === "akwam-iframe" &&
        String(item?.type || "").toLowerCase() === "web" &&
        typeof item?.iframeUrl === "string" &&
        item.iframeUrl.trim()
      )
    : body.data.find((item) =>
        typeof item?.url === "string" &&
        item.url.trim() &&
        String(item?.providerKey || "").toLowerCase() === "akwam-direct"
      );

  assert(source, fixture.kind === "episode"
    ? fixture.label + " returned no Akwam player source"
    : fixture.label + " returned no direct Akwam source");

  if (fixture.kind === "episode") {
    assert(
      /\/watch\/\d+(?:[/?#]|$)/i.test(new URL(source.iframeUrl).pathname),
      fixture.label + " iframeUrl is not an Akwam watch-player route: " + source.iframeUrl,
    );
    console.log(fixture.label + " PASS", JSON.stringify({
      providerKey: source.providerKey,
      type: source.type,
      iframeUrl: source.iframeUrl,
      playerOnly: true,
    }));
  } else {
    assert(
      ["hls", "mp4", "webm"].includes(String(source.type).toLowerCase()),
      fixture.label + " returned unsupported direct media type: " + source.type,
    );
    assertPlayableUrl(source.url, fixture.label + " source.url");
    assert(!source.iframeUrl, fixture.label + " unexpectedly returned an iframeUrl");

    console.log(fixture.label + " PASS", JSON.stringify({
      providerKey: source.providerKey,
      type: source.type,
      quality: source.quality,
      urlHost: new URL(source.url).hostname,
      directMedia: true,
    }));
  }
}

console.log("MOVYZ_WATCH_ROUTE_E2E=PASS");

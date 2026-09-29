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

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
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

for (const fixture of fixtures) {
  const body = await fetchJson(fixture.url, fixture.label);
  assert(body?.success === true, fixture.label + " success !== true");
  assert(Array.isArray(body?.data), fixture.label + " data is not an array");
  assert(body.data.length > 0, fixture.label + " returned no playback sources");

  const source = body.data.find((item) =>
    String(item?.providerKey || "").toLowerCase() === "akwam-iframe" &&
    String(item?.type || "").toLowerCase() === "web" &&
    typeof item?.iframeUrl === "string" &&
    item.iframeUrl.trim()
  );

  assert(source, fixture.label + " returned no Akwam iframe source");

  assert(
    /\/watch\/\d+(?:[/?#]|$)/i.test(new URL(source.iframeUrl).pathname) &&
    new URL(source.iframeUrl).hash === "#player",
    fixture.label + " iframeUrl is not an Akwam native watch-player route: " + source.iframeUrl,
  );
  assert(source.providerKey === "akwam-iframe", fixture.label + " is not Akwam iframe");
  assert(source.type === "web", fixture.label + " is not web/iframe type");
  assertPlayableUrl(source.iframeUrl, fixture.label + " iframeUrl");

  console.log(fixture.label + " PASS", JSON.stringify({
    providerKey: source.providerKey,
    type: source.type,
    iframeUrl: source.iframeUrl,
    playerOnly: true,
    sourceCount: body.data.length,
  }));
}

console.log("MOVYZ_WATCH_ROUTE_E2E=PASS");

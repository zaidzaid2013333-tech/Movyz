const API_BASE = (process.env.MOVYZ_API_BASE ||
  "https://movyz-api.sameranede.workers.dev/api/v1").replace(/\\/+$/, "");

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

function assertAkwamPage(value, label) {
  assert(typeof value === "string" && /^https:\/\//i.test(value), label + " is not a valid HTTPS URL: " + value);
  const host = new URL(value).hostname.toLowerCase();
  const allowed = [
    "ak.sv",
    "akwam.it",
    "go.akwam.it",
    "akwam.ss",
    "akwam.ee",
    "akwam.com.co",
    "go.akwam.com.co",
    "akwam.net",
    "downet.net",
  ];
  assert(
    allowed.some((base) => host === base || host.endsWith("." + base)),
    label + " returned unexpected host: " + host,
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
    typeof item?.iframeUrl === "string" && item.iframeUrl.trim()
  );

  assert(source, fixture.label + " returned no iframeUrl source");
  assert(String(source.type).toLowerCase() === "web", fixture.label + " source.type is not web");
  assert(String(source.providerKey).toLowerCase() === "akwam-iframe", fixture.label + " providerKey is not akwam-iframe");
  assertAkwamPage(source.iframeUrl, fixture.label + " iframeUrl");

  if (fixture.kind === "episode") {
    assert(/\/episode\//i.test(new URL(source.iframeUrl).pathname), fixture.label + " is not an Akwam episode page");
  }

  console.log(fixture.label + " PASS", JSON.stringify({
    providerKey: source.providerKey,
    type: source.type,
    iframeUrl: source.iframeUrl,
  }));
}

console.log("MOVYZ_WATCH_ROUTE_E2E=PASS");

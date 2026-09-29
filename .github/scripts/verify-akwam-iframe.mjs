// Production verification: exactly one Movyz Akwam player iframe target.
const RESOLVER_BASE = (process.env.AKWAM_RESOLVER_BASE ||
  "https://movyz-akwam-resolver.sameranede.workers.dev").replace(/\/+$/, "");

const fixtures = [
  {
    label: "Akwam resolver movie",
    title: "Inception",
    title_en: "Inception",
    original_title: "Inception",
    year: 2010,
    tmdb_id: 27205,
    type: "movie",
  },
  {
    label: "Akwam resolver episode",
    title: "The Mentalist",
    title_en: "The Mentalist",
    original_title: "The Mentalist",
    year: 2008,
    tmdb_id: 5920,
    season: 1,
    episode: 1,
    type: "series",
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function jsonFetch(url, init, label) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(label + " returned non-JSON HTTP " + response.status + ": " + text.slice(0, 1000));
  }
  if (!response.ok) throw new Error(label + " HTTP " + response.status + ": " + text.slice(0, 1800));
  return body;
}

for (const fixture of fixtures) {
  const body = await jsonFetch(
    RESOLVER_BASE + "/resolve-iframe",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fixture),
    },
    fixture.label,
  );

  assert(body?.ok === true, fixture.label + " did not return ok=true");
  assert(body?.mode === "movyz-player-shell", fixture.label + " did not return player-shell mode");

  const iframeUrl = String(body?.iframe_url || "");
  const playerUrl = String(body?.player_url || "");
  assert(iframeUrl === playerUrl, fixture.label + " returned different iframe/player URLs");
  assert(/^https:\/\//i.test(iframeUrl), fixture.label + " iframe URL is not HTTPS");

  const url = new URL(iframeUrl);
  assert(
    url.hostname.toLowerCase() === "movyz-akwam-resolver.sameranede.workers.dev" &&
    url.pathname === "/player",
    fixture.label + " iframe is not the single Movyz player shell: " + iframeUrl,
  );

  const htmlResponse = await fetch(iframeUrl, {
    headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
    signal: AbortSignal.timeout(30_000),
  });
  const html = await htmlResponse.text();

  assert(htmlResponse.ok, fixture.label + " player shell HTTP " + htmlResponse.status);
  assert(/<video\b[^>]*\bid=["']player["']/i.test(html), fixture.label + " player shell has no video element");
  assert(/<title>Movyz Akwam Player<\/title>/i.test(html), fixture.label + " player shell title missing");
  assert(!/<nav\b/i.test(html), fixture.label + " player shell contains site navigation");

  console.log(fixture.label + " PASS", JSON.stringify({
    mode: body.mode,
    iframeUrl,
    qualityCount: Array.isArray(body.qualities) ? body.qualities.length : 0,
    sourceCount: Array.isArray(body.sources) ? body.sources.length : 0,
  }));
}

console.log("AKWAM_IFRAME_E2E=PASS");

// Final deployment verification: Movyz returns one native Akwam player/embed URL.
const RESOLVER_BASE = (process.env.AKWAM_RESOLVER_BASE ||
  "https://movyz-akwam-resolver.sameranede.workers.dev").replace(/\/+$/, "");

const fixtures = [
  {
    label: "Akwam resolver movie",
    mode: "iframe",
    title: "Inception",
    title_en: "Inception",
    original_title: "Inception",
    year: 2010,
    tmdb_id: 27205,
    type: "movie",
  },
  {
    label: "Akwam resolver episode",
    mode: "iframe",
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

const ALLOWED_AKWAM_HOSTS = [
  "akwam.ss",
  "akwam.it",
  "go.akwam.it",
  "ak.sv",
  "go.ak.sv",
  "akwam.ee",
  "akwam.com.co",
  "go.akwam.com.co",
  "akwam.net",
  "downet.net",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isDedicatedAkwamIframe(value, label) {
  assert(typeof value === "string" && /^https:\/\//i.test(value), label + " is not HTTPS: " + value);

  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  assert(
    ALLOWED_AKWAM_HOSTS.some((base) => host === base || host.endsWith("." + base)),
    label + " is not an Akwam host: " + host,
  );
  assert(
    !/\/(?:movie|movies|series|episode|episodes|download|link|search|login|register)(?:\/|[?#]|$)/i.test(url.pathname),
    label + " returned an Akwam content page: " + value,
  );
  assert(
    /\/(?:player|embed)(?:\/|[?#]|$)/i.test(url.pathname),
    label + " is not a dedicated Akwam player/embed URL: " + value,
  );
  assert(
    !host.includes("movyz-akwam-resolver"),
    label + " unexpectedly returned the Movyz player shell: " + value,
  );
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
    throw new Error(label + " returned non-JSON HTTP " + response.status + ": " + text.slice(0, 800));
  }
  if (!response.ok) {
    throw new Error(label + " HTTP " + response.status + ": " + text.slice(0, 1600));
  }
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
  assert(body?.mode === "akwam-native-iframe", fixture.label + " did not return native iframe mode");
  const iframe = body?.iframe_url || body?.player_url || "";
  isDedicatedAkwamIframe(iframe, fixture.label + " iframe_url");

  assert(
    body?.iframe_url === body?.player_url,
    fixture.label + " returned two different player targets",
  );

  console.log(fixture.label + " NATIVE_IFRAME_OK", JSON.stringify({
    iframeUrl: iframe,
    cached: body?.cached === true,
  }));
}

console.log("AKWAM_IFRAME_E2E=PASS");

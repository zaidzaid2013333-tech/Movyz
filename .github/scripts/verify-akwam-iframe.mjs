const RESOLVER_BASE = (process.env.AKWAM_RESOLVER_BASE ||
  "https://movyz-akwam-resolver.sameranede.workers.dev").replace(/\/+$/, "");
const movieFixture = {
  mode: "iframe",
  title: "Inception",
  title_en: "Inception",
  original_title: "Inception",
  year: 2010,
  tmdb_id: 27205,
  type: "movie",
};

const episodeFixture = {
  mode: "iframe",
  title: "The Mentalist",
  title_en: "The Mentalist",
  original_title: "The Mentalist",
  year: 2008,
  tmdb_id: 5920,
  season: 1,
  episode: 1,
  type: "series",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isHttp(value) {
  return typeof value === "string" && /^https:\/\//i.test(value);
}

function assertAkwamPage(value, label) {
  assert(isHttp(value), label + " is not HTTPS: " + value);
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
  const pathname = new URL(value).pathname;
  assert(
    !/\/(?:movie|movies|series|episode|episodes|download|link|search|login|register)(?:\/|[?#]|$)/i.test(pathname),
    label + " returned an Akwam content page instead of a player: " + value,
  );
  const isWatch = /\/watch\/\d+(?:[/?#]|$)/i.test(pathname);
  const isDedicated = /\/(?:player|embed)(?:\/|[?#]|$)/i.test(pathname);
  assert(
    isWatch || isDedicated,
    label + " did not return a valid Akwam player route: " + value,
  );
}

async function jsonFetch(url, init, label) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();

  let body;
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

async function inspectReturnedPlayer(url, label) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Movyz-Akwam-Smoke/1.0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const html = await response.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "";
    const iframes = [...html.matchAll(/<iframe\b[^>]*(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi)]
      .map((m) => m[1]).slice(0, 8);
    const videos = (html.match(/<video\b/gi) || []).length;
    const sources = (html.match(/<source\b/gi) || []).length;
    const hasNativePlayer = /<video\b[^>]*\bid=["']player["']/i.test(html);
    const videoIndex = html.search(/<video\b/i);
    const videoContext = videoIndex >= 0
      ? html.slice(Math.max(0, videoIndex - 2600), Math.min(html.length, videoIndex + 6200))
      : "";
    if (/\/watch\/\d+(?:[/?#]|$)/i.test(new URL(url).pathname)) {
      assert(hasNativePlayer, label + " watch route does not expose <video id="player">");
      assert(new URL(url).hash === "#player", label + " watch route is missing #player fragment: " + url);
    }

    console.log(label + " TARGET_INSPECT", JSON.stringify({
      httpStatus: response.status,
      finalUrl: response.url,
      title: title.slice(0, 180),
      iframeCount: iframes.length,
      iframes,
      videoTags: videos,
      sourceTags: sources,
      hasNativePlayer,
      videoContext,
    }));
  } catch (error) {
    console.log(label + " TARGET_INSPECT_FAILED", String(error?.message || error));
  }
}

async function resolverIframe(fixture, label) {
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
    label,
  );

  assert(body?.ok === true, label + " did not return ok=true");
  const iframe = body?.iframe_url || body?.source_url || body?.media_url || "";
  assertAkwamPage(iframe, label + " iframe_url");
  await inspectReturnedPlayer(iframe, label);
  return { body, iframe };
}

function watchIframe(body, fixture, label) {
  assert(body?.ok === true, label + " did not return ok=true");
  assert(body?.type === (fixture.type === "series" ? "episode" : "movie"), label + " returned wrong content type");
  assert(body?.media_type === "web", label + " media_type is not web");
  assert(body?.stream?.type === "web", label + " stream.type is not web");

  const iframe = body?.stream?.iframe_url || body?.iframe_url || body?.source_url || body?.media_url || "";
  assertAkwamPage(iframe, label + " iframe_url");

  if (fixture.type === "series") {
    assert(Number(body?.season) === Number(fixture.season), label + " season mismatch");
    assert(Number(body?.episode) === Number(fixture.episode), label + " episode mismatch");
    const pathname = new URL(iframe).pathname;
    assert(
      /\/(?:watch|player|embed)\//i.test(pathname),
      label + " did not return an Akwam episode/player route: " + iframe,
    );
  }

  return iframe;
}


const resolverMovie = await resolverIframe(movieFixture, "Akwam resolver movie");
const resolverEpisode = await resolverIframe(episodeFixture, "Akwam resolver episode");
console.log("AKWAM_IFRAME_SMOKE_RESULT", JSON.stringify({
  movie: resolverMovie.iframe,
  episode: resolverEpisode.iframe,
}));
console.log("AKWAM_IFRAME_E2E=PASS");

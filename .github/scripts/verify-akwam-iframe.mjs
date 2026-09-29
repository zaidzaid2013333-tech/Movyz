const RESOLVER_BASE = (process.env.AKWAM_RESOLVER_BASE ||
  "https://movyz-akwam-resolver.sameranede.workers.dev").replace(/\/+$/, "");
const WATCH_BASE = (process.env.WATCH_API_BASE ||
  "https://movyz-moviebox.sameranede.workers.dev").replace(/\/+$/, "");

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
      /\/(?:watch|episode)\//i.test(pathname),
      label + " did not return an Akwam episode/player route: " + iframe,
    );
  }

  return iframe;
}

console.log("AKWAM_IFRAME_SMOKE_START", JSON.stringify({
  resolver: RESOLVER_BASE,
  watch: WATCH_BASE,
}));

const resolverMovie = await resolverIframe(movieFixture, "Akwam resolver movie");
const resolverEpisode = await resolverIframe(episodeFixture, "Akwam resolver episode");

assertAkwamPage(resolverMovie.iframe, "Resolver movie");
assertAkwamPage(resolverEpisode.iframe, "Resolver episode");
assert(/\/episode\//i.test(new URL(resolverEpisode.iframe).pathname), "Resolver episode is not an /episode/ page: " + resolverEpisode.iframe);

const watchedMovie = await jsonFetch(
  WATCH_BASE + "/watch/movie",
  {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(movieFixture),
  },
  "Watch API movie iframe",
);
const watchedEpisode = await jsonFetch(
  WATCH_BASE + "/watch/episode",
  {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(episodeFixture),
  },
  "Watch API episode iframe",
);

const watchMovieIframe = watchIframe(watchedMovie, movieFixture, "Watch API movie");
const watchEpisodeIframe = watchIframe(watchedEpisode, episodeFixture, "Watch API episode");

console.log("AKWAM_IFRAME_SMOKE_RESULT", JSON.stringify({
  movie: {
    resolver: resolverMovie.iframe,
    watch: watchMovieIframe,
  },
  episode: {
    resolver: resolverEpisode.iframe,
    watch: watchEpisodeIframe,
    season: watchedEpisode.season,
    episode: watchedEpisode.episode,
  },
}));

console.log("AKWAM_IFRAME_E2E=PASS");

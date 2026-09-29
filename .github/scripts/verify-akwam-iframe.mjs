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

  const token = url.searchParams.get("t") || "";
  assert(token, fixture.label + " player token missing");

  const sources = Array.isArray(body.sources) ? body.sources : [];
  assert(sources.length > 0, fixture.label + " returned no media sources");

  const sourceChecks = [];
  for (const source of sources.slice(0, 3)) {
    const rawSource = String(source?.url || "").trim();
    assert(/^https:\/\//i.test(rawSource), fixture.label + " source is not HTTPS: " + rawSource);

    const mediaUrl =
      RESOLVER_BASE +
      "/media?t=" + encodeURIComponent(token) +
      "&u=" + encodeURIComponent(rawSource);

    const mediaResponse = await fetch(mediaUrl, {
      headers: {
        Accept: "video/*,application/vnd.apple.mpegurl,application/dash+xml,*/*;q=0.8",
        Range: "bytes=0-65535",
      },
      signal: AbortSignal.timeout(60_000),
    });

    const contentType = String(mediaResponse.headers.get("content-type") || "").toLowerCase();
    const contentRange = mediaResponse.headers.get("content-range") || "";
    const mediaText = /mpegurl|vnd\.apple\.mpegurl/.test(contentType)
      ? (await mediaResponse.text()).slice(0, 12000)
      : "";

    assert(
      mediaResponse.ok,
      fixture.label + " media proxy HTTP " + mediaResponse.status + " for " + rawSource,
    );
    assert(
      !/application\/json|text\/html/i.test(contentType),
      fixture.label + " media proxy returned non-media content type " + contentType,
    );

    if (/mpegurl|vnd\.apple\.mpegurl/.test(contentType)) {
      assert(
        /#EXTM3U/i.test(mediaText),
        fixture.label + " media proxy returned an invalid HLS playlist",
      );
    } else {
      assert(
        /^video\//i.test(contentType) || /octet-stream/i.test(contentType),
        fixture.label + " media proxy returned unexpected content type " + contentType,
      );
    }

    sourceChecks.push({
      quality: source?.quality || "auto",
      type: source?.type || "",
      status: mediaResponse.status,
      contentType,
      contentRange,
    });
  }

  // Verify that the resolver bounds a large initial MP4 Range to roughly
  // twenty seconds of the selected quality instead of forwarding a huge request.
  const startupSourceIndexes = [0, Math.max(0, sources.length - 1)]
    .filter((value, index, list) => list.indexOf(value) === index);

  for (const index of startupSourceIndexes) {
    const source = sources[index];
    const rawSource = String(source?.url || "").trim();
    if (!rawSource) continue;

    const quality = String(source?.quality || "720p").toLowerCase();
    const bitrateByQuality = {
      "2160p": 20_000_000,
      "1440p": 12_000_000,
      "1080p": 7_000_000,
      "900p": 5_000_000,
      "720p": 4_000_000,
      "576p": 2_500_000,
      "540p": 2_000_000,
      "480p": 1_500_000,
      "360p": 800_000,
      "240p": 500_000,
    };
    const bitrate = bitrateByQuality[quality] || bitrateByQuality["720p"];
    const maxStartupBytes = Math.ceil((bitrate * 20) / 8);
    const mediaUrl =
      RESOLVER_BASE +
      "/media?t=" + encodeURIComponent(token) +
      "&u=" + encodeURIComponent(rawSource);

    const startupResponse = await fetch(mediaUrl, {
      headers: {
        Accept: "video/*,application/vnd.apple.mpegurl,application/dash+xml,*/*;q=0.8",
        Range: "bytes=0-52428799",
      },
      signal: AbortSignal.timeout(60_000),
    });

    const startupRange = startupResponse.headers.get("content-range") || "";
    const startupMatch = startupRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
    assert(startupResponse.status === 206,
      fixture.label + " startup range did not return 206 for " + quality + ": " + startupResponse.status);
    assert(startupMatch,
      fixture.label + " startup range missing Content-Range for " + quality + ": " + startupRange);

    const deliveredBytes = Number(startupMatch[2]) - Number(startupMatch[1]) + 1;
    assert(
      deliveredBytes <= maxStartupBytes,
      fixture.label + " startup range exceeded 20s cap for " + quality +
        ": " + deliveredBytes + " > " + maxStartupBytes,
    );

    startupResponse.body?.cancel();
    console.log(fixture.label + " STARTUP_RANGE PASS", JSON.stringify({
      quality,
      deliveredBytes,
      maxStartupBytes,
      contentRange: startupRange,
    }));
  }

  console.log(fixture.label + " PASS", JSON.stringify({
    mode: body.mode,
    iframeUrl,
    qualityCount: Array.isArray(body.qualities) ? body.qualities.length : 0,
    sourceCount: sources.length,
    mediaChecks: sourceChecks,
  }));
}

console.log("AKWAM_IFRAME_E2E=PASS");

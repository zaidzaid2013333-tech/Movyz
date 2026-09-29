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
  const mp4StartupChecks = [];

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
        /^video\//i.test(contentType),
        fixture.label + " MP4 media proxy returned unexpected content type " + contentType,
      );
    }

    sourceChecks.push({
      quality: source?.quality || "auto",
      type: source?.type || "",
      status: mediaResponse.status,
      contentType,
      contentRange,
    });
    try { mediaResponse.body?.cancel(); } catch {}

    if (String(source?.type || "").toLowerCase() === "mp4" && mp4StartupChecks.length === 0) {
      const startupResponse = await fetch(mediaUrl, {
        headers: {
          Accept: "video/mp4,video/*,application/octet-stream,*/*;q=0.8",
          Range: "bytes=0-524287",
        },
        signal: AbortSignal.timeout(60_000),
      });

      const startupType = String(startupResponse.headers.get("content-type") || "").toLowerCase();
      const startupRange = startupResponse.headers.get("content-range") || "";
      const rangeMatch = startupRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);

      assert(startupResponse.status === 206,
        fixture.label + " startup MP4 did not return 206: " + startupResponse.status);
      assert(/^video\/mp4$/i.test(startupType),
        fixture.label + " startup MP4 content-type is " + startupType);
      assert(Boolean(rangeMatch),
        fixture.label + " startup MP4 missing Content-Range");

      const startByte = Number(rangeMatch[1]);
      const endByte = Number(rangeMatch[2]);
      const deliveredBytes = endByte - startByte + 1;
      assert(startByte === 0,
        fixture.label + " startup MP4 did not start at byte 0: " + startupRange);
      assert(deliveredBytes <= 256 * 1024,
        fixture.label + " startup MP4 exceeded 256KiB: " + deliveredBytes);

      mp4StartupChecks.push({
        quality: source?.quality || "auto",
        status: startupResponse.status,
        contentType: startupType,
        contentRange: startupRange,
        deliveredBytes,
        resolverVersion: startupResponse.headers.get("x-movyz-resolver-version") || "",
      });

      try { startupResponse.body?.cancel(); } catch {}
    }
  }

  console.log(fixture.label + " PASS", JSON.stringify({
    mode: body.mode,
    iframeUrl,
    qualityCount: Array.isArray(body.qualities) ? body.qualities.length : 0,
    sourceCount: sources.length,
    mediaChecks: sourceChecks,
    startupMp4Checks: mp4StartupChecks,
  }));
}

console.log("AKWAM_IFRAME_E2E=PASS");

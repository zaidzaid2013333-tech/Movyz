import { spawnSync } from "node:child_process";
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
    try { mediaResponse.body?.cancel(); } catch {}
  }

  // Startup latency benchmark: compare a small byte-0 range, the current
  // startup cap, a non-zero seek-like range, and the tail where MP4 metadata
  // may live. We log timings instead of guessing from HTTP status alone.
  const mp4Sources = sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => String(source?.type || "").toLowerCase() === "mp4");

  for (const { source, index } of mp4Sources.slice(0, 1)) {
    const rawSource = String(source?.url || "").trim();
    if (!rawSource) continue;

    const mediaUrl =
      RESOLVER_BASE +
      "/media?t=" + encodeURIComponent(token) +
      "&u=" + encodeURIComponent(rawSource);

    const runRangeProbe = async (label, rangeHeader, readBytes = 65_536) => {
      const started = performance.now();
      const response = await fetch(mediaUrl, {
        headers: {
          Accept: "video/*,application/octet-stream,*/*;q=0.8",
          Range: rangeHeader,
        },
        signal: AbortSignal.timeout(20_000),
      });
      const headersAt = performance.now();
      const reader = response.body?.getReader();
      let firstByteMs = null;
      let bytes = 0;
      let bodyError = "";
      if (reader) {
        try {
          const first = await reader.read();
          firstByteMs = Math.round(performance.now() - started);
          if (!first.done && first.value) {
            bytes += first.value.byteLength;
            if (bytes > readBytes) {
              try { await reader.cancel(); } catch {}
            }
          }
        } catch (error) {
          bodyError = error instanceof Error ? error.message : String(error);
        } finally {
          try { await reader.cancel(); } catch {}
        }
      }
      return {
        label,
        requestedRange: rangeHeader,
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        contentRange: response.headers.get("content-range") || "",
        resolverVersion: response.headers.get("x-movyz-resolver-version") || "",
        sourceType: response.headers.get("x-movyz-source-type") || "",
        headersMs: Math.round(headersAt - started),
        firstByteMs,
        firstChunkBytes: bytes,
        bodyError,
      };
    };

    const small = await runRangeProbe("byte-0-256KiB", "bytes=0-262143");

    const current = await runRangeProbe(
      "byte-0-4MiB",
      "bytes=0-4194303",
    );

    const parsedCurrent = current.contentRange.match(/\/([0-9]+)$/);
    const total = parsedCurrent ? Number(parsedCurrent[1]) : 0;
    const seekOffset = total > 0
      ? Math.min(
        Math.max(50 * 1024 * 1024, Math.floor(total * 0.35)),
        Math.max(0, total - 262144),
      )
      : 50 * 1024 * 1024;

    const seek = await runRangeProbe(
      "seek-like-nonzero",
      `bytes=${seekOffset}-${seekOffset + 65535}`,
    );

    let tail = null;
    if (total > 65_536) {
      tail = await runRangeProbe(
        "file-tail-64KiB",
        `bytes=${Math.max(0, total - 65_536)}-${total - 1}`,
        65_536,
      );
    }

    console.log(fixture.label + " STARTUP_BENCHMARK", JSON.stringify({
      quality: source?.quality || "auto",
      total,
      small,
      current,
      seek,
      tail,
    }));

    if (fixture.label === "Akwam resolver movie" && index === 0) {
      const ffprobeStarted = Date.now();
      const ffprobe = spawnSync(
        "ffprobe",
        [
          "-v", "error",
          "-rw_timeout", "15000000",
          "-show_entries", "format=duration,format_name:stream=index,codec_name,codec_type,width,height",
          "-of", "json",
          mediaUrl,
        ],
        {
          encoding: "utf8",
          timeout: 20_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      console.log("Akwam resolver movie FFPROBE", JSON.stringify({
        exitCode: ffprobe.status,
        signal: ffprobe.signal || null,
        elapsedMs: Date.now() - ffprobeStarted,
        error: ffprobe.error ? String(ffprobe.error.message || ffprobe.error) : "",
        stdout: String(ffprobe.stdout || "").slice(0, 12000),
        stderr: String(ffprobe.stderr || "").slice(0, 4000),
      }));
    }
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

// Akwam prep: staged discovery + exact episode-to-watch resolution.
type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  AKWAM_BASE_URL: string;
  MAX_JOBS_PER_RUN: string;
};

type Job = {
  id: string;
  content_type: "movie" | "episode";
  content_id: string;
  tmdb_id: number | null;
  season_number: number | null;
  episode_number: number | null;
  attempts: number;
};

type Candidate = {
  url: string;
  title: string;
  year?: number;
  kind: "movie" | "series" | "episode" | "watch" | "other";
};
type Media = {
  url: string;
  type: "hls" | "mp4" | "dash" | "webm" | "direct";
  quality?: string;
  referer?: string;
};

const AKWAM_HOSTS = new Set(["akwam.ss", "www.akwam.ss"]);

function isAkwamUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && AKWAM_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function base(env: Env) {
  return "https://akwam.ss";
}

function headers(env: Env) {
  const b = base(env);
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en;q=0.9",
    Referer: b,
  };
}

async function sb(env: Env, path: string, init: RequestInit = {}) {
  const response = await fetch(env.SUPABASE_URL.replace(/\/+$/, "") + path, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 700)}`);
  return text ? JSON.parse(text) : null;
}

async function claim(env: Env, workerId: string): Promise<Job | null> {
  const rows = await sb(env, "/rest/v1/rpc/claim_akwam_prefill_job", {
    method: "POST",
    body: JSON.stringify({ p_worker_id: workerId, p_lease_seconds: 300 }),
  });
  return Array.isArray(rows) && rows[0] ? (rows[0] as Job) : null;
}

async function fetchText(env: Env, url: string, diagnostics?: string[]): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: headers(env),
      redirect: "follow",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) {
      diagnostics?.push(new URL(url).hostname + ":" + response.status);
      return null;
    }
    return await response.text();
  } catch (error) {
    diagnostics?.push(new URL(url).hostname + ":ERR");
    return null;
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u003f/gi, "?")
    .replace(/\\//g, "/");
}

function normalize(value: string) {
  return decodeHtml(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function overlap(a: string, b: string) {
  const x = new Set(a.split(" ").filter(Boolean));
  const y = new Set(b.split(" ").filter(Boolean));
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const t of x) if (y.has(t)) common++;
  return common / Math.max(x.size, y.size);
}

function candidateKind(pathname: string): Candidate["kind"] {
  const path = pathname.toLowerCase();
  if (/^\/old(?:\/|$)/i.test(path)) return "other";
  if (/^\/series\//i.test(path)) return "series";
  if (/^\/movie\//i.test(path)) return "movie";
  if (/^\/episode\//i.test(path)) return "episode";
  if (/^\/watch\//i.test(path)) return "watch";
  return "other";
}

function candidateSignals(c: Candidate) {
  try {
    const pathname = decodeHtml(new URL(c.url).pathname);
    const parts = pathname.split("/").filter(Boolean);
    const slug = parts.at(-1) || "";
    return [c.title, slug.replace(/[-_]+/g, " ")].filter(Boolean);
  } catch {
    return [c.title];
  }
}

function score(c: Candidate, titles: string[], year?: number, expected?: "movie" | "series" | "episode") {
  if (c.kind === "other" || c.kind === "watch") return -1000;
  if (expected === "movie" && c.kind !== "movie") return -1000;
  if (expected === "series" && c.kind !== "series") return -1000;
  if (expected === "episode" && c.kind !== "series" && c.kind !== "episode") return -1000;

  let bestTitleScore = 0;
  for (const rawCandidate of candidateSignals(c)) {
    const ct = normalize(rawCandidate);
    if (!ct) continue;
    for (const raw of titles) {
      const t = normalize(raw);
      if (!t) continue;
      if (ct === t) bestTitleScore = Math.max(bestTitleScore, 110);
      else if (ct.includes(t) || t.includes(ct)) bestTitleScore = Math.max(bestTitleScore, 88);
      else {
        const ov = overlap(ct, t);
        if (ov >= 0.45) bestTitleScore = Math.max(bestTitleScore, 55 + ov * 35);
      }
    }
  }

  if (bestTitleScore < 80) return -1000;

  let out = bestTitleScore;
  if (expected === c.kind) out += 18;
  if (year && c.year) {
    if (year === c.year) out += 12;
    else if (Math.abs(year - c.year) === 1) out += 4;
    else out -= 16;
  }
  return Math.min(140, out);
}

function parseCandidates(html: string, env: Env): Candidate[] {
  const out: Candidate[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(decodeHtml(m[1]), base(env));
      if (!isAkwamUrl(u.href)) continue;
      const kind = candidateKind(u.pathname);
      if (kind === "other" || kind === "watch") continue;

      const raw = decodeHtml(m[2]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const yearMatch = (m[0].match(/\b(?:19|20)\d{2}\b/) || [])[0];
      const slug = decodeHtml(u.pathname.split("/").filter(Boolean).at(-1) || "").replace(/[-_]+/g, " ");
      const title = [raw, slug].filter(Boolean).join(" || ");

      const item: Candidate = { url: u.href, title, kind, year: yearMatch ? Number(yearMatch) : undefined };
      if (!out.some((x) => x.url === item.url)) out.push(item);
    } catch {}
  }
  return out;
}

async function findCandidate(
  env: Env,
  titles: string[],
  year?: number,
  expected: "movie" | "series" | "episode" = "movie",
) {
  const hosts = [base(env)];

  let best: { item: Candidate; score: number } | null = null;
  const diagnostics: string[] = [];
  const variants = titles.filter(Boolean).map((x) => x.trim()).filter(Boolean).slice(0, 3);

  for (const host of hosts) {
    for (const title of variants) {
      const url = host + "/search?q=" + encodeURIComponent(title);
      const html = await fetchText(env, url, diagnostics);
      if (!html) continue;

      for (const item of parseCandidates(html, env)) {
        const itemScore = score(item, titles, year, expected);
        if (!best || itemScore > best.score) best = { item, score: itemScore };
      }

      if (best && best.score >= 128) return best.item;
    }

    // Legacy search is allowed only on the single verified host, as a last resort.
    if (host === base(env)) {
      for (const title of variants.slice(0, 1)) {
        const html = await fetchText(env, host + "/old/search/" + encodeURIComponent(title), diagnostics);
        if (!html) continue;
        for (const item of parseCandidates(html, env)) {
          const itemScore = score(item, titles, year, expected);
          if (!best || itemScore > best.score) best = { item, score: itemScore };
        }
        if (best && best.score >= 128) return best.item;
      }
    }
  }

  if (best && best.score >= 80) return best.item;
  throw new Error("AKWAM_SEARCH_EMPTY probes=" + diagnostics.slice(0, 12).join(","));
}

function extractMediaLikeUrls(text: string) {
  const decoded = decodeHtml(text);
  return Array.from(new Set(
    decoded.match(/https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4|mpd|webm)(?:\?[^\s"'<>]*)?/gi) || []
  ));
}

function inferQuality(text: string) {
  return (decodeHtml(text).match(/(?:^|\D)(2160|1440|1080|720|576|480|360|240)(?:p)?(?:\D|$)/i) || [])[1];
}

function mediaTypeFromUrl(url: string): Media["type"] {
  if (/\.m3u8(?:\?|$)/i.test(url)) return "hls";
  if (/\.mpd(?:\?|$)/i.test(url)) return "dash";
  if (/\.webm(?:\?|$)/i.test(url)) return "webm";
  if (/\.mp4(?:\?|$)/i.test(url)) return "mp4";
  return "direct";
}

function extractMedia(text: string, baseUrl: string): Media | null {
  const decoded = decodeHtml(text);
  const direct = extractMediaLikeUrls(decoded)[0];
  if (direct) {
    return { url: direct, type: mediaTypeFromUrl(direct), quality: inferQuality(decoded),
      referer: isAkwamUrl(baseUrl) ? baseUrl : undefined };
  }

  const embedded = decoded.match(/<(?:iframe|video|source)\b[^>]+(?:src|data-src)=["']([^"']+)["']/i)?.[1];
  if (embedded) {
    try {
      const url = new URL(decodeHtml(embedded), baseUrl).href;
      return { url, type: mediaTypeFromUrl(url), quality: inferQuality(decoded),
        referer: isAkwamUrl(baseUrl) ? baseUrl : undefined };
    } catch {}
  }

  const file = decoded.match(/(?:file|source|src|videoUrl|video_url|stream|streamUrl|playlist|manifest)\s*[:=]\s*["']([^"']+)["']/i)?.[1];
  if (file) {
    try {
      const url = new URL(decodeHtml(file), baseUrl).href;
      return { url, type: mediaTypeFromUrl(url), quality: inferQuality(decoded) };
    } catch {}
  }
  return null;
}

function cleanHtmlText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPageLinks(html: string, baseUrl: string) {
  const out: Array<{ url: string; text: string }> = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const url = new URL(m[1], baseUrl).href;
      if (!isAkwamUrl(url)) continue;
      out.push({ url, text: cleanHtmlText(m[2]) });
    } catch {}
  }
  return out;
}

function extractEpisodeTarget(html: string, baseUrl: string, season: number, episode: number) {
  const links = extractPageLinks(html, baseUrl).filter((item) => {
    try {
      const url = new URL(item.url);
      return isAkwamUrl(url.href) &&
        /^\/episode\//i.test(url.pathname) &&
        !/^\/old(?:\/|$)/i.test(url.pathname);
    } catch { return false; }
  });

  let best: { url: string; score: number } | null = null;
  for (const link of links) {
    let rawPath = "";
    try { rawPath = decodeURIComponent(new URL(link.url).pathname); } catch { rawPath = link.url; }
    const hay = decodeHtml(link.text + " " + rawPath);
    let scoreValue = 0;
    const exactEpisode =
      new RegExp("(?:الحلقة[-_ ]*|episode[-_ ]*|ep[-_ ]*)0*" + episode + "(?![0-9.])", "i").test(hay) ||
      new RegExp("(?:^|[^0-9.])0*" + episode + "(?:$|[^0-9.])", "i").test(rawPath);
    if (exactEpisode) scoreValue += 180;
    if (new RegExp("s0*" + season + "e0*" + episode + "(?![0-9])", "i").test(hay)) scoreValue += 100;
    if (new RegExp("(?:season|الموسم)\\s*0*" + season + "(?:\\D|$)", "i").test(hay)) scoreValue += 35;
    if (scoreValue > 0 && (!best || scoreValue > best.score)) best = { url: link.url, score: scoreValue };
  }
  return best?.url || null;
}

function extractTargets(html: string, baseUrl: string) {
  const ranked: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();

  const add = (raw: string, scoreValue: number) => {
    try {
      const url = new URL(decodeHtml(raw), baseUrl).href;
      if (!url.startsWith("https://") || seen.has(url)) return;
      seen.add(url); ranked.push({ url, score: scoreValue });
    } catch {}
  };

  const addLinkAsDownload = (href: string, text: string) => {
    try {
      const observed = new URL(decodeHtml(href), baseUrl);
      if (!isAkwamUrl(observed.href)) return;

      if (/^\/download\//i.test(observed.pathname)) {
        add(observed.href, 155);
        return;
      }

      const marker = observed.pathname.indexOf("/link");
      if (marker >= 0) {
        // Mirrors the verified CloudStream extraction strategy:
        // an observed /link/... action is promoted to /download... using
        // the observed content pathname. Never invent IDs or paths.
        const contentPath = new URL(baseUrl).pathname.replace(/\/$/, "");
        const suffix = observed.pathname.slice(marker + "/link".length);
        const download = new URL(new URL(baseUrl).origin + "/download" + suffix + contentPath);
        add(download.href, 150);
        return;
      }

      if (/^\/watch\//i.test(observed.pathname)) {
        add(observed.href, 120);
      } else if (/\/episode\//i.test(observed.pathname)) {
        add(observed.href, 20);
      }
    } catch {}
  };

  const anchors = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchors.exec(html))) {
    const text = cleanHtmlText(decodeHtml(m[2]));
    addLinkAsDownload(m[1], text);
    if (/(2160|1440|1080|720|576|480|360|240)\s*p?/i.test(text + " " + m[1])) {
      try {
        const observed = new URL(decodeHtml(m[1]), baseUrl);
        add(observed.href, 20);
      } catch {}
    }
  }

  const mediaTags = /<(?:iframe|video|source)\b[^>]*(?:src|data-src|data-url)=["']([^"']+)["'][^>]*>/gi;
  while ((m = mediaTags.exec(html))) add(m[1], 100);
  for (const u of extractMediaLikeUrls(html)) add(u, 140);

  return ranked.sort((a, b) => b.score - a.score).map((x) => x.url).slice(0, 12);
}

function extractDownloadButtonMedia(html: string, baseUrl: string): Media | null {
  const patterns = [
    /<div\b[^>]*class=["'][^"']*btn-loader[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["']/gi,
    /<a\b[^>]*class=["'][^"']*btn-loader[^"']*["'][^>]*href=["']([^"']+)["']/gi,
  ];

  for (const re of patterns) {
    const match = re.exec(html);
    if (!match?.[1]) continue;
    try {
      const url = new URL(decodeHtml(match[1]), baseUrl).href;
      return {
        url,
        type: mediaTypeFromUrl(url),
        quality: inferQuality(match[0] + " " + html.slice(Math.max(0, match.index - 900), match.index + 900)),
        referer: isAkwamUrl(baseUrl) ? baseUrl : undefined,
      };
    } catch {}
  }

  return null;
}

async function resolveTarget(env: Env, target: string): Promise<Media | null> {
  const direct = extractMedia(target, target);
  if (direct) return direct;

  const html = await fetchText(env, target);
  if (!html) return null;

  // Akwam's current deterministic path: /download -> div.btn-loader > a -> final media.
  const buttonMedia = extractDownloadButtonMedia(html, target);
  if (buttonMedia) return buttonMedia;

  const media = extractMedia(html, target);
  if (media) return media;

  for (const nested of extractTargets(html, target).slice(0, 3)) {
    const directNested = extractMedia(nested, nested);
    if (directNested) return directNested;

    const nestedHtml = await fetchText(env, nested);
    if (!nestedHtml) continue;

    const nestedButton = extractDownloadButtonMedia(nestedHtml, nested);
    if (nestedButton) return nestedButton;

    const nestedMedia = extractMedia(nestedHtml, nested);
    if (nestedMedia) return nestedMedia;
  }

  return null;
}

async function readPrefix(response: Response, maxBytes = 8192) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value?.length) {
        const remaining = maxBytes - total;
        const chunk = next.value.length > remaining ? next.value.slice(0, remaining) : next.value;
        chunks.push(chunk);
        total += chunk.length;
      }
    }
  } finally { try { await reader.cancel(); } catch {} }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}

async function validateMedia(env: Env, media: Media) {
  try {
    if (!/^https:\/\//i.test(media.url)) return false;
    const response = await fetch(media.url, {
      method: "GET",
      headers: { ...headers(env), Accept: "*/*", Range: "bytes=0-8191", ...(media.referer ? { Referer: media.referer } : {}) },
      redirect: "follow",
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok && response.status !== 206) return false;
    const ct = response.headers.get("content-type")?.toLowerCase() || "";
    const body = await readPrefix(response);
    if (!body.length) return false;

    const sample = new TextDecoder().decode(body.slice(0, 8192));
    if (/<html|<!doctype|captcha|cloudflare/i.test(sample)) return false;
    if (media.type === "hls") return sample.includes("#EXTM3U");
    if (media.type === "dash") return /<MPD[\s>]|<\?xml/i.test(sample);
    if (media.type === "webm") return ct.includes("webm") || (body[0] === 0x1a && body[1] === 0x45 && body[2] === 0xdf && body[3] === 0xa3);
    if (ct.startsWith("video/") || ct.includes("octet-stream") || ct.includes("binary/octet-stream")) return true;

    for (let i = 0; i + 3 < Math.min(body.length, 512); i++) {
      if (body[i] === 0x66 && body[i + 1] === 0x74 && body[i + 2] === 0x79 && body[i + 3] === 0x70) return true;
    }
    return false;
  } catch { return false; }
}

async function getContext(env: Env, job: Job) {
  const rows = await sb(env, "/rest/v1/rpc/get_akwam_prefill_context", {
    method: "POST",
    body: JSON.stringify({ p_job_id: job.id }),
  });
  const ctx = rows?.[0];
  if (!ctx) throw new Error("AKWAM_CONTEXT_NOT_FOUND");

  return {
    titles: Array.isArray(ctx.titles) ? (ctx.titles.filter(Boolean) as string[]) : [],
    year: ctx.year ? Number(ctx.year) : undefined,
    episodeNumber: ctx.episode_number ? Number(ctx.episode_number) : undefined,
    seasonNumber: ctx.season_number ? Number(ctx.season_number) : undefined,
  };
}

async function discover(env: Env, job: Job, ctx: any) {
  const expected = job.content_type === "episode" ? "series" : "movie";
  const candidate = await findCandidate(env, ctx.titles, ctx.year, expected);
  if (!candidate) throw new Error("AKWAM_NOT_FOUND");

  const detail = await fetchText(env, candidate.url);
  if (!detail) throw new Error("AKWAM_DETAIL_FETCH_FAILED");

  let targets: string[] = [];
  if (job.content_type === "episode") {
    const ep = ctx.episodeNumber || job.episode_number || 1;
    const season = ctx.seasonNumber || job.season_number || 1;

    if (!/^\/series\//i.test(new URL(candidate.url).pathname)) {
      throw new Error("AKWAM_SERIES_CANDIDATE_INVALID candidate=" + candidate.url);
    }

    const exactEpisode = extractEpisodeTarget(detail, candidate.url, season, ep);
    if (!exactEpisode) {
      throw new Error("AKWAM_EPISODE_NOT_INDEXED candidate=" + candidate.url + " season=" + season + " episode=" + ep);
    }

    const episodeHtml = await fetchText(env, exactEpisode);
    if (!episodeHtml) throw new Error("AKWAM_EPISODE_FETCH_FAILED");

    targets = extractTargets(episodeHtml, exactEpisode);
    if (!targets.length) throw new Error("AKWAM_EPISODE_LINKS_EMPTY episode=" + new URL(exactEpisode).pathname);
  } else {
    targets = extractTargets(detail, candidate.url);
  }

  const medias: Media[] = [];
  for (const target of targets.slice(0, 6)) {
    const media = await resolveTarget(env, target);
    if (!media || !(await validateMedia(env, media))) continue;
    if (!medias.some((x) => x.url === media.url)) medias.push(media);
    if (medias.length >= 3) break;
  }

  if (!medias.length) {
    const summary = targets.slice(0, 6).map((url) => {
      try { return new URL(url).pathname; } catch { return "invalid"; }
    }).join(",");
    throw new Error("AKWAM_NO_PLAYABLE_SOURCE candidate=" + candidate.url + " targets=" + summary);
  }
  return medias;
}

async function providerId(env: Env) {
  const rows = await sb(env, "/rest/v1/providers?select=id&key=eq.akwam&limit=1");
  if (rows?.[0]?.id) return rows[0].id as string;
  const created = await sb(env, "/rest/v1/providers?on_conflict=key&select=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      key: "akwam",
      name: "Akwam",
      adapter_name: "akwam-db-prefill",
      enabled: true,
      status: "healthy",
      updated_at: new Date().toISOString(),
    }),
  });
  if (!created?.[0]?.id) throw new Error("Akwam provider row missing");
  return created[0].id as string;
}

async function persist(env: Env, job: Job, sources: Media[], provider: string, workerId: string) {
  const now = new Date().toISOString();
  await sb(env, `/rest/v1/playback_sources?provider_id=eq.${provider}&content_type=eq.${job.content_type}&content_id=eq.${job.content_id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ is_working: false, last_checked_at: now }),
  });

  const rows = sources.map((s, i) => ({
    provider_id: provider,
    content_type: job.content_type,
    source_type: s.type,
    content_id: job.content_id,
    url: s.url,
    provider_reference: "akwam",
    quality: s.quality || "Auto",
    language: "und",
    label_ar: `Akwam • ${s.quality || "Auto"}`,
    label_en: `Akwam • ${s.quality || "Auto"}`,
    expires_at: null,
    is_working: true,
    last_checked_at: now,
    failure_count: 0,
    subtitle_url: null,
    subtitle_type: null,
    subtitle_language: null,
    subtitle_label_ar: null,
    subtitle_label_en: null,
    subtitle_default: i === 0,
  }));

  await sb(env, "/rest/v1/playback_sources?on_conflict=provider_id,content_type,content_id,url", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });

  await sb(env, `/rest/v1/playback_source_jobs?id=eq.${job.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "succeeded",
      source_count: rows.length,
      locked_at: null,
      locked_by: null,
      last_success_at: now,
      next_check_at: new Date(Date.now() + 86400000).toISOString(),
      updated_at: now,
      last_error: null,
      details: { provider: "akwam", mode: "db-only-prefill", worker: workerId, stored: rows.length },
    }),
  });

  return rows.length;
}

async function fail(env: Env, job: Job, error: unknown, workerId: string) {
  const message = String(error).slice(0, 1800);
  const terminal = job.attempts >= 3 && /AKWAM_NOT_FOUND|AKWAM_NO_PLAYABLE_SOURCE|AKWAM_DETAIL_FETCH_FAILED/.test(message);
  const delaySeconds = Math.min(3600, 60 * Math.pow(2, Math.max(0, job.attempts - 1)));
  const now = new Date().toISOString();

  await sb(env, `/rest/v1/playback_source_jobs?id=eq.${job.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: terminal ? "failed" : "pending",
      source_count: 0,
      locked_at: null,
      locked_by: null,
      last_error: message,
      available_at: terminal ? now : new Date(Date.now() + delaySeconds * 1000).toISOString(),
      updated_at: now,
      details: { provider: "akwam", mode: "db-only-prefill", worker: workerId, terminal },
    }),
  });
}

async function processJob(env: Env, job: Job, workerId: string, provider: string) {
  try {
    const context = await getContext(env, job);
    const sources = await discover(env, job, context);
    const count = await persist(env, job, sources, provider, workerId);
    return { ok: true, count };
  } catch (error) {
    await fail(env, job, error, workerId);
    return { ok: false, error: String(error) };
  }
}
async function run(env: Env, workerId: string) {
  const max = Math.max(1, Math.min(50, Number(env.MAX_JOBS_PER_RUN || 1)));

  const claimed = await Promise.all(
    Array.from({ length: max }, () => claim(env, workerId))
  );
  const jobs = claimed.filter((job): job is Job => Boolean(job));
  if (!jobs.length) return { workerId, processed: 0, saved: 0, failed: 0 };

  let provider: string;
  try {
    provider = await providerId(env);
  } catch (error) {
    throw new Error("AKWAM_PROVIDER_INIT_FAILED: " + String(error).slice(0, 1200));
  }

  const results = await Promise.all(
    jobs.map((job) => processJob(env, job, workerId, provider))
  );

  return {
    workerId,
    processed: results.length,
    saved: results.reduce((sum, r) => sum + (r.ok ? r.count : 0), 0),
    failed: results.filter((r) => !r.ok).length,
  };
}

const PREFILL_PUBLIC_URL = "https://movyz-akwam-prefill.sameranede.workers.dev/";

async function fanout(env: Env) {
  const requests = Array.from({ length: 6 }, () =>
    fetch(PREFILL_PUBLIC_URL, {
      method: "POST",
      headers: {
        "x-movyz-prefill-key": env.SUPABASE_SERVICE_ROLE_KEY,
        "x-movyz-prefill-mode": "batch",
      },
    })
  );

  const settled = await Promise.allSettled(requests);
  return {
    launched: settled.length,
    accepted: settled.filter((r) => r.status === "fulfilled").length,
  };
}
export default {
  async fetch(request: Request, env: Env) {
    try {
      if (request.method === "POST" && request.headers.get("x-movyz-prefill-key") === env.SUPABASE_SERVICE_ROLE_KEY) {
        const mode = request.headers.get("x-movyz-prefill-mode") || "batch";

        if (mode === "fanout") {
          const result = await fanout(env);
          return Response.json({ ok: true, trigger: "fanout", ...result });
        }

        const workerId = "prefill-" + crypto.randomUUID();
        const result = await run(env, workerId);
        return Response.json({ ok: true, trigger: "batch", ...result });
      }

      return Response.json({ ok: true, service: "movyz-akwam-prefill", mode: "db-only", parallel_jobs: 1, fanout: 6, akwam_host: "akwam.ss" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[akwam-prefill]", message);
      return Response.json(
        { ok: false, service: "movyz-akwam-prefill", error: message.slice(0, 1800) },
        { status: 500 }
      );
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      run(env, "cron-" + crypto.randomUUID())
        .then((r) => console.log(JSON.stringify(r)))
        .catch((error) => console.error(String(error)))
    );
  }
};

export { run };

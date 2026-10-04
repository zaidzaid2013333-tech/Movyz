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

type Candidate = { url: string; title: string; year?: number };
type Media = { url: string; type: "hls" | "mp4"; quality?: string };

function base(env: Env) {
  return (env.AKWAM_BASE_URL || "https://akwam.ss").replace(/\/+$/, "");
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

async function fetchText(env: Env, url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: headers(env),
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
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

function score(c: Candidate, titles: string[], year?: number) {
  const ct = normalize(c.title);
  let out = 0;
  for (const raw of titles) {
    const t = normalize(raw);
    if (!t) continue;
    if (ct === t) out = Math.max(out, 100);
    else if (ct.includes(t) || t.includes(ct)) out = Math.max(out, 84);
    else out = Math.max(out, 40 + overlap(ct, t) * 40);
  }
  if (year && c.year) {
    if (year === c.year) out += 15;
    else if (Math.abs(year - c.year) === 1) out += 5;
    else out -= 20;
  }
  return Math.min(120, out);
}

function parseCandidates(html: string, env: Env): Candidate[] {
  const host = new URL(base(env)).hostname;
  const out: Candidate[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base(env));
      if (!u.hostname.endsWith(host) || !/(movie|series|show|anime)\//i.test(u.pathname)) continue;
      const raw = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (raw.length < 2) continue;
      const yearMatch = (raw.match(/\b(?:19|20)\d{2}\b/) || [])[0];
      const item = { url: u.href, title: raw, year: yearMatch ? Number(yearMatch) : undefined };
      if (!out.some((x) => x.url === item.url)) out.push(item);
    } catch {}
  }
  return out;
}

async function findCandidate(env: Env, titles: string[], year?: number) {
  for (const title of titles.filter(Boolean).map((x) => x.trim()).filter(Boolean)) {
    const html = await fetchText(env, base(env) + "/search?q=" + encodeURIComponent(title));
    if (!html) continue;
    const ranked = parseCandidates(html, env)
      .map((item) => ({ item, score: score(item, titles, year) }))
      .sort((a, b) => b.score - a.score);
    if (ranked[0] && ranked[0].score >= 55) return ranked[0].item;
  }
  return null;
}

function extractMediaLikeUrls(text: string) {
  return Array.from(new Set(
    text.match(/https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi) || []
  ));
}

function inferQuality(text: string) {
  return (text.match(/(?:^|\D)(2160|1440|1080|720|576|480|360)(?:p)?(?:\D|$)/i) || [])[1];
}

function extractMedia(text: string, baseUrl: string): Media | null {
  const direct = extractMediaLikeUrls(text)[0];
  if (direct) {
    return {
      url: direct,
      type: /\.m3u8(?:\?|$)/i.test(direct) ? "hls" : "mp4",
      quality: inferQuality(text),
    };
  }

  const embedded = text.match(/<(?:iframe|video|source)\b[^>]+(?:src|data-src)=["']([^"']+)["']/i)?.[1];
  if (embedded) {
    try {
      const url = new URL(embedded, baseUrl).href;
      if (/\.(?:m3u8|mp4)(?:\?|$)/i.test(url)) {
        return { url, type: /\.m3u8/i.test(url) ? "hls" : "mp4", quality: inferQuality(text) };
      }
    } catch {}
  }

  const file = text.match(/(?:file|source|src|videoUrl|video_url|stream|streamUrl)\s*[:=]\s*["']([^"']+)["']/i)?.[1];
  if (file) {
    try {
      const url = new URL(file, baseUrl).href;
      if (/\.(?:m3u8|mp4)(?:\?|$)/i.test(url)) {
        return { url, type: /\.m3u8/i.test(url) ? "hls" : "mp4", quality: inferQuality(text) };
      }
    } catch {}
  }
  return null;
}

function extractTargets(html: string, baseUrl: string) {
  const targets = new Set<string>();
  const re = /<(?:a|iframe|video|source)\b[^>]*(?:href|src|data-href|data-url|data-src)=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const url = new URL(m[1], baseUrl).href;
      const path = new URL(url).pathname;
      if (
        /(?:watch|download|link)/i.test(path) ||
        /(?:m3u8|mp4)(?:\?|$)/i.test(url) ||
        /مشاهدة|watch|تحميل|download|رابط|1080|720|480/i.test(m[0])
      ) targets.add(url);
    } catch {}
  }
  for (const u of extractMediaLikeUrls(html)) targets.add(u);
  return Array.from(targets).slice(0, 12);
}

async function resolveTarget(env: Env, target: string): Promise<Media | null> {
  const direct = extractMedia(target, target);
  if (direct) return direct;
  const html = await fetchText(env, target);
  if (!html) return null;
  const media = extractMedia(html, target);
  if (media) return media;
  for (const nested of extractTargets(html, target).slice(0, 8)) {
    const directNested = extractMedia(nested, nested);
    if (directNested) return directNested;
    const nestedHtml = await fetchText(env, nested);
    if (!nestedHtml) continue;
    const nestedMedia = extractMedia(nestedHtml, nested);
    if (nestedMedia) return nestedMedia;
  }
  return null;
}

async function validateMedia(env: Env, media: Media) {
  try {
    const response = await fetch(media.url, {
      method: "GET",
      headers: {
        ...headers(env),
        Accept: media.type === "hls"
          ? "application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.8"
          : "video/mp4,video/webm,application/octet-stream,*/*;q=0.8",
        Range: "bytes=0-262143",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok && response.status !== 206) return false;
    const body = new Uint8Array(await response.arrayBuffer());
    if (!body.length) return false;
    if (media.type === "hls") {
      return new TextDecoder().decode(body.slice(0, 512)).includes("#EXTM3U");
    }
    const ct = response.headers.get("content-type")?.toLowerCase() || "";
    if (ct.startsWith("video/") || ct.includes("octet-stream")) return true;
    for (let i = 0; i + 3 < Math.min(body.length, 512); i++) {
      if (body[i] === 0x66 && body[i + 1] === 0x74 && body[i + 2] === 0x79 && body[i + 3] === 0x70) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function getContext(env: Env, job: Job) {
  if (job.content_type === "movie") {
    const rows = await sb(env, `/rest/v1/movies?id=eq.${job.content_id}&select=id,tmdb_id,title_en,title_ar,original_title,release_date&limit=1`);
    const m = rows?.[0];
    if (!m) throw new Error("Movie row not found");
    return {
      titles: [m.title_en, m.title_ar, m.original_title].filter(Boolean) as string[],
      year: m.release_date ? Number(String(m.release_date).slice(0, 4)) : undefined,
    };
  }

  const eps = await sb(env, `/rest/v1/episodes?id=eq.${job.content_id}&select=id,name,episode_number,season_id&limit=1`);
  const ep = eps?.[0];
  if (!ep) throw new Error("Episode row not found");
  const seasons = await sb(env, `/rest/v1/seasons?id=eq.${ep.season_id}&select=id,series_id,season_number&limit=1`);
  const season = seasons?.[0];
  if (!season) throw new Error("Season row not found");
  const series = await sb(env, `/rest/v1/series?id=eq.${season.series_id}&select=id,tmdb_id,title_en,title_ar,original_title,first_air_date&limit=1`);
  const s = series?.[0];
  if (!s) throw new Error("Series row not found");
  return {
    titles: [s.title_en, s.title_ar, s.original_title].filter(Boolean) as string[],
    year: s.first_air_date ? Number(String(s.first_air_date).slice(0, 4)) : undefined,
    episodeNumber: Number(ep.episode_number ?? job.episode_number ?? 1),
    seasonNumber: Number(season.season_number ?? job.season_number ?? 1),
  };
}

async function discover(env: Env, job: Job, ctx: any) {
  const candidate = await findCandidate(env, ctx.titles, ctx.year);
  if (!candidate) throw new Error("AKWAM_NOT_FOUND");

  const detail = await fetchText(env, candidate.url);
  if (!detail) throw new Error("AKWAM_DETAIL_FETCH_FAILED");

  let targets = extractTargets(detail, candidate.url);

  if (job.content_type === "episode") {
    const ep = ctx.episodeNumber || job.episode_number || 1;
    const season = ctx.seasonNumber || job.season_number || 1;
    const rank = (url: string) => {
      const text = url.toLowerCase();
      let s = 0;
      if (new RegExp(`(?:^|\\D)${ep}(?:\\D|$)`, "i").test(text)) s += 70;
      if (new RegExp(`(?:season|الموسم)\\D{0,6}${season}(?:\\D|$)|s0*${season}`, "i").test(text)) s += 25;
      if (/\/(?:episode|watch|show\/episode)\//i.test(new URL(url).pathname)) s += 20;
      return s;
    };
    targets = targets.sort((a, b) => rank(b) - rank(a));
  }

  const medias: Media[] = [];
  for (const target of targets.slice(0, 8)) {
    const media = await resolveTarget(env, target);
    if (!media || !(await validateMedia(env, media))) continue;
    if (!medias.some((x) => x.url === media.url)) medias.push(media);
    if (medias.length >= 2) break;
  }

  if (!medias.length) throw new Error("AKWAM_NO_PLAYABLE_SOURCE");
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

async function processJob(env: Env, job: Job, workerId: string) {
  try {
    const context = await getContext(env, job);
    const sources = await discover(env, job, context);
    const count = await persist(env, job, sources, await providerId(env), workerId);
    return { ok: true, count };
  } catch (error) {
    await fail(env, job, error, workerId);
    return { ok: false, error: String(error) };
  }
}

async function run(env: Env, workerId: string) {
  let processed = 0;
  let saved = 0;
  const max = Math.max(1, Math.min(6, Number(env.MAX_JOBS_PER_RUN || 4)));

  for (let i = 0; i < max; i++) {
    const job = await claim(env, workerId);
    if (!job) break;
    const result = await processJob(env, job, workerId);
    processed++;
    if (result.ok) saved += result.count;
  }

  return { workerId, processed, saved };
}

export default {
  async fetch(_request: Request, env: Env) {
    return Response.json({ ok: true, service: "movyz-akwam-prefill", mode: "db-only" });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const workerId = "cf-" + crypto.randomUUID();
    ctx.waitUntil(run(env, workerId).then((r) => console.log(JSON.stringify(r))));
  },
};

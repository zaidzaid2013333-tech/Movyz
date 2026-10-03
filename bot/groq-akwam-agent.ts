import 'dotenv/config';

import { spawn } from 'node:child_process';
import { adminSupabase } from '../server/supabase';
import { fetchArProvPage } from '../server/providers/arprov-runtime';
import { resolveAkwamPlayback, resolveAkwamEpisodeFromSeriesPage } from '../server/providers/arprov-akwam';
import type { ProviderContext, NormalizedPlaybackSource } from '../server/providers/types';
import { validatePreparedMediaSource } from '../scripts/validate-prepared-source';

// [akwam-robot] full-cycle trigger with Groq supervisor
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const MAX_TURNS = Math.max(1, Math.min(6, Number.parseInt(process.env.GROQ_AGENT_MAX_TURNS || '5', 10) || 5));
const MAX_ACTIONS = Math.max(1, Math.min(4, Number.parseInt(process.env.GROQ_AGENT_MAX_ACTIONS || '3', 10) || 3));
const GROQ_RETRIES = 2;
const ACTION_DELAY_MS = 700;

type ActionState = { count: number };
const state: ActionState = { count: 0 };

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanTitles(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap(value => {
    if (typeof value === 'string') return [value];
    if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>;
      return [item.title, item.name].filter((x): x is string => typeof x === 'string');
    }
    return [];
  }).map(x => x.trim()).filter(Boolean).slice(0, 20);
}

function buildEpisodeContext(row: any, titleVariant?: string): ProviderContext {
  const season = row.seasons;
  const series = season?.series;
  const title = titleVariant?.trim() || series?.title_ar || series?.title_en || series?.original_title;
  return {
    tmdbId: Number(series?.tmdb_id || 0) || undefined,
    title,
    originalTitle: series?.original_title || series?.title_en || series?.title_ar || undefined,
    alternateTitles: cleanTitles(series?.alternative_titles),
    releaseYear: series?.first_air_date ? Number(String(series.first_air_date).slice(0, 4)) : undefined,
    seasonNumber: Number(season?.season_number || 1),
    episodeNumber: Number(row.episode_number || 0),
    episodeTitle: row.name_ar || row.name_en || undefined,
  };
}

function buildMovieContext(row: any, titleVariant?: string): ProviderContext {
  return {
    tmdbId: Number(row.tmdb_id || 0) || undefined,
    title: titleVariant?.trim() || row.title_ar || row.title_en || row.original_title || undefined,
    originalTitle: row.original_title || row.title_en || row.title_ar || undefined,
    alternateTitles: cleanTitles(row.alternative_titles),
    releaseYear: row.release_date ? Number(String(row.release_date).slice(0, 4)) : undefined,
  };
}

async function fetchEpisodeRow(contentId: string) {
  const { data, error } = await adminSupabase
    .from('episodes')
    .select('id,tmdb_id,episode_number,name_ar,name_en,seasons!inner(season_number,series:series_id!inner(id,tmdb_id,title_ar,title_en,original_title,alternative_titles,status,first_air_date))')
    .eq('id', contentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Episode not found');
  return data;
}

async function fetchMovieRow(contentId: string) {
  const { data, error } = await adminSupabase
    .from('movies')
    .select('id,tmdb_id,title_ar,title_en,original_title,alternative_titles,release_date,status')
    .eq('id', contentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Movie not found');
  return data;
}

async function getContentDetails(contentType: 'movie' | 'episode', contentId: string) {
  if (contentType === 'episode') {
    const row = await fetchEpisodeRow(contentId);
    const context = buildEpisodeContext(row);
    return {
      ok: true,
      contentType,
      contentId,
      tmdbId: context.tmdbId,
      title: context.title,
      originalTitle: context.originalTitle,
      alternateTitles: context.alternateTitles || [],
      seasonNumber: context.seasonNumber,
      episodeNumber: context.episodeNumber,
      episodeTitle: context.episodeTitle || null,
    };
  }

  const row = await fetchMovieRow(contentId);
  const context = buildMovieContext(row);
  return {
    ok: true,
    contentType,
    contentId,
    tmdbId: context.tmdbId,
    title: context.title,
    originalTitle: context.originalTitle,
    alternateTitles: context.alternateTitles || [],
    releaseYear: context.releaseYear || null,
  };
}

async function saveValidatedSources(
  contentType: 'movie' | 'episode',
  contentId: string,
  sources: NormalizedPlaybackSource[],
  providerId: string,
) {
  const prepared: Array<Record<string, unknown>> = [];
  for (const source of sources.slice(0, 8)) {
    const quality = String(source.quality || '').trim().toLowerCase();
    const type = String(source.type || '').trim().toLowerCase();
    const url = String(source.url || '').trim();
    if (!/^(?:mp4|hls|dash|webm|direct)$/.test(type)) continue;
    if (!/^\d{3,4}p$/.test(quality)) continue;
    const checked = await validatePreparedMediaSource({
      provider: 'Akwam',
      providerReference: 'akwam',
      type: source.type,
      url,
      quality,
      language: source.language,
      label: source.label || ('Akwam ' + quality),
      referer: 'https://akwam.ss/',
    });
    if (!checked) continue;
    prepared.push({
      provider_id: providerId,
      content_type: contentType,
      content_id: contentId,
      source_type: type,
      url: checked.url,
      provider_reference: 'akwam',
      quality,
      language: source.language || 'und',
      label_ar: source.label || ('Akwam ' + quality),
      label_en: source.label || ('Akwam ' + quality),
      expires_at: source.expiresAt || null,
      is_working: true,
      last_checked_at: new Date().toISOString(),
      failure_count: 0,
    });
  }

  const deduped = [...new Map(prepared.map(row => [
    String(row.quality) + '|' + String(row.source_type) + '|' + String(row.url),
    row,
  ])).values()];

  if (!deduped.length) return { saved: 0, qualities: [] as string[] };

  const qualities = [...new Set(deduped.map(row => String(row.quality)))];
  const { error: deleteError } = await adminSupabase
    .from('playback_sources')
    .delete()
    .eq('provider_id', providerId)
    .eq('content_type', contentType)
    .eq('content_id', contentId)
    .eq('provider_reference', 'akwam')
    .in('quality', qualities);
  if (deleteError) throw deleteError;

  const { error: insertError } = await adminSupabase
    .from('playback_sources')
    .insert(deduped);
  if (insertError) throw insertError;

  return { saved: deduped.length, qualities };
}

async function getProviderId() {
  const { data, error } = await adminSupabase
    .from('providers')
    .select('id')
    .eq('key', 'arprov')
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('ArProv provider row not found');
  return data.id as string;
}

async function prepareEpisode(contentId: string, titleVariant?: string) {
  if (state.count >= MAX_ACTIONS) return { ok: false, blocked: 'action-budget' };
  state.count++;
  const row = await fetchEpisodeRow(contentId);
  const context = buildEpisodeContext(row, titleVariant);
  const providerId = await getProviderId();
  const sources = await resolveAkwamPlayback(context, {});
  const saved = await saveValidatedSources('episode', contentId, sources, providerId);
  return {
    ok: saved.saved > 0,
    action: 'prepare_episode',
    contentId,
    tmdbId: context.tmdbId,
    season: context.seasonNumber,
    episode: context.episodeNumber,
    titleVariant: titleVariant || null,
    discovered: sources.length,
    saved: saved.saved,
    qualities: saved.qualities,
  };
}

async function prepareMovie(contentId: string, titleVariant?: string) {
  if (state.count >= MAX_ACTIONS) return { ok: false, blocked: 'action-budget' };
  state.count++;
  const row = await fetchMovieRow(contentId);
  const context = buildMovieContext(row, titleVariant);
  const providerId = await getProviderId();
  const sources = await resolveAkwamPlayback(context, {});
  const saved = await saveValidatedSources('movie', contentId, sources, providerId);
  return {
    ok: saved.saved > 0,
    action: 'prepare_movie',
    contentId,
    tmdbId: context.tmdbId,
    titleVariant: titleVariant || null,
    discovered: sources.length,
    saved: saved.saved,
    qualities: saved.qualities,
  };
}

async function searchAkwam(query: string) {
  if (state.count >= MAX_ACTIONS) return { ok: false, blocked: 'action-budget' };
  state.count++;
  const encoded = encodeURIComponent(query.trim());
  const urls = [
    'https://akwam.ss/search?q=' + encoded,
    'https://akwam.ss/?s=' + encoded,
    'https://akwam.ss/series?search=' + encoded,
  ];
  const out: any[] = [];
  for (const url of urls) {
    const page = await fetchArProvPage(url, { timeoutMs: 12000 });
    if (!page) continue;
    const body = page.body;
    const links = [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => ({
        href: new URL(m[1], page.url).toString(),
        text: String(m[2] || '').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim().slice(0,160),
      }))
      .filter(x => /^https:\/\/akwam\.ss(?:\/|$)/i.test(x.href))
      .filter(x => /\/series\//i.test(x.href) || /\/episode\//i.test(x.href))
      .slice(0,80);
    out.push({ url: page.url, status: page.status, bytes: body.length, links });
  }
  return { ok: true, query, pages: out };
}

async function searchAkwamSeries(query: string) {
  const encoded = encodeURIComponent(query.trim());
  const urls = [
    'https://akwam.ss/search?q=' + encoded + '&section=series',
    'https://akwam.ss/search?q=' + encoded,
  ];
  const byUrl = new Map<string, { url: string; title: string }>();

  for (const url of urls) {
    const page = await fetchArProvPage(url, { timeoutMs: 12_000 });
    if (!page) continue;
    for (const match of page.body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      let href: string;
      try { href = new URL(match[1], page.url).toString(); } catch { continue; }
      if (!/^https:\/\/akwam\.ss\/series\//i.test(href)) continue;
      const text = String(match[2] || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
      const current = byUrl.get(href);
      if (!current || text.length > current.title.length) {
        byUrl.set(href, { url: href, title: text.slice(0, 180) });
      }
    }
  }

  return [...byUrl.values()].slice(0, 12);
}

async function inspectAkwamPage(url: string) {
  if (state.count >= MAX_ACTIONS) return { ok: false, blocked: 'action-budget' };
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, error: 'invalid-url' }; }
  if (parsed.origin !== 'https://akwam.ss') return { ok: false, error: 'only-akwam-ss-allowed' };
  state.count++;

  const page = await fetchArProvPage(url, { timeoutMs: 10_000 });
  if (!page) return { ok: false, error: 'no-response' };

  const body = page.body;
  const anchors = [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .slice(0, 120)
    .map(match => ({
      href: match[1],
      text: String(match[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180),
    }))
    .filter(x => x.href && x.text)
    .slice(0, 60);

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
  const downloadLinks = [...body.matchAll(/href=["']([^"']*\/(?:download|link)\/[^"']+)["']/gi)]
    .map(m => m[1])
    .slice(0, 12);

  const allAnchors = [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(match => ({
      href: match[1],
      text: String(match[2] || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 220),
    }))
    .filter(item => /^https:\/\/akwam\.ss(?:\/|$)/i.test(item.href));

  const seriesLinks = allAnchors
    .filter(item => /\/series\//i.test(item.href) || /\/episode\//i.test(item.href))
    .slice(0, 24);

  const forms = [...body.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)]
    .slice(0, 12)
    .map(match => ({
      tag: match[0].slice(0, 2400),
      inputs: [...match[1].matchAll(/<(?:input|textarea|select)\b[^>]*>/gi)].map(x => x[0].slice(0, 500)).slice(0, 30),
    }));

  const scriptSources = [...body.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)]
    .map(match => match[1])
    .slice(0, 24);

  return {
    ok: true,
    finalUrl: page.url,
    status: page.status,
    title: title.slice(0, 300),
    bytes: body.length,
    anchors,
    seriesLinks,
    forms,
    scriptSources,
    downloadLinks,
    hasQualityMarkers: /1080|720|480|360/.test(body),
    hasEpisodeMarkers: /episode|الحلقة|الموسم|season|S\d{1,2}E\d{1,3}/i.test(body),
  };
}

async function getPriorityQueue() {
  const tmdbIds = (process.env.AKWAM_PRIORITY_TMDB_IDS || '1396')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => Number.isFinite(value) && value > 0)
    .slice(0, 10);

  if (!tmdbIds.length) return [];

  const { data: episodes, error } = await adminSupabase
    .from('episodes')
    .select('id,episode_number,name_ar,name_en,seasons!inner(season_number,series:series_id!inner(tmdb_id,title_ar,title_en,original_title,status))')
    .eq('seasons.series.status', 'published')
    .in('seasons.series.tmdb_id', tmdbIds)
    .order('episode_number')
    .limit(40);

  if (error || !episodes?.length) return [];

  const ids = episodes.map((row: any) => String(row.id));
  const { data: sources } = await adminSupabase
    .from('playback_sources')
    .select('content_id')
    .eq('provider_reference', 'akwam')
    .eq('content_type', 'episode')
    .eq('is_working', true)
    .in('content_id', ids);

  const ready = new Set((sources || []).map((row: any) => String(row.content_id)));
  return episodes
    .filter((row: any) => !ready.has(String(row.id)))
    .slice(0, 12)
    .map((row: any) => ({
      contentId: row.id,
      tmdbId: row.seasons?.series?.tmdb_id,
      title: row.seasons?.series?.title_ar || row.seasons?.series?.title_en || row.seasons?.series?.original_title,
      seasonNumber: row.seasons?.season_number,
      episodeNumber: row.episode_number,
      episodeTitle: row.name_ar || row.name_en || null,
    }));
}

async function getStatus() {
  const [movies, episodes, failures, states] = await Promise.all([
    adminSupabase.from('playback_sources').select('id', { count: 'exact', head: true }).eq('provider_reference', 'akwam').eq('content_type', 'movie').eq('is_working', true),
    adminSupabase.from('playback_sources').select('id', { count: 'exact', head: true }).eq('provider_reference', 'akwam').eq('content_type', 'episode').eq('is_working', true),
    adminSupabase.from('maintenance_failures').select('*').order('failed_at', { ascending: false }).limit(12),
    adminSupabase.from('maintenance_state').select('job_key,last_run_at,last_success_at,last_error,stats').ilike('job_key', '%akwam%').order('updated_at', { ascending: false }).limit(10),
  ]);

  const priorityQueue = await getPriorityQueue();
  return {
    workingMovieSources: movies.count ?? 0,
    workingEpisodeSources: episodes.count ?? 0,
    failures: failures.data || [],
    states: states.data || [],
    priorityQueue,
  };
}

async function runBoundedBatch(mode: 'movies' | 'episodes', limit: number) {
  if (state.count >= MAX_ACTIONS) return { ok: false, blocked: 'action-budget' };
  state.count++;
  const bounded = Math.max(1, Math.min(mode === 'episodes' ? 50 : 25, limit));
  const env = {
    ...process.env,
    PREPARE_ONLY_MISSING: 'true',
    ...(mode === 'movies'
      ? { PREPARE_MODE: 'movies', PREPARE_LIMIT: String(bounded), PREPARE_CONCURRENCY: '2' }
      : { PREPARE_LIMIT: String(bounded), EPISODE_SEASON_LIMIT: '5', EPISODE_CONCURRENCY: '4', SEASON_CONCURRENCY: '1' }),
  } as Record<string, string | undefined>;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs',
      mode === 'movies' ? 'scripts/prepare-arprov-sources.ts' : 'scripts/prepare-arprov-episodes-fast.ts'
    ], { cwd: process.cwd(), env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('batch worker failed with code=' + String(code))));
  });

  await sleep(ACTION_DELAY_MS);
  return { ok: true, action: 'run_bounded_batch', mode, requested: bounded };
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_content_details',
      description: 'Load safe Movyz metadata for one failed movie or episode so the agent can identify the exact title, TMDB id, season and episode before retrying.',
      parameters: {
        type: 'object',
        properties: {
          contentType: { type: 'string', enum: ['movie', 'episode'] },
          contentId: { type: 'string' },
        },
        required: ['contentType', 'contentId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_akwam',
      description: 'Search Akwam in the background using the site search contract and return only matching series/episode links plus the form/API hints. Only https://akwam.ss is allowed.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_akwam_page',
      description: 'Inspect one already-known Akwam page in the background. Only https://akwam.ss is allowed. Never use browser automation. Returns titles, relevant anchors, quality markers and download/link candidates.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_episode',
      description: 'Prepare one missing episode using the existing deterministic Akwam resolver and validator, then store only validated qualities. Can optionally try a title variant. Never deletes other qualities unless replacing the exact qualities successfully returned and validated.',
      parameters: {
        type: 'object',
        properties: {
          contentId: { type: 'string' },
          titleVariant: { type: 'string' },
        },
        required: ['contentId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_movie',
      description: 'Prepare one missing movie using the existing deterministic Akwam resolver and validator, then store only validated qualities.',
      parameters: {
        type: 'object',
        properties: {
          contentId: { type: 'string' },
          titleVariant: { type: 'string' },
        },
        required: ['contentId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_bounded_batch',
      description: 'Run a bounded deterministic preparation batch. Maximum 25 movies or 50 episodes per action. Use only when the current queue clearly needs more normal preparation.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['movies', 'episodes'] },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
        required: ['mode', 'limit'],
        additionalProperties: false,
      },
    },
  },
];

async function callGroqDecision(context: unknown) {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error('Missing GROQ_API_KEY');

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 650,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You are the Movyz preparation repair brain.',
            'Choose one safe deterministic repair action from the supplied candidates.',
            'Never invent URLs.',
            'Prefer exact series + season matches.',
            'Return JSON only:',
            '{"candidateUrl":"https://akwam.ss/series/... or null","titleVariant":"... or null","retryQuery":"... or null","reason":"brief"}',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify(context).slice(0, 4200),
        },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const body = await response.text();
  if (!response.ok) throw new Error('Groq HTTP ' + response.status + ': ' + body.slice(0, 700));
  const payload = JSON.parse(body);
  const content = String(payload.choices?.[0]?.message?.content || '{}');
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(content.slice(start, end + 1));
    throw new Error('Groq returned non-JSON decision');
  }
}

function toolArgs(raw: string | undefined) {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

async function executeTool(name: string, args: any) {
  if (name === 'search_akwam') return searchAkwam(String(args.query || ''));
  if (name === 'get_content_details') return getContentDetails(args.contentType === 'episode' ? 'episode' : 'movie', String(args.contentId || ''));
  if (name === 'inspect_akwam_page') return inspectAkwamPage(String(args.url || ''));
  if (name === 'prepare_episode') return prepareEpisode(String(args.contentId || ''), args.titleVariant ? String(args.titleVariant) : undefined);
  if (name === 'prepare_movie') return prepareMovie(String(args.contentId || ''), args.titleVariant ? String(args.titleVariant) : undefined);
  if (name === 'run_bounded_batch') return runBoundedBatch(args.mode === 'movies' ? 'movies' : 'episodes', Number(args.limit || 1));
  return { ok: false, error: 'unknown-tool' };
}

async function persistState(stateData: Record<string, unknown>) {
  await adminSupabase.from('maintenance_state').upsert({
    job_key: 'akwam-groq-agent',
    last_run_at: new Date().toISOString(),
    last_success_at: new Date().toISOString(),
    last_error: null,
    stats: stateData,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'job_key' });
}

async function main() {
  const initial = await getStatus();
  const system = [
    'You are the Movyz Akwam Preparation Agent.',
    'You are a planner/reasoner, not the playback engine.',
    'Your job is background preparation and repair only.',
    'Follow this invariant: PREPARE ONCE -> VALIDATE -> STORE -> PROXY -> NATIVE PLAYER.',
    'Playback must never discover sources dynamically.',
    'Use only https://akwam.ss for Akwam.',
    'Never store iframe/embed/search/index/HTML pages as media.',
    'Only save final HTTPS media after deterministic validation.',
    'Never delete healthy qualities because another quality failed.',
    'Never use Browser Run or any browser automation.',
    'Never invent a URL or claim success without a tool result.',
    'Never access or expose API keys or secrets.',
    'You have a strict action budget and must stop when the useful work is done.',
  ].join('\n');

  const prompt = [
    'Current Movyz state:',
    JSON.stringify({
      workingMovieSources: initial.workingMovieSources,
      workingEpisodeSources: initial.workingEpisodeSources,
      priorityQueue: initial.priorityQueue?.slice(0, 8),
      failures: initial.failures?.slice(0, 5),
      states: initial.states?.slice(0, 5),
    }),
    '',
    'First inspect the failures and states. Then take only the minimum useful actions.',
    'Prioritize missing or recently failing episodes before broad batches.',
    'A deterministic preflight attempt is already made on the first priority item; continue from its result instead of re-reading metadata.',
    'Use get_content_details only when the queue item lacks enough metadata.',
    'For a failure id, call get_content_details before acting unless the metadata is already explicit.',
    'For difficult episodes, use search_akwam first to obtain real /series/ or /episode/ links, then inspect the best link, then prepare.',
    'Akwam may express seasons with Arabic ordinals such as الموسم الأول; use the exact requested season.',
    'For a difficult episode, inspect a relevant Akwam page and then retry preparation with a verified title variant if needed.',
    'Do not repeatedly retry the exact same failed action.',
    'Finish with a concise machine-readable summary in plain text.',
  ].join('\n');

  const firstPriority = initial.priorityQueue?.[0];
  let preflight: unknown = null;
  let groqDecision: unknown = null;
  let chosenCandidate: { url: string; title: string } | null = null;
  let repair: unknown = null;

  if (firstPriority) {
    preflight = await prepareEpisode(
      String(firstPriority.contentId),
      typeof firstPriority.title === 'string' ? firstPriority.title : undefined,
    );

    const preflightOk = Boolean((preflight as any)?.ok);
    if (!preflightOk) {
      const queries = [
        String(firstPriority.title || '').trim(),
        String((firstPriority as any).originalTitle || '').trim(),
      ].filter(Boolean);

      const candidates = [];
      for (const query of queries.slice(0, 2)) {
        candidates.push(...await searchAkwamSeries(query));
      }
      const deduped = [...new Map(candidates.map(item => [item.url, item])).values()].slice(0, 12);

      const decisionInput = {
        failedPreparation: {
          contentId: firstPriority.contentId,
          tmdbId: firstPriority.tmdbId,
          title: firstPriority.title,
          seasonNumber: firstPriority.seasonNumber,
          episodeNumber: firstPriority.episodeNumber,
          episodeTitle: firstPriority.episodeTitle,
          result: preflight,
        },
        candidates: deduped,
      };

      groqDecision = await callGroqDecision(decisionInput);
      const chosenUrl = typeof (groqDecision as any)?.candidateUrl === 'string'
        ? String((groqDecision as any).candidateUrl)
        : '';
      const chosen = deduped.find(item => item.url === chosenUrl) || null;
      chosenCandidate = chosen;

      if (chosenCandidate) {
        if (state.count < MAX_ACTIONS) {
          state.count++;
          const row = await fetchEpisodeRow(String(firstPriority.contentId));
          const context = buildEpisodeContext(row, (groqDecision as any)?.titleVariant || chosenCandidate.title);
          const resolved = await resolveAkwamEpisodeFromSeriesPage(chosenCandidate.url, context, {});
          const providerId = await getProviderId();
          const saved = await saveValidatedSources('episode', String(firstPriority.contentId), resolved.sources, providerId);
          repair = {
            ok: saved.saved > 0,
            action: 'prepare_episode_from_series_url',
            seriesUrl: chosenCandidate.url,
            episodeUrl: resolved.episodeUrl,
            indexed: resolved.indexed.slice(0, 8),
            discovered: resolved.sources.length,
            saved: saved.saved,
            qualities: saved.qualities,
          };
        }
      }

      if (!(repair as any)?.ok && state.count < MAX_ACTIONS && typeof (groqDecision as any)?.retryQuery === 'string' && String((groqDecision as any).retryQuery).trim()) {
        const retryCandidates = await searchAkwamSeries(String((groqDecision as any).retryQuery).trim());
        const retry = retryCandidates.find(item => item.url !== chosenCandidate?.url);
        if (retry) {
          state.count++;
          const row = await fetchEpisodeRow(String(firstPriority.contentId));
          const context = buildEpisodeContext(row, (groqDecision as any)?.titleVariant || retry.title);
          const resolved = await resolveAkwamEpisodeFromSeriesPage(retry.url, context, {});
          const providerId = await getProviderId();
          const saved = await saveValidatedSources('episode', String(firstPriority.contentId), resolved.sources, providerId);
          repair = {
            ok: saved.saved > 0,
            action: 'prepare_episode_from_retry_series_url',
            seriesUrl: retry.url,
            episodeUrl: resolved.episodeUrl,
            indexed: resolved.indexed.slice(0, 8),
            discovered: resolved.sources.length,
            saved: saved.saved,
            qualities: saved.qualities,
          };
        }
      }
    }
  }

  console.log(JSON.stringify({
    agent: 'movyz-groq-akwam',
    model: MODEL,
    firstPriority,
    preflight,
    groqDecision,
    chosenCandidate,
    repair,
    actions: state.count,
  }));
  await persistState({
    state: 'success',
    model: MODEL,
    turns: groqDecision ? 1 : 0,
    actions: state.count,
    preflight,
    groqDecision,
    chosenCandidate,
    repair,
    completedAt: new Date().toISOString(),
  });

  console.log(JSON.stringify({
    agent: 'movyz-groq-akwam',
    model: MODEL,
    actions: state.count,
    turns: trace.filter(x => x.role === 'assistant').length,
    finalMessage,
  }));
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await adminSupabase.from('maintenance_state').upsert({
      job_key: 'akwam-groq-agent',
      last_run_at: new Date().toISOString(),
      last_success_at: null,
      last_error: message,
      stats: { state: 'failed', model: MODEL, actionCount: state.count, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'job_key' });
  } catch {}
  console.error('[movyz-groq-agent]', message);
  process.exitCode = 1;
}

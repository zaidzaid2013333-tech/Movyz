import 'dotenv/config';

import { spawn } from 'node:child_process';
import { adminSupabase } from '../server/supabase';
import { fetchArProvPage } from '../server/providers/arprov-runtime';
import { resolveAkwamPlayback } from '../server/providers/arprov-akwam';
import type { ProviderContext, NormalizedPlaybackSource } from '../server/providers/types';
import { validatePreparedMediaSource } from '../scripts/validate-prepared-source';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const MAX_TURNS = Math.max(1, Math.min(6, Number.parseInt(process.env.GROQ_AGENT_MAX_TURNS || '5', 10) || 5));
const MAX_ACTIONS = Math.max(1, Math.min(4, Number.parseInt(process.env.GROQ_AGENT_MAX_ACTIONS || '3', 10) || 3));
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
    .slice(0, 30);

  return {
    ok: true,
    finalUrl: page.url,
    status: page.status,
    title: title.slice(0, 300),
    bytes: body.length,
    anchors,
    downloadLinks,
    hasQualityMarkers: /1080|720|480|360/.test(body),
    hasEpisodeMarkers: /episode|الحلقة|الموسم|season|S\d{1,2}E\d{1,3}/i.test(body),
  };
}

async function getStatus() {
  const [movies, episodes, failures, states] = await Promise.all([
    adminSupabase.from('playback_sources').select('id', { count: 'exact', head: true }).eq('provider_reference', 'akwam').eq('content_type', 'movie').eq('is_working', true),
    adminSupabase.from('playback_sources').select('id', { count: 'exact', head: true }).eq('provider_reference', 'akwam').eq('content_type', 'episode').eq('is_working', true),
    adminSupabase.from('maintenance_failures').select('*').order('failed_at', { ascending: false }).limit(12),
    adminSupabase.from('maintenance_state').select('job_key,last_run_at,last_success_at,last_error,stats').ilike('job_key', '%akwam%').order('updated_at', { ascending: false }).limit(10),
  ]);

  return {
    workingMovieSources: movies.count ?? 0,
    workingEpisodeSources: episodes.count ?? 0,
    failures: failures.data || [],
    states: states.data || [],
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

async function callGroq(messages: any[]) {
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
      temperature: 0.15,
      max_tokens: 2200,
      messages,
      tools,
      tool_choice: 'auto',
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const body = await response.text();
  if (!response.ok) throw new Error('Groq HTTP ' + response.status + ': ' + body.slice(0, 600));

  const payload = JSON.parse(body);
  return payload.choices?.[0]?.message;
}

function toolArgs(raw: string | undefined) {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

async function executeTool(name: string, args: any) {
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
    JSON.stringify(initial).slice(0, 28000),
    '',
    'First inspect the failures and states. Then take only the minimum useful actions.',
    'Prioritize missing or recently failing episodes before broad batches.',
    'For a difficult episode, inspect a relevant Akwam page and then retry preparation with a verified title variant if needed.',
    'Do not repeatedly retry the exact same failed action.',
    'Finish with a concise machine-readable summary in plain text.',
  ].join('\n');

  const messages: any[] = [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ];

  const trace: any[] = [];
  let finalMessage = '';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const message = await callGroq(messages);
    messages.push(message);
    trace.push({ turn, role: 'assistant', toolCalls: message?.tool_calls?.map((c: any) => ({ name: c.function?.name, arguments: c.function?.arguments })) || [], content: String(message?.content || '').slice(0, 1800) });

    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    if (!calls.length) {
      finalMessage = String(message?.content || '');
      break;
    }

    for (const call of calls.slice(0, 2)) {
      const name = String(call?.function?.name || '');
      const args = toolArgs(call?.function?.arguments);
      const result = await executeTool(name, args);
      trace.push({ turn, tool: name, result: result && typeof result === 'object' ? result : String(result) });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name,
        content: JSON.stringify(result).slice(0, 10000),
      });
      if (state.count >= MAX_ACTIONS) break;
    }

    if (state.count >= MAX_ACTIONS) break;
  }

  await persistState({
    state: 'success',
    model: MODEL,
    turns: trace.filter(x => x.role === 'assistant').length,
    actions: state.count,
    trace,
    finalMessage: finalMessage.slice(0, 3000),
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

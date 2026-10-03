import 'dotenv/config';

import { adminSupabase } from '../server/supabase';
import { debugAkwamEpisode, resolveAkwamEpisodeFromSeriesPage } from '../server/providers/arprov-akwam';
import type { ProviderContext } from '../server/providers/types';

const SERIES_ID = '0e6b39aa-6564-4bbc-91f3-8f36ba808362';
const EPISODE_ID = 'cfec368f-138e-405d-a98b-bb6734f5bbf5';
const JOB_KEY = 'akwam-debug-breaking-bad';

async function writeState(values: Record<string, unknown>) {
  const { error } = await adminSupabase.from('maintenance_state').upsert({
    job_key: JOB_KEY,
    ...values,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'job_key' });
  if (error) throw error;
}

const { fetchArProvPage } = await import('../server/providers/arprov-runtime');

async function inspectSearchContract() {
  const urls = [
    'https://akwam.ss/search?q=Breaking%20Bad',
    'https://akwam.ss/?s=Breaking%20Bad',
    'https://akwam.ss/series?search=Breaking%20Bad',
  ];
  const out: any[] = [];
  for (const url of urls) {
    const page = await fetchArProvPage(url, { timeoutMs: 12000 });
    if (!page) {
      out.push({ url, ok: false });
      continue;
    }
    const body = page.body;
    const anchors = [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => ({
        href: new URL(m[1], page.url).toString(),
        text: String(m[2] || '').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim().slice(0,180),
      }))
      .filter(x => /^https:\/\/akwam\.ss(?:\/|$)/i.test(x.href))
      .filter(x => /\/series\//i.test(x.href) || /\/episode\//i.test(x.href) || /breaking|bad/i.test(x.text + ' ' + x.href))
      .slice(0, 120);
    const forms = [...body.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].slice(0, 10).map(m => m[0].slice(0, 3000));
    const scripts = [...body.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(m => new URL(m[1], page.url).toString()).slice(0,80);
    const apiHints = [...body.matchAll(/(?:\/api\/|ajax|search\?)[^"'\s<>]{0,180}/gi)].map(m=>m[0]).slice(0,80);
    out.push({url,ok:true,status:page.status,bytes:body.length,anchors,forms,scripts,apiHints});
  }
  await writeState({
    last_run_at:new Date().toISOString(),
    last_success_at:new Date().toISOString(),
    last_error:null,
    stats:{state:'search-contract',out},
  });
  console.log(JSON.stringify(out,null,2));
}

async function inspectKnownSeriesPages() {
  const known = [
    { season: 1, url: 'https://akwam.ss/series/59/breaking-bad-الموسم-الأول' },
    { season: 4, url: 'https://akwam.ss/series/66/breaking-bad-الموسم-الرابع' },
  ];
  const output: any[] = [];

  for (const item of known) {
    const page = await fetchArProvPage(item.url, { timeoutMs: 12000 });
    if (!page) {
      output.push({ season: item.season, url: item.url, ok: false, error: 'no-response' });
      continue;
    }

    const body = page.body;
    const anchors = [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map(match => {
        const tag = match[0];
        let href = match[1];
        try { href = new URL(href, page.url).toString(); } catch {}
        const text = String(match[2] || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
        return { href, text: text.slice(0, 220), tag: tag.slice(0, 900) };
      })
      .filter(x => /\/episode(?:\/|$)/i.test(x.href) || /text-white|الحلقة|episode|ep/i.test(x.tag + ' ' + x.text))
      .slice(0, 120);

    const snippets: Record<string,string> = {};
    for (const needle of ['الحلقة 1','الحلقة 01','الحلقة الأولى','Episode 1','EP 1','S01E01','S04E01','episode']) {
      const index = body.toLowerCase().indexOf(needle.toLowerCase());
      if (index >= 0) snippets[needle] = body.slice(Math.max(0,index-1200), Math.min(body.length,index+2200));
    }

    output.push({
      season: item.season,
      url: page.url,
      status: page.status,
      bytes: body.length,
      title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),
      episodePathCount: (body.match(/\/episode(?:\/|["'])/gi) || []).length,
      textWhiteCount: (body.match(/text-white/gi) || []).length,
      episodeWordCount: (body.match(/الحلقة|episode|\bep\b/gi) || []).length,
      anchors,
      snippets,
    });
  }

  await writeState({
    last_run_at: new Date().toISOString(),
    last_success_at: new Date().toISOString(),
    last_error: null,
    stats: { state: 'series-page-inspection', output },
  });

  console.log(JSON.stringify(output, null, 2));
}

async function main() {
  await inspectKnownSeriesPages();
  await inspectSearchContract();
  const { data: series, error: seriesError } = await adminSupabase
    .from('series')
    .select('id,tmdb_id,title_ar,title_en,original_title,alternative_titles,first_air_date')
    .eq('id', SERIES_ID)
    .maybeSingle();
  if (seriesError) throw seriesError;
  if (!series) throw new Error('Breaking Bad series row not found');

  const { data: episode, error: episodeError } = await adminSupabase
    .from('episodes')
    .select('id,episode_number,name_ar,name_en,seasons!inner(season_number)')
    .eq('id', EPISODE_ID)
    .maybeSingle();
  if (episodeError) throw episodeError;
  if (!episode) throw new Error('Breaking Bad S01E01 row not found');

  const rawSeason = Array.isArray(episode.seasons) ? episode.seasons[0] : episode.seasons;
  const seasonNumber = Number((rawSeason as Record<string, unknown> | null | undefined)?.season_number || 1);

  const context: ProviderContext = {
    tmdbId: Number(series.tmdb_id || 0) || undefined,
    title: series.title_ar || series.title_en || series.original_title || undefined,
    originalTitle: series.original_title || series.title_en || series.title_ar || undefined,
    alternateTitles: Array.isArray(series.alternative_titles)
      ? series.alternative_titles
          .flatMap((value) => value && typeof value === 'object'
            ? [String((value as Record<string, unknown>).title || '')]
            : [])
          .filter(Boolean)
      : [],
    releaseYear: series.first_air_date ? Number(String(series.first_air_date).slice(0, 4)) : undefined,
    seasonNumber,
    episodeNumber: Number(episode.episode_number),
    episodeTitle: episode.name_ar || episode.name_en || undefined,
  };

  await writeState({
    last_run_at: new Date().toISOString(),
    last_success_at: null,
    last_error: null,
    stats: { state: 'running', stage: 'debug', content: 'Breaking Bad S01E01', context },
  });

  const trace = await debugAkwamEpisode(context, {});
  const compactTrace = trace.slice(0, 40).map((item) => {
    const copy: Record<string, unknown> = { ...item };
    if (typeof copy.excerpt === 'string') copy.excerpt = copy.excerpt.slice(0, 800);
    return copy;
  });

  const hasEpisodePage = trace.some((item) => item.stage === 'episode-page');
  const hasDownloadTarget = trace.some((item) => item.stage === 'download-target');
  const hasLoader = trace.some((item) => item.stage === 'download-page' && item.hasBtnLoader === true);
  const errorMessages = trace
    .filter((item) => item.ok === false)
    .map((item) => String(item.error || item.reason || item.result || 'unknown'))
    .slice(0, 20);

  const success = hasEpisodePage && (hasDownloadTarget || hasLoader);
  await writeState({
    last_run_at: new Date().toISOString(),
    last_success_at: success ? new Date().toISOString() : null,
    last_error: success ? null : 'Breaking Bad debug did not reach a final download target',
    stats: {
      state: success ? 'success' : 'diagnostic-failed',
      content: 'Breaking Bad S01E01',
      stages: {
        hasEpisodePage,
        hasDownloadTarget,
        hasLoader,
        errorMessages,
      },
      trace: compactTrace,
    },
  });

  console.log(JSON.stringify({
    ok: success,
    hasEpisodePage,
    hasDownloadTarget,
    hasLoader,
    errors: errorMessages,
    trace: compactTrace,
  }, null, 2));

  if (!success) process.exitCode = 2;
}

await main();

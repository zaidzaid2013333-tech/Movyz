import 'dotenv/config';

import { adminSupabase } from '../server/supabase';
import { debugAkwamEpisode, resolveAkwamPlayback } from '../server/providers/arprov-akwam';
import { fetchArProvPage } from '../server/providers/arprov-runtime';
import type { NormalizedPlaybackSource, ProviderContext } from '../server/providers/types';
import { validatePreparedMediaSource } from './validate-prepared-source';

const SERIES_ID = '0e6b39aa-6564-4bbc-91f3-8f36ba808362';
const SEASON_NUMBER = 1;
const JOB_KEY = 'akwam-breaking-bad-s1-smoke';

function cleanTitles(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (typeof value === 'string') return [value];
    if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>;
      return [item.title, item.name].filter((x): x is string => typeof x === 'string');
    }
    return [];
  }).map((value) => value.trim()).filter(Boolean).slice(0, 20);
}

function normalizeSource(source: NormalizedPlaybackSource) {
  const url = String(source.url || '').trim();
  const quality = String(source.quality || '').trim().toLowerCase();
  const type = String(source.type || '').trim().toLowerCase();
  if (!/^https:\/\//i.test(url)) return null;
  if (!['mp4', 'hls', 'dash', 'webm', 'direct'].includes(type)) return null;
  if (!/^\d{3,4}p$/.test(quality)) return null;
  return {
    source_type: type,
    url,
    provider_reference: 'akwam',
    quality,
    language: source.language || 'und',
    label_ar: source.label || `Akwam ${quality}`,
    label_en: source.label || `Akwam ${quality}`,
    expires_at: source.expiresAt || null,
    is_working: true,
    last_checked_at: new Date().toISOString(),
    failure_count: 0,
  };
}

async function saveEpisode(episodeId: string, sources: NormalizedPlaybackSource[], providerId: string): Promise<number> {
  void episodeId;
  void providerId;
  const validated = [];
  for (const source of sources) {
    const normalized = normalizeSource(source);
    if (!normalized) continue;
    const checked = await validatePreparedMediaSource({
      provider: 'Akwam',
      providerReference: 'akwam',
      type: source.type,
      url: normalized.url,
      quality: normalized.quality,
      language: normalized.language,
      label: normalized.label_ar,
      referer: 'https://akwam.ss/',
    });
    if (checked) validated.push({ ...normalized, url: checked.url });
  }

  const deduped = [...new Map(validated.map((row) => [row.quality + '|' + row.source_type + '|' + row.url, row])).values()];
  if (!deduped.length) return 0;

  // Smoke-only validation: never persist Akwam URLs. Playback is resolved on demand.\n  return deduped.length;
}

async function writeState(values: Record<string, unknown>) {
  const { error } = await adminSupabase.from('maintenance_state').upsert({
    job_key: JOB_KEY,
    ...values,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'job_key' });
  if (error) throw error;
}

async function main() {
  const { data: provider, error: providerError } = await adminSupabase
    .from('providers')
    .select('id')
    .eq('key', 'arprov')
    .maybeSingle();
  if (providerError) throw providerError;
  if (!provider?.id) throw new Error('ArProv provider row not found');

  const { data: season, error: seasonError } = await adminSupabase
    .from('seasons')
    .select('id,season_number')
    .eq('series_id', SERIES_ID)
    .eq('season_number', SEASON_NUMBER)
    .maybeSingle();
  if (seasonError) throw seasonError;
  if (!season) throw new Error('Breaking Bad S01 not found');

  const { data: series, error: seriesError } = await adminSupabase
    .from('series')
    .select('tmdb_id,title_ar,title_en,original_title,alternative_titles,first_air_date')
    .eq('id', SERIES_ID)
    .maybeSingle();
  if (seriesError) throw seriesError;
  if (!series) throw new Error('Breaking Bad series not found');

  const { data: episodes, error: episodeError } = await adminSupabase
    .from('episodes')
    .select('id,episode_number,name_ar,name_en')
    .eq('season_id', season.id)
    .order('episode_number');
  if (episodeError) throw episodeError;

  await writeState({
    last_run_at: new Date().toISOString(),
    last_success_at: null,
    last_error: null,
    stats: { state: 'running', episodes: episodes?.length || 0 },
  });

  const results = [];
  for (const episode of episodes || []) {
    const context: ProviderContext = {
      tmdbId: Number(series.tmdb_id || 0) || undefined,
      title: series.title_ar || series.title_en || series.original_title || undefined,
      originalTitle: series.original_title || series.title_en || series.title_ar || undefined,
      alternateTitles: cleanTitles(series.alternative_titles),
      releaseYear: series.first_air_date ? Number(String(series.first_air_date).slice(0, 4)) : undefined,
      seasonNumber: SEASON_NUMBER,
      episodeNumber: Number(episode.episode_number),
      episodeTitle: episode.name_ar || episode.name_en || undefined,
    };

    try {
      const sources = await resolveAkwamPlayback(context, {});
      const saved = await saveEpisode(episode.id, sources, provider.id);
      let trace: Array<Record<string, unknown>> = [];
      if (!sources.length && episode.episode_number === 1) {
        const debugTrace = await debugAkwamEpisode(context, {});
        trace = debugTrace.slice(0, 30).map((item) => {
          const copy = { ...item };
          if (typeof copy.excerpt === 'string') copy.excerpt = copy.excerpt.slice(0, 1000);
          return copy;
        });

        const detailUrls = debugTrace
          .filter((item) => item.stage === 'detail' && typeof item.finalUrl === 'string')
          .map((item) => String(item.finalUrl))
          .slice(0, 5);

        for (const detailUrl of detailUrls) {
          const page = await fetchArProvPage(detailUrl, { timeoutMs: 10_000 });
          if (!page) continue;
          const anchors = [...page.body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
            .map((match) => ({
              href: match[1],
              text: String(match[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160),
            }))
            .filter((item) => /episode|watch|الحلقة|مشاهدة|play/i.test(item.href + ' ' + item.text))
            .slice(0, 80);

          trace.push({
            stage: 'anchor-inspection',
            url: page.url,
            matchingAnchors: anchors,
          });
        }
      }

      const result = {
        episode: episode.episode_number,
        title: episode.name_en || episode.name_ar,
        discovered: sources.length,
        rawSources: sources.map((source) => ({
          url: source.url,
          quality: source.quality,
          type: source.type,
          label: source.label,
        })).slice(0, 8),
        trace,
        saved,
      };
      results.push(result);
      console.log(JSON.stringify({ ok: saved > 0, ...result }));
    } catch (error) {
      let trace: Array<Record<string, unknown>> = [];
      if (episode.episode_number === 1) {
        trace = (await debugAkwamEpisode(context, {})).slice(0, 30).map((item) => {
          const copy = { ...item };
          if (typeof copy.excerpt === 'string') copy.excerpt = copy.excerpt.slice(0, 1000);
          return copy;
        });
      }

      const result = {
        episode: episode.episode_number,
        title: episode.name_en || episode.name_ar,
        discovered: 0,
        rawSources: [],
        trace,
        saved: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      console.error(JSON.stringify({ ok: false, ...result }));
    }
  }

  const preparedCount = results.filter((item) => item.saved > 0).length;
  const success = preparedCount === (episodes?.length || 0);

  await writeState({
    last_run_at: new Date().toISOString(),
    last_success_at: success ? new Date().toISOString() : null,
    last_error: success ? null : `Prepared ${preparedCount}/${episodes?.length || 0} Breaking Bad S01 episodes`,
    stats: { state: success ? 'success' : 'incomplete', preparedCount, total: episodes?.length || 0, results },
  });

  if (!success) process.exitCode = 2;
}

await main();

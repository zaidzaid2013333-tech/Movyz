import { adminSupabase } from './supabase';
import {
  resolveRe3ArabiProvider,
  resolveRe3ArabiProviderWithContext,
  resolveRe3ArabiSeriesContext,
} from './providers/re3arabi';

type MaintenanceJob = 'primary_sources' | 'secondary_sources' | 'repair_sources';
type ProviderRole = 'primary' | 'secondary';

type PlaybackSource = {
  url?: string;
  type?: string;
  quality?: string;
  language?: string;
  label?: string;
  labelEn?: string;
  providerKey?: string;
  providerReference?: string;
  expiresAt?: string;
};

const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const LEASE_MS = 4 * 60 * 1000;

const nowIso = () => new Date().toISOString();

function providerKeyFor(role: ProviderRole, isAnime: boolean) {
  return role === 'primary'
    ? (isAnime ? 'anime3rb' : 'aflaam')
    : (isAnime ? 'anime4up' : 'cimaclub');
}

function expiryFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    for (const key of ['expires', 'expires_at', 'exp']) {
      const raw = parsed.searchParams.get(key);
      if (!raw) continue;
      const numeric = Number(raw);
      const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      if (Number.isFinite(ms) && ms > Date.now()) return new Date(ms).toISOString();
    }
  } catch {}
  return new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
}

async function getProviderId() {
  const { data } = await adminSupabase
    .from('providers')
    .select('id')
    .eq('key', 're3arabi')
    .maybeSingle();
  return data?.id as string | undefined;
}

async function claim(jobKey: MaintenanceJob) {
  const now = new Date();
  const { data, error } = await adminSupabase
    .from('maintenance_state')
    .update({
      lease_until: new Date(now.getTime() + LEASE_MS).toISOString(),
      last_run_at: now.toISOString(),
      updated_at: now.toISOString(),
      last_error: null,
    })
    .eq('job_key', jobKey)
    .lt('lease_until', now.toISOString())
    .select('job_key')
    .maybeSingle();

  if (error) throw new Error('maintenance lease failed: ' + error.message);
  return Boolean(data?.job_key);
}

async function release(
  jobKey: MaintenanceJob,
  stats: Record<string, unknown>,
  errorMessage?: string,
) {
  const patch: Record<string, unknown> = {
    lease_until: new Date(0).toISOString(),
    last_error: errorMessage || null,
    stats,
    updated_at: nowIso(),
  };
  if (!errorMessage) patch.last_success_at = nowIso();

  await adminSupabase
    .from('maintenance_state')
    .update(patch)
    .eq('job_key', jobKey);
}

async function recordFailure(
  jobKey: MaintenanceJob,
  contentType: 'movie' | 'episode',
  contentId: string,
  error: unknown,
) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);

  const { data: previous } = await adminSupabase
    .from('maintenance_failures')
    .select('attempts')
    .eq('job_key', jobKey)
    .eq('content_type', contentType)
    .eq('content_id', contentId)
    .maybeSingle();

  await adminSupabase
    .from('maintenance_failures')
    .upsert({
      job_key: jobKey,
      content_type: contentType,
      content_id: contentId,
      failed_at: nowIso(),
      attempts: Number(previous?.attempts || 0) + 1,
      last_error: message,
    }, { onConflict: 'job_key,content_type,content_id' });
}

async function clearFailure(
  jobKey: MaintenanceJob,
  contentType: 'movie' | 'episode',
  contentId: string,
) {
  await adminSupabase
    .from('maintenance_failures')
    .delete()
    .eq('job_key', jobKey)
    .eq('content_type', contentType)
    .eq('content_id', contentId);
}

async function persistSources(
  contentType: 'movie' | 'episode',
  contentId: string,
  sources: PlaybackSource[],
  providerKey: string,
) {
  const providerId = await getProviderId();
  if (!providerId) return 0;

  const allowedTypes = new Set(['hls', 'mp4', 'dash', 'webm', 'direct']);
  const qualityScore = (value: unknown) => {
    const q = String(value || '').toLowerCase();
    if (/2160|4k|ultra/.test(q)) return 4000;
    if (/1440/.test(q)) return 3000;
    if (/1080|fhd/.test(q)) return 2000;
    if (/720|hd/.test(q)) return 1500;
    if (/480|sd/.test(q)) return 1000;
    return 500;
  };
  const typeScore = (value: unknown) => {
    switch (String(value || '').toLowerCase()) {
      case 'hls': return 40;
      case 'dash': return 35;
      case 'mp4': return 30;
      case 'webm': return 25;
      case 'direct': return 10;
      default: return 0;
    }
  };

  const rows = sources
    .filter((source) =>
      String(source.providerKey || source.providerReference || '').toLowerCase() === providerKey &&
      allowedTypes.has(String(source.type || '').toLowerCase()) &&
      /^https:\/\//i.test(String(source.url || '')) &&
      !/movyz-api\.sameranede\.workers\.dev/i.test(String(source.url || '')) &&
      !['auto', 'source'].includes(String(source.quality || '').toLowerCase()),
    )
    .filter((source, index, all) =>
      index === all.findIndex((candidate) => String(candidate.url) === String(source.url)),
    )
    .sort((a, b) =>
      (qualityScore(b.quality) + typeScore(b.type)) -
      (qualityScore(a.quality) + typeScore(a.type)),
    )
    .slice(0, 8)
    .map((source) => ({
      provider_id: providerId,
      content_type: contentType,
      content_id: contentId,
      source_type: String(source.type).toLowerCase(),
      url: String(source.url),
      provider_reference: providerKey,
      quality: String(source.quality || ''),
      language: String(source.language || 'ar'),
      label_ar: String(source.label || providerKey),
      label_en: String(source.labelEn || source.label || providerKey),
      expires_at: source.expiresAt || expiryFromUrl(String(source.url)),
      is_working: true,
      last_checked_at: nowIso(),
      failure_count: 0,
    }));

  if (!rows.length) return 0;

  const { error: deleteError } = await adminSupabase
    .from('playback_sources')
    .delete()
    .eq('provider_id', providerId)
    .eq('content_type', contentType)
    .eq('content_id', contentId)
    .eq('provider_reference', providerKey);

  if (deleteError) throw new Error('source cleanup failed: ' + deleteError.message);

  const { error } = await adminSupabase
    .from('playback_sources')
    .upsert(rows, { onConflict: 'provider_id,content_type,content_id,url' });

  if (error) throw new Error('source persistence failed: ' + error.message);
  return rows.length;
}

async function getFailedIds(jobKey: MaintenanceJob, contentType: 'movie' | 'episode', contentIds: string[]) {
  if (!contentIds.length) return new Set<string>();
  const cutoff = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
  const failed = new Set<string>();

  for (let i = 0; i < contentIds.length; i += 100) {
    const chunk = contentIds.slice(i, i + 100);
    const { data, error } = await adminSupabase
      .from('maintenance_failures')
      .select('content_id')
      .eq('job_key', jobKey)
      .eq('content_type', contentType)
      .gt('failed_at', cutoff)
      .in('content_id', chunk);

    if (error) throw new Error('failure lookup failed: ' + error.message);
    for (const row of data || []) failed.add(String(row.content_id));
  }

  return failed;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}

async function loadEpisodesForSeries(series: any, providerKey: string, jobKey: MaintenanceJob, limit: number) {
  const { data: seasons, error: seasonError } = await adminSupabase
    .from('seasons')
    .select('id,season_number')
    .eq('series_id', series.id)
    .order('season_number');

  if (seasonError || !seasons?.length) return [];

  const episodes: any[] = [];
  for (let i = 0; i < seasons.length; i += 50) {
    const chunk = seasons.slice(i, i + 50).map((row: any) => String(row.id));
    const { data, error } = await adminSupabase
      .from('episodes')
      .select('id,season_id,episode_number')
      .in('season_id', chunk)
      .order('episode_number');
    if (!error) episodes.push(...(data || []));
  }

  if (!episodes.length) return [];

  const providerId = await getProviderId();
  if (!providerId) return [];

  const ids = episodes.map((row) => String(row.id));
  const existing = new Set<string>();

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await adminSupabase
      .from('playback_sources')
      .select('content_id')
      .eq('provider_id', providerId)
      .eq('content_type', 'episode')
      .eq('provider_reference', providerKey)
      .in('content_id', chunk);
    if (!error) {
      for (const row of data || []) existing.add(String(row.content_id));
    }
  }

  const failedIds = await getFailedIds(jobKey, 'episode', ids);
  const seasonById = new Map(seasons.map((row: any) => [String(row.id), Number(row.season_number)]));

  return episodes
    .filter((row) => !existing.has(String(row.id)) && !failedIds.has(String(row.id)))
    .slice(0, limit)
    .map((row) => ({
      id: String(row.id),
      episode: Number(row.episode_number),
      season: Number(seasonById.get(String(row.season_id)) || 1),
      tmdbId: Number(series.tmdb_id),
      title: String(series.title_en || ''),
    }));
}

async function fillEpisodes(role: ProviderRole, limit: number, jobKey: MaintenanceJob) {
  const genericProvider = role === 'primary' ? 'aflaam' : 'cimaclub';
  const animeProvider = role === 'primary' ? 'anime3rb' : 'anime4up';

  const { data: seriesRows, error } = await adminSupabase
    .from('series')
    .select('id,tmdb_id,title_en')
    .eq('status', 'published')
    .not('tmdb_id', 'is', null)
    .order('id');

  if (error) throw new Error('series load failed: ' + error.message);

  const candidates: any[] = [];
  for (const series of seriesRows || []) {
    if (candidates.length >= limit) break;

    const generic = await loadEpisodesForSeries(series, genericProvider, jobKey, limit - candidates.length);
    if (generic.length) candidates.push(...generic);
  }

  let succeeded = 0;
  let failed = 0;

  await runWithConcurrency(candidates, 8, async (item) => {
    try {
      const context = await resolveRe3ArabiSeriesContext(item.tmdbId);
      const providerKey = providerKeyFor(role, context.__isAnime);
      const sources = await resolveRe3ArabiProviderWithContext(
        context,
        item.season,
        item.episode,
        providerKey,
      );

      if (!sources.length) {
        await recordFailure(jobKey, 'episode', item.id, 'No ' + providerKey + ' playback source');
        failed++;
        return;
      }

      const persisted = await persistSources('episode', item.id, sources as PlaybackSource[], providerKey);
      if (!persisted) {
        await recordFailure(jobKey, 'episode', item.id, 'No native ' + providerKey + ' source');
        failed++;
        return;
      }

      await clearFailure(jobKey, 'episode', item.id);
      succeeded++;
    } catch (error) {
      await recordFailure(jobKey, 'episode', item.id, error);
      failed++;
    }
  });

  return { requested: candidates.length, succeeded, failed };
}

async function fillMovies(role: ProviderRole, limit: number, jobKey: MaintenanceJob) {
  const { data: movies, error } = await adminSupabase
    .from('movies')
    .select('id,tmdb_id,title_en')
    .eq('status', 'published')
    .not('tmdb_id', 'is', null)
    .order('id')
    .limit(500);

  if (error) throw new Error('movie load failed: ' + error.message);

  const providerId = await getProviderId();
  if (!providerId) return { requested: 0, succeeded: 0, failed: 0 };

  const genericProvider = role === 'primary' ? 'aflaam' : 'cimaclub';
  const failures = await getFailedIds(jobKey, 'movie', (movies || []).map((row) => String(row.id)));
  const candidates: any[] = [];

  for (const movie of movies || []) {
    if (candidates.length >= limit || failures.has(String(movie.id))) continue;

    const { data: existing } = await adminSupabase
      .from('playback_sources')
      .select('content_id')
      .eq('provider_id', providerId)
      .eq('content_type', 'movie')
      .eq('provider_reference', genericProvider)
      .eq('content_id', movie.id)
      .limit(1);

    if (!existing?.length) candidates.push(movie);
  }

  let succeeded = 0;
  let failed = 0;

  await runWithConcurrency(candidates, 4, async (movie: any) => {
    try {
      const generic = await resolveRe3ArabiProvider({
        type: 'movie',
        tmdbId: Number(movie.tmdb_id),
      }, genericProvider).catch(() => []);

      const animeKey = role === 'primary' ? 'anime3rb' : 'anime4up';
      const anime = await resolveRe3ArabiProvider({
        type: 'movie',
        tmdbId: Number(movie.tmdb_id),
      }, animeKey).catch(() => []);

      const attempts = [
        [genericProvider, generic] as const,
        [animeKey, anime] as const,
      ].filter(([, sources]) => sources.length > 0);

      if (!attempts.length) {
        await recordFailure(jobKey, 'movie', String(movie.id), 'No playback source returned by any selected provider');
        failed++;
        return;
      }

      let persistedTotal = 0;
      for (const [providerKey, selected] of attempts) {
        try {
          persistedTotal += await persistSources(
            'movie',
            String(movie.id),
            selected as PlaybackSource[],
            providerKey,
          );
        } catch (error) {
          console.warn('[movyz-maintenance] movie provider persistence failed', {
            movieId: movie.id,
            providerKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (!persistedTotal) {
        await recordFailure(jobKey, 'movie', String(movie.id), 'No native playback source could be persisted');
        failed++;
        return;
      }

      await clearFailure(jobKey, 'movie', String(movie.id));
      succeeded++;
    } catch (error) {
      await recordFailure(jobKey, 'movie', String(movie.id), error);
      failed++;
    }
  });

  return { requested: candidates.length, succeeded, failed };
}

async function refreshExpiringSources(limit = 30) {
  const providerId = await getProviderId();
  if (!providerId) return { requested: 0, refreshed: 0, failed: 0 };

  const cutoff = new Date(Date.now() + 90 * 60 * 1000).toISOString();
  const { data: sources, error } = await adminSupabase
    .from('playback_sources')
    .select('id,content_type,content_id,provider_reference,expires_at,failure_count')
    .eq('provider_id', providerId)
    .or('expires_at.lte.' + cutoff + ',is_working.eq.false')
    .order('expires_at')
    .limit(limit);

  if (error) throw new Error('expiring source lookup failed: ' + error.message);

  let refreshed = 0;
  let failed = 0;

  for (const row of sources || []) {
    try {
      const providerKey = String(row.provider_reference || '').toLowerCase();

      if (row.content_type === 'movie') {
        const { data: movie } = await adminSupabase
          .from('movies')
          .select('id,tmdb_id')
          .eq('id', row.content_id)
          .maybeSingle();
        if (!movie?.tmdb_id) continue;

        const resolved = await resolveRe3ArabiProvider({
          type: 'movie',
          tmdbId: Number(movie.tmdb_id),
        }, providerKey);

        if (await persistSources('movie', String(movie.id), resolved as PlaybackSource[], providerKey)) {
          refreshed++;
        }
        continue;
      }

      const { data: episode } = await adminSupabase
        .from('episodes')
        .select('id,season_id,episode_number')
        .eq('id', row.content_id)
        .maybeSingle();
      if (!episode) continue;

      const { data: season } = await adminSupabase
        .from('seasons')
        .select('series_id,season_number')
        .eq('id', episode.season_id)
        .maybeSingle();
      if (!season) continue;

      const { data: series } = await adminSupabase
        .from('series')
        .select('tmdb_id')
        .eq('id', season.series_id)
        .maybeSingle();
      if (!series?.tmdb_id) continue;

      const context = await resolveRe3ArabiSeriesContext(Number(series.tmdb_id));
      const resolved = await resolveRe3ArabiProviderWithContext(
        context,
        Number(season.season_number),
        Number(episode.episode_number),
        providerKey,
      );

      if (await persistSources('episode', String(episode.id), resolved as PlaybackSource[], providerKey)) {
        refreshed++;
      }
    } catch (error) {
      failed++;
      await adminSupabase
        .from('playback_sources')
        .update({
          is_working: false,
          failure_count: Number(row.failure_count || 0) + 1,
          last_checked_at: nowIso(),
        })
        .eq('id', row.id);
    }
  }

  return { requested: (sources || []).length, refreshed, failed };
}

export async function runMaintenanceTick(jobKey: MaintenanceJob) {
  const acquired = await claim(jobKey);
  if (!acquired) return { skipped: true, jobKey };

  try {
    let stats: Record<string, unknown>;

    if (jobKey === 'primary_sources') {
      stats = {
        episodes: await fillEpisodes('primary', 80, jobKey),
        movies: await fillMovies('primary', 4, jobKey),
      };
    } else if (jobKey === 'secondary_sources') {
      stats = {
        episodes: await fillEpisodes('secondary', 30, jobKey),
        movies: await fillMovies('secondary', 2, jobKey),
      };
    } else {
      stats = { refresh: await refreshExpiringSources(40) };
    }

    await release(jobKey, stats);
    console.log('[movyz-maintenance]', jobKey, JSON.stringify(stats));
    return { skipped: false, jobKey, stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await release(jobKey, { error: message }, message).catch(() => undefined);
    console.error('[movyz-maintenance]', jobKey, message);
    return { skipped: false, jobKey, error: message };
  }
}

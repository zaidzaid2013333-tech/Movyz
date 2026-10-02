import { MiniApp, type NextFunction, type HttpRequest, type HttpResponse } from './mini-http';
import { z } from 'zod';
import { adminSupabase } from './supabase';
import { asyncRoute, created, fail, ok } from './http';
import { requireAdmin, requireAuth, requireOwner, type AuthenticatedRequest } from './auth';
import { getProvider } from './providers/registry';
import { runTmdbSync, syncEpisodesForSeries, syncMovieByTmdbId, syncSeriesByTmdbId } from './tmdb';
import { registerBuiltInProviders } from './providers/bootstrap';
import { resolveRe3ArabiPlayback } from './providers/re3arabi';
import { resolveDoodStreamPlayback } from './providers/dood';
import { resolveArProvPlayback } from './providers/arprov';

export const app = new MiniApp();
const api = '/api/v1';

registerBuiltInProviders();

app.disable('x-powered-by');

// Production diagnostics for the selected playback-sites path.
const MOVYZ_BUILD_ID = process.env.MOVYZ_BUILD_ID || 'unknown';

function cachedRe3ArabiSourceDto(source: any) {
  const providerReference = String(source.provider_reference || '').trim().toLowerCase();
  const allowedProviders = new Set(['aflaam', 'cimaclub', 'anime4up']);

  return {
    id: source.id,
    type: source.source_type,
    quality: source.quality || 'source',
    language: source.language || 'und',
    label: source.label_ar || source.providers?.name || 'Selected Playback Site',
    labelEn: source.label_en || source.providers?.name || 'Selected Playback Site',
    url: source.url || '',
    isWorking: source.is_working === true,
    provider: providerReference || source.providers?.name || 'Selected Playback Site',
    providerKey: allowedProviders.has(providerReference) ? providerReference : undefined,
    providerReference: allowedProviders.has(providerReference) ? providerReference : undefined,
  };
}

function playbackQualityScore(value: unknown) {
  const q = String(value || '').toLowerCase();
  if (/2160|4k|ultra/.test(q)) return 4000;
  if (/1440/.test(q)) return 3000;
  if (/1080|fhd/.test(q)) return 2000;
  if (/720|hd/.test(q)) return 1500;
  if (/576/.test(q)) return 1200;
  if (/480|sd/.test(q)) return 1000;
  if (/360/.test(q)) return 800;
  return 500;
}

function playbackTypeScore(value: unknown) {
  switch (String(value || '').toLowerCase()) {
    case 'hls': return 50;
    case 'dash': return 45;
    case 'mp4': return 40;
    case 'webm': return 35;
    case 'direct': return 25;
    default: return 0;
  }
}

async function getFreshRe3ArabiSourcesForContent(contentType: 'movie' | 'episode', contentId: string) {
  const { data, error } = await adminSupabase
    .from('playback_sources')
    .select('id,source_type,url,quality,language,label_ar,label_en,provider_reference,expires_at,is_working,providers!inner(key,name)')
    .eq('content_type', contentType)
    .eq('content_id', contentId)
    .eq('is_working', true)
    .eq('providers.key', 're3arabi')
    .order('quality', { ascending: true });

  if (error) {
    throw new Error('Unable to load ready cached playback sources: ' + error.message);
  }

  const allowedProviders = new Set(['aflaam', 'cimaclub', 'anime4up']);
  const allowedTypes = new Set(['mp4', 'hls', 'dash', 'webm', 'direct']);

  return (data || [])
    .filter((source: any) => allowedProviders.has(String(source.provider_reference || '').trim().toLowerCase()))
    .filter((source: any) => allowedTypes.has(String(source.source_type || '').trim().toLowerCase()))
    .filter((source: any) => /^https:\/\//i.test(String(source.url || '').trim()))
    .filter((source: any) => String(source.quality || '').trim().toLowerCase() !== 'auto')
        .map(cachedRe3ArabiSourceDto)
    .filter((source: any) => /^https:\/\//i.test(String(source.url || '').trim()))
    .sort((a: any, b: any) => {
      const qualityDiff = playbackQualityScore(b.quality) - playbackQualityScore(a.quality);
      if (qualityDiff) return qualityDiff;
      return playbackTypeScore(b.type) - playbackTypeScore(a.type);
    })
    .slice(0, 5);
}

app.use(async (req: HttpRequest, res: HttpResponse, next: NextFunction) => {
  const origin = req.headers.get('origin');
  const allow = (process.env.CORS_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (origin && (allow.length === 0 || allow.includes(origin))) res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-headers', 'Authorization, Content-Type');
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  if (req.method === 'OPTIONS') return res.status(204).send();
  return next();
});

const catalogQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  genreId: z.coerce.number().int().optional(),
  year: z.coerce.number().int().optional(),
  minRating: z.coerce.number().min(0).max(10).optional(),
  sortBy: z.enum(['popular', 'rating', 'newest']).default('popular'),
  search: z.string().trim().max(120).optional(),
});

const genreDto = (g: any) => ({
  id: g.id,
  name: g.name_ar,
  nameEn: g.name_en,
  slug: g.slug,
});

const movieCardDto = (row: any, genres: any[] = []) => ({
  id: row.id,
  tmdbId: Number(row.tmdb_id || 0),
  type: 'movie',
  title: row.title_ar,
  titleEn: row.title_en || row.title_ar,
  originalTitle: row.original_title || row.title_en || row.title_ar,
  year: row.release_date ? Number(String(row.release_date).slice(0, 4)) : 0,
  releaseDate: row.release_date || '',
  rating: Number(row.rating || 0),
  votesCount: Number(row.vote_count || 0),
  runtime: Number(row.runtime_minutes || 0),
  overview: row.overview_ar || '',
  overviewEn: row.overview_en || row.overview_ar || '',
  posterUrl: row.poster_url || '',
  backdropUrl: row.backdrop_url || '',
  genres,
  director: row.metadata?.director_ar || '',
  directorEn: row.metadata?.director_en || '',
  cast: [],
  sources: [],
  isFeatured: !!row.featured,
  isTrending: !!row.trending,
  isPopular: !!row.popular,
  addedAt: row.created_at,
  ageRating: row.age_rating || '',
});

const seriesCardDto = (row: any, genres: any[] = []) => ({
  id: row.id,
  tmdbId: Number(row.tmdb_id || 0),
  type: 'series',
  title: row.title_ar,
  titleEn: row.title_en || row.title_ar,
  originalTitle: row.original_title || row.title_en || row.title_ar,
  startYear: row.first_air_date ? Number(String(row.first_air_date).slice(0, 4)) : 0,
  endYear: row.last_air_date ? Number(String(row.last_air_date).slice(0, 4)) : undefined,
  releaseDate: row.first_air_date || '',
  rating: Number(row.rating || 0),
  votesCount: Number(row.vote_count || 0),
  overview: row.overview_ar || '',
  overviewEn: row.overview_en || row.overview_ar || '',
  posterUrl: row.poster_url || '',
  backdropUrl: row.backdrop_url || '',
  genres,
  creator: row.metadata?.creator_ar || '',
  creatorEn: row.metadata?.creator_en || '',
  cast: [],
  seasonsCount: 0,
  episodesCount: 0,
  seasons: [],
  isFeatured: !!row.featured,
  isTrending: !!row.trending,
  isPopular: !!row.popular,
  status: row.status,
  addedAt: row.created_at,
  ageRating: row.age_rating || '',
});

async function batchMovieGenres(ids: string[]) {
  if (!ids.length) return new Map<string, any[]>();
  const { data } = await adminSupabase
    .from('movie_genres')
    .select('movie_id,genres(id,name_ar,name_en,slug)')
    .in('movie_id', ids);
  const map = new Map<string, any[]>();
  for (const row of data || []) {
    const list = map.get(row.movie_id) || [];
    if (row.genres) list.push(genreDto(row.genres));
    map.set(row.movie_id, list);
  }
  return map;
}

async function batchSeriesGenres(ids: string[]) {
  if (!ids.length) return new Map<string, any[]>();
  const { data } = await adminSupabase
    .from('series_genres')
    .select('series_id,genres(id,name_ar,name_en,slug)')
    .in('series_id', ids);
  const map = new Map<string, any[]>();
  for (const row of data || []) {
    const list = map.get(row.series_id) || [];
    if (row.genres) list.push(genreDto(row.genres));
    map.set(row.series_id, list);
  }
  return map;
}

async function movieDto(row: any, includePlaybackSources = false) {
  const playbackPromise = includePlaybackSources
    ? getFreshRe3ArabiSourcesForContent('movie', row.id).catch((error) => {
        console.warn('[movie-playback-cache]', error instanceof Error ? error.message : String(error));
        return [];
      })
    : Promise.resolve([]);

  const [genres, cast, playbackSources] = await Promise.all([
    adminSupabase.from('movie_genres').select('genres(id,name_ar,name_en,slug)').eq('movie_id', row.id),
    adminSupabase.from('movie_cast').select('character_ar,character_en,people(id,name_ar,name_en,avatar_url)').eq('movie_id', row.id).order('cast_order'),
    playbackPromise,
  ]);
  return {
    id: row.id, tmdbId: Number(row.tmdb_id || 0), type: 'movie',
    title: row.title_ar, titleEn: row.title_en || row.title_ar,
    originalTitle: row.original_title || row.title_en || row.title_ar,
    year: row.release_date ? Number(String(row.release_date).slice(0, 4)) : 0,
    releaseDate: row.release_date || '',
    rating: Number(row.rating || 0), votesCount: Number(row.vote_count || 0),
    runtime: Number(row.runtime_minutes || 0),
    overview: row.overview_ar || '', overviewEn: row.overview_en || row.overview_ar || '',
    posterUrl: row.poster_url || '', backdropUrl: row.backdrop_url || '',
    genres: (genres.data || []).map((x: any) => genreDto(x.genres)),
    director: row.metadata?.director_ar || '', directorEn: row.metadata?.director_en || '',
    cast: (cast.data || []).map((x: any) => ({
      id: x.people.id, name: x.people.name_ar || x.people.name_en,
      nameEn: x.people.name_en || x.people.name_ar,
      character: x.character_ar || '', characterEn: x.character_en || '',
      avatarUrl: x.people.avatar_url || '',
    })),
    sources: playbackSources,
    isFeatured: !!row.featured, isTrending: !!row.trending, isPopular: !!row.popular,
    addedAt: row.created_at, ageRating: row.age_rating || '',
  } as any;
}

async function seriesDto(row: any, includePlaybackSources = false) {
  const [genres, cast, seasons] = await Promise.all([
    adminSupabase.from('series_genres').select('genres(id,name_ar,name_en,slug)').eq('series_id', row.id),
    adminSupabase.from('series_cast').select('character_ar,character_en,people(id,name_ar,name_en,avatar_url)').eq('series_id', row.id).order('cast_order'),
    adminSupabase.from('seasons').select('*').eq('series_id', row.id).order('season_number'),
  ]);

  const seasonRows = seasons.data || [];
  const ids = seasonRows.map((x: any) => x.id);
  const episodes = ids.length
    ? await adminSupabase.from('episodes').select('*').in('season_id', ids).order('episode_number')
    : { data: [] as any[] };

  const episodeRows = episodes.data || [];
  const episodeIds = episodeRows.map((episode: any) => episode.id);
  const playbackByEpisode = new Map<string, any[]>();

  if (includePlaybackSources && episodeIds.length) {
    const { data: playbackRows, error: playbackError } = await adminSupabase
      .from('playback_sources')
      .select('id,content_id,source_type,url,quality,language,label_ar,label_en,provider_reference,expires_at,is_working,providers!inner(key,name)')
      .eq('content_type', 'episode')
      .in('content_id', episodeIds)
      .eq('is_working', true)
      .eq('providers.key', 're3arabi')
      .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
      .order('quality', { ascending: true });

    if (playbackError) {
      console.warn('[series-playback-cache]', playbackError.message);
    } else {
      for (const source of playbackRows || []) {
        const episodeId = String(source.content_id || '');
        if (!episodeId) continue;
        const list = playbackByEpisode.get(episodeId) || [];
        const providerReference = String(source.provider_reference || '').trim().toLowerCase();
        if (!['aflaam', 'cimaclub', 'anime4up'].includes(providerReference)) continue;
        const mapped = cachedRe3ArabiSourceDto(source);
        if (mapped.url && mapped.providerKey) list.push(mapped);
        playbackByEpisode.set(episodeId, list);
      }
    }
  }

  const seasonDtos = seasonRows.map((s: any) => ({
    id: s.id, seriesId: row.id, seasonNumber: s.season_number,
    name: s.name_ar || s.name_en || `الموسم ${s.season_number}`,
    nameEn: s.name_en || s.name_ar || `Season ${s.season_number}`,
    posterUrl: s.poster_url || '', overview: s.overview_ar || '',
    airDate: s.air_date || '', episodesCount: (episodes.data || []).filter((e: any) => e.season_id === s.id).length,
    episodes: (episodes.data || []).filter((e: any) => e.season_id === s.id).map((e: any) => ({
      id: e.id, seriesId: row.id, tmdbId: Number(e.tmdb_id || 0), seasonNumber: s.season_number, episodeNumber: e.episode_number,
      title: e.name_ar || e.name_en || `الحلقة ${e.episode_number}`,
      titleEn: e.name_en || e.name_ar || `Episode ${e.episode_number}`,
      overview: e.overview_ar || '', overviewEn: e.overview_en || e.overview_ar || '',
      stillUrl: e.still_url || '', duration: Number(e.runtime_minutes || 0), airDate: e.air_date || '',
      sources: includePlaybackSources ? (playbackByEpisode.get(e.id) || []) : [],
    })),
  }));

  return {
    id: row.id, tmdbId: Number(row.tmdb_id || 0), type: 'series',
    title: row.title_ar, titleEn: row.title_en || row.title_ar,
    originalTitle: row.original_title || row.title_en || row.title_ar,
    startYear: row.first_air_date ? Number(String(row.first_air_date).slice(0, 4)) : 0,
    endYear: row.last_air_date ? Number(String(row.last_air_date).slice(0, 4)) : undefined,
    releaseDate: row.first_air_date || '',
    rating: Number(row.rating || 0), votesCount: Number(row.vote_count || 0),
    overview: row.overview_ar || '', overviewEn: row.overview_en || row.overview_ar || '',
    posterUrl: row.poster_url || '', backdropUrl: row.backdrop_url || '',
    genres: (genres.data || []).map((x: any) => genreDto(x.genres)),
    creator: row.metadata?.creator_ar || '', creatorEn: row.metadata?.creator_en || '',
    cast: (cast.data || []).map((x: any) => ({
      id: x.people.id, name: x.people.name_ar || x.people.name_en,
      nameEn: x.people.name_en || x.people.name_ar,
      character: x.character_ar || '', characterEn: x.character_en || '',
      avatarUrl: x.people.avatar_url || '',
    })),
    seasonsCount: seasonDtos.length,
    episodesCount: seasonDtos.reduce((sum: number, s: any) => sum + s.episodes.length, 0),
    seasons: seasonDtos, isFeatured: !!row.featured, isTrending: !!row.trending, isPopular: !!row.popular,
    status: row.status, addedAt: row.created_at, ageRating: row.age_rating || '',
  } as any;
}

async function seriesWatchDto(row: any, seasonNumber: number) {
  const [genres, cast, seasonResult] = await Promise.all([
    adminSupabase.from('series_genres').select('genres(id,name_ar,name_en,slug)').eq('series_id', row.id),
    adminSupabase.from('series_cast').select('character_ar,character_en,people(id,name_ar,name_en,avatar_url)').eq('series_id', row.id).order('cast_order'),
    adminSupabase.from('seasons').select('*').eq('series_id', row.id).eq('season_number', seasonNumber).maybeSingle(),
  ]);

  if (seasonResult.error || !seasonResult.data) return null;
  const season = seasonResult.data;
  const { data: episodes, error: episodesError } = await adminSupabase
    .from('episodes').select('*').eq('season_id', season.id).order('episode_number');
  if (episodesError) throw new Error('Unable to load season episodes: ' + episodesError.message);

  const episodeIds = (episodes || []).map((episode: any) => String(episode.id));
  const playbackByEpisode = new Map<string, any[]>();

  if (episodeIds.length) {
    const { data: playbackRows, error: playbackError } = await adminSupabase
      .from('playback_sources')
      .select('id,content_id,source_type,url,quality,language,label_ar,label_en,provider_reference,expires_at,is_working,providers!inner(key,name)')
      .eq('content_type', 'episode')
      .in('content_id', episodeIds)
      .eq('is_working', true)
      .eq('providers.key', 're3arabi')
      .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
      .order('quality', { ascending: true });

    if (playbackError) {
      console.warn('[series-watch-playback-cache]', playbackError.message);
    } else {
      for (const source of playbackRows || []) {
        const providerReference = String(source.provider_reference || '').trim().toLowerCase();
        if (!['aflaam', 'cimaclub', 'anime4up'].includes(providerReference)) continue;
        const mapped = cachedRe3ArabiSourceDto(source);
        if (!mapped.url || !mapped.providerKey) continue;
        const episodeId = String(source.content_id || '');
        const list = playbackByEpisode.get(episodeId) || [];
        list.push(mapped);
        playbackByEpisode.set(episodeId, list);
      }
    }
  }

  const seasonDto = {
    id: season.id, seriesId: row.id, seasonNumber: season.season_number,
    name: season.name_ar || season.name_en || ('الموسم ' + season.season_number),
    nameEn: season.name_en || season.name_ar || ('Season ' + season.season_number),
    posterUrl: season.poster_url || '', overview: season.overview_ar || '',
    airDate: season.air_date || '', episodesCount: (episodes || []).length,
    episodes: (episodes || []).map((e: any) => ({
      id: e.id, seriesId: row.id, tmdbId: Number(e.tmdb_id || 0),
      seasonNumber: season.season_number, episodeNumber: e.episode_number,
      title: e.name_ar || e.name_en || ('الحلقة ' + e.episode_number),
      titleEn: e.name_en || e.name_ar || ('Episode ' + e.episode_number),
      overview: e.overview_ar || '', overviewEn: e.overview_en || e.overview_ar || '',
      stillUrl: e.still_url || '', duration: Number(e.runtime_minutes || 0),
      airDate: e.air_date || '',
      sources: playbackByEpisode.get(String(e.id)) || [],
    })),
  };

  return {
    id: row.id, tmdbId: Number(row.tmdb_id || 0), type: 'series',
    title: row.title_ar, titleEn: row.title_en || row.title_ar,
    originalTitle: row.original_title || row.title_en || row.title_ar,
    startYear: row.first_air_date ? Number(String(row.first_air_date).slice(0, 4)) : 0,
    endYear: row.last_air_date ? Number(String(row.last_air_date).slice(0, 4)) : undefined,
    releaseDate: row.first_air_date || '', rating: Number(row.rating || 0),
    votesCount: Number(row.vote_count || 0), overview: row.overview_ar || '',
    overviewEn: row.overview_en || row.overview_ar || '',
    posterUrl: row.poster_url || '', backdropUrl: row.backdrop_url || '',
    genres: (genres.data || []).map((x: any) => genreDto(x.genres)),
    creator: row.metadata?.creator_ar || '', creatorEn: row.metadata?.creator_en || '',
    cast: (cast.data || []).map((x: any) => ({
      id: x.people.id, name: x.people.name_ar || x.people.name_en,
      nameEn: x.people.name_en || x.people.name_ar, character: x.character_ar || '',
      characterEn: x.character_en || '', avatarUrl: x.people.avatar_url || '',
    })),
    seasonsCount: 1, episodesCount: seasonDto.episodesCount, seasons: [seasonDto],
    isFeatured: !!row.featured, isTrending: !!row.trending, isPopular: !!row.popular,
    status: row.status, addedAt: row.created_at, ageRating: row.age_rating || '',
  };
}

app.get(`${api}/subtitles/proxy`, asyncRoute(async (req, res) => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  let target: URL;

  try {
    target = new URL(rawUrl);
  } catch {
    return fail(res, 400, 'INVALID_SUBTITLE_URL', 'Invalid subtitle URL');
  }

  if (
    target.protocol !== 'https:' ||
    target.hostname !== 'commons.wikimedia.org' ||
    target.pathname !== '/w/api.php' ||
    target.searchParams.get('action') !== 'timedtext'
  ) {
    return fail(res, 403, 'SUBTITLE_URL_NOT_ALLOWED', 'Subtitle URL is not allowed');
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        Accept: 'text/vtt, text/plain;q=0.9, */*;q=0.8',
        'Accept-Language': 'ar,en;q=0.8',
        'User-Agent': 'MOVYZA/1.0 (subtitle proxy; https://movyza.app)',
      },
      redirect: 'follow',
    });

    if (!upstream.ok) {
      const upstreamBody = (await upstream.text()).slice(0, 1200);
      console.error('[subtitle-proxy-upstream]', upstream.status, upstreamBody);
      return fail(res, 502, 'SUBTITLE_FETCH_FAILED', `Wikimedia subtitle request failed (${upstream.status})`);
    }

    const body = (await upstream.text()).replace(/^\uFEFF/, '').trim();
    const isWebVtt = /^WEBVTT(?:\s|$)/i.test(body);
    const hasSrtCue = /(?:^|\n)\s*\d+\s*\n\s*\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(body);

    if (!body || (!isWebVtt && !hasSrtCue)) {
      return fail(res, 502, 'SUBTITLE_FORMAT_INVALID', 'Wikimedia returned an invalid timed-text payload');
    }

    const vttBody = isWebVtt
      ? body
      : `WEBVTT\n\n${body.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}\n`;

    const responseHeaders = new Headers({
      'content-type': 'text/vtt; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    });

    return new Response(vttBody, { status: 200, headers: responseHeaders });
  } catch (error) {
    console.error('[subtitle-proxy]', error instanceof Error ? error.message : error);
    return fail(res, 502, 'SUBTITLE_PROXY_FAILED', 'Subtitle proxy failed');
  }
}));

app.get('/health', asyncRoute(async (_req, res) => {
  const { error } = await adminSupabase.from('genres').select('id').limit(1);
  if (error) return fail(res, 503, 'DATABASE_UNAVAILABLE', 'Database check failed');
  return ok(res, { status: 'ok', service: 'movyz-api', timestamp: new Date().toISOString() });
}));

app.get(`${api}/genres`, asyncRoute(async (_req, res) => {
  const { data, error } = await adminSupabase.from('genres').select('id,name_ar,name_en,slug').order('id');
  if (error) return fail(res, 500, 'GENRES_QUERY_FAILED', 'Unable to load genres');
  return ok(res, (data || []).map(genreDto));
}));

app.get(`${api}/movies`, asyncRoute(async (req, res) => {
  const p = catalogQuery.safeParse(req.query);
  if (!p.success) return fail(res, 400, 'INVALID_QUERY', 'Invalid catalog parameters');
  const q = p.data;
  const from = (q.page - 1) * q.limit;
  const to = from + q.limit - 1;
  let query = adminSupabase.from('movies').select('*', { count: 'exact' }).eq('status', 'published');
  if (q.year) query = query.gte('release_date', `${q.year}-01-01`).lt('release_date', `${q.year + 1}-01-01`);
  if (q.minRating !== undefined) query = query.gte('rating', q.minRating);
  if (q.search) query = query.or(`title_ar.ilike.%${q.search}%,title_en.ilike.%${q.search}%,original_title.ilike.%${q.search}%`);
  if (q.genreId) {
    const { data } = await adminSupabase.from('movie_genres').select('movie_id').eq('genre_id', q.genreId);
    query = query.in('id', (data || []).map((x: any) => x.movie_id));
  }
  query = q.sortBy === 'rating' ? query.order('rating', { ascending: false })
    : q.sortBy === 'newest' ? query.order('release_date', { ascending: false })
    : query.order('vote_count', { ascending: false });
  const { data, count, error } = await query.range(from, to);
  if (error) return fail(res, 500, 'MOVIES_QUERY_FAILED', 'Unable to load movies');
  const rows = data || [];
  const genreMap = await batchMovieGenres(rows.map((row: any) => row.id));
  const output = rows.map((row: any) => movieCardDto(row, genreMap.get(row.id) || []));
  return ok(res, output, { page: q.page, limit: q.limit, total: count || 0, totalPages: Math.ceil((count || 0) / q.limit) || 1 });
}));

app.get(`${api}/movies/tmdb/:tmdbId`, asyncRoute(async (req, res) => {
  const tmdbId = Number(req.params.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return fail(res, 400, 'INVALID_TMDB_ID', 'Invalid TMDB id');

  let { data, error } = await adminSupabase
    .from('movies')
    .select('*')
    .eq('tmdb_id', tmdbId)
    .eq('status', 'published')
    .maybeSingle();

  if (error) return fail(res, 500, 'MOVIE_QUERY_FAILED', 'Unable to load movie');

  if (!data) {
    try {
      await syncMovieByTmdbId(tmdbId);
      const refreshed = await adminSupabase
        .from('movies')
        .select('*')
        .eq('tmdb_id', tmdbId)
        .eq('status', 'published')
        .maybeSingle();
      data = refreshed.data;
      error = refreshed.error;
    } catch (syncError) {
      console.warn('[auto-import-movie]', syncError instanceof Error ? syncError.message : String(syncError));
    }
  }

  if (error || !data) return fail(res, 404, 'MOVIE_NOT_FOUND', 'Movie not found');
  const movie = await movieDto(data, true);
  return ok(res, { movie, similar: [] });
}));

app.get(`${api}/movies/:id`, asyncRoute(async (req, res) => {
  const { data, error } = await adminSupabase.from('movies').select('*').eq('id', req.params.id).eq('status', 'published').maybeSingle();
  if (error || !data) return fail(res, 404, 'MOVIE_NOT_FOUND', 'Movie not found');
  const movie = await movieDto(data, true);
  return ok(res, { movie, similar: [] });
}));

app.get(`${api}/series`, asyncRoute(async (req, res) => {
  const p = catalogQuery.safeParse(req.query);
  if (!p.success) return fail(res, 400, 'INVALID_QUERY', 'Invalid catalog parameters');
  const q = p.data;
  const from = (q.page - 1) * q.limit;
  const to = from + q.limit - 1;
  let query = adminSupabase.from('series').select('*', { count: 'exact' }).eq('status', 'published');
  if (q.year) query = query.gte('first_air_date', `${q.year}-01-01`).lt('first_air_date', `${q.year + 1}-01-01`);
  if (q.minRating !== undefined) query = query.gte('rating', q.minRating);
  if (q.search) query = query.or(`title_ar.ilike.%${q.search}%,title_en.ilike.%${q.search}%,original_title.ilike.%${q.search}%`);
  if (q.genreId) {
    const { data } = await adminSupabase.from('series_genres').select('series_id').eq('genre_id', q.genreId);
    query = query.in('id', (data || []).map((x: any) => x.series_id));
  }
  query = q.sortBy === 'rating' ? query.order('rating', { ascending: false })
    : q.sortBy === 'newest' ? query.order('first_air_date', { ascending: false })
    : query.order('vote_count', { ascending: false });
  const { data, count, error } = await query.range(from, to);
  if (error) return fail(res, 500, 'SERIES_QUERY_FAILED', 'Unable to load series');
  const rows = data || [];
  const genreMap = await batchSeriesGenres(rows.map((row: any) => row.id));
  const output = rows.map((row: any) => seriesCardDto(row, genreMap.get(row.id) || []));
  return ok(res, output, { page: q.page, limit: q.limit, total: count || 0, totalPages: Math.ceil((count || 0) / q.limit) || 1 });
}));

app.get(`${api}/series/tmdb/:tmdbId/watch/:season/:episode`, asyncRoute(async (req, res) => {
  const tmdbId = Number(req.params.tmdbId);
  const seasonNumber = Number(req.params.season);
  const episodeNumber = Number(req.params.episode);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
    return fail(res, 400, 'INVALID_WATCH_REQUEST', 'Invalid series watch request');
  }
  const { data, error } = await adminSupabase.from('series').select('*')
    .eq('tmdb_id', tmdbId).eq('status', 'published').maybeSingle();
  if (error) return fail(res, 500, 'SERIES_QUERY_FAILED', 'Unable to load series');
  if (!data) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
  const series = await seriesWatchDto(data, seasonNumber);
  if (!series) return fail(res, 404, 'SEASON_NOT_FOUND', 'Season not found');
  if (!series.seasons[0].episodes.some((item: any) => item.episodeNumber === episodeNumber)) {
    return fail(res, 404, 'EPISODE_NOT_FOUND', 'Episode not found');
  }
  res.setHeader('Cache-Control', 'public, max-age=20, s-maxage=60, stale-while-revalidate=120');
  return ok(res, { series, currentSeason: series.seasons[0] });
}));

app.get(`${api}/series/:id/watch/:season/:episode`, asyncRoute(async (req, res) => {
  const seasonNumber = Number(req.params.season);
  const episodeNumber = Number(req.params.episode);
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
    return fail(res, 400, 'INVALID_WATCH_REQUEST', 'Invalid series watch request');
  }
  const { data, error } = await adminSupabase.from('series').select('*')
    .eq('id', req.params.id).eq('status', 'published').maybeSingle();
  if (error) return fail(res, 500, 'SERIES_QUERY_FAILED', 'Unable to load series');
  if (!data) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
  const series = await seriesWatchDto(data, seasonNumber);
  if (!series) return fail(res, 404, 'SEASON_NOT_FOUND', 'Season not found');
  if (!series.seasons[0].episodes.some((item: any) => item.episodeNumber === episodeNumber)) {
    return fail(res, 404, 'EPISODE_NOT_FOUND', 'Episode not found');
  }
  res.setHeader('Cache-Control', 'public, max-age=20, s-maxage=60, stale-while-revalidate=120');
  return ok(res, { series, currentSeason: series.seasons[0] });
}));

app.get(`${api}/series/tmdb/:tmdbId`, asyncRoute(async (req, res) => {
  const tmdbId = Number(req.params.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return fail(res, 400, 'INVALID_TMDB_ID', 'Invalid TMDB id');

  let { data, error } = await adminSupabase
    .from('series')
    .select('*')
    .eq('tmdb_id', tmdbId)
    .eq('status', 'published')
    .maybeSingle();

  if (error) return fail(res, 500, 'SERIES_QUERY_FAILED', 'Unable to load series');

  if (!data) {
    try {
      await syncSeriesByTmdbId(tmdbId);
      const refreshed = await adminSupabase
        .from('series')
        .select('*')
        .eq('tmdb_id', tmdbId)
        .eq('status', 'published')
        .maybeSingle();
      data = refreshed.data;
      error = refreshed.error;
    } catch (syncError) {
      console.warn('[auto-import-series]', syncError instanceof Error ? syncError.message : String(syncError));
    }
  }

  if (error || !data) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
  const series = await seriesDto(data, false);
  return ok(res, { series, similar: [] });
}));

app.get(`${api}/series/:id`, asyncRoute(async (req, res) => {
  const { data, error } = await adminSupabase.from('series').select('*').eq('id', req.params.id).eq('status', 'published').maybeSingle();
  if (error || !data) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
  const series = await seriesDto(data);
  return ok(res, { series, similar: [] });
}));

app.get(`${api}/series/:id/seasons`, asyncRoute(async (req, res) => {
  const { data: series, error: seriesError } = await adminSupabase
    .from('series').select('id').eq('id', req.params.id).eq('status', 'published').maybeSingle();
  if (seriesError || !series) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');

  const { data: seasons, error } = await adminSupabase
    .from('seasons').select('*').eq('series_id', req.params.id).order('season_number');
  if (error) return fail(res, 500, 'SEASONS_QUERY_FAILED', 'Unable to load seasons');

  const seasonRows = seasons || [];
  const seasonIds = seasonRows.map((season: any) => season.id);
  const { data: episodeRows } = seasonIds.length
    ? await adminSupabase.from('episodes').select('season_id').in('season_id', seasonIds)
    : { data: [] as any[] };
  const counts = new Map<string, number>();
  for (const episode of episodeRows || []) counts.set(episode.season_id, (counts.get(episode.season_id) || 0) + 1);

  return ok(res, seasonRows.map((season: any) => ({
    id: season.id, seriesId: season.series_id, tmdbId: season.tmdb_id, seasonNumber: season.season_number,
    name: season.name_ar || season.name_en || `الموسم ${season.season_number}`,
    nameEn: season.name_en || season.name_ar || `Season ${season.season_number}`,
    overview: season.overview_ar || '', overviewEn: season.overview_en || season.overview_ar || '',
    posterUrl: season.poster_url || '', airDate: season.air_date || '',
    episodesCount: counts.get(season.id) || 0,
  })));
}));

app.get(`${api}/seasons/:id`, asyncRoute(async (req, res) => {
  const { data: season, error } = await adminSupabase.from('seasons').select('*').eq('id', req.params.id).maybeSingle();
  if (error || !season) return fail(res, 404, 'SEASON_NOT_FOUND', 'Season not found');
  const { data: series } = await adminSupabase.from('series').select('id,title_ar,title_en,original_title,poster_url').eq('id', season.series_id).eq('status', 'published').maybeSingle();
  if (!series) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
  const { data: episodes, error: episodeError } = await adminSupabase.from('episodes').select('*').eq('season_id', season.id).order('episode_number');
  if (episodeError) return fail(res, 500, 'EPISODES_QUERY_FAILED', 'Unable to load episodes');
  return ok(res, {
    season: { id: season.id, seriesId: season.series_id, tmdbId: season.tmdb_id, seasonNumber: season.season_number,
      name: season.name_ar || season.name_en || `الموسم ${season.season_number}`, nameEn: season.name_en || season.name_ar || `Season ${season.season_number}`,
      overview: season.overview_ar || '', overviewEn: season.overview_en || season.overview_ar || '', posterUrl: season.poster_url || '', airDate: season.air_date || '',
      episodesCount: (episodes || []).length },
    series: { id: series.id, title: series.title_ar, titleEn: series.title_en || series.title_ar, originalTitle: series.original_title || series.title_en || series.title_ar, posterUrl: series.poster_url || '' },
    episodes: (episodes || []).map((episode: any) => ({
      id: episode.id, seriesId: series.id, seasonId: season.id, seasonNumber: season.season_number, tmdbId: episode.tmdb_id, episodeNumber: episode.episode_number,
      title: episode.name_ar || episode.name_en || `الحلقة ${episode.episode_number}`, titleEn: episode.name_en || episode.name_ar || `Episode ${episode.episode_number}`,
      overview: episode.overview_ar || '', overviewEn: episode.overview_en || episode.overview_ar || '', stillUrl: episode.still_url || '',
      duration: Number(episode.runtime_minutes || 0), airDate: episode.air_date || '',
    })),
  });
}));

app.get(`${api}/episodes/:id`, asyncRoute(async (req, res) => {
  const { data: episode, error } = await adminSupabase.from('episodes').select('*').eq('id', req.params.id).maybeSingle();
  if (error || !episode) return fail(res, 404, 'EPISODE_NOT_FOUND', 'Episode not found');
  const { data: season } = await adminSupabase.from('seasons').select('id,series_id,season_number,name_ar,name_en').eq('id', episode.season_id).maybeSingle();
  if (!season) return fail(res, 404, 'SEASON_NOT_FOUND', 'Season not found');
  const { data: series } = await adminSupabase.from('series').select('id,title_ar,title_en,original_title,poster_url,backdrop_url').eq('id', season.series_id).eq('status', 'published').maybeSingle();
  if (!series) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
  return ok(res, {
    id: episode.id, seriesId: series.id, seasonId: season.id, seasonNumber: season.season_number, tmdbId: episode.tmdb_id, episodeNumber: episode.episode_number,
    title: episode.name_ar || episode.name_en || `الحلقة ${episode.episode_number}`, titleEn: episode.name_en || episode.name_ar || `Episode ${episode.episode_number}`,
    overview: episode.overview_ar || '', overviewEn: episode.overview_en || episode.overview_ar || '', stillUrl: episode.still_url || '',
    duration: Number(episode.runtime_minutes || 0), airDate: episode.air_date || '',
    series: { id: series.id, title: series.title_ar, titleEn: series.title_en || series.title_ar, originalTitle: series.original_title || series.title_en || series.title_ar, posterUrl: series.poster_url || '', backdropUrl: series.backdrop_url || '' },
    season: { id: season.id, seasonNumber: season.season_number, name: season.name_ar || season.name_en || `الموسم ${season.season_number}`, nameEn: season.name_en || season.name_ar || `Season ${season.season_number}` },
  });
}));

app.post(`${api}/playback/resolve`, asyncRoute(async (req, res) => {
  const body = z.object({
    contentType: z.enum(['movie', 'episode']),
    contentId: z.string().uuid(),
  }).safeParse(req.body);

  if (!body.success) {
    return fail(res, 400, 'INVALID_PLAYBACK_REQUEST', 'Invalid playback request');
  }

  let sources: any[] = [];

  if (body.data.contentType === 'movie') {
    const { data, error } = await adminSupabase
      .from('movies')
      .select('tmdb_id,status,title_ar,title_en,original_title')
      .eq('id', body.data.contentId)
      .maybeSingle();

    if (error || !data || data.status !== 'published' || !data.tmdb_id) {
      return fail(res, 404, 'MOVIE_NOT_FOUND', 'Movie not found');
    }

    try {
      sources = await resolveArProvPlayback({
        tmdbId: Number(data.tmdb_id),
        title: data.title_en || data.title_ar || data.original_title || undefined,
        originalTitle: data.original_title || data.title_en || data.title_ar || undefined,
      });
    } catch (error) {
      console.warn('[arprov-movie]', error instanceof Error ? error.message : String(error));
      sources = [];
    }

    if (!sources.length) {
      try {
        sources = await resolveDoodStreamPlayback({
          tmdbId: Number(data.tmdb_id),
          title: data.title_en || data.title_ar || data.original_title || undefined,
          originalTitle: data.original_title || data.title_en || data.title_ar || undefined,
        });
      } catch (error) {
        console.warn('[doodstream-movie]', error instanceof Error ? error.message : String(error));
        sources = [];
      }
    }

    if (!sources.length) {
      try {
        sources = await resolveRe3ArabiPlayback({
          type: 'movie',
          tmdbId: Number(data.tmdb_id),
        });
      } catch (error) {
        console.warn('[re3arabi-movie]', error instanceof Error ? error.message : String(error));
        sources = [];
      }
    }
  } else {
    const { data: episode, error: episodeError } = await adminSupabase
      .from('episodes')
      .select('id,episode_number,season_id')
      .eq('id', body.data.contentId)
      .maybeSingle();

    if (episodeError || !episode || !episode.season_id || !episode.episode_number) {
      return fail(res, 404, 'EPISODE_NOT_FOUND', 'Episode not found');
    }

    const { data: season, error: seasonError } = await adminSupabase
      .from('seasons')
      .select('season_number,series_id')
      .eq('id', episode.season_id)
      .maybeSingle();

    if (seasonError || !season || !season.series_id || !season.season_number) {
      return fail(res, 404, 'SEASON_NOT_FOUND', 'Season not found');
    }

    const { data: series, error: seriesError } = await adminSupabase
      .from('series')
      .select('tmdb_id,status,title_ar,title_en,original_title')
      .eq('id', season.series_id)
      .maybeSingle();

    if (
      seriesError ||
      !series ||
      series.status !== 'published' ||
      !series.tmdb_id
    ) {
      return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
    }

    try {
      sources = await resolveArProvPlayback({
        tmdbId: Number(series.tmdb_id),
        title: series.title_en || series.title_ar || series.original_title || undefined,
        originalTitle: series.original_title || series.title_en || series.title_ar || undefined,
        seasonNumber: Number(season.season_number),
        episodeNumber: Number(episode.episode_number),
      });
    } catch (error) {
      console.warn('[arprov-episode]', error instanceof Error ? error.message : String(error));
      sources = [];
    }

    if (!sources.length) {
      try {
        sources = await resolveDoodStreamPlayback({
          tmdbId: Number(series.tmdb_id),
          title: series.title_en || series.title_ar || series.original_title || undefined,
          originalTitle: series.original_title || series.title_en || series.title_ar || undefined,
          seasonNumber: Number(season.season_number),
          episodeNumber: Number(episode.episode_number),
        });
      } catch (error) {
        console.warn('[doodstream-episode]', error instanceof Error ? error.message : String(error));
        sources = [];
      }
    }

    if (!sources.length) {
      try {
        sources = await resolveRe3ArabiPlayback({
          type: 'series',
          tmdbId: Number(series.tmdb_id),
          season: Number(season.season_number),
          episode: Number(episode.episode_number),
        });
      } catch (error) {
        console.warn('[re3arabi-episode]', error instanceof Error ? error.message : String(error));
        sources = [];
      }
    }
  }

  const output = (sources || [])
    .filter((source: any) => String(source?.url || '').trim().startsWith('https://'))
    .map((source: any) => ({
      id: crypto.randomUUID(),
      type: source.type,
      quality: source.quality || 'auto',
      language: source.language || 'ar',
      label: source.label || source.provider || 'Re3Arabi',
      labelEn: source.label || source.provider || 'Re3Arabi',
      url: String(source.url).trim(),
      isWorking: true,
      provider: source.provider || 'Re3Arabi',
      providerKey: source.providerKey || undefined,
      providerReference: source.providerReference || undefined,
    }))
    .slice(0, 12);

  res.setHeader('Cache-Control', 'no-store');
  return ok(res, output);
}));

app.get(`${api}/watch/:id`, asyncRoute(async (req, res) => {
  const contentType = z.enum(['movie', 'episode']).default('movie').parse(req.query.type);
  const id = req.params.id;

  if (contentType === 'movie') {
    const { data, error } = await adminSupabase
      .from('movies')
      .select('*')
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle();
    if (error || !data) return fail(res, 404, 'MOVIE_NOT_FOUND', 'Movie not found');
    return ok(res, {
      contentType,
      id,
      tmdbId: Number(data.tmdb_id || 0),
      content: await movieDto(data, true),
    });
  }

  const { data: episode, error } = await adminSupabase
    .from('episodes')
    .select('*,seasons(id,season_number,series_id,series:series_id(id,title_ar,title_en,original_title,status,tmdb_id,poster_url,backdrop_url))')
    .eq('id', id)
    .maybeSingle();
  const series = episode?.seasons?.series;
  if (error || !episode || !series || series.status !== 'published') {
    return fail(res, 404, 'EPISODE_NOT_FOUND', 'Episode not found');
  }

  const playbackSources = await getFreshRe3ArabiSourcesForContent('episode', String(episode.id))
    .catch((sourceError) => {
      console.warn('[episode-playback-cache]', sourceError instanceof Error ? sourceError.message : String(sourceError));
      return [];
    });

  return ok(res, {
    contentType,
    id,
    tmdbId: Number(series.tmdb_id || 0),
    content: {
      id: episode.id,
      seriesId: series.id,
      seriesTitle: series.title_ar,
      seriesTitleEn: series.title_en || series.title_ar,
      seasonNumber: episode.seasons.season_number,
      episodeNumber: episode.episode_number,
      title: episode.name_ar || episode.name_en || ('الحلقة ' + episode.episode_number),
      titleEn: episode.name_en || episode.name_ar || ('Episode ' + episode.episode_number),
      overview: episode.overview_ar || '',
      overviewEn: episode.overview_en || episode.overview_ar || '',
      stillUrl: episode.still_url || '',
      duration: Number(episode.runtime_minutes || 0),
      airDate: episode.air_date || '',
      sources: playbackSources,
    },
  });
}));

app.get(`${api}/search`, asyncRoute(async (req, res) => {
  const q = z.string().trim().min(1).max(100).parse(req.query.q);
  const [movies, series, people] = await Promise.all([
    adminSupabase.from('movies').select('*').eq('status', 'published').or(`title_ar.ilike.%${q}%,title_en.ilike.%${q}%,original_title.ilike.%${q}%`).limit(24),
    adminSupabase.from('series').select('*').eq('status', 'published').or(`title_ar.ilike.%${q}%,title_en.ilike.%${q}%,original_title.ilike.%${q}%`).limit(24),
    adminSupabase.from('people').select('id,name_ar,name_en,original_name,avatar_url').or(`name_ar.ilike.%${q}%,name_en.ilike.%${q}%,original_name.ilike.%${q}%`).limit(12),
  ]);
  const movieRows = movies.data || []; const seriesRows = series.data || []; const personRows = people.data || [];
  const [movieGenres, seriesGenres] = await Promise.all([batchMovieGenres(movieRows.map((row: any) => row.id)), batchSeriesGenres(seriesRows.map((row: any) => row.id))]);
  const personIds = personRows.map((person: any) => person.id);
  const [movieLinks, seriesLinks] = personIds.length ? await Promise.all([
    adminSupabase.from('movie_cast').select('person_id').in('person_id', personIds),
    adminSupabase.from('series_cast').select('person_id').in('person_id', personIds),
  ]) : [{ data: [] as any[] }, { data: [] as any[] }];
  const workCounts = new Map<string, number>();
  for (const link of [...(movieLinks.data || []), ...(seriesLinks.data || [])]) workCounts.set(link.person_id, (workCounts.get(link.person_id) || 0) + 1);
  const movieResults = movieRows.map((row: any) => movieCardDto(row, movieGenres.get(row.id) || []));
  const seriesResults = seriesRows.map((row: any) => seriesCardDto(row, seriesGenres.get(row.id) || []));
  const castResults = personRows.map((person: any) => ({ name: person.name_ar || person.name_en || person.original_name || '', nameEn: person.name_en || person.original_name || person.name_ar || '', worksCount: workCounts.get(person.id) || 0, avatarUrl: person.avatar_url || '' }));
  return ok(res, { movies: movieResults, series: seriesResults, cast: castResults }, { total: movieResults.length + seriesResults.length + castResults.length });
}));
app.get(`${api}/home`, asyncRoute(async (_req, res) => {
  const [movies, series, recentMovies, recentSeries, genres] = await Promise.all([
    adminSupabase.from('movies').select('*').eq('status', 'published').order('vote_count', { ascending: false }).limit(12),
    adminSupabase.from('series').select('*').eq('status', 'published').order('vote_count', { ascending: false }).limit(12),
    adminSupabase.from('movies').select('*').eq('status', 'published').order('created_at', { ascending: false }).limit(12),
    adminSupabase.from('series').select('*').eq('status', 'published').order('created_at', { ascending: false }).limit(12),
    adminSupabase.from('genres').select('id,name_ar,name_en,slug').order('id'),
  ]);
  const movieRows = movies.data || [];
  const seriesRows = series.data || [];
  const recentMovieRows = recentMovies.data || [];
  const recentSeriesRows = recentSeries.data || [];
  const allMovieRows = [...new Map([...movieRows, ...recentMovieRows].map((row: any) => [row.id, row])).values()];
  const allSeriesRows = [...new Map([...seriesRows, ...recentSeriesRows].map((row: any) => [row.id, row])).values()];
  const [movieGenres, seriesGenres] = await Promise.all([
    batchMovieGenres(allMovieRows.map((row: any) => row.id)),
    batchSeriesGenres(allSeriesRows.map((row: any) => row.id)),
  ]);
  const movieDtos = movieRows.map((row: any) => movieCardDto(row, movieGenres.get(row.id) || []));
  const seriesDtos = seriesRows.map((row: any) => seriesCardDto(row, seriesGenres.get(row.id) || []));
  const recentMovieDtos = recentMovieRows.map((row: any) => movieCardDto(row, movieGenres.get(row.id) || []));
  const recentSeriesDtos = recentSeriesRows.map((row: any) => seriesCardDto(row, seriesGenres.get(row.id) || []));
  const combined = [...movieDtos, ...seriesDtos].sort((a: any, b: any) => b.rating - a.rating);
  return ok(res, {
    hero: combined.find((x: any) => x.isFeatured) || combined[0],
    continueWatching: [],
    trending: combined.filter((x: any) => x.isTrending),
    popularMovies: movieDtos.filter((x: any) => x.isPopular),
    featuredSeries: seriesDtos.filter((x: any) => x.isFeatured),
    recentAdded: [...recentMovieDtos, ...recentSeriesDtos]
      .sort((a: any, b: any) => String(b.addedAt).localeCompare(String(a.addedAt)))
      .slice(0, 24),
    genres: (genres.data || []).map(genreDto),
  });
}));

app.get(`${api}/auth/me`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { data: authData } = await req.supabase!.auth.getUser();
  const { data: profile } = await req.supabase!.from('profiles').select('*').eq('id', req.userId!).single();
  return ok(res, {
    id: req.userId, email: authData.user?.email || '', name: profile?.display_name || '',
    role: profile?.role || 'USER', avatarUrl: profile?.avatar_url || '',
    preferredLanguage: profile?.locale || 'ar', createdAt: profile?.created_at || '',
  });
}));

app.get(`${api}/watchlist`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { data, error } = await req.supabase!.from('watchlist').select('*').eq('user_id', req.userId!).order('created_at', { ascending: false });
  if (error) return fail(res, 500, 'WATCHLIST_QUERY_FAILED', 'Unable to load watchlist');
  const rows = data || [];
  const movieIds = rows.filter((x: any) => x.content_type === 'movie').map((x: any) => x.content_id);
  const seriesIds = rows.filter((x: any) => x.content_type === 'series').map((x: any) => x.content_id);
  const [movies, series] = await Promise.all([
    movieIds.length ? adminSupabase.from('movies').select('*').in('id', movieIds) : { data: [] as any[] },
    seriesIds.length ? adminSupabase.from('series').select('*').in('id', seriesIds) : { data: [] as any[] },
  ]);
  const movieMap = new Map((movies.data || []).map((x: any) => [x.id, x]));
  const seriesMap = new Map((series.data || []).map((x: any) => [x.id, x]));
  const [movieGenres, seriesGenres] = await Promise.all([batchMovieGenres(movieIds), batchSeriesGenres(seriesIds)]);
  return ok(res, rows.map((x: any) => {
    const row = x.content_type === 'movie' ? movieMap.get(x.content_id) : seriesMap.get(x.content_id);
    const genres = x.content_type === 'movie' ? movieGenres.get(x.content_id) || [] : seriesGenres.get(x.content_id) || [];
    return { id: x.id, userId: x.user_id, contentId: x.content_id, contentType: x.content_type, title: row?.title_ar || '', titleEn: row?.title_en || row?.title_ar || '', posterUrl: row?.poster_url || '', year: Number(String(row?.release_date || row?.first_air_date || '').slice(0,4)) || 0, rating: Number(row?.rating || 0), genres, addedAt: x.created_at };
  }));
}));
app.get(`${api}/history`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { data, error } = await req.supabase!.from('watch_history').select('*').eq('user_id', req.userId!).order('updated_at', { ascending: false }).limit(100);
  if (error) return fail(res, 500, 'HISTORY_QUERY_FAILED', 'Unable to load history');
  const rows = data || [];
  const movieIds = rows.filter((x: any) => x.content_type === 'movie').map((x: any) => x.content_id);
  const episodeIds = rows.filter((x: any) => x.content_type === 'episode').map((x: any) => x.content_id);
  const [movies, episodes] = await Promise.all([
    movieIds.length ? adminSupabase.from('movies').select('id,tmdb_id,title_ar,title_en,poster_url,backdrop_url,rating').in('id', movieIds) : { data: [] as any[] },
    episodeIds.length ? adminSupabase.from('episodes').select('id,season_id,episode_number,name_ar,name_en').in('id', episodeIds) : { data: [] as any[] },
  ]);
  const movieMap = new Map((movies.data || []).map((x: any) => [x.id, x]));
  const episodeRows = episodes.data || []; const seasonIds = episodeRows.map((x: any) => x.season_id);
  const { data: seasons } = seasonIds.length ? await adminSupabase.from('seasons').select('id,series_id,season_number').in('id', seasonIds) : { data: [] as any[] };
  const seasonMap = new Map((seasons || []).map((x: any) => [x.id, x]));
  const seriesIds = [...new Set((seasons || []).map((x: any) => x.series_id))];
  const { data: seriesRows } = seriesIds.length ? await adminSupabase.from('series').select('id,tmdb_id,title_ar,title_en,poster_url,backdrop_url,rating').in('id', seriesIds) : { data: [] as any[] };
  const seriesMap = new Map((seriesRows || []).map((x: any) => [x.id, x])); const episodeMap = new Map(episodeRows.map((x: any) => [x.id, x]));
  return ok(res, rows.map((x: any) => {
    const movie = x.content_type === 'movie' ? movieMap.get(x.content_id) : null; const episode = x.content_type === 'episode' ? episodeMap.get(x.content_id) : null;
    const season = episode ? seasonMap.get(episode.season_id) : null; const series = season ? seriesMap.get(season.series_id) : null; const base = movie || series;
    return { contentId: base?.id || x.content_id, tmdbId: Number(base?.tmdb_id || 0), contentType: movie ? 'movie' : 'series', episodeId: episode?.id || undefined, episodeNumber: episode?.episode_number || undefined, seasonNumber: season?.season_number || undefined,
      title: base?.title_ar || episode?.name_ar || '', titleEn: base?.title_en || episode?.name_en || '', posterUrl: base?.poster_url || '', backdropUrl: base?.backdrop_url || '',
      positionSeconds: x.position_seconds, durationSeconds: x.duration_seconds, percentage: x.duration_seconds ? Math.floor((x.position_seconds / x.duration_seconds) * 100) : 0, lastWatchedAt: x.updated_at, completed: x.completed };
  }));
}));
app.delete(`${api}/history`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { error } = await req.supabase!.from('watch_history').delete().eq('user_id', req.userId!);
  if (error) return fail(res, 500, 'HISTORY_DELETE_FAILED', 'Unable to clear history');
  return ok(res, { cleared: true });
}));

app.get(`${api}/watch/:id/progress`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const episodeId = typeof req.query.episodeId === 'string' ? req.query.episodeId : null;
  const contentType = episodeId ? 'episode' : 'movie'; const contentId = episodeId || req.params.id;
  const { data, error } = await req.supabase!.from('watch_history').select('*').eq('user_id', req.userId!).eq('content_type', contentType).eq('content_id', contentId).maybeSingle();
  if (error) return fail(res, 500, 'PROGRESS_QUERY_FAILED', 'Unable to load progress'); if (!data) return ok(res, null);
  if (contentType === 'episode') {
    const { data: episode } = await adminSupabase.from('episodes').select('id,season_id,episode_number').eq('id', data.content_id).maybeSingle();
    const { data: season } = episode ? await adminSupabase.from('seasons').select('id,series_id,season_number').eq('id', episode.season_id).maybeSingle() : { data: null };
    const { data: series } = season ? await adminSupabase.from('series').select('id,title_ar,title_en,poster_url,backdrop_url').eq('id', season.series_id).maybeSingle() : { data: null };
    return ok(res, { contentId: series?.id || data.content_id, contentType: 'series', title: series?.title_ar || '', titleEn: series?.title_en || '', posterUrl: series?.poster_url || '', backdropUrl: series?.backdrop_url || '', positionSeconds: data.position_seconds, durationSeconds: data.duration_seconds, percentage: data.duration_seconds ? Math.floor((data.position_seconds / data.duration_seconds) * 100) : 0, lastWatchedAt: data.updated_at, completed: data.completed, episodeId: data.content_id, episodeNumber: episode?.episode_number || undefined, seasonNumber: season?.season_number || undefined });
  }
  const { data: movie } = await adminSupabase.from('movies').select('title_ar,title_en,poster_url,backdrop_url').eq('id', data.content_id).maybeSingle();
  return ok(res, { contentId: data.content_id, contentType: 'movie', title: movie?.title_ar || '', titleEn: movie?.title_en || '', posterUrl: movie?.poster_url || '', backdropUrl: movie?.backdrop_url || '', positionSeconds: data.position_seconds, durationSeconds: data.duration_seconds, percentage: data.duration_seconds ? Math.floor((data.position_seconds / data.duration_seconds) * 100) : 0, lastWatchedAt: data.updated_at, completed: data.completed });
}));

app.post(`${api}/watch/:id/progress`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = z.object({
    contentType: z.enum(['movie', 'series']),
    episodeId: z.string().uuid().optional(),
    positionSeconds: z.number().int().min(0),
    durationSeconds: z.number().int().min(0),
    completed: z.boolean().default(false),
  }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid progress payload');
  const type = body.data.episodeId ? 'episode' : 'movie';
  const contentId = body.data.episodeId || req.params.id;
  const { data, error } = await req.supabase!.from('watch_history').upsert({
    user_id: req.userId!, content_type: type, content_id: contentId,
    position_seconds: body.data.positionSeconds, duration_seconds: body.data.durationSeconds,
    completed: body.data.completed,
  }, { onConflict: 'user_id,content_type,content_id' }).select('*').single();
  if (error) return fail(res, 500, 'PROGRESS_WRITE_FAILED', 'Unable to save progress');
  return ok(res, {
    contentId: data.content_id, contentType: body.data.contentType, title: '', titleEn: '',
    posterUrl: '', backdropUrl: '', positionSeconds: data.position_seconds, durationSeconds: data.duration_seconds,
    percentage: data.duration_seconds ? Math.floor((data.position_seconds / data.duration_seconds) * 100) : 0,
    lastWatchedAt: data.updated_at, completed: data.completed, episodeId: body.data.episodeId,
  });
}));

app.post(`${api}/reports`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = z.object({
    contentId: z.string().uuid(), contentType: z.enum(['movie', 'episode']),
    contentTitle: z.string().max(300), sourceId: z.string().uuid(),
    issueType: z.string().max(80), description: z.string().max(2000),
  }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid report payload');
  const { data, error } = await req.supabase!.from('reports').insert({
    user_id: req.userId!, content_id: body.data.contentId, content_type: body.data.contentType,
    source_id: body.data.sourceId, issue_type: body.data.issueType, description: body.data.description,
  }).select('*').single();
  if (error) return fail(res, 500, 'REPORT_WRITE_FAILED', 'Unable to submit report');
  return created(res, {
    id: data.id, contentId: data.content_id, contentTitle: body.data.contentTitle,
    sourceId: data.source_id, issueType: data.issue_type, description: data.description || '',
    reportedAt: data.created_at, status: data.status,
  });
}));


async function writeAudit(actorId: string, action: string, targetType: string, targetId: string, details: Record<string, unknown> = {}) {
  await adminSupabase.from('audit_logs').insert({ actor_id: actorId, action, target_type: targetType, target_id: targetId, details });
}

const adminListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
});

app.get(`${api}` + '/admin/movies', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const parsed = adminListQuery.safeParse(req.query);
  if (!parsed.success) return fail(res, 400, 'INVALID_QUERY', 'Invalid admin movie parameters');
  const { page, limit, search } = parsed.data;
  let query = adminSupabase.from('movies').select('*', { count: 'exact' }).order('updated_at', { ascending: false });
  if (search) query = query.or('title_ar.ilike.%' + search + '%,title_en.ilike.%' + search + '%,original_title.ilike.%' + search + '%');
  const from = (page - 1) * limit;
  const { data, count, error } = await query.range(from, from + limit - 1);
  if (error) return fail(res, 500, 'ADMIN_MOVIES_QUERY_FAILED', 'Unable to load admin movies');
  return ok(res, (data || []).map((row: any) => movieCardDto(row)), { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) || 1 });
}));

const adminMovieBody = z.object({
  titleAr: z.string().min(1).max(300),
  titleEn: z.string().max(300).optional().nullable(),
  originalTitle: z.string().max(300).optional().nullable(),
  overviewAr: z.string().max(10000).optional().nullable(),
  overviewEn: z.string().max(10000).optional().nullable(),
  posterUrl: z.string().url().optional().nullable(),
  backdropUrl: z.string().url().optional().nullable(),
  releaseDate: z.string().optional().nullable(),
  runtimeMinutes: z.number().int().min(0).max(1000).optional().nullable(),
  rating: z.number().min(0).max(10).optional(),
  voteCount: z.number().int().min(0).optional(),
  ageRating: z.string().max(30).optional().nullable(),
  status: z.enum(['draft','published','archived']).optional(),
  featured: z.boolean().optional(), trending: z.boolean().optional(), popular: z.boolean().optional(),
});

app.post(`${api}` + '/admin/movies', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = adminMovieBody.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid movie payload');
  const b = body.data;
  const { data, error } = await adminSupabase.from('movies').insert({
    title_ar: b.titleAr, title_en: b.titleEn || null, original_title: b.originalTitle || null,
    overview_ar: b.overviewAr || '', overview_en: b.overviewEn || '', poster_url: b.posterUrl || '', backdrop_url: b.backdropUrl || '',
    release_date: b.releaseDate || null, runtime_minutes: b.runtimeMinutes ?? null, rating: b.rating ?? 0, vote_count: b.voteCount ?? 0,
    age_rating: b.ageRating || '', status: b.status || 'draft', featured: b.featured ?? false, trending: b.trending ?? false, popular: b.popular ?? false,
  }).select('*').single();
  if (error || !data) return fail(res, 500, 'MOVIE_CREATE_FAILED', 'Unable to create movie');
  await writeAudit(req.userId!, 'create_movie', 'movie', data.id);
  return created(res, movieCardDto(data));
}));

app.patch(`${api}` + '/admin/movies/:id', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = adminMovieBody.partial().safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid movie payload');
  const b = body.data;
  const map: Record<string,string> = { titleAr:'title_ar', titleEn:'title_en', originalTitle:'original_title', overviewAr:'overview_ar', overviewEn:'overview_en', posterUrl:'poster_url', backdropUrl:'backdrop_url', releaseDate:'release_date', runtimeMinutes:'runtime_minutes', rating:'rating', voteCount:'vote_count', ageRating:'age_rating', status:'status', featured:'featured', trending:'trending', popular:'popular' };
  const update: Record<string, unknown> = {};
  for (const [from,to] of Object.entries(map)) if ((b as any)[from] !== undefined) update[to] = (b as any)[from];
  const { data, error } = await adminSupabase.from('movies').update(update).eq('id', req.params.id).select('*').maybeSingle();
  if (error || !data) return fail(res, 404, 'MOVIE_UPDATE_FAILED', 'Movie not found or not updated');
  await writeAudit(req.userId!, 'update_movie', 'movie', data.id, { fields: Object.keys(update) });
  return ok(res, movieCardDto(data));
}));

app.get(`${api}` + '/admin/series', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const parsed = adminListQuery.safeParse(req.query);
  if (!parsed.success) return fail(res, 400, 'INVALID_QUERY', 'Invalid admin series parameters');
  const { page, limit, search } = parsed.data;
  let query = adminSupabase.from('series').select('*', { count: 'exact' }).order('updated_at', { ascending: false });
  if (search) query = query.or('title_ar.ilike.%' + search + '%,title_en.ilike.%' + search + '%,original_title.ilike.%' + search + '%');
  const from = (page - 1) * limit;
  const { data, count, error } = await query.range(from, from + limit - 1);
  if (error) return fail(res, 500, 'ADMIN_SERIES_QUERY_FAILED', 'Unable to load admin series');
  return ok(res, (data || []).map((row: any) => seriesCardDto(row)), { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) || 1 });
}));

const adminSeriesBody = z.object({
  titleAr: z.string().min(1).max(300),
  titleEn: z.string().max(300).optional().nullable(),
  originalTitle: z.string().max(300).optional().nullable(),
  overviewAr: z.string().max(10000).optional().nullable(),
  overviewEn: z.string().max(10000).optional().nullable(),
  posterUrl: z.string().url().optional().nullable(),
  backdropUrl: z.string().url().optional().nullable(),
  firstAirDate: z.string().optional().nullable(),
  lastAirDate: z.string().optional().nullable(),
  rating: z.number().min(0).max(10).optional(), voteCount: z.number().int().min(0).optional(),
  ageRating: z.string().max(30).optional().nullable(), status: z.enum(['draft','published','archived']).optional(),
  featured: z.boolean().optional(), trending: z.boolean().optional(), popular: z.boolean().optional(),
});

app.post(`${api}` + '/admin/series', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = adminSeriesBody.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid series payload');
  const b = body.data;
  const { data, error } = await adminSupabase.from('series').insert({
    title_ar: b.titleAr, title_en: b.titleEn || null, original_title: b.originalTitle || null,
    overview_ar: b.overviewAr || '', overview_en: b.overviewEn || '', poster_url: b.posterUrl || '', backdrop_url: b.backdropUrl || '',
    first_air_date: b.firstAirDate || null, last_air_date: b.lastAirDate || null, rating: b.rating ?? 0, vote_count: b.voteCount ?? 0,
    age_rating: b.ageRating || '', status: b.status || 'draft', featured: b.featured ?? false, trending: b.trending ?? false, popular: b.popular ?? false,
  }).select('*').single();
  if (error || !data) return fail(res, 500, 'SERIES_CREATE_FAILED', 'Unable to create series');
  await writeAudit(req.userId!, 'create_series', 'series', data.id);
  return created(res, seriesCardDto(data));
}));

app.patch(`${api}` + '/admin/series/:id', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = adminSeriesBody.partial().safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid series payload');
  const b = body.data;
  const map: Record<string,string> = { titleAr:'title_ar', titleEn:'title_en', originalTitle:'original_title', overviewAr:'overview_ar', overviewEn:'overview_en', posterUrl:'poster_url', backdropUrl:'backdrop_url', firstAirDate:'first_air_date', lastAirDate:'last_air_date', rating:'rating', voteCount:'vote_count', ageRating:'age_rating', status:'status', featured:'featured', trending:'trending', popular:'popular' };
  const update: Record<string,unknown> = {};
  for (const [from,to] of Object.entries(map)) if ((b as any)[from] !== undefined) update[to] = (b as any)[from];
  const { data, error } = await adminSupabase.from('series').update(update).eq('id', req.params.id).select('*').maybeSingle();
  if (error || !data) return fail(res, 404, 'SERIES_UPDATE_FAILED', 'Series not found or not updated');
  await writeAudit(req.userId!, 'update_series', 'series', data.id, { fields:Object.keys(update) });
  return ok(res, seriesCardDto(data));
}));

app.get(`${api}` + '/admin/episodes', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const q = z.object({ seriesId:z.string().uuid().optional(), seasonId:z.string().uuid().optional(), page:z.coerce.number().int().min(1).default(1), limit:z.coerce.number().int().min(1).max(100).default(50) }).safeParse(req.query);
  if (!q.success) return fail(res, 400, 'INVALID_QUERY', 'Invalid episode parameters');
  const { seriesId, seasonId, page, limit } = q.data;
  let query = adminSupabase.from('episodes').select('*,seasons(series_id,season_number)', { count:'exact' }).order('episode_number');
  if (seasonId) query = query.eq('season_id', seasonId);
  const from = (page - 1) * limit;
  const result = await query.range(from, from + limit - 1);
  if (result.error) return fail(res, 500, 'EPISODES_QUERY_FAILED', 'Unable to load episodes');
  let rows = result.data || [];
  if (seriesId) rows = rows.filter((x:any) => x.seasons?.series_id === seriesId);
  return ok(res, rows, { page, limit, total:result.count || rows.length, totalPages:Math.ceil((result.count || rows.length)/limit) || 1 });
}));

const adminEpisodeBody = z.object({
  seasonId:z.string().uuid(), episodeNumber:z.number().int().min(1), nameAr:z.string().min(1).max(500), nameEn:z.string().max(500).optional().nullable(),
  overviewAr:z.string().max(10000).optional().nullable(), overviewEn:z.string().max(10000).optional().nullable(),
  stillUrl:z.string().url().optional().nullable(), airDate:z.string().optional().nullable(), runtimeMinutes:z.number().int().min(0).max(1000).optional().nullable(),
});

app.post(`${api}` + '/admin/episodes', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = adminEpisodeBody.safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid episode payload');
  const b = body.data;
  const { data, error } = await adminSupabase.from('episodes').insert({
    season_id:b.seasonId, episode_number:b.episodeNumber, name_ar:b.nameAr, name_en:b.nameEn || null, overview_ar:b.overviewAr || '', overview_en:b.overviewEn || '',
    still_url:b.stillUrl || '', air_date:b.airDate || null, runtime_minutes:b.runtimeMinutes ?? null,
  }).select('*').single();
  if (error || !data) return fail(res, 500, 'EPISODE_CREATE_FAILED', 'Unable to create episode');
  await writeAudit(req.userId!, 'create_episode', 'episode', data.id);
  return created(res, data);
}));

app.patch(`${api}` + '/admin/episodes/:id', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = adminEpisodeBody.partial().safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid episode payload');
  const b = body.data;
  const map: Record<string,string> = { seasonId:'season_id', episodeNumber:'episode_number', nameAr:'name_ar', nameEn:'name_en', overviewAr:'overview_ar', overviewEn:'overview_en', stillUrl:'still_url', airDate:'air_date', runtimeMinutes:'runtime_minutes' };
  const update: Record<string,unknown> = {};
  for (const [from,to] of Object.entries(map)) if ((b as any)[from] !== undefined) update[to] = (b as any)[from];
  const { data, error } = await adminSupabase.from('episodes').update(update).eq('id', req.params.id).select('*').maybeSingle();
  if (error || !data) return fail(res, 404, 'EPISODE_UPDATE_FAILED', 'Episode not found or not updated');
  await writeAudit(req.userId!, 'update_episode', 'episode', data.id, { fields:Object.keys(update) });
  return ok(res, data);
}));

app.delete(`${api}` + '/admin/episodes/:id', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { error } = await adminSupabase.from('episodes').delete().eq('id', req.params.id);
  if (error) return fail(res, 500, 'EPISODE_DELETE_FAILED', 'Unable to delete episode');
  await writeAudit(req.userId!, 'delete_episode', 'episode', req.params.id);
  return ok(res, { deleted:true });
}));

app.post(`${api}` + '/admin/providers', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body=z.object({key:z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/),name:z.string().min(1).max(150),adapterName:z.string().min(1).max(150),enabled:z.boolean().default(true)}).safeParse(req.body);
  if(!body.success) return fail(res,400,'INVALID_BODY','Invalid provider payload');
  const {key,name,adapterName,enabled}=body.data;
  const {data,error}=await adminSupabase.from('providers').insert({key,name,adapter_name:adapterName,enabled}).select('*').single();
  if(error||!data) return fail(res,409,'PROVIDER_CREATE_FAILED','Unable to create provider');
  await writeAudit(req.userId!,'create_provider','provider',data.id);
  return created(res,data);
}));

app.patch(`${api}` + '/admin/providers/:id', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body=z.object({name:z.string().min(1).max(150).optional(),adapterName:z.string().min(1).max(150).optional(),enabled:z.boolean().optional()}).safeParse(req.body);
  if(!body.success) return fail(res,400,'INVALID_BODY','Invalid provider payload');
  const b=body.data; const update:Record<string,unknown>={};
  if(b.name!==undefined) update.name=b.name;
  if(b.adapterName!==undefined) update.adapter_name=b.adapterName;
  if(b.enabled!==undefined) update.enabled=b.enabled;
  const {data,error}=await adminSupabase.from('providers').update(update).eq('id',req.params.id).select('*').maybeSingle();
  if(error||!data) return fail(res,404,'PROVIDER_UPDATE_FAILED','Provider not found or not updated');
  await writeAudit(req.userId!,'update_provider','provider',data.id,{fields:Object.keys(update)});
  return ok(res,data);
}));

app.delete(`${api}` + '/admin/providers/:id', requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const {error}=await adminSupabase.from('providers').delete().eq('id',req.params.id);
  if(error) return fail(res,409,'PROVIDER_DELETE_FAILED','Unable to delete provider');
  await writeAudit(req.userId!,'delete_provider','provider',req.params.id);
  return ok(res,{deleted:true});
}));

app.get(`${api}` + '/admin/reports', requireAuth, requireAdmin, asyncRoute(async (req,res) => {
  const q=z.object({status:z.string().optional(),limit:z.coerce.number().int().min(1).max(200).default(100)}).safeParse(req.query);
  if(!q.success) return fail(res,400,'INVALID_QUERY','Invalid report parameters');
  let query=adminSupabase.from('reports').select('*').order('created_at',{ascending:false}).limit(q.data.limit);
  if(q.data.status) query=query.eq('status',q.data.status);
  const {data,error}=await query;
  if(error) return fail(res,500,'REPORTS_QUERY_FAILED','Unable to load reports');
  return ok(res,data||[]);
}));

app.patch(`${api}` + '/admin/reports/:id', requireAuth, requireAdmin, asyncRoute(async (req:AuthenticatedRequest,res) => {
  const body=z.object({status:z.enum(['pending','investigating','resolved'])}).safeParse(req.body);
  if(!body.success) return fail(res,400,'INVALID_BODY','Invalid report status');
  const {data,error}=await adminSupabase.from('reports').update({status:body.data.status}).eq('id',req.params.id).select('*').maybeSingle();
  if(error||!data) return fail(res,404,'REPORT_NOT_FOUND','Report not found');
  await writeAudit(req.userId!,'update_report','report',data.id,{status:data.status});
  return ok(res,data);
}));

app.get(`${api}` + '/admin/users', requireAuth, requireAdmin, asyncRoute(async (req,res) => {
  const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(50)}).safeParse(req.query);
  if(!q.success) return fail(res,400,'INVALID_QUERY','Invalid user parameters');
  const {data:users,error}=await adminSupabase.auth.admin.listUsers({page:q.data.page,perPage:q.data.limit});
  if(error) return fail(res,500,'USERS_QUERY_FAILED','Unable to load users');
  const ids=(users.users||[]).map((u:any)=>u.id);
  const {data:profiles}=ids.length?await adminSupabase.from('profiles').select('id,role,display_name,avatar_url,locale,created_at,updated_at').in('id',ids):{data:[] as any[]};
  const profileMap=new Map((profiles||[]).map((p:any)=>[p.id,p]));
  return ok(res,(users.users||[]).map((u:any)=>{const p=profileMap.get(u.id);return {id:u.id,email:u.email||'',role:p?.role||'USER',name:p?.display_name||'',avatarUrl:p?.avatar_url||'',preferredLanguage:p?.locale||'ar',createdAt:p?.created_at||u.created_at};}),{page:q.data.page,limit:q.data.limit,total:users.total||0});
}));

app.patch(`${api}` + '/admin/users/:id/role', requireAuth, requireOwner, asyncRoute(async (req:AuthenticatedRequest,res) => {
  const body=z.object({role:z.enum(['USER','ADMIN','OWNER'])}).safeParse(req.body);
  if(!body.success) return fail(res,400,'INVALID_BODY','Invalid user role');
  if(req.userId===req.params.id && body.data.role!=='OWNER') return fail(res,400,'SELF_ROLE_CHANGE_BLOCKED','Owner cannot remove their own owner role');
  const {data,error}=await adminSupabase.from('profiles').update({role:body.data.role}).eq('id',req.params.id).select('id,role').maybeSingle();
  if(error||!data) return fail(res,404,'USER_NOT_FOUND','User not found');
  await writeAudit(req.userId!,'update_user_role','user',data.id,{role:data.role});
  return ok(res,data);
}));

app.post(`${api}` + '/admin/sync', requireAuth, requireAdmin, asyncRoute(async (req:AuthenticatedRequest,res) => {
  const body=z.object({provider:z.literal('tmdb').default('tmdb'),kind:z.enum(['catalog','episodes']).default('catalog'),pages:z.number().int().min(1).max(3).default(1),seriesLimit:z.number().int().min(1).max(25).default(10)}).safeParse(req.body||{});
  if(!body.success) return fail(res,400,'INVALID_BODY','Invalid sync request');
  try{
    if(body.data.kind==='episodes'){
      const result=await syncEpisodesForSeries(body.data.seriesLimit);
      await writeAudit(req.userId!,'sync','tmdb','episodes',result);
      return ok(res,{kind:'episodes',syncedCount:result.episodes,result});
    }
    const result=await runTmdbSync({pages:body.data.pages});
    await writeAudit(req.userId!,'sync','tmdb','catalog',result);
    return ok(res,{kind:'catalog',syncedCount:result.total,result});
  }catch(error){
    return fail(res,502,'SYNC_FAILED',error instanceof Error?error.message:'Sync failed');
  }
}));

app.get(`${api}/admin/stats`, requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const [m, s, e, p, healthy, src] = await Promise.all([
    adminSupabase.from('movies').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    adminSupabase.from('series').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    adminSupabase.from('episodes').select('id', { count: 'exact', head: true }),
    adminSupabase.from('providers').select('id', { count: 'exact', head: true }).eq('enabled', true),
    adminSupabase.from('providers').select('id', { count: 'exact', head: true }).eq('enabled', true).eq('status', 'healthy'),
    adminSupabase.from('playback_sources').select('id', { count: 'exact', head: true }).eq('is_working', true),
  ]);
  const activeProviders = p.count || 0;
  const healthyProviders = healthy.count || 0;
  return ok(res, {
    totalMovies: m.count || 0,
    totalSeries: s.count || 0,
    totalEpisodes: e.count || 0,
    activeProviders,
    streamHealthPct: activeProviders ? Math.round((healthyProviders / activeProviders) * 100) : 0,
    dailyStreamRequests: 0,
    workingSources: src.count || 0,
  });
}));


const adminPlaybackSourceBody = z.object({
  providerId: z.string().uuid(),
  contentType: z.enum(['movie', 'episode']),
  contentId: z.string().uuid(),
  sourceType: z.enum(['hls', 'mp4', 'dash']),
  url: z.string().url(),
  providerReference: z.string().max(500).optional().nullable(),
  quality: z.string().max(50).default('auto'),
  language: z.string().max(20).default('und'),
  labelAr: z.string().max(150).optional().nullable(),
  labelEn: z.string().max(150).optional().nullable(),
  expiresAt: z.string().optional().nullable(),
  isWorking: z.boolean().default(true),
});

async function validatePlaybackSourceTarget(contentType: 'movie' | 'episode', contentId: string) {
  const table = contentType === 'movie' ? 'movies' : 'episodes';
  const { data } = await adminSupabase.from(table).select('id').eq('id', contentId).maybeSingle();
  return !!data;
}

function normalizeAdminPlaybackSourceBody(value: z.infer<typeof adminPlaybackSourceBody>) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value.url);
  } catch {
    throw new Error('SOURCE_URL_INVALID');
  }

  if (parsedUrl.protocol !== 'https:') throw new Error('SOURCE_URL_MUST_USE_HTTPS');

  let expiresAt: string | null = null;
  if (value.expiresAt) {
    const timestamp = Date.parse(value.expiresAt);
    if (!Number.isFinite(timestamp)) throw new Error('SOURCE_EXPIRES_AT_INVALID');
    expiresAt = new Date(timestamp).toISOString();
  }

  return {
    provider_id: value.providerId,
    content_type: value.contentType,
    content_id: value.contentId,
    source_type: value.sourceType,
    url: parsedUrl.toString(),
    provider_reference: value.providerReference || null,
    quality: value.quality || 'auto',
    language: value.language || 'und',
    label_ar: value.labelAr || '',
    label_en: value.labelEn || '',
    expires_at: expiresAt,
    is_working: value.isWorking !== false,
    last_checked_at: value.isWorking !== false ? new Date().toISOString() : null,
  };
}

app.get(`${api}/admin/mappings`, requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const query = z.object({
    providerId: z.string().uuid().optional(),
    contentType: z.enum(['movie','series','season','episode']).optional(),
    contentId: z.string().uuid().optional(),
  }).safeParse(req.query);
  if (!query.success) return fail(res, 400, 'INVALID_QUERY', 'Invalid mapping filters');

  let q = adminSupabase
    .from('provider_mappings')
    .select('id,provider_id,content_type,internal_content_id,provider_content_id,confidence,status,providers(key,name)')
    .order('confidence', { ascending: false });
  if (query.data.providerId) q = q.eq('provider_id', query.data.providerId);
  if (query.data.contentType) q = q.eq('content_type', query.data.contentType);
  if (query.data.contentId) q = q.eq('internal_content_id', query.data.contentId);

  const { data, error } = await q;
  if (error) return fail(res, 500, 'MAPPINGS_QUERY_FAILED', 'Unable to load provider mappings');

  return ok(res, (data || []).map((row: any) => ({
    id: row.id,
    providerId: row.provider_id,
    providerKey: row.providers?.key || '',
    providerName: row.providers?.name || '',
    contentType: row.content_type,
    contentId: row.internal_content_id,
    providerContentId: row.provider_content_id,
    confidence: Number(row.confidence || 0),
    status: row.status,
  })));
}));

app.post(`${api}/admin/mappings`, requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = z.object({
    providerId: z.string().uuid(),
    contentType: z.enum(['movie','series','season','episode']),
    contentId: z.string().uuid(),
    providerContentId: z.string().trim().min(1).max(500),
    confidence: z.number().min(0).max(100).default(100),
    status: z.enum(['active','inactive']).default('active'),
  }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_MAPPING', 'Invalid provider mapping');

  const { data: provider } = await adminSupabase.from('providers').select('id').eq('id', body.data.providerId).maybeSingle();
  if (!provider) return fail(res, 404, 'PROVIDER_NOT_FOUND', 'Provider not found');

  const { data, error } = await adminSupabase
    .from('provider_mappings')
    .upsert({
      provider_id: body.data.providerId,
      content_type: body.data.contentType,
      internal_content_id: body.data.contentId,
      provider_content_id: body.data.providerContentId,
      confidence: body.data.confidence,
      status: body.data.status,
    }, { onConflict: 'provider_id,content_type,internal_content_id' })
    .select('id,provider_id,content_type,internal_content_id,provider_content_id,confidence,status')
    .single();

  if (error) return fail(res, 500, 'MAPPING_WRITE_FAILED', 'Unable to save provider mapping');

  await adminSupabase.from('audit_logs').insert({
    actor_id: req.userId,
    action: 'provider_mapping.upsert',
    target_type: 'provider_mapping',
    target_id: data.id,
    details: { providerId: data.provider_id, contentType: data.content_type, contentId: data.internal_content_id },
  });

  return created(res, data);
}));

app.patch(`${api}/admin/mappings/:id`, requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = z.object({
    providerContentId: z.string().trim().min(1).max(500).optional(),
    confidence: z.number().min(0).max(100).optional(),
    status: z.enum(['active','inactive']).optional(),
  }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_MAPPING', 'Invalid provider mapping update');

  const update: Record<string, unknown> = {};
  if (body.data.providerContentId !== undefined) update.provider_content_id = body.data.providerContentId;
  if (body.data.confidence !== undefined) update.confidence = body.data.confidence;
  if (body.data.status !== undefined) update.status = body.data.status;

  const { data, error } = await adminSupabase
    .from('provider_mappings')
    .update(update)
    .eq('id', req.params.id)
    .select('id,provider_id,content_type,internal_content_id,provider_content_id,confidence,status')
    .maybeSingle();

  if (error) return fail(res, 500, 'MAPPING_UPDATE_FAILED', 'Unable to update provider mapping');
  if (!data) return fail(res, 404, 'MAPPING_NOT_FOUND', 'Provider mapping not found');

  await adminSupabase.from('audit_logs').insert({
    actor_id: req.userId,
    action: 'provider_mapping.update',
    target_type: 'provider_mapping',
    target_id: data.id,
    details: { providerContentId: body.data.providerContentId, confidence: body.data.confidence, status: body.data.status },
  });

  return ok(res, data);
}));

app.delete(`${api}/admin/mappings/:id`, requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { error } = await adminSupabase.from('provider_mappings').delete().eq('id', req.params.id);
  if (error) return fail(res, 500, 'MAPPING_DELETE_FAILED', 'Unable to delete provider mapping');

  await adminSupabase.from('audit_logs').insert({
    actor_id: req.userId,
    action: 'provider_mapping.delete',
    target_type: 'provider_mapping',
    target_id: req.params.id,
  });

  return ok(res, { deleted: true });
}));

app.get(`${api}/admin/sources`, requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const parsed = z.object({
    contentType: z.enum(['movie', 'episode']).optional(),
    contentId: z.string().uuid().optional(),
    providerId: z.string().uuid().optional(),
    includeBroken: z.coerce.boolean().default(true),
  }).safeParse(req.query);

  if (!parsed.success) return fail(res, 400, 'INVALID_QUERY', 'Invalid source parameters');

  let request = adminSupabase
    .from('playback_sources')
    .select('id,provider_id,content_type,content_id,source_type,url,provider_reference,quality,language,label_ar,label_en,expires_at,is_working,last_checked_at,failure_count,providers(id,name,key,enabled)')
    .order('last_checked_at', { ascending: false });

  if (parsed.data.contentType) request = request.eq('content_type', parsed.data.contentType);
  if (parsed.data.contentId) request = request.eq('content_id', parsed.data.contentId);
  if (parsed.data.providerId) request = request.eq('provider_id', parsed.data.providerId);
  if (!parsed.data.includeBroken) request = request.eq('is_working', true);

  const { data, error } = await request;
  if (error) return fail(res, 500, 'SOURCES_QUERY_FAILED', 'Unable to load playback sources');
  return ok(res, data || []);
}));

app.post(`${api}/admin/sources`, requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const parsed = adminPlaybackSourceBody.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'INVALID_BODY', 'Invalid playback source payload');

  try {
    const payload = normalizeAdminPlaybackSourceBody(parsed.data);

    const { data: provider } = await adminSupabase
      .from('providers')
      .select('id')
      .eq('id', payload.provider_id)
      .maybeSingle();
    if (!provider) return fail(res, 404, 'PROVIDER_NOT_FOUND', 'Provider not found');

    if (!(await validatePlaybackSourceTarget(payload.content_type, payload.content_id))) {
      return fail(res, 404, 'CONTENT_NOT_FOUND', 'Target content not found');
    }

    const { data: duplicate } = await adminSupabase
      .from('playback_sources')
      .select('id')
      .eq('provider_id', payload.provider_id)
      .eq('content_type', payload.content_type)
      .eq('content_id', payload.content_id)
      .eq('url', payload.url)
      .maybeSingle();
    if (duplicate) return fail(res, 409, 'SOURCE_ALREADY_EXISTS', 'Playback source already exists');

    const { data, error } = await adminSupabase
      .from('playback_sources')
      .insert(payload)
      .select('id,provider_id,content_type,content_id,source_type,url,provider_reference,quality,language,label_ar,label_en,expires_at,is_working,last_checked_at,failure_count,providers(id,name,key,enabled)')
      .single();

    if (error || !data) return fail(res, 500, 'SOURCE_CREATE_FAILED', 'Unable to create playback source');
    await writeAudit(req.userId!, 'create_playback_source', payload.content_type, payload.content_id, { sourceId: data.id, providerId: payload.provider_id });
    return created(res, data);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'SOURCE_URL_INVALID') return fail(res, 400, code, 'Invalid source URL');
    if (code === 'SOURCE_URL_MUST_USE_HTTPS') return fail(res, 400, code, 'Source URL must use HTTPS');
    if (code === 'SOURCE_EXPIRES_AT_INVALID') return fail(res, 400, code, 'Invalid source expiry timestamp');
    return fail(res, 400, 'SOURCE_PAYLOAD_INVALID', 'Invalid playback source payload');
  }
}));

app.patch(`${api}/admin/sources/:id`, requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const parsed = adminPlaybackSourceBody.partial().safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'INVALID_BODY', 'Invalid playback source payload');

  try {
    const current = await adminSupabase
      .from('playback_sources')
      .select('id,provider_id,content_type,content_id,source_type,url,provider_reference,quality,language,label_ar,label_en,expires_at,is_working,last_checked_at')
      .eq('id', req.params.id)
      .maybeSingle();
    if (current.error || !current.data) return fail(res, 404, 'SOURCE_NOT_FOUND', 'Playback source not found');

    const values = parsed.data;
    const merged = {
      providerId: values.providerId ?? current.data.provider_id,
      contentType: values.contentType ?? current.data.content_type,
      contentId: values.contentId ?? current.data.content_id,
      sourceType: values.sourceType ?? current.data.source_type,
      url: values.url ?? current.data.url,
      providerReference: values.providerReference ?? current.data.provider_reference,
      quality: values.quality ?? current.data.quality ?? 'auto',
      language: values.language ?? current.data.language ?? 'und',
      labelAr: values.labelAr ?? current.data.label_ar ?? '',
      labelEn: values.labelEn ?? current.data.label_en ?? '',
      expiresAt: values.expiresAt ?? current.data.expires_at,
      isWorking: values.isWorking ?? current.data.is_working,
    };

    const payload = normalizeAdminPlaybackSourceBody(merged);

    const { data: provider } = await adminSupabase
      .from('providers')
      .select('id')
      .eq('id', payload.provider_id)
      .maybeSingle();
    if (!provider) return fail(res, 404, 'PROVIDER_NOT_FOUND', 'Provider not found');

    if (!(await validatePlaybackSourceTarget(payload.content_type, payload.content_id))) {
      return fail(res, 404, 'CONTENT_NOT_FOUND', 'Target content not found');
    }

    const { data, error } = await adminSupabase
      .from('playback_sources')
      .update(payload)
      .eq('id', req.params.id)
      .select('id,provider_id,content_type,content_id,source_type,url,provider_reference,quality,language,label_ar,label_en,expires_at,is_working,last_checked_at,failure_count,providers(id,name,key,enabled)')
      .maybeSingle();

    if (error || !data) return fail(res, 404, 'SOURCE_UPDATE_FAILED', 'Playback source not found or not updated');
    await writeAudit(req.userId!, 'update_playback_source', payload.content_type, payload.content_id, { sourceId: data.id });
    return ok(res, data);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'SOURCE_URL_INVALID') return fail(res, 400, code, 'Invalid source URL');
    if (code === 'SOURCE_URL_MUST_USE_HTTPS') return fail(res, 400, code, 'Source URL must use HTTPS');
    if (code === 'SOURCE_EXPIRES_AT_INVALID') return fail(res, 400, code, 'Invalid source expiry timestamp');
    return fail(res, 400, 'SOURCE_PAYLOAD_INVALID', 'Invalid playback source payload');
  }
}));

app.delete(`${api}/admin/sources/:id`, requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { data, error } = await adminSupabase
    .from('playback_sources')
    .select('id,content_type,content_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error || !data) return fail(res, 404, 'SOURCE_NOT_FOUND', 'Playback source not found');

  const { error: deleteError } = await adminSupabase
    .from('playback_sources')
    .delete()
    .eq('id', req.params.id);
  if (deleteError) return fail(res, 500, 'SOURCE_DELETE_FAILED', 'Unable to delete playback source');

  await writeAudit(req.userId!, 'delete_playback_source', data.content_type, data.content_id, { sourceId: data.id });
  return ok(res, { deleted: true });
}));

app.post(`${api}/admin/providers/:id/test`, requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { data: provider, error: providerError } = await adminSupabase
    .from('providers')
    .select('id,key,name,enabled,status')
    .eq('id', req.params.id)
    .maybeSingle();

  if (providerError) return fail(res, 500, 'PROVIDER_QUERY_FAILED', 'Unable to load provider');
  if (!provider) return fail(res, 404, 'PROVIDER_NOT_FOUND', 'Provider not found');

  const adapter = getProvider(provider.key);
  const started = Date.now();

  if (!adapter || !adapter.enabled) {
    const message = 'Provider adapter is not registered';
    await adminSupabase.from('providers').update({ status: 'offline', latency_ms: Date.now() - started, last_checked_at: new Date().toISOString() }).eq('id', provider.id);
    return ok(res, { id: provider.id, key: provider.key, name: provider.name, status: 'offline', latencyMs: Date.now() - started, message });
  }

  try {
    const health = await adapter.health();
    const latencyMs = Date.now() - started;
    await adminSupabase.from('providers').update({ status: health.status, latency_ms: latencyMs, last_checked_at: new Date().toISOString() }).eq('id', provider.id);
    return ok(res, { id: provider.id, key: provider.key, name: provider.name, status: health.status, latencyMs, message: health.message || undefined });
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error ? error.message : 'Provider health check failed';
    await adminSupabase.from('providers').update({ status: 'offline', latency_ms: latencyMs, last_checked_at: new Date().toISOString() }).eq('id', provider.id);
    return ok(res, { id: provider.id, key: provider.key, name: provider.name, status: 'offline', latencyMs, message });
  }
}));
app.get(`${api}/admin/providers`, requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await adminSupabase.from('providers').select('*').order('name');
  if (error) return fail(res, 500, 'PROVIDERS_QUERY_FAILED', 'Unable to load providers');

  const providers = data || [];
  const sourceCounts = new Map<string, number>();
  if (providers.length) {
    const { data: sources } = await adminSupabase
      .from('playback_sources')
      .select('provider_id')
      .eq('is_working', true)
      .in('provider_id', providers.map((p: any) => p.id));

    for (const source of sources || []) {
      sourceCounts.set(source.provider_id, (sourceCounts.get(source.provider_id) || 0) + 1);
    }
  }

  return ok(res, providers.map((p: any) => ({
    id: p.id, name: p.name, adapterName: p.adapter_name, type: 'api',
    status: p.status, latencyMs: p.latency_ms || 0, successRate: Number(p.success_rate || 0),
    lastChecked: p.last_checked_at || '', activeSources: sourceCounts.get(p.id) || 0,
  })));
}));

app.post(`${api}/admin/sync/tmdb/episodes`, requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = z.object({ seriesLimit: z.number().int().min(1).max(25).default(10) }).safeParse(req.body || {});
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid episode sync options');
  try {
    const result = await syncEpisodesForSeries(body.data.seriesLimit);
    await adminSupabase.from('audit_logs').insert({
      actor_id: req.userId,
      action: 'tmdb_episode_sync',
      target_type: 'episodes',
      target_id: 'tmdb',
      details: result,
    });
    return ok(res, {
      syncedCount: result.episodes,
      message: `Episode sync completed: ${result.episodes} episodes across ${result.seasons} seasons`,
    });
  } catch (error) {
    return fail(res, 502, 'TMDB_EPISODE_SYNC_FAILED', error instanceof Error ? error.message : 'Episode sync failed');
  }
}));

app.get(`${api}/admin/sync/jobs`, requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await adminSupabase
    .from('sync_jobs')
    .select('id,provider,job_type,status,pages,movies_synced,series_synced,seasons_synced,episodes_synced,error,started_at,finished_at,created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return fail(res, 500, 'SYNC_JOBS_QUERY_FAILED', 'Unable to load sync jobs');

  return ok(res, (data || []).map((job: any) => ({
    id: job.id,
    provider: job.provider,
    jobType: job.job_type,
    status: job.status,
    pages: job.pages,
    moviesSynced: job.movies_synced,
    seriesSynced: job.series_synced,
    seasonsSynced: job.seasons_synced,
    episodesSynced: job.episodes_synced,
    error: job.error || '',
    startedAt: job.started_at || '',
    finishedAt: job.finished_at || '',
    createdAt: job.created_at,
  })));
}));

app.get(`${api}/admin/audit`, requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await adminSupabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return fail(res, 500, 'AUDIT_QUERY_FAILED', 'Unable to load audit logs');
  return ok(res, (data || []).map((x: any) => ({
    id: x.id, timestamp: x.created_at, userId: x.actor_id || '', userEmail: '',
    action: x.action, actionEn: x.action, target: x.target_id || '',
    details: JSON.stringify(x.details || {}), ip: '-',
  })));
}));

app.delete(`${api}/admin/movies/:id`, requireAuth, requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { error } = await adminSupabase.from('movies').update({ status: 'archived' }).eq('id', req.params.id);
  if (error) return fail(res, 500, 'MOVIE_DELETE_FAILED', 'Unable to archive movie');
  await adminSupabase.from('audit_logs').insert({ actor_id: req.userId!, action: 'archive_movie', target_type: 'movie', target_id: req.params.id });
  return ok(res, { deleted: true });
}));

app.post(`${api}/admin/sync/tmdb`, requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({ pages: z.number().int().min(1).max(3).default(1) }).safeParse(req.body || {});
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid sync options');
  try {
    const result = await runTmdbSync({ pages: body.data.pages });
    await adminSupabase.from('audit_logs').insert({
      actor_id: (req as AuthenticatedRequest).userId,
      action: 'tmdb_sync',
      target_type: 'catalog',
      target_id: 'tmdb',
      details: result,
    });
    return ok(res, {
      syncedCount: result.total,
      message: `TMDB sync completed: ${result.movies} movies, ${result.series} series`,
    });
  } catch (error) {
    return fail(res, 502, 'TMDB_SYNC_FAILED', error instanceof Error ? error.message : 'TMDB sync failed');
  }
}));

app.use((err: any, _req: HttpRequest, res: HttpResponse, _next: NextFunction) => {
  console.error(err);

  return fail(res, 500, 'INTERNAL_ERROR', 'Internal server error');
});

// Playback architecture marker: browser consumes direct Re3Arabi links stored in Supabase.

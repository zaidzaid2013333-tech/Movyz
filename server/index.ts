import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { z } from 'zod';
import { adminSupabase } from './supabase';
import { asyncRoute, created, fail, ok } from './http';
import { requireAdmin, requireAuth, type AuthenticatedRequest } from './auth';

const app = express();
const port = Number(process.env.PORT || 8787);
const api = '/api/v1';

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    const allow = (process.env.CORS_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!origin || allow.length === 0 || allow.includes(origin)) return callback(null, true);
    callback(new Error('Origin not allowed'));
  },
}));
app.use(express.json({ limit: '1mb' }));

const catalogQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  genreId: z.coerce.number().int().optional(),
  year: z.coerce.number().int().optional(),
  minRating: z.coerce.number().min(0).max(10).optional(),
  sortBy: z.enum(['popular', 'rating', 'newest']).default('popular'),
  search: z.string().trim().max(120).optional(),
});

const sourceDto = (s: any) => ({
  id: s.id,
  type: s.source_type,
  quality: s.quality || 'auto',
  language: s.language || 'und',
  label: s.label_ar || s.providers?.name || 'Source',
  labelEn: s.label_en || s.providers?.name || 'Source',
  url: s.url || '',
  isWorking: s.is_working === true,
  provider: s.providers?.name || 'Provider',
});

const genreDto = (g: any) => ({
  id: g.id,
  name: g.name_ar,
  nameEn: g.name_en,
  slug: g.slug,
});

async function movieDto(row: any) {
  const [genres, cast, sources] = await Promise.all([
    adminSupabase.from('movie_genres').select('genres(id,name_ar,name_en,slug)').eq('movie_id', row.id),
    adminSupabase.from('movie_cast').select('character_ar,character_en,people(id,name_ar,name_en,avatar_url)').eq('movie_id', row.id).order('cast_order'),
    adminSupabase.from('playback_sources').select('id,source_type,url,quality,language,label_ar,label_en,expires_at,is_working,providers(name)').eq('content_type', 'movie').eq('content_id', row.id).eq('is_working', true),
  ]);
  return {
    id: row.id, type: 'movie',
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
    sources: (sources.data || []).filter((x: any) => !x.expires_at || new Date(x.expires_at) > new Date()).map(sourceDto),
    isFeatured: !!row.featured, isTrending: !!row.trending, isPopular: !!row.popular,
    addedAt: row.created_at, ageRating: row.age_rating || '',
  } as any;
}

async function seriesDto(row: any) {
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

  const seasonDtos = seasonRows.map((s: any) => ({
    id: s.id, seriesId: row.id, seasonNumber: s.season_number,
    name: s.name_ar || s.name_en || `الموسم ${s.season_number}`,
    nameEn: s.name_en || s.name_ar || `Season ${s.season_number}`,
    posterUrl: s.poster_url || '', overview: s.overview_ar || '',
    airDate: s.air_date || '', episodesCount: (episodes.data || []).filter((e: any) => e.season_id === s.id).length,
    episodes: (episodes.data || []).filter((e: any) => e.season_id === s.id).map((e: any) => ({
      id: e.id, seriesId: row.id, seasonNumber: s.season_number, episodeNumber: e.episode_number,
      title: e.name_ar || e.name_en || `الحلقة ${e.episode_number}`,
      titleEn: e.name_en || e.name_ar || `Episode ${e.episode_number}`,
      overview: e.overview_ar || '', overviewEn: e.overview_en || e.overview_ar || '',
      stillUrl: e.still_url || '', duration: Number(e.runtime_minutes || 0), airDate: e.air_date || '',
      sources: [],
    })),
  }));

  return {
    id: row.id, type: 'series',
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
  const rows = await Promise.all((data || []).map(movieDto));
  return ok(res, rows, { page: q.page, limit: q.limit, total: count || 0, totalPages: Math.ceil((count || 0) / q.limit) || 1 });
}));

app.get(`${api}/movies/:id`, asyncRoute(async (req, res) => {
  const { data, error } = await adminSupabase.from('movies').select('*').eq('id', req.params.id).eq('status', 'published').maybeSingle();
  if (error || !data) return fail(res, 404, 'MOVIE_NOT_FOUND', 'Movie not found');
  const movie = await movieDto(data);
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
  const rows = await Promise.all((data || []).map(seriesDto));
  return ok(res, rows, { page: q.page, limit: q.limit, total: count || 0, totalPages: Math.ceil((count || 0) / q.limit) || 1 });
}));

app.get(`${api}/series/:id`, asyncRoute(async (req, res) => {
  const { data, error } = await adminSupabase.from('series').select('*').eq('id', req.params.id).eq('status', 'published').maybeSingle();
  if (error || !data) return fail(res, 404, 'SERIES_NOT_FOUND', 'Series not found');
  const series = await seriesDto(data);
  return ok(res, { series, similar: [] });
}));

app.get(`${api}/watch/:id/sources`, asyncRoute(async (req, res) => {
  const episodeId = typeof req.query.episodeId === 'string' ? req.query.episodeId : null;
  const type = episodeId ? 'episode' : 'movie';
  const contentId = episodeId || req.params.id;
  const { data, error } = await adminSupabase
    .from('playback_sources')
    .select('id,source_type,url,quality,language,label_ar,label_en,expires_at,is_working,providers(name)')
    .eq('content_type', type)
    .eq('content_id', contentId)
    .eq('is_working', true);
  if (error) return fail(res, 500, 'SOURCES_QUERY_FAILED', 'Unable to load playback sources');
  const valid = (data || []).filter((x: any) => !x.expires_at || new Date(x.expires_at) > new Date());
  return ok(res, valid.map(sourceDto));
}));

app.get(`${api}/search`, asyncRoute(async (req, res) => {
  const q = z.string().trim().min(1).max(100).parse(req.query.q);
  const [movies, series] = await Promise.all([
    adminSupabase.from('movies').select('*').eq('status', 'published').or(`title_ar.ilike.%${q}%,title_en.ilike.%${q}%,original_title.ilike.%${q}%`).limit(24),
    adminSupabase.from('series').select('*').eq('status', 'published').or(`title_ar.ilike.%${q}%,title_en.ilike.%${q}%,original_title.ilike.%${q}%`).limit(24),
  ]);
  const movieRows = await Promise.all((movies.data || []).map(movieDto));
  const seriesRows = await Promise.all((series.data || []).map(seriesDto));
  return ok(res, { movies: movieRows, series: seriesRows, cast: [] }, { total: movieRows.length + seriesRows.length });
}));

app.get(`${api}/home`, asyncRoute(async (_req, res) => {
  const [movies, series, genres] = await Promise.all([
    adminSupabase.from('movies').select('*').eq('status', 'published').order('vote_count', { ascending: false }).limit(12),
    adminSupabase.from('series').select('*').eq('status', 'published').order('vote_count', { ascending: false }).limit(12),
    adminSupabase.from('genres').select('id,name_ar,name_en,slug').order('id'),
  ]);
  const movieDtos = await Promise.all((movies.data || []).map(movieDto));
  const seriesDtos = await Promise.all((series.data || []).map(seriesDto));
  const combined = [...movieDtos, ...seriesDtos].sort((a: any, b: any) => b.rating - a.rating);
  return ok(res, {
    hero: combined.find((x: any) => x.isFeatured) || combined[0],
    continueWatching: [],
    trending: combined.filter((x: any) => x.isTrending),
    popularMovies: movieDtos.filter((x: any) => x.isPopular),
    featuredSeries: seriesDtos.filter((x: any) => x.isFeatured),
    recentAdded: [...movieDtos, ...seriesDtos].sort((a: any, b: any) => String(b.addedAt).localeCompare(String(a.addedAt))),
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
  return ok(res, (data || []).map((x: any) => ({
    id: x.id, userId: x.user_id, contentId: x.content_id, contentType: x.content_type,
    title: '', titleEn: '', posterUrl: '', year: 0, rating: 0, genres: [], addedAt: x.created_at,
  })));
}));

app.post(`${api}/watchlist`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const body = z.object({ contentId: z.string().uuid(), contentType: z.enum(['movie', 'series']) }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid watchlist item');
  const { data, error } = await req.supabase!.from('watchlist').upsert({
    user_id: req.userId!, content_id: body.data.contentId, content_type: body.data.contentType,
  }, { onConflict: 'user_id,content_type,content_id' }).select('*').single();
  if (error) return fail(res, 500, 'WATCHLIST_WRITE_FAILED', 'Unable to save watchlist item');
  return created(res, { id: data.id, userId: data.user_id, contentId: data.content_id, contentType: data.content_type, title: '', titleEn: '', posterUrl: '', year: 0, rating: 0, genres: [], addedAt: data.created_at });
}));

app.delete(`${api}/watchlist/:contentId`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { error } = await req.supabase!.from('watchlist').delete().eq('user_id', req.userId!).eq('content_id', req.params.contentId);
  if (error) return fail(res, 500, 'WATCHLIST_DELETE_FAILED', 'Unable to remove watchlist item');
  return ok(res, { removed: true });
}));

app.get(`${api}/history`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { data, error } = await req.supabase!.from('watch_history').select('*').eq('user_id', req.userId!).order('updated_at', { ascending: false }).limit(100);
  if (error) return fail(res, 500, 'HISTORY_QUERY_FAILED', 'Unable to load history');
  return ok(res, (data || []).map((x: any) => ({
    contentId: x.content_id,
    contentType: x.content_type === 'episode' ? 'series' : 'movie',
    title: '', titleEn: '', posterUrl: '', backdropUrl: '',
    positionSeconds: x.position_seconds, durationSeconds: x.duration_seconds,
    percentage: x.duration_seconds ? Math.floor((x.position_seconds / x.duration_seconds) * 100) : 0,
    lastWatchedAt: x.updated_at, completed: x.completed,
  })));
}));

app.get(`${api}/watch/:id/progress`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const episodeId = typeof req.query.episodeId === 'string' ? req.query.episodeId : null;
  const contentType = episodeId ? 'episode' : 'movie';
  const contentId = episodeId || req.params.id;
  const { data, error } = await req.supabase!.from('watch_history').select('*').eq('user_id', req.userId!).eq('content_type', contentType).eq('content_id', contentId).maybeSingle();
  if (error) return fail(res, 500, 'PROGRESS_QUERY_FAILED', 'Unable to load progress');
  if (!data) return ok(res, null);
  return ok(res, {
    contentId: data.content_id,
    contentType: contentType === 'episode' ? 'series' : 'movie',
    title: '', titleEn: '', posterUrl: '', backdropUrl: '',
    positionSeconds: data.position_seconds, durationSeconds: data.duration_seconds,
    percentage: data.duration_seconds ? Math.floor((data.position_seconds / data.duration_seconds) * 100) : 0,
    lastWatchedAt: data.updated_at, completed: data.completed, episodeId: episodeId || undefined,
  });
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
    contentId: z.string().uuid(), contentTitle: z.string().max(300),
    sourceId: z.string().uuid(), issueType: z.string().max(80), description: z.string().max(2000),
  }).safeParse(req.body);
  if (!body.success) return fail(res, 400, 'INVALID_BODY', 'Invalid report payload');
  const { data, error } = await req.supabase!.from('reports').insert({
    user_id: req.userId!, content_id: body.data.contentId, content_type: 'movie',
    source_id: body.data.sourceId, issue_type: body.data.issueType, description: body.data.description,
  }).select('*').single();
  if (error) return fail(res, 500, 'REPORT_WRITE_FAILED', 'Unable to submit report');
  return created(res, {
    id: data.id, contentId: data.content_id, contentTitle: body.data.contentTitle,
    sourceId: data.source_id, issueType: data.issue_type, description: data.description || '',
    reportedAt: data.created_at, status: data.status,
  });
}));

app.get(`${api}/admin/stats`, requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const [m, s, e, p, src] = await Promise.all([
    adminSupabase.from('movies').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    adminSupabase.from('series').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    adminSupabase.from('episodes').select('id', { count: 'exact', head: true }),
    adminSupabase.from('providers').select('id', { count: 'exact', head: true }).eq('enabled', true),
    adminSupabase.from('playback_sources').select('id', { count: 'exact', head: true }).eq('is_working', true),
  ]);
  return ok(res, {
    totalMovies: m.count || 0, totalSeries: s.count || 0, totalEpisodes: e.count || 0,
    activeProviders: p.count || 0, streamHealthPct: src.count ? 100 : 0, dailyStreamRequests: 0,
  });
}));

app.get(`${api}/admin/providers`, requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await adminSupabase.from('providers').select('*').order('name');
  if (error) return fail(res, 500, 'PROVIDERS_QUERY_FAILED', 'Unable to load providers');
  return ok(res, (data || []).map((p: any) => ({
    id: p.id, name: p.name, adapterName: p.adapter_name, type: 'api',
    status: p.status, latencyMs: p.latency_ms || 0, successRate: Number(p.success_rate || 0),
    lastChecked: p.last_checked_at || '', activeSources: 0,
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

app.get(`${api}/admin/sync/tmdb`, requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  return ok(res, { status: 'not_configured', syncedCount: 0, message: 'TMDB sync worker is not configured yet' });
}));

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (res.headersSent) return;
  return fail(res, 500, 'INTERNAL_ERROR', 'Internal server error');
});

app.listen(port, () => console.log(`Movyz API listening on port ${port}`));

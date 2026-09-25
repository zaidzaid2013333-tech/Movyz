import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { z } from 'zod';
import { adminSupabase } from './supabase';
import { asyncRoute, created, fail, ok } from './http';
import { requireAdmin, requireAuth, type AuthenticatedRequest } from './auth';
import { runTmdbSync, syncEpisodesForSeries } from './tmdb';
import { getProvider } from './providers/registry';
import { resolvePlaybackSources } from './providers/resolver';

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

const movieCardDto = (row: any, genres: any[] = []) => ({
  id: row.id,
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
  const rows = data || [];
  const genreMap = await batchMovieGenres(rows.map((row: any) => row.id));
  const output = rows.map((row: any) => movieCardDto(row, genreMap.get(row.id) || []));
  return ok(res, output, { page: q.page, limit: q.limit, total: count || 0, totalPages: Math.ceil((count || 0) / q.limit) || 1 });
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
  const rows = data || [];
  const genreMap = await batchSeriesGenres(rows.map((row: any) => row.id));
  const output = rows.map((row: any) => seriesCardDto(row, genreMap.get(row.id) || []));
  return ok(res, output, { page: q.page, limit: q.limit, total: count || 0, totalPages: Math.ceil((count || 0) / q.limit) || 1 });
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

  if (valid.length) {
    return ok(res, valid.map(sourceDto));
  }

  try {
    const resolved = await resolvePlaybackSources(type, contentId);
    if (resolved.length) return ok(res, resolved);
  } catch (error) {
    console.error('Provider resolution failed:', error);
  }

  return ok(res, []);
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
  const [movies, series, genres] = await Promise.all([
    adminSupabase.from('movies').select('*').eq('status', 'published').order('vote_count', { ascending: false }).limit(12),
    adminSupabase.from('series').select('*').eq('status', 'published').order('vote_count', { ascending: false }).limit(12),
    adminSupabase.from('genres').select('id,name_ar,name_en,slug').order('id'),
  ]);
  const movieRows = movies.data || [];
  const seriesRows = series.data || [];
  const [movieGenres, seriesGenres] = await Promise.all([
    batchMovieGenres(movieRows.map((row: any) => row.id)),
    batchSeriesGenres(seriesRows.map((row: any) => row.id)),
  ]);
  const movieDtos = movieRows.map((row: any) => movieCardDto(row, movieGenres.get(row.id) || []));
  const seriesDtos = seriesRows.map((row: any) => seriesCardDto(row, seriesGenres.get(row.id) || []));
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
    movieIds.length ? adminSupabase.from('movies').select('id,title_ar,title_en,poster_url,backdrop_url,rating').in('id', movieIds) : { data: [] as any[] },
    episodeIds.length ? adminSupabase.from('episodes').select('id,season_id,episode_number,name_ar,name_en').in('id', episodeIds) : { data: [] as any[] },
  ]);
  const movieMap = new Map((movies.data || []).map((x: any) => [x.id, x]));
  const episodeRows = episodes.data || []; const seasonIds = episodeRows.map((x: any) => x.season_id);
  const { data: seasons } = seasonIds.length ? await adminSupabase.from('seasons').select('id,series_id,season_number').in('id', seasonIds) : { data: [] as any[] };
  const seasonMap = new Map((seasons || []).map((x: any) => [x.id, x]));
  const seriesIds = [...new Set((seasons || []).map((x: any) => x.series_id))];
  const { data: seriesRows } = seriesIds.length ? await adminSupabase.from('series').select('id,title_ar,title_en,poster_url,backdrop_url,rating').in('id', seriesIds) : { data: [] as any[] };
  const seriesMap = new Map((seriesRows || []).map((x: any) => [x.id, x])); const episodeMap = new Map(episodeRows.map((x: any) => [x.id, x]));
  return ok(res, rows.map((x: any) => {
    const movie = x.content_type === 'movie' ? movieMap.get(x.content_id) : null; const episode = x.content_type === 'episode' ? episodeMap.get(x.content_id) : null;
    const season = episode ? seasonMap.get(episode.season_id) : null; const series = season ? seriesMap.get(season.series_id) : null; const base = movie || series;
    return { contentId: base?.id || x.content_id, contentType: movie ? 'movie' : 'series', episodeId: episode?.id || undefined, episodeNumber: episode?.episode_number || undefined, seasonNumber: season?.season_number || undefined,
      title: base?.title_ar || episode?.name_ar || '', titleEn: base?.title_en || episode?.name_en || '', posterUrl: base?.poster_url || '', backdropUrl: base?.backdrop_url || '',
      positionSeconds: x.position_seconds, durationSeconds: x.duration_seconds, percentage: x.duration_seconds ? Math.floor((x.position_seconds / x.duration_seconds) * 100) : 0, lastWatchedAt: x.updated_at, completed: x.completed };
  }));
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

app.post(`${api}/watch/:id/progress`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {app.post(`${api}/watch/:id/progress`, requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
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

app.post(`${api}/admin/providers/:id/test`, requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const { data, error } = await adminSupabase
    .from('providers')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error || !data) return fail(res, 404, 'PROVIDER_NOT_FOUND', 'Provider not found');

  const adapter = getProvider(data.key);
  if (!adapter || !adapter.enabled) {
    return fail(res, 409, 'PROVIDER_ADAPTER_NOT_CONFIGURED', 'Provider adapter is not configured');
  }

  const started = Date.now();
  try {
    const health = await adapter.health();
    const latencyMs = Date.now() - started;
    await adminSupabase
      .from('providers')
      .update({
        status: health.status,
        latency_ms: latencyMs,
        success_rate: health.status === 'healthy' ? 100 : health.status === 'degraded' ? 50 : 0,
        last_checked_at: new Date().toISOString(),
      })
      .eq('id', data.id);

    return ok(res, {
      id: data.id,
      name: data.name,
      adapterName: data.adapter_name,
      type: 'api',
      status: health.status,
      latencyMs,
      successRate: health.status === 'healthy' ? 100 : health.status === 'degraded' ? 50 : 0,
      lastChecked: new Date().toISOString(),
      activeSources: 0,
    });
  } catch (error) {
    return fail(res, 502, 'PROVIDER_HEALTH_CHECK_FAILED', error instanceof Error ? error.message : 'Provider health check failed');
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

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (res.headersSent) return;
  return fail(res, 500, 'INTERNAL_ERROR', 'Internal server error');
});

app.listen(port, () => console.log(`Movyz API listening on port ${port}`));

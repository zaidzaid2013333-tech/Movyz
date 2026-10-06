import { supabase } from '../lib/supabase';
import {
  Movie, Series, Genre, WatchProgress, WatchlistItem, StreamReport,
  UserProfile, ApiResponse, Season, Episode, CastMember
} from '../types';

type DbMovie = any;
type DbSeries = any;

const ok = <T,>(data: T, meta?: ApiResponse<T>['meta']): ApiResponse<T> => ({
  success: true,
  data,
  ...(meta ? { meta } : {}),
});

const requireSupabase = () => {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
};

const genre = (g: any): Genre => ({
  id: Number(g.id),
  name: g.name_ar || g.name || '',
  nameEn: g.name_en || g.nameEn || '',
  slug: g.slug || '',
});

const castMember = (row: any): CastMember => ({
  id: row.person_id || row.id,
  name: row.people?.name_ar || row.name_ar || row.people?.name_en || row.name_en || '',
  nameEn: row.people?.name_en || row.name_en || row.people?.name_ar || row.name_ar || '',
  character: row.character_ar || row.character_en || '',
  characterEn: row.character_en || row.character_ar || '',
  avatarUrl: row.people?.avatar_url || row.avatar_url || '',
});

const mapMovie = (m: DbMovie, genres: Genre[] = [], cast: CastMember[] = []): Movie => ({
  id: m.id,
  tmdbId: Number(m.tmdb_id || 0),
  type: 'movie',
  title: m.title_ar || m.title_en || '',
  titleEn: m.title_en || m.title_ar || '',
  originalTitle: m.original_title || m.title_en || m.title_ar || '',
  year: Number(String(m.release_date || '').slice(0, 4) || 0),
  releaseDate: m.release_date || '',
  rating: Number(m.rating || 0),
  votesCount: Number(m.vote_count || 0),
  runtime: Number(m.runtime_minutes || 0),
  overview: m.overview_ar || m.overview_en || '',
  overviewEn: m.overview_en || m.overview_ar || '',
  posterUrl: m.poster_url || '',
  backdropUrl: m.backdrop_url || '',
  genres,
  director: m.metadata?.director_ar || m.metadata?.director || '',
  directorEn: m.metadata?.director_en || m.metadata?.director || '',
  cast,
  sources: [],
  isFeatured: !!m.featured,
  isTrending: !!m.trending,
  isPopular: !!m.popular,
  addedAt: m.created_at || '',
  ageRating: m.age_rating || '',
});

const mapEpisode = (e: any, seriesId: string, seasonNumber: number): Episode => ({
  id: e.id,
  tmdbId: e.tmdb_id ? Number(e.tmdb_id) : undefined,
  seriesId,
  seasonNumber,
  episodeNumber: Number(e.episode_number || 0),
  title: e.name_ar || e.name_en || '',
  titleEn: e.name_en || e.name_ar || '',
  overview: e.overview_ar || e.overview_en || '',
  overviewEn: e.overview_en || e.overview_ar || '',
  stillUrl: e.still_url || '',
  duration: Number(e.runtime_minutes || 0),
  airDate: e.air_date || '',
  sources: [],
});

const mapSeason = (s: any, seriesId: string, episodes: Episode[] = []): Season => ({
  id: s.id,
  seriesId,
  seasonNumber: Number(s.season_number || 0),
  name: s.name_ar || s.name_en || '',
  nameEn: s.name_en || s.name_ar || '',
  posterUrl: s.poster_url || '',
  overview: s.overview_ar || s.overview_en || '',
  airDate: s.air_date || '',
  episodesCount: episodes.length,
  episodes,
});

const mapSeries = (s: DbSeries, genres: Genre[] = [], cast: CastMember[] = [], seasons: Season[] = []): Series => ({
  id: s.id,
  tmdbId: Number(s.tmdb_id || 0),
  type: 'series',
  title: s.title_ar || s.title_en || '',
  titleEn: s.title_en || s.title_ar || '',
  originalTitle: s.original_title || s.title_en || s.title_ar || '',
  startYear: Number(String(s.first_air_date || '').slice(0, 4) || 0),
  endYear: s.last_air_date ? Number(String(s.last_air_date).slice(0, 4)) : undefined,
  releaseDate: s.first_air_date || '',
  rating: Number(s.rating || 0),
  votesCount: Number(s.vote_count || 0),
  overview: s.overview_ar || s.overview_en || '',
  overviewEn: s.overview_en || s.overview_ar || '',
  posterUrl: s.poster_url || '',
  backdropUrl: s.backdrop_url || '',
  genres,
  creator: s.metadata?.creator_ar || s.metadata?.creator || '',
  creatorEn: s.metadata?.creator_en || s.metadata?.creator || '',
  cast,
  seasonsCount: seasons.length || Number(s.metadata?.seasons_count || 0),
  episodesCount: seasons.reduce((n, x) => n + x.episodesCount, 0),
  seasons,
  isFeatured: !!s.featured,
  isTrending: !!s.trending,
  isPopular: !!s.popular,
  status: s.status,
  addedAt: s.created_at || '',
  ageRating: s.age_rating || '',
});

async function getMovieExtras(movieId: string) {
  const db = requireSupabase();
  const [{ data: links }, { data: castLinks }] = await Promise.all([
    db.from('movie_genres').select('genre_id, genres(*)').eq('movie_id', movieId),
    db.from('movie_cast').select('person_id, character_ar, character_en, people(*)').eq('movie_id', movieId).order('cast_order', { ascending: true }),
  ]);
  return {
    genres: (links || []).map((x: any) => genre(x.genres)).filter((x: Genre) => x.id),
    cast: (castLinks || []).map(castMember),
  };
}

async function getSeriesExtras(seriesId: string) {
  const db = requireSupabase();
  const [{ data: genreLinks }, { data: castLinks }, { data: seasonRows }] = await Promise.all([
    db.from('series_genres').select('genre_id, genres(*)').eq('series_id', seriesId),
    db.from('series_cast').select('person_id, character_ar, character_en, people(*)').eq('series_id', seriesId).order('cast_order', { ascending: true }),
    db.from('seasons').select('*').eq('series_id', seriesId).order('season_number', { ascending: true }),
  ]);
  const seasons = await Promise.all((seasonRows || []).map(async (s: any) => {
    const { data: eps } = await db.from('episodes').select('*').eq('season_id', s.id).order('episode_number', { ascending: true });
    return mapSeason(s, seriesId, (eps || []).map((e: any) => mapEpisode(e, seriesId, Number(s.season_number))));
  }));
  return {
    genres: (genreLinks || []).map((x: any) => genre(x.genres)).filter((x: Genre) => x.id),
    cast: (castLinks || []).map(castMember),
    seasons,
  };
}

async function listMovies(params: {
  genreId?: number; year?: number; minRating?: number; sortBy?: 'popular' | 'rating' | 'newest';
  search?: string; page?: number; limit?: number;
} = {}) {
  const db = requireSupabase();
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(48, Math.max(1, params.limit || 24));
  let q = db.from('movies').select('*', { count: 'exact' }).eq('status', 'published');
  if (params.genreId) {
    const { data: ids } = await db.from('movie_genres').select('movie_id').eq('genre_id', params.genreId);
    const movieIds = (ids || []).map((x: any) => x.movie_id);
    if (!movieIds.length) return ok<Movie[]>([], { page, limit, total: 0, totalPages: 0 });
    q = q.in('id', movieIds);
  }
  if (params.year) q = q.gte('release_date', `${params.year}-01-01`).lte('release_date', `${params.year}-12-31`);
  if (params.minRating) q = q.gte('rating', params.minRating);
  if (params.search) {
    const term = params.search.replace(/[%_]/g, '');
    q = q.or(`title_ar.ilike.%${term}%,title_en.ilike.%${term}%,original_title.ilike.%${term}%`);
  }
  if (params.sortBy === 'rating') q = q.order('rating', { ascending: false });
  else if (params.sortBy === 'newest') q = q.order('release_date', { ascending: false, nullsFirst: false });
  else q = q.order(params.sortBy === 'popular' ? 'vote_count' : 'created_at', { ascending: false, nullsFirst: false });
  q = q.range((page - 1) * limit, page * limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return ok((data || []).map((m: any) => mapMovie(m)), {
    page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit),
  });
}

async function listSeries(params: {
  genreId?: number; year?: number; sortBy?: 'popular' | 'rating' | 'newest'; search?: string;
  page?: number; limit?: number;
} = {}) {
  const db = requireSupabase();
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(48, Math.max(1, params.limit || 24));
  let q = db.from('series').select('*', { count: 'exact' }).eq('status', 'published');
  if (params.genreId) {
    const { data: ids } = await db.from('series_genres').select('series_id').eq('genre_id', params.genreId);
    const seriesIds = (ids || []).map((x: any) => x.series_id);
    if (!seriesIds.length) return ok<Series[]>([], { page, limit, total: 0, totalPages: 0 });
    q = q.in('id', seriesIds);
  }
  if (params.year) q = q.gte('first_air_date', `${params.year}-01-01`).lte('first_air_date', `${params.year}-12-31`);
  if (params.search) {
    const term = params.search.replace(/[%_]/g, '');
    q = q.or(`title_ar.ilike.%${term}%,title_en.ilike.%${term}%,original_title.ilike.%${term}%`);
  }
  if (params.sortBy === 'rating') q = q.order('rating', { ascending: false });
  else if (params.sortBy === 'newest') q = q.order('first_air_date', { ascending: false, nullsFirst: false });
  else q = q.order(params.sortBy === 'popular' ? 'vote_count' : 'created_at', { ascending: false, nullsFirst: false });
  q = q.range((page - 1) * limit, page * limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return ok((data || []).map((s: any) => mapSeries(s)), {
    page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit),
  });
}

export const MovyzaApi = {
  getHomeData: async () => {
    const [featured, trending, popularMovies, featuredSeries, recentAdded, genres] = await Promise.all([
      listMovies({ limit: 12 }).then((x) => x.data),
      listMovies({ sortBy: 'popular', limit: 12 }).then((x) => x.data),
      listMovies({ sortBy: 'rating', limit: 12 }).then((x) => x.data),
      listSeries({ sortBy: 'popular', limit: 12 }).then((x) => x.data),
      Promise.all([
        listMovies({ sortBy: 'newest', limit: 8 }).then((x) => x.data),
        listSeries({ sortBy: 'newest', limit: 8 }).then((x) => x.data),
      ]).then(([m, s]) => [...m, ...s].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 12)),
      MovyzaApi.getGenres().then((x) => x.data),
    ]);
    const hero = featured.find((x) => x.isFeatured) || featured[0] || trending[0] || popularMovies[0] || featuredSeries[0];
    const history = await MovyzaApi.getWatchHistory().catch(() => ok<WatchProgress[]>([]));
    return ok({
      hero: hero as Movie | Series,
      continueWatching: history.data.filter((x) => !x.completed && x.percentage > 2).slice(0, 12),
      trending,
      popularMovies,
      featuredSeries,
      recentAdded,
      genres,
    });
  },

  getMovies: (params?: Parameters<typeof listMovies>[0]) => listMovies(params),
  getMovieById: async (id: string) => {
    const db = requireSupabase();
    const { data, error } = await db.from('movies').select('*').eq('id', id).eq('status', 'published').single();
    if (error) throw error;
    const extras = await getMovieExtras(id);
    const similar = (await listMovies({ genreId: extras.genres[0]?.id, limit: 12 })).data.filter((x) => x.id !== id);
    return ok({ movie: mapMovie(data, extras.genres, extras.cast), similar });
  },
  getMovieByTmdbId: async (tmdbId: number) => {
    const db = requireSupabase();
    const { data, error } = await db.from('movies').select('*').eq('tmdb_id', tmdbId).eq('status', 'published').single();
    if (error) throw error;
    const extras = await getMovieExtras(data.id);
    const similar = (await listMovies({ genreId: extras.genres[0]?.id, limit: 12 })).data.filter((x) => x.id !== data.id);
    return ok({ movie: mapMovie(data, extras.genres, extras.cast), similar });
  },
  getSeries: (params?: Parameters<typeof listSeries>[0]) => listSeries(params),
  getSeriesById: async (id: string) => {
    const db = requireSupabase();
    const { data, error } = await db.from('series').select('*').eq('id', id).eq('status', 'published').single();
    if (error) throw error;
    const extras = await getSeriesExtras(id);
    const similar = (await listSeries({ limit: 12 })).data.filter((x) => x.id !== id);
    return ok({ series: mapSeries(data, extras.genres, extras.cast, extras.seasons), similar });
  },
  getSeriesByTmdbId: async (tmdbId: number) => {
    const db = requireSupabase();
    const { data, error } = await db.from('series').select('*').eq('tmdb_id', tmdbId).eq('status', 'published').single();
    if (error) throw error;
    const extras = await getSeriesExtras(data.id);
    const similar = (await listSeries({ limit: 12 })).data.filter((x) => x.id !== data.id);
    return ok({ series: mapSeries(data, extras.genres, extras.cast, extras.seasons), similar });
  },
  getSeriesWatchByTmdbId: async (tmdbId: number, season: number, episode: number) => {
    const base = await MovyzaApi.getSeriesByTmdbId(tmdbId);
    const currentSeason = base.data.series.seasons.find((s) => s.seasonNumber === season) || base.data.series.seasons[0];
    if (!currentSeason) throw new Error('Season not found');
    return ok({ series: base.data.series, currentSeason });
  },
  getSeriesWatchById: async (id: string, season: number, episode: number) => {
    const base = await MovyzaApi.getSeriesById(id);
    const currentSeason = base.data.series.seasons.find((s) => s.seasonNumber === season) || base.data.series.seasons[0];
    if (!currentSeason) throw new Error('Season not found');
    return ok({ series: base.data.series, currentSeason });
  },
  searchCatalog: async (search: string) => {
    const term = search.trim().replace(/[%_]/g, '');
    if (!term) return ok({ movies: [], series: [], cast: [] });
    const db = requireSupabase();
    const [m, s, p] = await Promise.all([
      db.from('movies').select('*').eq('status', 'published').or(`title_ar.ilike.%${term}%,title_en.ilike.%${term}%,original_title.ilike.%${term}%`).limit(20),
      db.from('series').select('*').eq('status', 'published').or(`title_ar.ilike.%${term}%,title_en.ilike.%${term}%,original_title.ilike.%${term}%`).limit(20),
      db.from('people').select('*').or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%,original_name.ilike.%${term}%`).limit(12),
    ]);
    if (m.error) throw m.error;
    if (s.error) throw s.error;
    if (p.error) throw p.error;
    return ok({
      movies: (m.data || []).map((x: any) => mapMovie(x)),
      series: (s.data || []).map((x: any) => mapSeries(x)),
      cast: (p.data || []).map((x: any) => ({ name: x.name_ar || x.name_en || '', nameEn: x.name_en || x.name_ar || '', worksCount: 0, avatarUrl: x.avatar_url || '' })),
    });
  },
  getGenres: async () => {
    const db = requireSupabase();
    const { data, error } = await db.from('genres').select('*').order('name_en');
    if (error) throw error;
    return ok((data || []).map(genre));
  },

  getWatchlist: async () => {
    const db = requireSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) return ok<WatchlistItem[]>([]);
    const { data, error } = await db.from('watchlist').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (error) throw error;
    const rows = data || [];
    const movieIds = rows.filter((x: any) => x.content_type === 'movie').map((x: any) => x.content_id);
    const seriesIds = rows.filter((x: any) => x.content_type === 'series').map((x: any) => x.content_id);
    const [{ data: movies }, { data: series }] = await Promise.all([
      movieIds.length ? db.from('movies').select('*').in('id', movieIds) : Promise.resolve({ data: [] as any[] }),
      seriesIds.length ? db.from('series').select('*').in('id', seriesIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const map = new Map<string, any>([...(movies || []), ...(series || [])].map((x) => [x.id, x]));
    return ok(rows.map((r: any) => {
      const item = map.get(r.content_id) || {};
      return {
        id: r.id, userId: r.user_id, contentId: r.content_id, contentType: r.content_type,
        title: item.title_ar || item.title_en || '', titleEn: item.title_en || item.title_ar || '',
        posterUrl: item.poster_url || '', year: Number(String(item.release_date || item.first_air_date || '').slice(0, 4) || 0),
        rating: Number(item.rating || 0), genres: [], addedAt: r.created_at,
      } as WatchlistItem;
    }));
  },

  addToWatchlist: async (item: Omit<WatchlistItem, 'id' | 'addedAt'>) => {
    const db = requireSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) throw new Error('You must be signed in');
    const { data, error } = await db.from('watchlist').upsert({
      user_id: user.id, content_type: item.contentType, content_id: item.contentId,
    }, { onConflict: 'user_id,content_type,content_id' }).select('*').single();
    if (error) throw error;
    return ok({ ...item, id: data.id, addedAt: data.created_at } as WatchlistItem);
  },

  removeFromWatchlist: async (contentId: string) => {
    const db = requireSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) throw new Error('You must be signed in');
    const { error } = await db.from('watchlist').delete().eq('user_id', user.id).eq('content_id', contentId);
    if (error) throw error;
    return ok({ removed: true });
  },

  getWatchHistory: async () => {
    const db = requireSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) return ok<WatchProgress[]>([]);
    const { data, error } = await db.from('watch_history').select('*').eq('user_id', user.id).order('updated_at', { ascending: false });
    if (error) throw error;
    const rows = data || [];
    const movieIds = rows.filter((x: any) => x.content_type === 'movie').map((x: any) => x.content_id);
    const [{ data: movies }] = await Promise.all([
      movieIds.length ? db.from('movies').select('*').in('id', movieIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const movieMap = new Map((movies || []).map((x: any) => [x.id, x]));
    return ok(rows.filter((r: any) => r.content_type === 'movie').map((r: any) => {
      const m = movieMap.get(r.content_id) || {};
      const duration = Number(r.duration_seconds || 0);
      return {
        contentId: r.content_id, tmdbId: Number(m.tmdb_id || 0), contentType: 'movie',
        title: m.title_ar || m.title_en || '', titleEn: m.title_en || m.title_ar || '',
        posterUrl: m.poster_url || '', backdropUrl: m.backdrop_url || '', positionSeconds: Number(r.position_seconds || 0),
        durationSeconds: duration, percentage: duration ? Math.min(100, Math.round(Number(r.position_seconds || 0) / duration * 100)) : 0,
        lastWatchedAt: r.updated_at, completed: !!r.completed,
      } as WatchProgress;
    }));
  },

  clearWatchHistory: async () => {
    const db = requireSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) return ok({ cleared: true });
    const { error } = await db.from('watch_history').delete().eq('user_id', user.id);
    if (error) throw error;
    return ok({ cleared: true });
  },

  getWatchProgress: async (contentId: string) => {
    const db = requireSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) return ok<WatchProgress | null>(null);
    const { data, error } = await db.from('watch_history').select('*').eq('user_id', user.id).eq('content_id', contentId).maybeSingle();
    if (error) throw error;
    if (!data) return ok<WatchProgress | null>(null);
    const [movie, series] = await Promise.all([
      db.from('movies').select('*').eq('id', contentId).maybeSingle(),
      db.from('series').select('*').eq('id', contentId).maybeSingle(),
    ]);
    const m = movie.data || series.data || {};
    const duration = Number(data.duration_seconds || 0);
    return ok({
      contentId, tmdbId: Number(m.tmdb_id || 0), contentType: data.content_type,
      title: m.title_ar || m.title_en || '', titleEn: m.title_en || m.title_ar || '',
      posterUrl: m.poster_url || '', backdropUrl: m.backdrop_url || '',
      positionSeconds: Number(data.position_seconds || 0), durationSeconds: duration,
      percentage: duration ? Math.min(100, Math.round(Number(data.position_seconds || 0) / duration * 100)) : 0,
      lastWatchedAt: data.updated_at, completed: !!data.completed,
    } as WatchProgress);
  },

  saveWatchProgress: async (progress: WatchProgress) => {
    const db = requireSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) throw new Error('You must be signed in');
    const { data, error } = await db.from('watch_history').upsert({
      user_id: user.id, content_type: progress.contentType === 'series' ? 'movie' : progress.contentType,
      content_id: progress.episodeId || progress.contentId,
      position_seconds: Math.floor(progress.positionSeconds),
      duration_seconds: Math.floor(progress.durationSeconds),
      completed: progress.completed,
    }, { onConflict: 'user_id,content_type,content_id' }).select('*').single();
    if (error) throw error;
    return ok(progress);
  },

  reportIssue: async (_report: Omit<StreamReport, 'id' | 'reportedAt' | 'status'> & { contentType: 'movie' | 'episode' }) => {
    throw new Error('Playback reports are disabled in catalog-only mode.');
  },

  getAdminStats: async () => {
    const db = requireSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) throw new Error('Authentication required');
    const profile = await db.from('profiles').select('role').eq('id', user.id).single();
    if (profile.data?.role !== 'ADMIN' && profile.data?.role !== 'OWNER') throw new Error('Admin access required');
    const [{ count: movies }, { count: series }, { count: episodes }] = await Promise.all([
      db.from('movies').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      db.from('series').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      db.from('episodes').select('id', { count: 'exact', head: true }),
    ]);
    return ok({ totalMovies: movies || 0, totalSeries: series || 0, totalEpisodes: episodes || 0, activeProviders: 0, streamHealthPct: 0, dailyStreamRequests: 0 });
  },

  getMe: async () => {
    const db = requireSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) throw new Error('Not authenticated');
    const { data: profile, error } = await db.from('profiles').select('*').eq('id', user.id).single();
    if (error) throw error;
    return ok<UserProfile>({
      id: user.id, email: user.email || '', name: profile.display_name || '',
      role: profile.role, avatarUrl: profile.avatar_url || '', preferredLanguage: profile.locale || 'ar',
      createdAt: profile.created_at,
    });
  },
};

export { ok as apiResponse };
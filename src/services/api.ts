import { supabase } from '../lib/supabase';
import { Language, getLanguageConfig, getLanguageFromPath, detectLanguageFromBrowser } from '../lib/i18n';
import {
  Movie, Series, Genre, WatchProgress, WatchlistItem, StreamReport,
  UserProfile, ApiResponse, Season, Episode, CastMember
} from '../types';

const TMDB_BASE = (import.meta.env.VITE_TMDB_PROXY_URL || '/tmdb').replace(/\/$/, '');

const ok = <T,>(data: T, meta?: ApiResponse<T>['meta']): ApiResponse<T> => ({
  success: true,
  data,
  ...(meta ? { meta } : {}),
});

const getRequestLanguage = (): Language => {
  if (typeof window !== 'undefined') {
    return getLanguageFromPath(window.location.pathname) || detectLanguageFromBrowser();
  }
  return 'ar';
};

const tmdb = async <T,>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> => {
  const language = getRequestLanguage();
  const config = getLanguageConfig(language);
  const search = new URLSearchParams();
  search.set('language', config.tmdb);
  search.set('region', config.region);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const response = await fetch(`${TMDB_BASE}/${path.replace(/^\//, '')}?${search.toString()}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.status_message || `TMDB request failed (${response.status})`);
  return payload as T;
};

const movieMap = (m: any): Movie => ({
  id: String(m.id),
  tmdbId: Number(m.id),
  type: 'movie',
  title: m.title || m.original_title || '',
  titleEn: m.original_title || m.title || '',
  originalTitle: m.original_title || m.title || '',
  year: Number(String(m.release_date || '').slice(0, 4) || 0),
  releaseDate: m.release_date || '',
  rating: Number(m.vote_average || 0),
  votesCount: Number(m.vote_count || 0),
  runtime: Number(m.runtime || 0),
  overview: m.overview || '',
  overviewEn: m.overview || '',
  posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '',
  backdropUrl: m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : '',
  genres: (m.genres || m.genre_ids || []).map((g: any) => typeof g === 'number' ? ({ id: g, name: '', nameEn: '', slug: '' }) : ({ id: Number(g.id), name: g.name || '', nameEn: g.name || '', slug: String(g.name || '').toLowerCase().replace(/\s+/g, '-') })),
  director: (m.credits?.crew || []).find((x: any) => x.job === 'Director')?.name || '',
  directorEn: (m.credits?.crew || []).find((x: any) => x.job === 'Director')?.original_name || '',
  cast: (m.credits?.cast || []).slice(0, 16).map((x: any) => ({
    id: String(x.id), name: x.name || '', nameEn: x.original_name || x.name || '',
    character: x.character || '', characterEn: x.character || '',
    avatarUrl: x.profile_path ? `https://image.tmdb.org/t/p/w185${x.profile_path}` : '',
  })),
  sources: [],
  isFeatured: false,
  isTrending: false,
  isPopular: false,
  addedAt: m.release_date || new Date().toISOString(),
  ageRating: '',
});

const episodeMap = (e: any, seriesId: string, seasonNumber: number): Episode => ({
  id: String(e.id),
  tmdbId: Number(e.id),
  seriesId,
  seasonNumber,
  episodeNumber: Number(e.episode_number || 0),
  title: e.name || e.original_name || '',
  titleEn: e.original_name || e.name || '',
  overview: e.overview || '',
  overviewEn: e.overview || '',
  stillUrl: e.still_path ? `https://image.tmdb.org/t/p/w780${e.still_path}` : '',
  duration: Number(e.runtime || 0),
  airDate: e.air_date || '',
  sources: [],
});

const seriesMap = (s: any, seasons: Season[] = []): Series => ({
  id: String(s.id),
  tmdbId: Number(s.id),
  type: 'series',
  title: s.name || s.original_name || '',
  titleEn: s.original_name || s.name || '',
  originalTitle: s.original_name || s.name || '',
  startYear: Number(String(s.first_air_date || '').slice(0, 4) || 0),
  endYear: s.last_air_date ? Number(String(s.last_air_date).slice(0, 4)) : undefined,
  releaseDate: s.first_air_date || '',
  rating: Number(s.vote_average || 0),
  votesCount: Number(s.vote_count || 0),
  overview: s.overview || '',
  overviewEn: s.overview || '',
  posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : '',
  backdropUrl: s.backdrop_path ? `https://image.tmdb.org/t/p/w1280${s.backdrop_path}` : '',
  genres: (s.genres || s.genre_ids || []).map((g: any) => typeof g === 'number' ? ({ id: g, name: '', nameEn: '', slug: '' }) : ({ id: Number(g.id), name: g.name || '', nameEn: g.name || '', slug: String(g.name || '').toLowerCase().replace(/\s+/g, '-') })),
  creator: (s.created_by || [])[0]?.name || '',
  creatorEn: (s.created_by || [])[0]?.original_name || (s.created_by || [])[0]?.name || '',
  cast: (s.credits?.cast || []).slice(0, 16).map((x: any) => ({
    id: String(x.id), name: x.name || '', nameEn: x.original_name || x.name || '',
    character: x.character || '', characterEn: x.character || '',
    avatarUrl: x.profile_path ? `https://image.tmdb.org/t/p/w185${x.profile_path}` : '',
  })),
  seasons,
  seasonsCount: seasons.length || Number(s.number_of_seasons || 0),
  episodesCount: Number(s.number_of_episodes || seasons.reduce((n, x) => n + x.episodesCount, 0)),
  isFeatured: false,
  isTrending: false,
  isPopular: false,
  status: s.status,
  addedAt: s.first_air_date || new Date().toISOString(),
  ageRating: '',
});

const makeSeason = (s: any, episodes: Episode[] = []): Season => ({
  id: String(s.id || `${s.season_number}`),
  seriesId: String(s.tv_id || ''),
  seasonNumber: Number(s.season_number || 0),
  name: s.name || `Season ${s.season_number}`,
  nameEn: s.name || `Season ${s.season_number}`,
  posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : '',
  overview: s.overview || '',
  airDate: s.air_date || '',
  episodesCount: Number(s.episode_count || episodes.length),
  episodes,
});

async function loadSeriesSeason(seriesId: string, seasonNumber: number): Promise<Season> {
  const data = await tmdb<any>(`tv/${seriesId}/season/${seasonNumber}`);
  return { ...makeSeason({ ...data, tv_id: seriesId }), episodes: (data.episodes || []).map((e: any) => episodeMap(e, seriesId, seasonNumber)) };
}

async function detailMovie(id: string) {
  return tmdb<any>(`movie/${encodeURIComponent(id)}`, { append_to_response: 'credits,similar,release_dates' });
}

async function detailSeries(id: string) {
  return tmdb<any>(`tv/${encodeURIComponent(id)}`, { append_to_response: 'credits,similar' });
}

export const MovyzaApi = {
  getHomeData: async () => {
    const [trending, popularMovies, popularSeries, latestMovies, latestSeries, genreMovies, genreSeries] = await Promise.all([
      tmdb<any>('trending/all/week'),
      tmdb<any>('movie/popular', { page: 1 }),
      tmdb<any>('tv/popular', { page: 1 }),
      tmdb<any>('movie/now_playing', { page: 1 }),
      tmdb<any>('tv/on_the_air', { page: 1 }),
      tmdb<any>('genre/movie/list'),
      tmdb<any>('genre/tv/list'),
    ]);
    const trendingItems = (trending.results || []).filter((x: any) => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 18);
    const movieItems = (popularMovies.results || []).slice(0, 18).map(movieMap);
    const seriesItems = (popularSeries.results || []).slice(0, 18).map((x: any) => seriesMap(x));
    const recentAdded = [
      ...(latestMovies.results || []).slice(0, 8).map(movieMap),
      ...(latestSeries.results || []).slice(0, 8).map((x: any) => seriesMap(x)),
    ].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    const trendingMapped = trendingItems.map((x: any) => x.media_type === 'movie' ? movieMap(x) : seriesMap(x));
    const genreMap = new Map<number, Genre>();
    [...(genreMovies.genres || []), ...(genreSeries.genres || [])].forEach((g: any) => genreMap.set(Number(g.id), {
      id: Number(g.id), name: g.name || '', nameEn: g.name || '', slug: String(g.name || '').toLowerCase().replace(/\s+/g, '-'),
    }));
    const hero = trendingMapped[0] || movieItems[0] || seriesItems[0];
    // The public catalog must never depend on Supabase being configured.
    // Supabase is only required for authenticated user data (watchlist/history/profile).
    const history = supabase
      ? await MovyzaApi.getWatchHistory().catch(() => ok<WatchProgress[]>([]))
      : ok<WatchProgress[]>([]);
    return ok({
      hero, continueWatching: history.data.filter((x) => !x.completed && x.percentage > 2).slice(0, 10),
      trending: trendingMapped, popularMovies: movieItems, featuredSeries: seriesItems,
      recentAdded: recentAdded.slice(0, 16), genres: Array.from(genreMap.values()),
    });
  },

  getMovies: async (params: any = {}) => {
    let endpoint = params.sortBy === 'rating' ? 'movie/top_rated' : params.sortBy === 'newest' ? 'movie/now_playing' : 'discover/movie';
    const page = Math.max(1, Number(params.page || 1));
    const data = await tmdb<any>(endpoint, {
      page,
      with_genres: params.genreId,
      'vote_average.gte': params.minRating,
      query: params.search,
      sort_by: params.sortBy === 'rating' ? undefined : 'popularity.desc',
    });
    const items = (data.results || []).map(movieMap);
    return ok(items, { page, limit: Number(params.limit || 20), total: Number(data.total_results || items.length), totalPages: Number(data.total_pages || 1) });
  },

  getMovieById: async (id: string) => {
    const data = await detailMovie(id);
    const movie = movieMap(data);
    const similar = (data.similar?.results || []).slice(0, 12).map(movieMap);
    return ok({ movie, similar });
  },

  getMovieByTmdbId: async (tmdbId: number) => MovyzaApi.getMovieById(String(tmdbId)),

  getSeries: async (params: any = {}) => {
    const endpoint = params.sortBy === 'rating' ? 'tv/top_rated' : params.sortBy === 'newest' ? 'tv/on_the_air' : 'discover/tv';
    const page = Math.max(1, Number(params.page || 1));
    const data = await tmdb<any>(endpoint, {
      page,
      with_genres: params.genreId,
      query: params.search,
      sort_by: params.sortBy === 'rating' ? undefined : 'popularity.desc',
    });
    const items = (data.results || []).map(seriesMap);
    return ok(items, { page, limit: Number(params.limit || 20), total: Number(data.total_results || items.length), totalPages: Number(data.total_pages || 1) });
  },

  getSeriesById: async (id: string) => {
    const data = await detailSeries(id);
    const baseSeasons = (data.seasons || []).filter((s: any) => Number(s.season_number) > 0);
    const firstSeasons = await Promise.all(baseSeasons.map((s: any) => loadSeriesSeason(String(data.id), Number(s.season_number))));
    const series = seriesMap(data, firstSeasons);
    const similar = (data.similar?.results || []).slice(0, 12).map(seriesMap);
    return ok({ series, similar });
  },

  getSeriesByTmdbId: async (tmdbId: number) => MovyzaApi.getSeriesById(String(tmdbId)),

  getSeriesWatchByTmdbId: async (tmdbId: number, season: number, _episode?: number) => {
    const base = await MovyzaApi.getSeriesByTmdbId(tmdbId);
    const currentSeason = base.data.series.seasons.find((s) => s.seasonNumber === season) || await loadSeriesSeason(String(tmdbId), season);
    return ok({ series: base.data.series, currentSeason });
  },

  getSeriesWatchById: async (id: string, season: number, _episode?: number) => {
    const base = await MovyzaApi.getSeriesById(id);
    const currentSeason = base.data.series.seasons.find((s) => s.seasonNumber === season) || await loadSeriesSeason(id, season);
    return ok({ series: base.data.series, currentSeason });
  },

  searchCatalog: async (search: string) => {
    const data = await tmdb<any>('search/multi', { query: search, page: 1, include_adult: 'false' });
    const movies: Movie[] = [];
    const series: Series[] = [];
    const cast: { name: string; nameEn: string; worksCount: number; avatarUrl: string }[] = [];
    (data.results || []).slice(0, 40).forEach((x: any) => {
      if (x.media_type === 'movie') movies.push(movieMap(x));
      else if (x.media_type === 'tv') series.push(seriesMap(x));
      else if (x.media_type === 'person') cast.push({
        name: x.name || '', nameEn: x.original_name || x.name || '', worksCount: Number(x.known_for_department === 'Acting' ? (x.known_for?.length || 0) : 0),
        avatarUrl: x.profile_path ? `https://image.tmdb.org/t/p/w185${x.profile_path}` : '',
      });
    });
    return ok({ movies, series, cast });
  },

  getGenres: async () => {
    const [movies, series] = await Promise.all([
      tmdb<any>('genre/movie/list'),
      tmdb<any>('genre/tv/list'),
    ]);
    const map = new Map<number, Genre>();
    [...(movies.genres || []), ...(series.genres || [])].forEach((g: any) => map.set(Number(g.id), {
      id: Number(g.id), name: g.name || '', nameEn: g.name || '', slug: String(g.name || '').toLowerCase().replace(/\s+/g, '-'),
    }));
    return ok(Array.from(map.values()));
  },

  getWatchlist: async () => {
    if (!supabase) return ok<WatchlistItem[]>([]);
    const db = supabase;
    const user = (await db.auth.getUser()).data.user;
    if (!user) return ok<WatchlistItem[]>([]);
    const { data, error } = await db.from('watchlist').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (error) throw error;
    const rows = data || [];
    const items = await Promise.all(rows.slice(0, 100).map(async (row: any) => {
      try {
        const media = row.content_type === 'movie'
          ? (await MovyzaApi.getMovieByTmdbId(Number(row.content_id))).data.movie
          : (await MovyzaApi.getSeriesByTmdbId(Number(row.content_id))).data.series;
        return {
          id: row.id, userId: row.user_id, contentId: row.content_id, contentType: row.content_type,
          title: media.title, titleEn: media.titleEn, posterUrl: media.posterUrl,
          year: media.type === 'movie' ? media.year : media.startYear, rating: media.rating, genres: media.genres.map((g) => g.name), addedAt: row.created_at,
        } as WatchlistItem;
      } catch { return null; }
    }));
    return ok(items.filter(Boolean) as WatchlistItem[]);
  },

  addToWatchlist: async (item: Omit<WatchlistItem, 'id' | 'addedAt'>) => {
    const db = requireAuthenticatedSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) throw new Error('You must be signed in');
    const { data, error } = await db.from('watchlist').upsert({
      user_id: user.id, content_type: item.contentType, content_id: String(item.contentId),
    }, { onConflict: 'user_id,content_type,content_id' }).select('*').single();
    if (error) throw error;
    return ok({ ...item, id: data.id, addedAt: data.created_at } as WatchlistItem);
  },

  removeFromWatchlist: async (contentId: string) => {
    const db = requireAuthenticatedSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) throw new Error('You must be signed in');
    const { error } = await db.from('watchlist').delete().eq('user_id', user.id).eq('content_id', String(contentId));
    if (error) throw error;
    return ok({ removed: true });
  },

  getWatchHistory: async () => {
    if (!supabase) return ok<WatchProgress[]>([]);
    const db = supabase;
    const user = (await db.auth.getUser()).data.user;
    if (!user) return ok<WatchProgress[]>([]);
    const { data, error } = await db.from('watch_history').select('*').eq('user_id', user.id).order('updated_at', { ascending: false });
    if (error) throw error;
    const rows = (data || []).filter((x: any) => x.content_type === 'movie');
    const items = await Promise.all(rows.slice(0, 50).map(async (row: any) => {
      try {
        const movie = await MovyzaApi.getMovieByTmdbId(Number(row.content_id));
        const duration = Number(row.duration_seconds || 0);
        return {
          contentId: String(row.content_id), tmdbId: movie.data.movie.tmdbId, contentType: 'movie',
          title: movie.data.movie.title, titleEn: movie.data.movie.titleEn, posterUrl: movie.data.movie.posterUrl,
          backdropUrl: movie.data.movie.backdropUrl, positionSeconds: Number(row.position_seconds || 0), durationSeconds: duration,
          percentage: duration ? Math.min(100, Math.round(Number(row.position_seconds || 0) / duration * 100)) : 0,
          lastWatchedAt: row.updated_at, completed: !!row.completed,
        } as WatchProgress;
      } catch { return null; }
    }));
    return ok(items.filter(Boolean) as WatchProgress[]);
  },

  clearWatchHistory: async () => {
    if (!supabase) return ok({ cleared: true });
    const db = supabase;
    const user = (await db.auth.getUser()).data.user;
    if (!user) return ok({ cleared: true });
    const { error } = await db.from('watch_history').delete().eq('user_id', user.id);
    if (error) throw error;
    return ok({ cleared: true });
  },

  getWatchProgress: async (contentId: string, _episodeId?: string) => {
    if (!supabase) return ok<WatchProgress | null>(null);
    const db = supabase;
    const user = (await db.auth.getUser()).data.user;
    if (!user) return ok<WatchProgress | null>(null);
    const { data, error } = await db.from('watch_history').select('*').eq('user_id', user.id).eq('content_id', String(contentId)).maybeSingle();
    if (error) throw error;
    if (!data) return ok<WatchProgress | null>(null);
    const movie = await MovyzaApi.getMovieByTmdbId(Number(contentId));
    const duration = Number(data.duration_seconds || 0);
    return ok({
      contentId: String(contentId), tmdbId: movie.data.movie.tmdbId, contentType: 'movie',
      title: movie.data.movie.title, titleEn: movie.data.movie.titleEn, posterUrl: movie.data.movie.posterUrl,
      backdropUrl: movie.data.movie.backdropUrl, positionSeconds: Number(data.position_seconds || 0),
      durationSeconds: duration, percentage: duration ? Math.min(100, Math.round(Number(data.position_seconds || 0) / duration * 100)) : 0,
      lastWatchedAt: data.updated_at, completed: !!data.completed,
    } as WatchProgress);
  },

  saveWatchProgress: async (progress: WatchProgress) => {
    const db = requireAuthenticatedSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) throw new Error('You must be signed in');
    const { error } = await db.from('watch_history').upsert({
      user_id: user.id, content_type: progress.episodeId ? 'episode' : 'movie',
      content_id: String(progress.episodeId || progress.contentId),
      position_seconds: Math.floor(progress.positionSeconds), duration_seconds: Math.floor(progress.durationSeconds), completed: progress.completed,
    }, { onConflict: 'user_id,content_type,content_id' });
    if (error) throw error;
    return ok(progress);
  },

  reportIssue: async (_report: Omit<StreamReport, 'id' | 'reportedAt' | 'status'> & { contentType: 'movie' | 'episode' }) => {
    throw new Error('Playback reporting is disabled in catalog-only mode.');
  },

  getAdminStats: async () => {
    const db = requireAuthenticatedSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) throw new Error('Authentication required');
    const profile = await db.from('profiles').select('role').eq('id', user.id).single();
    if (profile.data?.role !== 'ADMIN' && profile.data?.role !== 'OWNER') throw new Error('Admin access required');
    const movies = await tmdb<any>('movie/popular', { page: 1 });
    const series = await tmdb<any>('tv/popular', { page: 1 });
    return ok({
      totalMovies: Number(movies.total_results || 0),
      totalSeries: Number(series.total_results || 0),
      totalEpisodes: 0,
      activeProviders: 0, streamHealthPct: 0, dailyStreamRequests: 0,
    });
  },

  getMe: async () => {
    const db = requireAuthenticatedSupabase();
    const user = (await db.auth.getUser()).data.user;
    if (!user) throw new Error('Not authenticated');
    const { data: profile, error } = await db.from('profiles').select('*').eq('id', user.id).single();
    if (error) throw error;
    return ok<UserProfile>({
      id: user.id, email: user.email || '', name: profile.display_name || '',
      role: profile.role, avatarUrl: profile.avatar_url || '', preferredLanguage: profile.locale || 'ar', createdAt: profile.created_at,
    });
  },
};

const requireSupabase = () => supabase;

const requireAuthenticatedSupabase = () => {
  if (!supabase) throw new Error('Authentication is unavailable in catalog-only mode.');
  return supabase;
};

export async function movyzaRequest<T>(_path: string): Promise<ApiResponse<T>> {
  throw new Error('Direct catalog mode: use MovyzaApi or Supabase directly.');
}

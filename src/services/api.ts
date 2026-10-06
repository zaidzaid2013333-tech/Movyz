import { supabase } from '../lib/supabase';
import { Movie, Series, Genre, WatchProgress, WatchlistItem, StreamReport, UserProfile } from '../types';

type ApiResponse<T> = { success: true; data: T; meta?: { page?: number; limit?: number; total?: number; totalPages?: number } };
const TMDB_BASE = (import.meta.env.VITE_TMDB_PROXY_URL || '/tmdb').replace(/\/$/, '');
const IMAGE = 'https://image.tmdb.org/t/p/';
const json = <T,>(data: T, meta?: ApiResponse<T>['meta']): ApiResponse<T> => ({ success: true, data, ...(meta ? { meta } : {}) });

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

async function tmdb<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const url = new URL(TMDB_BASE + (path.startsWith('/') ? path : '/' + path), window.location.origin);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') url.searchParams.set(k, String(v)); });
  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.status_message || `TMDB request failed (${response.status})`);
  return body as T;
}

function image(path: string | null | undefined, size: 'w500' | 'w780' | 'original' = 'w500') {
  return path ? IMAGE + size + path : '';
}

const movieGenre = (g: any): Genre => ({ id: Number(g.id), name: g.name || '', nameEn: g.name_en || g.name || '', slug: `tmdb-${g.id}` });
const mapMovie = (m: any, credits?: any): Movie => {
  const director = credits?.crew?.find((p: any) => p.job === 'Director');
  return {
    id: String(m.id), tmdbId: Number(m.id), type: 'movie',
    title: m.title || m.original_title || '', titleEn: m.title_en || m.original_title || '',
    originalTitle: m.original_title || m.title || '', year: Number(String(m.release_date || '').slice(0, 4)) || 0,
    releaseDate: m.release_date || '', rating: Number(m.vote_average || 0), votesCount: Number(m.vote_count || 0),
    runtime: Number(m.runtime || 0), overview: m.overview || '', overviewEn: m.overview_en || m.overview || '',
    posterUrl: image(m.poster_path), backdropUrl: image(m.backdrop_path, 'w780'),
    genres: (m.genres || []).map(movieGenre),
    director: director?.name || m.metadata?.director_ar || '', directorEn: director?.original_name || director?.name || m.metadata?.director_en || '',
    cast: (credits?.cast || []).slice(0, 12).map((p: any) => ({
      id: String(p.id), name: p.name || '', nameEn: p.original_name || p.name || '', character: p.character || '', characterEn: p.character || '',
      avatarUrl: image(p.profile_path, 'w500'),
    })),
    sources: [], isFeatured: false, isTrending: false, isPopular: false, addedAt: new Date().toISOString(),
    ageRating: m.certification || '16+',
  };
};

const mapSeries = (s: any, credits?: any): Series => {
  const creator = (s.created_by || [])[0];
  return {
    id: String(s.id), tmdbId: Number(s.id), type: 'series',
    title: s.name || s.original_name || '', titleEn: s.name_en || s.original_name || '',
    originalTitle: s.original_name || s.name || '',
    startYear: Number(String(s.first_air_date || '').slice(0, 4)) || 0,
    endYear: s.last_air_date ? Number(String(s.last_air_date).slice(0, 4)) : undefined,
    releaseDate: s.first_air_date || '', rating: Number(s.vote_average || 0), votesCount: Number(s.vote_count || 0),
    overview: s.overview || '', overviewEn: s.overview_en || s.overview || '',
    posterUrl: image(s.poster_path), backdropUrl: image(s.backdrop_path, 'w780'),
    genres: (s.genres || []).map(movieGenre),
    creator: creator?.name || '', creatorEn: creator?.original_name || creator?.name || '',
    cast: (credits?.cast || []).slice(0, 12).map((p: any) => ({
      id: String(p.id), name: p.name || '', nameEn: p.original_name || p.name || '', character: p.character || '', characterEn: p.character || '',
      avatarUrl: image(p.profile_path, 'w500'),
    })),
    seasonsCount: Number(s.number_of_seasons || 0), episodesCount: Number(s.number_of_episodes || 0),
    seasons: (s.seasons || []).filter((x: any) => Number(x.season_number) > 0).map((x: any) => ({
      id: String(x.id || x.season_number), seriesId: String(s.id), seasonNumber: Number(x.season_number),
      name: x.name || `الموسم ${x.season_number}`, nameEn: x.name || `Season ${x.season_number}`,
      posterUrl: image(x.poster_path), overview: x.overview || '', airDate: x.air_date || '',
      episodesCount: Number(x.episode_count || 0), episodes: [],
    })),
    isFeatured: false, isTrending: false, isPopular: false, addedAt: new Date().toISOString(),
    ageRating: '16+', status: s.status || '',
  };
};

async function tmdbMovie(id: string | number) {
  const ar = await tmdb<any>(`/movie/${id}`, { language: 'ar-SA', append_to_response: 'credits,release_dates,similar' });
  let en: any = null;
  try { en = await tmdb<any>(`/movie/${id}`, { language: 'en-US' }); } catch {}
  return mapMovie({ ...ar, title_en: en?.title, overview_en: en?.overview, original_title: ar.original_title }, ar.credits);
}

async function tmdbSeries(id: string | number) {
  const ar = await tmdb<any>(`/tv/${id}`, { language: 'ar-SA', append_to_response: 'credits,content_ratings,similar' });
  let en: any = null;
  try { en = await tmdb<any>(`/tv/${id}`, { language: 'en-US' }); } catch {}
  return mapSeries({ ...ar, name_en: en?.name, overview_en: en?.overview }, ar.credits);
}

async function enrichMovieList(rows: any[]) {
  return rows.map((m) => mapMovie(m));
}
async function enrichSeriesList(rows: any[]) {
  return rows.map((s) => mapSeries(s));
}

async function currentUserId() {
  const sb = requireSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Authentication required');
  return user.id;
}

export const MovyzaApi = {
  async getHomeData() {
    const [trending, popularMovies, popularSeries, nowPlaying, airing, genres] = await Promise.all([
      tmdb<any>('/trending/all/week', { language: 'ar-SA' }),
      tmdb<any>('/movie/popular', { language: 'ar-SA', page: 1 }),
      tmdb<any>('/tv/popular', { language: 'ar-SA', page: 1 }),
      tmdb<any>('/movie/now_playing', { language: 'ar-SA', page: 1 }),
      tmdb<any>('/tv/on_the_air', { language: 'ar-SA', page: 1 }),
      tmdb<any>('/genre/movie/list', { language: 'ar-SA' }),
    ]);
    const trendItems = (trending.results || []).filter((x: any) => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 12);
    const heroRaw = trendItems.find((x: any) => x.backdrop_path) || popularMovies.results?.[0];
    const hero = heroRaw?.media_type === 'tv'
      ? await tmdbSeries(heroRaw.id)
      : await tmdbMovie(heroRaw.id);
    let continueWatching: WatchProgress[] = [];
    try { continueWatching = (await this.getWatchHistory()).data.filter((x) => !x.completed && x.percentage > 2).slice(0, 10); } catch {}
    return json({
      hero,
      continueWatching,
      trending: await Promise.all(trendItems.slice(0, 10).map((x: any) => x.media_type === 'tv' ? tmdbSeries(x.id) : tmdbMovie(x.id))),
      popularMovies: await enrichMovieList((popularMovies.results || []).slice(0, 12)),
      featuredSeries: await enrichSeriesList((popularSeries.results || []).slice(0, 12)),
      recentAdded: [
        ...(await enrichMovieList((nowPlaying.results || []).slice(0, 8))),
        ...(await enrichSeriesList((airing.results || []).slice(0, 8))),
      ],
      genres: (genres.genres || []).map(movieGenre),
    });
  },

  async getMovies(params: { genreId?: number; year?: number; minRating?: number; sortBy?: 'popular' | 'rating' | 'newest'; search?: string; page?: number; limit?: number } = {}) {
    const page = Math.max(1, params.page || 1);
    let path = '/movie/popular';
    if (params.search) path = '/search/movie';
    else if (params.sortBy === 'rating') path = '/movie/top_rated';
    else if (params.sortBy === 'newest') path = '/movie/now_playing';
    const data = await tmdb<any>(path, { language: 'ar-SA', page, query: params.search, year: params.year, with_genres: params.genreId });
    const items = await enrichMovieList(data.results || []);
    return json(items, { page, total: Number(data.total_results || items.length), totalPages: Number(data.total_pages || 1), limit: params.limit || 20 });
  },

  async getMovieById(id: string) {
    const movie = await tmdbMovie(id);
    const similar = await tmdb<any>(`/movie/${id}/similar`, { language: 'ar-SA', page: 1 });
    return json({ movie, similar: await enrichMovieList((similar.results || []).slice(0, 12)) });
  },

  async getMovieByTmdbId(id: number) { return this.getMovieById(String(id)); },

  async getSeries(params: { genreId?: number; year?: number; sortBy?: 'popular' | 'rating' | 'newest'; search?: string; page?: number; limit?: number } = {}) {
    const page = Math.max(1, params.page || 1);
    let path = '/tv/popular';
    if (params.search) path = '/search/tv';
    else if (params.sortBy === 'rating') path = '/tv/top_rated';
    else if (params.sortBy === 'newest') path = '/tv/on_the_air';
    const data = await tmdb<any>(path, { language: 'ar-SA', page, query: params.search, first_air_date_year: params.year, with_genres: params.genreId });
    return json(await enrichSeriesList(data.results || []), { page, total: Number(data.total_results || 0), totalPages: Number(data.total_pages || 1), limit: params.limit || 20 });
  },

  async getSeriesById(id: string) {
    const series = await tmdbSeries(id);
    const similar = await tmdb<any>(`/tv/${id}/similar`, { language: 'ar-SA', page: 1 });
    return json({ series, similar: await enrichSeriesList((similar.results || []).slice(0, 12)) });
  },

  async getSeriesByTmdbId(id: number) { return this.getSeriesById(String(id)); },

  async getSeriesWatchByTmdbId(id: number, season: number, episode: number) {
    const [series, seasonData] = await Promise.all([
      tmdbSeries(id),
      tmdb<any>(`/tv/${id}/season/${season}`, { language: 'ar-SA' }),
    ]);
    const mapped = { id: `${id}-s${season}`, seriesId: String(id), seasonNumber: season, name: seasonData.name || `الموسم ${season}`, nameEn: seasonData.name || `Season ${season}`, posterUrl: image(seasonData.poster_path), overview: seasonData.overview || '', airDate: seasonData.air_date || '', episodesCount: seasonData.episodes?.length || 0, episodes: (seasonData.episodes || []).map((e: any) => ({ id: String(e.id), tmdbId: Number(e.id), seriesId: String(id), seasonNumber: season, episodeNumber: Number(e.episode_number), title: e.name || '', titleEn: e.name || '', overview: e.overview || '', overviewEn: e.overview || '', stillUrl: image(e.still_path, 'w780'), duration: Number(e.runtime || 0), airDate: e.air_date || '', sources: [] })),
    } as any;
    return json({ series, currentSeason: mapped });
  },

  async getSeriesWatchById(id: string, season: number, episode: number) { return this.getSeriesWatchByTmdbId(Number(id), season, episode); },

  async getGenres() {
    const data = await tmdb<any>('/genre/movie/list', { language: 'ar-SA' });
    return json((data.genres || []).map(movieGenre));
  },

  async searchCatalog(search: string) {
    const data = await tmdb<any>('/search/multi', { language: 'ar-SA', query: search, page: 1, include_adult: false });
    const results = (data.results || []).filter((x: any) => x.media_type === 'movie' || x.media_type === 'tv');
    const movies = await enrichMovieList(results.filter((x: any) => x.media_type === 'movie').slice(0, 12));
    const series = await enrichSeriesList(results.filter((x: any) => x.media_type === 'tv').slice(0, 12));
    const people = results.filter((x: any) => x.media_type === 'person').slice(0, 8).map((p: any) => ({ name: p.name || '', nameEn: p.name || '', worksCount: p.known_for?.length || 0, avatarUrl: image(p.profile_path) }));
    return json({ movies, series, cast: people });
  },

  async getWatchlist() {
    const sb = requireSupabase(); const uid = await currentUserId();
    const { data, error } = await sb.from('watchlist').select('id,content_type,content_id,created_at').eq('user_id', uid).order('created_at', { ascending: false });
    if (error) throw error;
    const result: WatchlistItem[] = [];
    for (const row of data || []) {
      const content = row.content_type === 'movie' ? await tmdbMovie(row.content_id) : await tmdbSeries(row.content_id);
      result.push({ id: row.id, userId: uid, contentId: String(row.content_id), contentType: row.content_type, title: content.title, titleEn: content.titleEn, posterUrl: content.posterUrl, year: content.type === 'movie' ? content.year : content.startYear, rating: content.rating, genres: content.genres.map((g) => g.name), addedAt: row.created_at });
    }
    return json(result);
  },

  async addToWatchlist(item: Omit<WatchlistItem, 'id' | 'addedAt'>) {
    const sb = requireSupabase(); const uid = await currentUserId();
    const { data, error } = await sb.from('watchlist').upsert({ user_id: uid, content_type: item.contentType, content_id: item.contentId }, { onConflict: 'user_id,content_type,content_id' }).select('id,user_id,content_type,content_id,created_at').single();
    if (error) throw error;
    return json({ ...item, id: data.id, addedAt: data.created_at });
  },

  async removeFromWatchlist(contentId: string) {
    const sb = requireSupabase(); const uid = await currentUserId();
    const { error } = await sb.from('watchlist').delete().eq('user_id', uid).eq('content_id', contentId);
    if (error) throw error;
    return json({ removed: true });
  },

  async getWatchHistory() {
    const sb = requireSupabase(); const uid = await currentUserId();
    const { data, error } = await sb.from('watch_history').select('*').eq('user_id', uid).order('updated_at', { ascending: false }).limit(50);
    if (error) throw error;
    const result: WatchProgress[] = [];
    for (const row of data || []) {
      const content = row.content_type === 'movie' ? await tmdbMovie(row.content_id) : null;
      if (!content) continue;
      result.push({ contentId: String(row.content_id), tmdbId: content.tmdbId, contentType: 'movie', title: content.title, titleEn: content.titleEn, posterUrl: content.posterUrl, backdropUrl: content.backdropUrl, positionSeconds: Number(row.position_seconds || 0), durationSeconds: Number(row.duration_seconds || 0), percentage: Number(row.duration_seconds) ? Number(row.position_seconds || 0) / Number(row.duration_seconds) * 100 : 0, lastWatchedAt: row.updated_at, completed: Boolean(row.completed) });
    }
    return json(result);
  },

  clearWatchHistory: async () => {
    const sb = requireSupabase(); const uid = await currentUserId();
    const { error } = await sb.from('watch_history').delete().eq('user_id', uid); if (error) throw error;
    return json({ cleared: true });
  },

  async getWatchProgress(contentId: string) {
    const sb = requireSupabase(); const uid = await currentUserId();
    const { data, error } = await sb.from('watch_history').select('*').eq('user_id', uid).eq('content_id', contentId).maybeSingle();
    if (error) throw error;
    if (!data) return json(null);
    return json({ contentId, tmdbId: Number(contentId), contentType: data.content_type, title: '', titleEn: '', posterUrl: '', backdropUrl: '', positionSeconds: Number(data.position_seconds || 0), durationSeconds: Number(data.duration_seconds || 0), percentage: Number(data.duration_seconds) ? Number(data.position_seconds || 0) / Number(data.duration_seconds) * 100 : 0, lastWatchedAt: data.updated_at, completed: Boolean(data.completed) } as WatchProgress);
  },

  async saveWatchProgress(progress: WatchProgress) {
    const sb = requireSupabase(); const uid = await currentUserId();
    const { data, error } = await sb.from('watch_history').upsert({ user_id: uid, content_type: progress.contentType === 'series' ? 'movie' : progress.contentType, content_id: String(progress.contentId), position_seconds: Math.floor(progress.positionSeconds), duration_seconds: Math.floor(progress.durationSeconds), completed: progress.completed }, { onConflict: 'user_id,content_type,content_id' }).select().single();
    if (error) throw error;
    return json({ ...progress, lastWatchedAt: data.updated_at });
  },

  async reportIssue(report: Omit<StreamReport, 'id' | 'reportedAt' | 'status'> & { contentType: 'movie' | 'episode' }) {
    const sb = requireSupabase(); const uid = await currentUserId();
    const { data, error } = await sb.from('reports').insert({ user_id: uid, content_id: String(report.contentId), content_type: report.contentType, issue_type: report.issueType, description: report.description }).select('id,created_at,status').single();
    if (error) throw error;
    return json({ ...report, id: data.id, reportedAt: data.created_at, status: data.status });
  },

  async getAdminStats() {
    const [m, s] = await Promise.all([tmdb<any>('/movie/popular', { language: 'ar-SA', page: 1 }), tmdb<any>('/tv/popular', { language: 'ar-SA', page: 1 })]);
    return json({ totalMovies: Number(m.total_results || 0), totalSeries: Number(s.total_results || 0), totalEpisodes: 0, activeProviders: 0, streamHealthPct: 0, dailyStreamRequests: 0 });
  },

  getAdminProviders: async () => json([]),
  getAdminMappings: async () => json([]),
  getAdminAuditLogs: async () => json([]),
  testProvider: async () => { throw new Error('Playback providers were removed from Movyz.'); },
  triggerTmdbSync: async () => { throw new Error('TMDB is now the live catalog source; no catalog sync backend is required.'); },
  syncTmdbEpisodes: async () => { throw new Error('TMDB episodes are loaded live when a series is opened.'); },
  triggerAdminSync: async () => { throw new Error('No custom catalog backend remains.'); },
  createAdminProvider: async () => { throw new Error('Providers were removed.'); },
  updateAdminProvider: async () => { throw new Error('Providers were removed.'); },
  deleteAdminProvider: async () => { throw new Error('Providers were removed.'); },

  async deleteMovie(id: string) { const sb = requireSupabase(); const uid = await currentUserId(); const { data: profile } = await sb.from('profiles').select('role').eq('id', uid).single(); if (!profile || !['ADMIN','OWNER'].includes(profile.role)) throw new Error('Admin access required'); return json({ deleted: false }); },

  getAdminMovies: async () => json([]),
  createAdminMovie: async () => { throw new Error('TMDB is the catalog source.'); },
  updateAdminMovie: async () => { throw new Error('TMDB is the catalog source.'); },
  getAdminSeries: async () => json([]),
  createAdminSeries: async () => { throw new Error('TMDB is the catalog source.'); },
  updateAdminSeries: async () => { throw new Error('TMDB is the catalog source.'); },
  getAdminEpisodes: async () => json([]),
  createAdminEpisode: async () => { throw new Error('TMDB is the catalog source.'); },
  updateAdminEpisode: async () => { throw new Error('TMDB is the catalog source.'); },
  deleteAdminEpisode: async () => { throw new Error('TMDB is the catalog source.'); },
  getAdminReports: async () => json([]),
  updateAdminReport: async () => { throw new Error('Reports are not managed by a custom backend.'); },
  getAdminUsers: async () => json([]),
  updateAdminUserRole: async () => { throw new Error('Manage roles from Supabase Auth/Database.'); },

  async getMe() {
    const sb = requireSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data: profile, error } = await sb.from('profiles').select('id,role,display_name,avatar_url,locale,created_at').eq('id', user.id).single();
    if (error) throw error;
    return json({ id: user.id, email: user.email || '', name: profile.display_name, role: profile.role, avatarUrl: profile.avatar_url || '', preferredLanguage: profile.locale, createdAt: profile.created_at } as UserProfile);
  },
};

export { tmdb as tmdbRequest };
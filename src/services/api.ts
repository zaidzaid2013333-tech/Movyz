import { supabase } from '../lib/supabase';
import {
  Movie, Series, Genre, WatchProgress, WatchlistItem, StreamReport,
  ProviderHealth, AuditLog, ApiResponse, UserProfile
} from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { skipAuth?: boolean; timeoutMs?: number; retry?: boolean } = {},
): Promise<ApiResponse<T>> {
  const session = options.skipAuth ? null : (supabase ? (await supabase.auth.getSession()).data.session : null);
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);

  const method = String(init.method || 'GET').toUpperCase();
  const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
  let response: Response | null = null;
  let lastError: unknown = null;

  const maxAttempts = options.retry === false ? 1 : 2;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeoutMs = Math.max(5000, Number(options.timeoutMs || 12000));
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: init.signal || controller.signal });
      } finally {
        window.clearTimeout(timeoutId);
      }
      if (method !== 'GET' || !retryableStatuses.has(response.status) || attempt === maxAttempts - 1) break;
    } catch (error) {
      lastError = error;
      if (method !== 'GET' || attempt === 1) throw error;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 180 * (attempt + 1)));
  }

  if (!response) {
    throw (lastError instanceof Error ? lastError : new Error('Network request failed'));
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.success === false) {
    const error = new Error(payload?.error?.message || `Request failed (${response.status})`) as Error & { code?: string; status?: number };
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload as ApiResponse<T>;
}

function query(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export const MovyzaApi = {
  async getHomeData() {
    const home = await request<{
      hero: Movie | Series;
      continueWatching: WatchProgress[];
      trending: (Movie | Series)[];
      popularMovies: Movie[];
      featuredSeries: Series[];
      recentAdded: (Movie | Series)[];
      genres: Genre[];
    }>('/home');

    if (supabase) {
      const session = (await supabase.auth.getSession()).data.session;
      if (session) {
        try {
          const history = await request<WatchProgress[]>('/history');
          home.data.continueWatching = history.data.filter((item) => !item.completed && item.percentage > 2);
        } catch {
          // Public home remains usable when a session has expired.
        }
      }
    }

    return home;
  },

  getMovies: (params?: {
    genreId?: number; year?: number; minRating?: number;
    sortBy?: 'popular' | 'rating' | 'newest'; search?: string;
    page?: number; limit?: number;
  }) => request<Movie[]>(`/movies${query(params || {})}`, {}, { skipAuth: true }),

  getMovieById: (id: string) =>
    request<{ movie: Movie; similar: Movie[] }>(`/movies/${encodeURIComponent(id)}`, {}, { skipAuth: true }),

  getMovieByTmdbId: (tmdbId: number) =>
    request<{ movie: Movie; similar: Movie[] }>(`/movies/tmdb/${encodeURIComponent(String(tmdbId))}`, {}, { skipAuth: true }),

  getSeries: (params?: {
    genreId?: number; year?: number;
    sortBy?: 'popular' | 'rating' | 'newest'; search?: string;
    page?: number; limit?: number;
  }) => request<Series[]>(`/series${query(params || {})}`, {}, { skipAuth: true }),

  getSeriesById: (id: string) =>
    request<{ series: Series; similar: Series[] }>(`/series/${encodeURIComponent(id)}`, {}, { skipAuth: true }),

  getSeriesByTmdbId: (tmdbId: number) =>
    request<{ series: Series; similar: Series[] }>(`/series/tmdb/${encodeURIComponent(String(tmdbId))}`, {}, { skipAuth: true }),

  getSeriesWatchByTmdbId: (tmdbId: number, season: number, episode: number) =>
    request<{ series: Series; currentSeason: import('../types').Season }>(
      `/series/tmdb/${encodeURIComponent(String(tmdbId))}/watch/${season}/${episode}`,
      {},
      { skipAuth: true },
    ),

  getSeriesWatchById: (id: string, season: number, episode: number) =>
    request<{ series: Series; currentSeason: import('../types').Season }>(
      `/series/${encodeURIComponent(id)}/watch/${season}/${episode}`,
      {},
      { skipAuth: true },
    ),

  searchCatalog: (search: string) =>
    request<{
      movies: Movie[];
      series: Series[];
      cast: { name: string; nameEn: string; worksCount: number; avatarUrl: string }[];
    }>(`/search?q=${encodeURIComponent(search)}`, {}, { skipAuth: true }),

  preparePlayback: (contentType: 'movie' | 'episode', contentId: string, season?: number, episode?: number) =>
    request<{ contentType: 'movie' | 'episode'; contentId: string; mode: string; ready: boolean; sources: any[] }>(
      `/playback/prepare?type=${encodeURIComponent(contentType)}&contentId=${encodeURIComponent(contentId)}${season ? `&season=${encodeURIComponent(String(season))}` : ''}${episode ? `&episode=${encodeURIComponent(String(episode))}` : ''}`,
      {},
      { skipAuth: true, timeoutMs: 30000, retry: false },
    ),

  getGenres: () => request<Genre[]>('/genres'),

  getWatchlist: () => request<WatchlistItem[]>('/watchlist'),

  addToWatchlist: (item: Omit<WatchlistItem, 'id' | 'addedAt'>) =>
    request<WatchlistItem>('/watchlist', {
      method: 'POST',
      body: JSON.stringify({ contentId: item.contentId, contentType: item.contentType }),
    }),

  removeFromWatchlist: (contentId: string) =>
    request<{ removed: boolean }>(`/watchlist/${encodeURIComponent(contentId)}`, { method: 'DELETE' }),

  getWatchHistory: () => request<WatchProgress[]>('/history'),
  clearWatchHistory: () => request<{ cleared: boolean }>('/history', { method: 'DELETE' }),


  getWatchProgress: (contentId: string, episodeId?: string) =>
    request<WatchProgress | null>(
      `/watch/${encodeURIComponent(contentId)}/progress${episodeId ? `?episodeId=${encodeURIComponent(episodeId)}` : ''}`
    ),

  saveWatchProgress: (progress: WatchProgress) =>
    request<WatchProgress>(`/watch/${encodeURIComponent(progress.contentId)}/progress`, {
      method: 'POST',
      body: JSON.stringify({
        contentType: progress.contentType,
        episodeId: progress.episodeId,
        positionSeconds: Math.floor(progress.positionSeconds),
        durationSeconds: Math.floor(progress.durationSeconds),
        completed: progress.completed,
      }),
    }),

  reportIssue: (report: Omit<StreamReport, 'id' | 'reportedAt' | 'status'> & { contentType: 'movie' | 'episode' }) =>
    request<StreamReport>('/reports', {
      method: 'POST',
      body: JSON.stringify(report),
    }),

  getAdminStats: () => request<{
    totalMovies: number;
    totalSeries: number;
    totalEpisodes: number;
    activeProviders: number;
    streamHealthPct: number;
    dailyStreamRequests: number;
  }>('/admin/stats'),

  getAdminProviders: () => request<ProviderHealth[]>('/admin/providers'),

  getAdminMappings: (params?: { providerId?: string; contentType?: 'movie' | 'series' | 'season' | 'episode'; contentId?: string }) =>
    request<any[]>(`/admin/mappings${query(params || {})}`),
  createAdminMapping: (payload: { providerId: string; contentType: 'movie' | 'series' | 'season' | 'episode'; contentId: string; providerContentId: string; confidence?: number; status?: 'active' | 'inactive' }) =>
    request<any>('/admin/mappings', { method: 'POST', body: JSON.stringify(payload) }),
  updateAdminMapping: (id: string, payload: { providerContentId?: string; confidence?: number; status?: 'active' | 'inactive' }) =>
    request<any>(`/admin/mappings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAdminMapping: (id: string) =>
    request<{ deleted: boolean }>(`/admin/mappings/${encodeURIComponent(id)}`, { method: 'DELETE' }),



  testProvider: (providerId: string) =>
    request<ProviderHealth>(`/admin/providers/${encodeURIComponent(providerId)}/test`, { method: 'POST' }),

  getAdminAuditLogs: () => request<AuditLog[]>('/admin/audit'),

  getAdminSyncJobs: () => request<Array<{
    id: string;
    provider: string;
    jobType: string;
    status: string;
    pages: number | null;
    moviesSynced: number;
    seriesSynced: number;
    seasonsSynced: number;
    episodesSynced: number;
    error: string;
    startedAt: string;
    finishedAt: string;
    createdAt: string;
  }>>('/admin/sync/jobs'),

  deleteMovie: (id: string) =>
    request<{ deleted: boolean }>(`/admin/movies/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  triggerTmdbSync: () =>
    request<{ syncedCount: number; message: string }>('/admin/sync/tmdb', { method: 'POST' }),

  syncTmdbEpisodes: (seriesLimit = 10) => request<{ syncedCount: number; message: string }>('/admin/sync/tmdb/episodes', { method: 'POST', body: JSON.stringify({ seriesLimit }) }),


  getAdminMovies: (params?: { page?: number; limit?: number; search?: string }) =>
    request<Movie[]>(`/admin/movies${query(params || {})}`),

  createAdminMovie: (payload: Record<string, unknown>) =>
    request<Movie>('/admin/movies', { method: 'POST', body: JSON.stringify(payload) }),

  updateAdminMovie: (id: string, payload: Record<string, unknown>) =>
    request<Movie>(`/admin/movies/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  getAdminSeries: (params?: { page?: number; limit?: number; search?: string }) =>
    request<Series[]>(`/admin/series${query(params || {})}`),

  createAdminSeries: (payload: Record<string, unknown>) =>
    request<Series>('/admin/series', { method: 'POST', body: JSON.stringify(payload) }),

  updateAdminSeries: (id: string, payload: Record<string, unknown>) =>
    request<Series>(`/admin/series/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  getAdminEpisodes: (params?: { seriesId?: string; seasonId?: string; page?: number; limit?: number }) =>
    request<any[]>(`/admin/episodes${query(params || {})}`),

  createAdminEpisode: (payload: Record<string, unknown>) =>
    request<any>('/admin/episodes', { method: 'POST', body: JSON.stringify(payload) }),

  updateAdminEpisode: (id: string, payload: Record<string, unknown>) =>
    request<any>(`/admin/episodes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  deleteAdminEpisode: (id: string) =>
    request<{ deleted: boolean }>(`/admin/episodes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  createAdminProvider: (payload: { key: string; name: string; adapterName: string; enabled?: boolean }) =>
    request<any>('/admin/providers', { method: 'POST', body: JSON.stringify(payload) }),

  updateAdminProvider: (id: string, payload: { name?: string; adapterName?: string; enabled?: boolean }) =>
    request<any>(`/admin/providers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  deleteAdminProvider: (id: string) =>
    request<{ deleted: boolean }>(`/admin/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getAdminReports: (status?: string) =>
    request<any[]>(`/admin/reports${query({ status })}`),

  updateAdminReport: (id: string, status: 'pending' | 'investigating' | 'resolved') =>
    request<any>(`/admin/reports/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  getAdminUsers: (params?: { page?: number; limit?: number }) =>
    request<any[]>(`/admin/users${query(params || {})}`),

  updateAdminUserRole: (id: string, role: UserProfile['role']) =>
    request<{ id: string; role: UserProfile['role'] }>(`/admin/users/${encodeURIComponent(id)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),

  triggerAdminSync: (payload?: { provider?: 'tmdb'; kind?: 'catalog' | 'episodes'; pages?: number; seriesLimit?: number }) =>
    request<any>('/admin/sync', { method: 'POST', body: JSON.stringify(payload || {}) }),

  getMe: () => request<UserProfile>('/auth/me'),
};

export { request as movyzaRequest };

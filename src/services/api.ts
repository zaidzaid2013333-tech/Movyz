import { supabase } from '../lib/supabase';
import {
  Movie, Series, Genre, WatchProgress, WatchlistItem, StreamReport,
  ProviderHealth, AuditLog, ApiResponse, PlaybackSource, UserProfile
} from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
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
    return request<{
      hero: Movie | Series;
      continueWatching: WatchProgress[];
      trending: (Movie | Series)[];
      popularMovies: Movie[];
      featuredSeries: Series[];
      recentAdded: (Movie | Series)[];
      genres: Genre[];
    }>('/home');
  },

  getMovies: (params?: {
    genreId?: number; year?: number; minRating?: number;
    sortBy?: 'popular' | 'rating' | 'newest'; search?: string;
    page?: number; limit?: number;
  }) => request<Movie[]>(`/movies${query(params || {})}`),

  getMovieById: (id: string) =>
    request<{ movie: Movie; similar: Movie[] }>(`/movies/${encodeURIComponent(id)}`),

  getSeries: (params?: {
    genreId?: number; year?: number;
    sortBy?: 'popular' | 'rating' | 'newest'; search?: string;
    page?: number; limit?: number;
  }) => request<Series[]>(`/series${query(params || {})}`),

  getSeriesById: (id: string) =>
    request<{ series: Series; similar: Series[] }>(`/series/${encodeURIComponent(id)}`),

  getWatchSources: (contentId: string, episodeId?: string) =>
    request<PlaybackSource[]>(
      `/watch/${encodeURIComponent(contentId)}/sources${episodeId ? `?episodeId=${encodeURIComponent(episodeId)}` : ''}`
    ),

  searchCatalog: (search: string) =>
    request<{
      movies: Movie[];
      series: Series[];
      cast: { name: string; nameEn: string; worksCount: number; avatarUrl: string }[];
    }>(`/search?q=${encodeURIComponent(search)}`),

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

  reportIssue: (report: Omit<StreamReport, 'id' | 'reportedAt' | 'status'>) =>
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

  testProvider: (providerId: string) =>
    request<ProviderHealth>(`/admin/providers/${encodeURIComponent(providerId)}/test`, { method: 'POST' }),

  getAdminAuditLogs: () => request<AuditLog[]>('/admin/audit'),

  deleteMovie: (id: string) =>
    request<{ deleted: boolean }>(`/admin/movies/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  triggerTmdbSync: () =>
    request<{ syncedCount: number; message: string }>('/admin/sync/tmdb', { method: 'POST' }),

  getMe: () => request<UserProfile>('/auth/me'),
};

export { request as movyzaRequest };

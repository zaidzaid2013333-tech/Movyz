import {
  Movie,
  Series,
  Genre,
  WatchProgress,
  WatchlistItem,
  StreamReport,
  ProviderHealth,
  AuditLog,
  ApiResponse,
  PlaybackSource
} from '../types';
import {
  GENRES,
  INITIAL_MOVIES,
  INITIAL_SERIES,
  INITIAL_PROVIDERS,
  INITIAL_AUDIT_LOGS
} from './mockData';

// Local storage keys
const STORAGE_KEYS = {
  MOVIES: 'movyza_db_movies_v1',
  SERIES: 'movyza_db_series_v1',
  WATCHLIST: 'movyza_user_watchlist_v1',
  PROGRESS: 'movyza_user_progress_v1',
  REPORTS: 'movyza_stream_reports_v1',
  PROVIDERS: 'movyza_providers_v1',
  AUDIT_LOGS: 'movyza_audit_logs_v1',
};

// Database state initializer
function getStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[Movyza Storage] Failed to parse ${key}`, e);
    return fallback;
  }
}

function setStored<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn(`[Movyza Storage] Failed to write ${key}`, e);
  }
}

// Initial hydration
if (!localStorage.getItem(STORAGE_KEYS.MOVIES)) {
  setStored(STORAGE_KEYS.MOVIES, INITIAL_MOVIES);
}
if (!localStorage.getItem(STORAGE_KEYS.SERIES)) {
  setStored(STORAGE_KEYS.SERIES, INITIAL_SERIES);
}
if (!localStorage.getItem(STORAGE_KEYS.PROVIDERS)) {
  setStored(STORAGE_KEYS.PROVIDERS, INITIAL_PROVIDERS);
}
if (!localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS)) {
  setStored(STORAGE_KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS);
}

// Unified API client class
export const MovyzaApi = {
  // GET /api/v1/home
  async getHomeData(): Promise<ApiResponse<{
    hero: Movie | Series;
    continueWatching: WatchProgress[];
    trending: (Movie | Series)[];
    popularMovies: Movie[];
    featuredSeries: Series[];
    recentAdded: (Movie | Series)[];
    genres: Genre[];
  }>> {
    // Artificial mini latency for realistic smooth skeleton transitions
    await new Promise((resolve) => setTimeout(resolve, 80));

    const movies: Movie[] = getStored(STORAGE_KEYS.MOVIES, INITIAL_MOVIES);
    const series: Series[] = getStored(STORAGE_KEYS.SERIES, INITIAL_SERIES);
    const progress: WatchProgress[] = getStored(STORAGE_KEYS.PROGRESS, []);

    // Featured hero
    const hero = movies.find((m) => m.isFeatured) || movies[0];

    // Combine trending
    const trending = [
      ...movies.filter((m) => m.isTrending),
      ...series.filter((s) => s.isTrending)
    ].sort((a, b) => b.rating - a.rating);

    // Combine recently added
    const recentAdded = [...movies, ...series].sort(
      (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
    );

    // Filter incomplete continue watching
    const continueWatching = progress.filter((p) => !p.completed && p.percentage > 2);

    return {
      success: true,
      data: {
        hero,
        continueWatching,
        trending,
        popularMovies: movies.filter((m) => m.isPopular),
        featuredSeries: series,
        recentAdded,
        genres: GENRES,
      },
    };
  },

  // GET /api/v1/movies
  async getMovies(params?: {
    genreId?: number;
    year?: number;
    minRating?: number;
    sortBy?: 'popular' | 'rating' | 'newest';
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<Movie[]>> {
    await new Promise((resolve) => setTimeout(resolve, 60));
    let movies: Movie[] = getStored(STORAGE_KEYS.MOVIES, INITIAL_MOVIES);

    if (params?.genreId) {
      movies = movies.filter((m) => m.genres.some((g) => g.id === params.genreId));
    }
    if (params?.year) {
      movies = movies.filter((m) => m.year === params.year);
    }
    if (params?.minRating !== undefined) {
      const min = params.minRating;
      movies = movies.filter((m) => m.rating >= min);
    }
    if (params?.search) {
      const q = params.search.trim().toLowerCase();
      movies = movies.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.titleEn.toLowerCase().includes(q) ||
          m.originalTitle.toLowerCase().includes(q) ||
          m.cast.some((c) => c.name.toLowerCase().includes(q) || c.nameEn.toLowerCase().includes(q))
      );
    }

    if (params?.sortBy === 'rating') {
      movies.sort((a, b) => b.rating - a.rating);
    } else if (params?.sortBy === 'newest') {
      movies.sort((a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime());
    } else {
      movies.sort((a, b) => b.votesCount - a.votesCount);
    }

    const page = params?.page || 1;
    const limit = params?.limit || 12;
    const total = movies.length;
    const paginated = movies.slice((page - 1) * limit, page * limit);

    return {
      success: true,
      data: paginated,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  // GET /api/v1/movies/:id
  async getMovieById(id: string): Promise<ApiResponse<{ movie: Movie; similar: Movie[] }>> {
    await new Promise((resolve) => setTimeout(resolve, 80));
    const movies: Movie[] = getStored(STORAGE_KEYS.MOVIES, INITIAL_MOVIES);
    const movie = movies.find((m) => m.id === id);

    if (!movie) {
      throw new Error('RESOURCE_NOT_FOUND: المحتوى المطلوب غير موجود');
    }

    const genreIds = new Set(movie.genres.map((g) => g.id));
    const similar = movies
      .filter((m) => m.id !== id && m.genres.some((g) => genreIds.has(g.id)))
      .slice(0, 6);

    return {
      success: true,
      data: {
        movie,
        similar: similar.length ? similar : movies.filter((m) => m.id !== id).slice(0, 6),
      },
    };
  },

  // GET /api/v1/series
  async getSeries(params?: {
    genreId?: number;
    year?: number;
    sortBy?: 'popular' | 'rating' | 'newest';
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<Series[]>> {
    await new Promise((resolve) => setTimeout(resolve, 60));
    let series: Series[] = getStored(STORAGE_KEYS.SERIES, INITIAL_SERIES);

    if (params?.genreId) {
      series = series.filter((s) => s.genres.some((g) => g.id === params.genreId));
    }
    if (params?.year) {
      series = series.filter((s) => s.startYear === params.year);
    }
    if (params?.search) {
      const q = params.search.trim().toLowerCase();
      series = series.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.titleEn.toLowerCase().includes(q) ||
          s.cast.some((c) => c.name.toLowerCase().includes(q) || c.nameEn.toLowerCase().includes(q))
      );
    }

    if (params?.sortBy === 'rating') {
      series.sort((a, b) => b.rating - a.rating);
    } else {
      series.sort((a, b) => b.votesCount - a.votesCount);
    }

    return {
      success: true,
      data: series,
      meta: {
        total: series.length,
      },
    };
  },

  // GET /api/v1/series/:id
  async getSeriesById(id: string): Promise<ApiResponse<{ series: Series; similar: Series[] }>> {
    await new Promise((resolve) => setTimeout(resolve, 80));
    const seriesList: Series[] = getStored(STORAGE_KEYS.SERIES, INITIAL_SERIES);
    const series = seriesList.find((s) => s.id === id);

    if (!series) {
      throw new Error('RESOURCE_NOT_FOUND: المسلسل المطلوب غير موجود');
    }

    const similar = seriesList.filter((s) => s.id !== id).slice(0, 6);

    return {
      success: true,
      data: {
        series,
        similar,
      },
    };
  },

  // GET /api/v1/watch/:id/sources
  async getWatchSources(contentId: string, episodeId?: string): Promise<ApiResponse<PlaybackSource[]>> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const movies: Movie[] = getStored(STORAGE_KEYS.MOVIES, INITIAL_MOVIES);
    const series: Series[] = getStored(STORAGE_KEYS.SERIES, INITIAL_SERIES);

    const movie = movies.find((m) => m.id === contentId);
    if (movie) {
      return { success: true, data: movie.sources };
    }

    const s = series.find((item) => item.id === contentId);
    if (s) {
      for (const season of s.seasons) {
        for (const ep of season.episodes) {
          if (!episodeId || ep.id === episodeId) {
            return { success: true, data: ep.sources };
          }
        }
      }
    }

    // Default resilient stream fallback
    return {
      success: true,
      data: [
        {
          id: 'def-src-1',
          type: 'mp4',
          quality: '1080p',
          language: 'ar',
          label: 'سيرفر الأمان الاحتياطي (Direct CDN)',
          labelEn: 'Direct Secure CDN',
          url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          isWorking: true,
          provider: 'Movyza Edge'
        }
      ]
    };
  },

  // GET /api/v1/search?q=
  async searchCatalog(query: string): Promise<ApiResponse<{
    movies: Movie[];
    series: Series[];
    cast: { name: string; nameEn: string; worksCount: number; avatarUrl: string }[];
  }>> {
    await new Promise((resolve) => setTimeout(resolve, 70));
    const q = query.trim().toLowerCase();
    if (!q) {
      return { success: true, data: { movies: [], series: [], cast: [] } };
    }

    const movies: Movie[] = getStored(STORAGE_KEYS.MOVIES, INITIAL_MOVIES);
    const series: Series[] = getStored(STORAGE_KEYS.SERIES, INITIAL_SERIES);

    const matchedMovies = movies.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.titleEn.toLowerCase().includes(q) ||
        m.originalTitle.toLowerCase().includes(q) ||
        m.director.toLowerCase().includes(q) ||
        m.genres.some((g) => g.name.toLowerCase().includes(q) || g.nameEn.toLowerCase().includes(q))
    );

    const matchedSeries = series.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.titleEn.toLowerCase().includes(q) ||
        s.originalTitle.toLowerCase().includes(q) ||
        s.creator.toLowerCase().includes(q) ||
        s.genres.some((g) => g.name.toLowerCase().includes(q) || g.nameEn.toLowerCase().includes(q))
    );

    // Cast matches
    const allCast = [...movies.flatMap((m) => m.cast), ...series.flatMap((s) => s.cast)];
    const castMap = new Map<string, { name: string; nameEn: string; worksCount: number; avatarUrl: string }>();

    for (const c of allCast) {
      if (c.name.toLowerCase().includes(q) || c.nameEn.toLowerCase().includes(q)) {
        if (!castMap.has(c.name)) {
          castMap.set(c.name, {
            name: c.name,
            nameEn: c.nameEn,
            worksCount: 1,
            avatarUrl: c.avatarUrl
          });
        } else {
          castMap.get(c.name)!.worksCount++;
        }
      }
    }

    return {
      success: true,
      data: {
        movies: matchedMovies,
        series: matchedSeries,
        cast: Array.from(castMap.values()),
      },
      meta: {
        total: matchedMovies.length + matchedSeries.length + castMap.size
      }
    };
  },

  // GET /api/v1/genres
  async getGenres(): Promise<ApiResponse<Genre[]>> {
    return { success: true, data: GENRES };
  },

  // WATCHLIST
  async getWatchlist(): Promise<ApiResponse<WatchlistItem[]>> {
    const list: WatchlistItem[] = getStored(STORAGE_KEYS.WATCHLIST, []);
    return { success: true, data: list };
  },

  async addToWatchlist(item: Omit<WatchlistItem, 'id' | 'addedAt'>): Promise<ApiResponse<WatchlistItem>> {
    const list: WatchlistItem[] = getStored(STORAGE_KEYS.WATCHLIST, []);
    const existing = list.find((i) => i.contentId === item.contentId);
    if (existing) {
      return { success: true, data: existing };
    }
    const newItem: WatchlistItem = {
      ...item,
      id: `wl-${Date.now()}`,
      addedAt: new Date().toISOString(),
    };
    list.unshift(newItem);
    setStored(STORAGE_KEYS.WATCHLIST, list);
    return { success: true, data: newItem };
  },

  async removeFromWatchlist(contentId: string): Promise<ApiResponse<{ removed: boolean }>> {
    let list: WatchlistItem[] = getStored(STORAGE_KEYS.WATCHLIST, []);
    list = list.filter((i) => i.contentId !== contentId);
    setStored(STORAGE_KEYS.WATCHLIST, list);
    return { success: true, data: { removed: true } };
  },

  // PROGRESS & HISTORY (Continue Watching)
  async getWatchHistory(): Promise<ApiResponse<WatchProgress[]>> {
    const list: WatchProgress[] = getStored(STORAGE_KEYS.PROGRESS, []);
    return { success: true, data: list };
  },

  async getWatchProgress(contentId: string, episodeId?: string): Promise<ApiResponse<WatchProgress | null>> {
    const list: WatchProgress[] = getStored(STORAGE_KEYS.PROGRESS, []);
    const found = list.find(
      (p) => p.contentId === contentId && (!episodeId || p.episodeId === episodeId)
    );
    return { success: true, data: found || null };
  },

  async saveWatchProgress(progress: WatchProgress): Promise<ApiResponse<WatchProgress>> {
    let list: WatchProgress[] = getStored(STORAGE_KEYS.PROGRESS, []);
    // Remove previous entry for this exact movie/episode
    list = list.filter(
      (p) => !(p.contentId === progress.contentId && p.episodeId === progress.episodeId)
    );
    list.unshift(progress);
    setStored(STORAGE_KEYS.PROGRESS, list);
    return { success: true, data: progress };
  },

  // STREAM ISSUE REPORT
  async reportIssue(report: Omit<StreamReport, 'id' | 'reportedAt' | 'status'>): Promise<ApiResponse<StreamReport>> {
    const reports: StreamReport[] = getStored(STORAGE_KEYS.REPORTS, []);
    const newReport: StreamReport = {
      ...report,
      id: `rep-${Date.now()}`,
      reportedAt: new Date().toISOString(),
      status: 'pending',
    };
    reports.unshift(newReport);
    setStored(STORAGE_KEYS.REPORTS, reports);
    return { success: true, data: newReport };
  },

  // ADMIN OPERATIONS
  async getAdminStats(): Promise<ApiResponse<{
    totalMovies: number;
    totalSeries: number;
    totalEpisodes: number;
    activeProviders: number;
    streamHealthPct: number;
    dailyStreamRequests: number;
  }>> {
    const movies: Movie[] = getStored(STORAGE_KEYS.MOVIES, INITIAL_MOVIES);
    const series: Series[] = getStored(STORAGE_KEYS.SERIES, INITIAL_SERIES);
    const providers: ProviderHealth[] = getStored(STORAGE_KEYS.PROVIDERS, INITIAL_PROVIDERS);

    const totalEpisodes = series.reduce((sum, s) => sum + s.episodesCount, 0);
    const activeProviders = providers.filter((p) => p.status === 'healthy').length;

    return {
      success: true,
      data: {
        totalMovies: movies.length,
        totalSeries: series.length,
        totalEpisodes,
        activeProviders,
        streamHealthPct: 99.2,
        dailyStreamRequests: 84320,
      }
    };
  },

  async getAdminProviders(): Promise<ApiResponse<ProviderHealth[]>> {
    const providers = getStored(STORAGE_KEYS.PROVIDERS, INITIAL_PROVIDERS);
    return { success: true, data: providers };
  },

  async testProvider(providerId: string): Promise<ApiResponse<ProviderHealth>> {
    const providers: ProviderHealth[] = getStored(STORAGE_KEYS.PROVIDERS, INITIAL_PROVIDERS);
    const p = providers.find((item) => item.id === providerId);
    if (!p) throw new Error('Provider not found');
    p.latencyMs = Math.floor(Math.random() * 80) + 25;
    p.lastChecked = 'الآن (Now)';
    p.status = 'healthy';
    setStored(STORAGE_KEYS.PROVIDERS, providers);
    return { success: true, data: p };
  },

  async getAdminAuditLogs(): Promise<ApiResponse<AuditLog[]>> {
    const logs = getStored(STORAGE_KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS);
    return { success: true, data: logs };
  },

  async deleteMovie(id: string): Promise<ApiResponse<{ deleted: boolean }>> {
    let movies: Movie[] = getStored(STORAGE_KEYS.MOVIES, INITIAL_MOVIES);
    movies = movies.filter((m) => m.id !== id);
    setStored(STORAGE_KEYS.MOVIES, movies);

    // Audit log
    const logs: AuditLog[] = getStored(STORAGE_KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS);
    logs.unshift({
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      userId: 'usr-admin-1',
      userEmail: 'admin@movyza.tv',
      action: 'حذف محتوى',
      actionEn: 'Delete Content',
      target: `Movie ${id}`,
      details: 'تم الحذف بواسطة لوحة الإدارة',
      ip: '197.165.22.4'
    });
    setStored(STORAGE_KEYS.AUDIT_LOGS, logs);

    return { success: true, data: { deleted: true } };
  },

  async triggerTmdbSync(): Promise<ApiResponse<{ syncedCount: number; message: string }>> {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return {
      success: true,
      data: {
        syncedCount: 14,
        message: 'تمت مزامنة بيانات الأفلام والمسلسلات بنجاح من TMDB'
      }
    };
  }
};

export type ContentType = 'movie' | 'series';
export type UserRole = 'USER' | 'ADMIN' | 'OWNER';

export interface Genre {
  id: number;
  name: string; // Arabic name
  nameEn: string;
  slug: string;
}

export interface CastMember {
  id: string;
  name: string;
  nameEn: string;
  character: string;
  characterEn: string;
  avatarUrl: string;
}

export interface PlaybackSubtitleTrack {
  url: string;
  type: 'vtt' | 'srt';
  language: string;
  label: string;
  labelEn: string;
  default?: boolean;
}

export interface PlaybackSource {
  id: string;
  type: 'hls' | 'mp4' | 'dash' | 'webm' | 'web';
  quality: string;
  language: string;
  label: string; // e.g., 'سيرفر سريع (Akamai CDN)'
  labelEn: string; // e.g., 'Fast CDN (Primary)'
  url: string;
  isWorking: boolean;
  provider: string; // e.g. 'AbdoBest', 'StreamProvider', 'TMDB Embed'
  providerKey?: string;
  providerReference?: string;
  sourceUrl?: string;
  subtitleTracks?: PlaybackSubtitleTrack[];
}

export interface Movie {
  id: string;
  tmdbId: number;
  type: 'movie';
  title: string; // Arabic Title
  titleEn: string; // English Title
  originalTitle: string;
  year: number;
  releaseDate: string;
  rating: number; // 0 to 10
  votesCount: number;
  runtime: number; // in minutes
  overview: string; // Arabic synopsis
  overviewEn: string; // English synopsis
  posterUrl: string;
  backdropUrl: string;
  genres: Genre[];
  director: string;
  directorEn: string;
  cast: CastMember[];
  sources: PlaybackSource[];
  isFeatured?: boolean;
  isTrending?: boolean;
  isPopular?: boolean;
  addedAt: string;
  ageRating: string; // 'PG-13', '18+', '16+'
}

export interface Episode {
  id: string;
  tmdbId?: number;
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  titleEn: string;
  overview: string;
  overviewEn: string;
  stillUrl: string;
  duration: number; // minutes
  airDate: string;
  sources: PlaybackSource[];
}

export interface Season {
  id: string;
  seriesId: string;
  seasonNumber: number;
  name: string;
  nameEn: string;
  posterUrl: string;
  overview: string;
  airDate: string;
  episodesCount: number;
  episodes: Episode[];
}

export interface Series {
  id: string;
  tmdbId: number;
  type: 'series';
  title: string;
  titleEn: string;
  originalTitle: string;
  startYear: number;
  endYear?: number;
  releaseDate: string;
  rating: number;
  votesCount: number;
  overview: string;
  overviewEn: string;
  posterUrl: string;
  backdropUrl: string;
  genres: Genre[];
  creator: string;
  creatorEn: string;
  cast: CastMember[];
  seasonsCount: number;
  episodesCount: number;
  seasons: Season[];
  isFeatured?: boolean;
  isTrending?: boolean;
  isPopular?: boolean;
  status?: string;
  addedAt: string;
  ageRating: string;
}

export type MediaItem = Movie | Series;

export interface WatchProgress {
  contentId: string;
  contentType: ContentType;
  title: string;
  titleEn: string;
  posterUrl: string;
  backdropUrl: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeId?: string;
  positionSeconds: number;
  durationSeconds: number;
  percentage: number;
  lastWatchedAt: string;
  completed: boolean;
}

export interface WatchlistItem {
  id: string;
  userId: string;
  contentId: string;
  contentType: ContentType;
  title: string;
  titleEn: string;
  posterUrl: string;
  year: number;
  rating: number;
  genres: string[];
  addedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl: string;
  preferredLanguage: 'ar' | 'en';
  createdAt: string;
}

export interface StreamReport {
  id: string;
  contentId: string;
  contentTitle: string;
  sourceId: string;
  issueType: 'broken_source' | 'audio_sync' | 'subtitle_issue' | 'buffering' | 'other';
  description: string;
  reportedAt: string;
  status: 'pending' | 'investigating' | 'resolved';
}

export interface ProviderHealth {
  id: string;
  name: string;
  adapterName: string;
  type: 'api' | 'scraper' | 'direct';
  status: 'healthy' | 'degraded' | 'offline';
  latencyMs: number;
  successRate: number; // percentage
  lastChecked: string;
  activeSources: number;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userEmail: string;
  action: string;
  actionEn: string;
  target: string;
  details: string;
  ip: string;
}

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type PlaybackKind = 'hls' | 'mp4' | 'dash' | 'embed';

export interface ProviderContext {
  tmdbId?: number;
  title?: string;
  originalTitle?: string;
  alternateTitles?: string[];
  releaseYear?: number;
  providerId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface NormalizedPlaybackSource {
  provider: string;
  type: PlaybackKind;
  url?: string;
  providerReference?: string;
  quality: string;
  language: string;
  label: string;
  expiresAt?: string;
}

export interface ProviderAdapter {
  key: string;
  name: string;
  enabled: boolean;
  requiresMapping?: boolean;
  resolveMovie(context: ProviderContext): Promise<NormalizedPlaybackSource[]>;
  resolveEpisode(context: ProviderContext): Promise<NormalizedPlaybackSource[]>;
  health(): Promise<{ status: 'healthy' | 'degraded' | 'offline'; latencyMs: number; message?: string }>;
}

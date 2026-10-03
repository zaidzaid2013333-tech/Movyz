import { adminSupabase } from './supabase';
import { createPlaybackProxyUrl } from './playback-proxy';

type PlaybackContentType = 'movie' | 'episode';

type CineProSource = {
  id?: string;
  url?: string;
  type?: string;
  quality?: string;
  streamable?: boolean;
  provider?: { id?: string; name?: string };
  audioTracks?: string[];
};

const QUALITY_MAP: Record<string, string> = {
  '4K': '2160p',
  UHD: '2160p',
  FHD: '1080p',
  '1080P': '1080p',
  HD: '720p',
  '720P': '720p',
  SD: '480p',
  '480P': '480p',
  '360P': '360p',
};

function normalizeType(value: unknown): 'mp4' | 'hls' | 'dash' | 'webm' | 'direct' | null {
  const type = String(value || '').toLowerCase();
  if (type === 'hls' || type === 'm3u8') return 'hls';
  if (type === 'dash' || type === 'mpd') return 'dash';
  if (type === 'mp4') return 'mp4';
  if (type === 'webm') return 'webm';
  if (type === 'direct') return 'direct';
  return null;
}

function normalizeQuality(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase();
  if (QUALITY_MAP[raw]) return QUALITY_MAP[raw];
  const match = raw.match(/(2160|1440|1080|720|576|480|360|240)/);
  return match ? `${match[1]}p` : '720p';
}

async function loadTmdbContext(contentType: PlaybackContentType, contentId: string) {
  if (contentType === 'movie') {
    const { data, error } = await adminSupabase
      .from('movies')
      .select('tmdb_id')
      .eq('id', contentId)
      .eq('status', 'published')
      .maybeSingle();
    if (error) throw new Error('Unable to load movie for CinePro: ' + error.message);
    if (!data?.tmdb_id) throw new Error('Movie has no TMDB id');
    return { tmdbId: Number(data.tmdb_id) };
  }

  const { data, error } = await adminSupabase
    .from('episodes')
    .select('episode_number,seasons!inner(season_number,series:series_id!inner(tmdb_id,status))')
    .eq('id', contentId)
    .maybeSingle();

  if (error) throw new Error('Unable to load episode for CinePro: ' + error.message);

  const season = Array.isArray(data?.seasons) ? data?.seasons[0] : data?.seasons;
  const series = season && (Array.isArray(season.series) ? season.series[0] : season.series);
  if (!series?.tmdb_id || String(series.status) !== 'published') {
    throw new Error('Episode series has no valid TMDB id');
  }

  return {
    tmdbId: Number(series.tmdb_id),
    season: Number(season.season_number),
    episode: Number(data.episode_number),
  };
}

export async function getCineProSources(
  contentType: PlaybackContentType,
  contentId: string,
  requestUrl: string,
  env: Record<string, unknown>,
) {
  const baseUrl = String(env.CINEPRO_BASE_URL || '').trim().replace(/\/$/, '');
  if (!baseUrl) return [];

  const context = await loadTmdbContext(contentType, contentId);
  const endpoint = contentType === 'movie'
    ? `${baseUrl}/v1/movies/${context.tmdbId}?platform=web`
    : `${baseUrl}/v1/tv/${context.tmdbId}/seasons/${context.season}/episodes/${context.episode}?platform=web`;

  const response = await fetch(endpoint, {
    headers: { Accept: 'application/json', 'User-Agent': 'Movyz-CinePro-Adapter/1.0' },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`CinePro returned HTTP ${response.status}`);
  }

  const payload = await response.json() as { sources?: CineProSource[] };
  const sources = Array.isArray(payload.sources) ? payload.sources : [];

  const prepared = [];
  for (const source of sources) {
    const url = String(source.url || '').trim();
    const type = normalizeType(source.type);
    if (!/^https:\/\//i.test(url) || !type || source.streamable === false) continue;

    const quality = normalizeQuality(source.quality);
    const providerName = String(source.provider?.name || source.provider?.id || 'CinePro').trim() || 'CinePro';

    const signedUrl = await createPlaybackProxyUrl({
      provider: providerName,
      providerReference: `cinepro:${String(source.provider?.id || 'unknown')}`,
      type,
      url,
      quality,
      language: 'und',
      label: providerName,
    }, requestUrl, env);

    if (!signedUrl || signedUrl === url) continue;

    prepared.push({
      id: `cinepro:${contentType}:${contentId}:${String(source.id || prepared.length)}`,
      type,
      quality,
      language: 'und',
      label: providerName,
      labelEn: providerName,
      url: signedUrl,
      isWorking: true,
      provider: providerName,
      providerKey: String(source.provider?.id || 'cinepro'),
      providerReference: `cinepro:${String(source.provider?.id || 'unknown')}`,
      expiresAt: null,
    });
  }

  return prepared
    .sort((a, b) => Number.parseInt(b.quality) - Number.parseInt(a.quality))
    .slice(0, 12);
}

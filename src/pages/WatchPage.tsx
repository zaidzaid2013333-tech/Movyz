import React, { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Film,
  Info,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Star,
  Share2,
  ShieldAlert,
  Sparkles,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { MovyzaApi } from '../services/api';
import { Movie, Series, Episode, PlaybackSource } from '../types';
import { ErrorState } from '../components/ui/FeedbackStates';
import { HeroSkeleton } from '../components/ui/Skeletons';

interface WatchPageProps {
  mediaType: 'movie' | 'series';
  contentId: string;
  seasonNumber?: number;
  episodeNumber?: number;
  onNavigate: (path: string) => void;
}

function normalizePlaybackQuality(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Auto';
  if (/^auto$/i.test(raw)) return 'Auto';
  const match = raw.match(/(?:^|\D)(2160|1440|1080|720|576|480|360|240)(?:p)?(?:$|\D)/i);
  return match?.[1] ? `${match[1]}p` : raw;
}

const inferPlaybackType = (url: string, declaredType?: string) => {
  const type = String(declaredType || '').trim().toLowerCase();
  if (['hls', 'mp4', 'dash', 'webm', 'direct', 'embed'].includes(type)) return type;
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return 'hls';
  if (/\.mpd(?:[?#]|$)/i.test(url)) return 'dash';
  if (/\.webm(?:[?#]|$)/i.test(url)) return 'webm';
  if (/\.mp4(?:[?#]|$)/i.test(url)) return 'mp4';
  return 'direct';
};

const normalizePlaybackSource = (source: PlaybackSource): PlaybackSource | null => {
  const isAkwamRelay = source.providerKey === 'akwam' && /\/api\/v1\/playback\/stream(?:\?|$)/i.test(String(source.url || ''));
  const url = String(isAkwamRelay ? source.url : (source.directUrl || source.url || source.embedUrl || '')).trim();
  if (!/^https?:\/\//i.test(url)) return null;

  return {
    ...source,
    url: String(source.url || url).trim() || url,
    type: inferPlaybackType(url, source.type) as PlaybackSource['type'],
    quality: normalizePlaybackQuality(source.quality),
    isWorking: source.isWorking !== false,
    directUrl: source.directUrl?.trim() || undefined,
  };
};

function playbackEngineFor(source: PlaybackSource | null | undefined) {
  const type = String(source?.type || '').toLowerCase();
  const isAkwamRelay = source?.providerKey === 'akwam' && /\/api\/v1\/playback\/stream(?:\?|$)/i.test(String(source.url || ''));
  const url = String(isAkwamRelay ? source.url : (source?.directUrl || source?.url || source?.embedUrl || '')).toLowerCase();
  if (type === 'embed') return 'embed' as const;
  if (type === 'hls' || /\.m3u8(?:[?#]|$)/i.test(url)) return 'hls' as const;
  if (type === 'dash' || /\.mpd(?:[?#]|$)/i.test(url)) return 'dash' as const;
  return 'native' as const;
}

const isPlayableHttpSource = (source: PlaybackSource) => {
  const normalized = normalizePlaybackSource(source);
  if (!normalized) return false;

  const isAkwamRelay = normalized.providerKey === 'akwam' && /\/api\/v1\/playback\/stream(?:\?|$)/i.test(String(normalized.url || ''));
  const url = String(isAkwamRelay ? normalized.url : (normalized.directUrl || normalized.url || '')).trim();
  if (!/^https?:\/\//i.test(url)) return false;

  const type = String(normalized.type || '').toLowerCase();
  if (!['mp4', 'hls', 'dash', 'webm', 'direct'].includes(type)) return false;

  try {
    new URL(url);
  } catch {
    return false;
  }

  return normalized.isWorking !== false;
};

const pickPlaybackSources = (content: Movie | Series, episode?: Episode) => {
  const candidates = episode?.sources ?? (content.type === 'movie' ? content.sources : []);
  const normalized = candidates
    .map(normalizePlaybackSource)
    .filter((source): source is PlaybackSource => Boolean(source))
    .filter((source) => source.isWorking !== false)
    .filter(isPlayableHttpSource);

  return collapseProviderQualityDuplicates(normalized).slice(0, 20);
};

const playbackQualityRank = (source: PlaybackSource) => {
  const match = normalizePlaybackQuality(source.quality).match(/(\d{3,4})p/i);
  const quality = match ? Number(match[1]) : 0;
  // Lower rank = preferred. Unknown quality stays behind known resolutions.
  return quality > 0 ? 10000 - quality : 20000;
};

const sortPlaybackSources = (sources: PlaybackSource[]) =>
  [...sources].sort((a, b) => playbackQualityRank(a) - playbackQualityRank(b));

const collapseProviderQualityDuplicates = (sources: PlaybackSource[]) => {
  const selected = new Map<string, PlaybackSource[]>();
  const priority: Record<string, number> = { hls: 50, mp4: 45, dash: 40, webm: 35, direct: 30 };
  const maxPerProviderQuality = 3;

  for (const source of sources) {
    const provider = String(source.providerKey || source.providerReference || source.provider || 'selected-site')
      .trim()
      .toLowerCase();
    const quality = String(source.quality || '').trim().toLowerCase();
    const key = `${provider}|${quality}`;
    const group = selected.get(key) || [];

    if (group.some((candidate) => candidate.url === source.url)) continue;

    if (group.length < maxPerProviderQuality) {
      group.push(source);
      selected.set(key, group);
      continue;
    }

    let weakestIndex = 0;
    for (let index = 1; index < group.length; index += 1) {
      const currentPriority = priority[String(group[index].type || '').toLowerCase()] || 0;
      const weakestPriority = priority[String(group[weakestIndex].type || '').toLowerCase()] || 0;
      if (currentPriority < weakestPriority) weakestIndex = index;
    }

    const sourcePriority = priority[String(source.type || '').toLowerCase()] || 0;
    const weakestPriority = priority[String(group[weakestIndex].type || '').toLowerCase()] || 0;
    if (sourcePriority > weakestPriority) {
      group[weakestIndex] = source;
      selected.set(key, group);
    }
  }

  return [...selected.values()]
    .flat();
};

const preferredPlaybackSource = (sources: PlaybackSource[]) => {
  if (!sources.length) return null;

  const qualityOf = (source: PlaybackSource) => {
    const match = normalizePlaybackQuality(source.quality).match(/(\d{3,4})p/i);
    return match ? Number(match[1]) : 0;
  };

  const typePriority: Record<string, number> = {
    mp4: 40,
    webm: 30,
    hls: 20,
    dash: 15,
    direct: 10,
  };

  return [...sources].sort((a, b) => {
    const aq = qualityOf(a);
    const bq = qualityOf(b);

    const bucket = (q: number) => {
      if (q === 720) return 0;
      if (q > 0 && q < 720) return 1;
      if (q > 720) return 2;
      return 3;
    };

    const ab = bucket(aq);
    const bb = bucket(bq);
    if (ab !== bb) return ab - bb;

    if (ab === 1 && aq !== bq) return bq - aq;
    if (ab === 2 && aq !== bq) return aq - bq;

    const at = typePriority[String(a.type || '').toLowerCase()] || 0;
    const bt = typePriority[String(b.type || '').toLowerCase()] || 0;
    return bt - at;
  })[0] || null;
};

const providerDisplayName = (key: string, fallback: string, language: 'ar' | 'en') => {
  const normalized = key.trim().toLowerCase();
  const names: Record<string, [string, string]> = {
    aflaam: ['أفلام', 'Aflam'],
    anime4up: ['أنمي فور أب', 'Anime4Up'],
    cimaclub: ['سيما كلوب', 'CimaClub'],
    doodstream: ['DoodStream', 'DoodStream'],
    akwam: ['أكوام', 'Akwam'],
  };
  return names[normalized]?.[language === 'ar' ? 0 : 1] || fallback;
};

const playbackHostLabel = (url?: string) => {
  if (!url) return 'server';
  try {
    return new URL(url).hostname.replace(/^www\\./i, '');
  } catch {
    return 'server';
  }
};

const groupPlaybackSources = (sources: PlaybackSource[], language: 'ar' | 'en') => {
  const groups = new Map<string, { key: string; label: string; sources: PlaybackSource[] }>();

  for (const source of sortPlaybackSources(sources)) {
    const key = String(source.providerKey || source.providerReference || source.provider || 'selected-site')
      .trim()
      .toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.sources.push(source);
      continue;
    }

    groups.set(key, {
      key,
      label: providerDisplayName(key, source.provider || source.labelEn || 'Source', language),
      sources: [source],
    });
  }

  return [...groups.values()];
};

export const WatchPage: React.FC<WatchPageProps> = ({
  mediaType,
  contentId,
  seasonNumber,
  episodeNumber,
  onNavigate,
}) => {
  const { language, t, direction } = useLanguage();
  const [content, setContent] = useState<Movie | Series | null>(null);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [theaterLighting, setTheaterLighting] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [remotePlaybackSources, setRemotePlaybackSources] = useState<PlaybackSource[]>([]);

  const [remotePlaybackSource, setRemotePlaybackSource] = useState<PlaybackSource | null>(null);
  const [resolverLoading, setResolverLoading] = useState(false);
  const [playerUnlocked, setPlayerUnlocked] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerCurrentTime, setPlayerCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(1);
  const [playerMuted, setPlayerMuted] = useState(false);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [playerPictureInPicture, setPlayerPictureInPicture] = useState(false);
  const [playerSpeed, setPlayerSpeed] = useState(1);
  const [playerBufferedEnd, setPlayerBufferedEnd] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerControlsVisible, setPlayerControlsVisible] = useState(true);
  const [playerSettingsOpen, setPlayerSettingsOpen] = useState(false);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerLoadingMessage, setPlayerLoadingMessage] = useState('');
  const [seekFeedback, setSeekFeedback] = useState<{ delta: number; id: number } | null>(null);
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  const [playbackRetry, setPlaybackRetry] = useState(0);
  const playerControlsHideTimerRef = useRef<number | null>(null);
  const playerControlsVisibleRef = useRef(true);
  const touchSingleTapTimerRef = useRef<number | null>(null);
  const playerLoadTimeoutRef = useRef<number | null>(null);
  const playbackStallTimerRef = useRef<number | null>(null);
  const reloadRestoreRef = useRef<{ time: number; wasPlaying: boolean } | null>(null);
  const lastTouchTapRef = useRef<{ time: number; x: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const qualityResumeTimeRef = useRef<number | null>(null);
  const resumeAfterQualitySwitchRef = useRef(false);
  const qualitySwitchPendingRef = useRef(false);
  const userPlayRequestedRef = useRef(false);
  const playbackStartedRef = useRef(false);
  const startupTriedUrlsRef = useRef<Set<string>>(new Set());
  const retriedPlaybackUrlsRef = useRef<Set<string>>(new Set());
  const failedPlaybackUrlsRef = useRef<Set<string>>(new Set());
  const startupGuardTimerRef = useRef<number | null>(null);
  const startupWarmupTimerRef = useRef<number | null>(null);
  const resumeAfterBufferingRef = useRef(false);
  const progressSaveTimerRef = useRef<number | null>(null);
  const lastProgressSaveAtRef = useRef(0);
  const playbackEngineRef = useRef<{ destroy?: () => void; reset?: () => void } | null>(null);
  const activeSeason = seasonNumber || 1;
  const activeEpisode = episodeNumber || 1;

  const startupRecoveryStageRef = useRef<'idle' | 'recovering' | 'done'>('idle');
  const startupRecoveryTimerRef = useRef<number | null>(null);

  const recoverStartupBuffer = () => {
    const video = videoRef.current;
    if (
      !video ||
      startupRecoveryStageRef.current !== 'idle' ||
      !Number.isFinite(video.duration) ||
      video.duration < 125 ||
      video.currentTime >= 20
    ) {
      return;
    }

    startupRecoveryStageRef.current = 'recovering';
    setPlayerLoadingState(
      true,
      language === 'ar' ? 'جارٍ تهيئة التشغيل…' : 'Preparing playback…',
    );

    const targetTime = Math.min(120, Math.max(1, video.duration - 1));

    const finishWarmup = () => {
      if (startupWarmupTimerRef.current !== null) {
        window.clearTimeout(startupWarmupTimerRef.current);
        startupWarmupTimerRef.current = null;
      }
      if (startupRecoveryStageRef.current !== 'recovering') return;

      try {
        video.currentTime = 0;
      } catch {
        // Some providers reject a seek while a range is still being opened.
      }

      startupRecoveryStageRef.current = 'done';
      setPlayerCurrentTime(0);
      setPlayerLoadingState(false);
      resumeAfterBufferingRef.current = false;
      void video.play().catch(() => undefined);
    };

    if (startupWarmupTimerRef.current !== null) {
      window.clearTimeout(startupWarmupTimerRef.current);
    }

    try {
      // Force a fast range request around 02:00, then return to 00:00 almost
      // immediately. The loading overlay hides the transient seek from the UI.
      video.currentTime = targetTime;
      startupWarmupTimerRef.current = window.setTimeout(finishWarmup, 120);
    } catch {
      startupRecoveryStageRef.current = 'idle';
      setPlayerLoadingState(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const loadContent = async () => {
      setLoading(true);
      setError(null);

      try {
        setContent(null);
        setCurrentEpisode(undefined);
        setRemotePlaybackSources([]);
        setRemotePlaybackSource(null);
        setResolverLoading(false);
        setPlaybackRetry(0);
        clearPlaybackStallTimer();
        setPlayerUnlocked(false);
        setPlaybackError(null);
        setPlayerReady(false);
        setPlayerCurrentTime(0);
        setPlayerDuration(0);
        setPlayerBufferedEnd(0);
        setPlayerPictureInPicture(false);
        userPlayRequestedRef.current = false;
        playbackStartedRef.current = false;
        startupTriedUrlsRef.current.clear();
        startupRecoveryStageRef.current = 'idle';
        if (startupRecoveryTimerRef.current !== null) {
          window.clearTimeout(startupRecoveryTimerRef.current);
          startupRecoveryTimerRef.current = null;
        }

        const legacyTmdbId = /^\d+$/.test(contentId) ? Number(contentId) : null;
        const response = mediaType === 'movie'
          ? legacyTmdbId
            ? await MovyzaApi.getMovieByTmdbId(legacyTmdbId)
            : await MovyzaApi.getMovieById(contentId)
          : legacyTmdbId
            ? await MovyzaApi.getSeriesWatchByTmdbId(legacyTmdbId, activeSeason, activeEpisode)
            : await MovyzaApi.getSeriesWatchById(contentId, activeSeason, activeEpisode);

        if (!mounted) return;

        const loaded = response.data;
        if (mediaType === 'movie') {
          if (!('movie' in loaded)) {
            throw new Error('Unexpected movie response');
          }
          setContent(loaded.movie);
          setCurrentEpisode(undefined);
        } else {
          if (!('series' in loaded)) {
            throw new Error('Unexpected series response');
          }
          const series = loaded.series;
          const season = series.seasons.find(
            (item) => item.seasonNumber === activeSeason,
          );
          const episode = season?.episodes.find(
            (item) => item.episodeNumber === activeEpisode,
          );

          if (!season || !episode) {
            throw new Error(
              `Requested episode S${activeSeason}E${activeEpisode} is not present in the catalog response`,
            );
          }

          setContent(series);
          setCurrentEpisode(episode);
        }

        setLoading(false);
      } catch (caught) {
        if (!mounted) return;
        setContent(null);
        setCurrentEpisode(undefined);
        setError(
          language === 'ar'
            ? 'تعذر تحميل معلومات العمل حاليًا.'
            : 'Unable to load the title information right now.',
        );
        setLoading(false);
      }
    };

    void loadContent();

    return () => {
      mounted = false;
    };
  }, [mediaType, contentId, activeSeason, activeEpisode, language]);

  useEffect(() => {
    setTheaterLighting(true);
  }, [contentId, activeSeason, activeEpisode]);

  // Playback is live-broker only. The API never returns persisted source rows.
  useEffect(() => {
    const targetId = mediaType === 'movie' ? content?.id : currentEpisode?.id;

    if (!targetId) {
      setRemotePlaybackSources([]);
      setRemotePlaybackSource(null);
      setPlayerUnlocked(false);
      setPlaybackError(null);
      setResolverLoading(true);
      return;
    }

    let cancelled = false;
    setResolverLoading(true);
    setRemotePlaybackSources([]);
    setRemotePlaybackSource(null);
    setPlayerUnlocked(false);
    setPlaybackError(null);

    const prepare = async () => {
      const attempts = mediaType === 'series' ? 2 : 1;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const response = await MovyzaApi.preparePlayback(
            mediaType === 'movie' ? 'movie' : 'episode',
            targetId,
            mediaType === 'series' ? currentEpisode?.seasonNumber : undefined,
            mediaType === 'series' ? currentEpisode?.episodeNumber : undefined,
          );
          if (cancelled) return;
          const sources = Array.isArray(response.data?.sources) ? response.data.sources : [];
          const playable = sources
            .map(normalizePlaybackSource)
            .filter((source): source is PlaybackSource => Boolean(source))
            .filter((source) => source.isWorking !== false)
            .filter(isPlayableHttpSource);
          if (!playable.length && attempt < attempts) {
            await new Promise((resolve) => window.setTimeout(resolve, 450));
            continue;
          }
          const collapsed = collapseProviderQualityDuplicates(playable).slice(0, 20);
          const preferred = collapsed[0] || null;
          failedPlaybackUrlsRef.current.clear();
          setRemotePlaybackSources(collapsed);
          setRemotePlaybackSource(preferred);
          setPlayerUnlocked(Boolean(preferred));
          setPlaybackError(
            preferred
              ? null
              : (language === 'ar'
                ? 'لا يوجد مصدر تشغيل صالح لهذا العمل حاليًا.'
                : 'No playable source is currently available for this title.'),
          );
          return;
        } catch {
          if (cancelled) return;
          if (attempt < attempts) {
            setPlaybackError(
              language === 'ar'
                ? 'تعذر فتح المصدر الآن، جارٍ إعادة المحاولة…'
                : 'The source did not respond; retrying…',
            );
            await new Promise((resolve) => window.setTimeout(resolve, 450));
            continue;
          }
        }
      }
      if (cancelled) return;
      setRemotePlaybackSources([]);
      setRemotePlaybackSource(null);
      setPlayerUnlocked(false);
      setPlaybackError(
        language === 'ar'
          ? 'تعذر الحصول على مصدر تشغيل مباشر من Akwam حاليًا.'
          : 'Unable to obtain a live Akwam playback source right now.',
      );
    };

    void prepare().finally(() => {
      if (!cancelled) setResolverLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    mediaType,
    content?.id,
    currentEpisode?.id,
    currentEpisode?.seasonNumber,
    currentEpisode?.episodeNumber,
    language,
  ]);

  const playbackSource = remotePlaybackSource;
  const brokerRelayUrl =
    playbackSource?.providerKey === 'akwam' &&
    /\/api\/v1\/playback\/stream(?:\?|$)/i.test(String(playbackSource?.url || ''))
      ? playbackSource.url.trim()
      : '';
  const directPlaybackUrl = playbackSource?.directUrl?.trim() || '';
  const playbackUrl = useMemo(() => {
    const baseUrl = brokerRelayUrl || directPlaybackUrl || playbackSource?.url?.trim() || '';
    if (!baseUrl || !brokerRelayUrl || playbackRetry === 0) return baseUrl;
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('retry', String(playbackRetry));
      return url.toString();
    } catch {
      return baseUrl;
    }
  }, [brokerRelayUrl, directPlaybackUrl, playbackSource?.url, playbackRetry]);
  const isEmbedPlayback = String(playbackSource?.type || '').toLowerCase() === 'embed';

  const formatPlayerTime = (value: number) => {
    if (!Number.isFinite(value) || value < 0) return '00:00';
    const total = Math.floor(value);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const base = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return hours > 0 ? `${String(hours).padStart(2, '0')}:${base}` : base;
  };

  const clearPlayerLoadTimeout = () => {
    if (playerLoadTimeoutRef.current !== null) {
      window.clearTimeout(playerLoadTimeoutRef.current);
      playerLoadTimeoutRef.current = null;
    }
  };
  
  const clearPlaybackStallTimer = () => {
    if (playbackStallTimerRef.current !== null) {
      window.clearTimeout(playbackStallTimerRef.current);
      playbackStallTimerRef.current = null;
    }
  };

  const setPlayerLoadingState = (loading: boolean, message = '') => {
    if (loading) {
      setPlayerLoading(true);
      setPlayerLoadingMessage(
        message ||
          (language === 'ar'
            ? 'جارٍ تحميل الفيديو…'
            : 'Loading video…'),
      );
    } else {
      setPlayerLoading(false);
      setPlayerLoadingMessage('');
    }
  };

  const armPlayerLoadTimeout = () => {
    // Playback timeout is intentionally non-fatal. The media element decides
    // whether the current source can actually play; buffering stays recoverable.
    clearPlayerLoadTimeout();
  };

  const reloadPlayer = () => {
    const video = videoRef.current;

    if (!video || !playbackUrl || isEmbedPlayback) {
      if (isEmbedPlayback) {
        setPlayerLoadingState(true, language === 'ar' ? 'جارٍ إعادة تحميل المشغل…' : 'Reloading player…');
        setPlayerReloadKey((value) => value + 1);
        armPlayerLoadTimeout();
      }
      return;
    }

    reloadRestoreRef.current = {
      time: Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0,
      wasPlaying: !video.paused && !video.ended,
    };
    qualityResumeTimeRef.current = null;
    qualitySwitchPendingRef.current = false;
    playbackStartedRef.current = false;
    setPlaybackError(null);
    setPlayerReady(false);
    setPlayerLoadingState(true, language === 'ar' ? 'جارٍ إعادة تحميل الفيديو…' : 'Reloading video…');
    playerControlsVisibleRef.current = true;
    setPlayerControlsVisible(true);
    armPlayerLoadTimeout();
    setPlaybackRetry((value) => value + 1);
    setPlayerReloadKey((value) => value + 1);
  };

  const togglePlayerPlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      // Load aggressively only when the user actually asks to play.
      video.preload = 'auto';
      userPlayRequestedRef.current = true;
      resumeAfterBufferingRef.current = true;
      void video.play().catch(() => undefined);
    } else {
      resumeAfterBufferingRef.current = false;
      userPlayRequestedRef.current = false;
      video.pause();
    }
  };

  const seekPlayerBy = (seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const nextTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + seconds));
    video.currentTime = nextTime;
    setPlayerCurrentTime(nextTime);
    setSeekFeedback({ delta: seconds, id: Date.now() });
    window.setTimeout(() => setSeekFeedback(null), 520);
  };

  const revealPlayerControls = () => {
    playerControlsVisibleRef.current = true;
    setPlayerControlsVisible(true);
    if (playerControlsHideTimerRef.current !== null) {
      window.clearTimeout(playerControlsHideTimerRef.current);
      playerControlsHideTimerRef.current = null;
    }
    if (playerPlaying) {
      playerControlsHideTimerRef.current = window.setTimeout(() => {
        playerControlsVisibleRef.current = false;
        setPlayerControlsVisible(false);
        playerControlsHideTimerRef.current = null;
      }, 3000);
    }
  };

  const handlePlayerSurfacePointerUp = (event: React.PointerEvent<HTMLVideoElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button,input,select')) return;

    if (event.pointerType === 'touch') {
      const now = Date.now();
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const previous = lastTouchTapRef.current;

      if (previous && now - previous.time < 360 && Math.abs(previous.x - x) < 90) {
        event.preventDefault();
        event.stopPropagation();
        if (touchSingleTapTimerRef.current !== null) {
          window.clearTimeout(touchSingleTapTimerRef.current);
          touchSingleTapTimerRef.current = null;
        }
        seekPlayerBy(x < rect.width / 2 ? -10 : 10);
        lastTouchTapRef.current = null;
        revealPlayerControls();
        return;
      }

      lastTouchTapRef.current = { time: now, x };

      // A first tap while controls are hidden only reveals them; it must not
      // pause/play the video. When controls are already visible, defer the
      // single-tap action briefly so a second tap can still become a seek.
      if (!playerControlsVisibleRef.current) {
        revealPlayerControls();
        return;
      }

      if (touchSingleTapTimerRef.current !== null) {
        window.clearTimeout(touchSingleTapTimerRef.current);
      }
      touchSingleTapTimerRef.current = window.setTimeout(() => {
        touchSingleTapTimerRef.current = null;
        togglePlayerPlayback();
      }, 360);
      return;
    }

    // Mouse/pen: one click reveals hidden controls; the next click toggles
    // playback. This keeps the first interaction from unexpectedly pausing.
    if (!playerControlsVisibleRef.current) {
      revealPlayerControls();
      return;
    }
    togglePlayerPlayback();
  };


  const setPlayerProgress = (value: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(Math.max(0, value), video.duration);
    setPlayerCurrentTime(video.currentTime);
  };

  const setPlayerVolumeLevel = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Math.min(Math.max(0, value), 1);
    video.volume = next;
    video.muted = next === 0;
    setPlayerVolume(next);
    setPlayerMuted(video.muted);
  };

  const togglePlayerMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) {
      video.volume = 0.8;
      setPlayerVolume(0.8);
    }
    setPlayerMuted(video.muted);
  };

  const lockLandscape = async () => {
    try {
      const orientation = (screen as Screen & {
        orientation?: ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
      }).orientation;
      if (orientation?.lock) {
        await orientation.lock('landscape');
      }
    } catch {
      // Some browsers reject orientation locks unless fullscreen is active.
    }
  };

  const unlockScreenOrientation = async () => {
    try {
      const orientation = (screen as Screen & { orientation?: ScreenOrientation & { unlock?: () => void } }).orientation;
      orientation?.unlock?.();
    } catch {}
  };

  const togglePlayerFullscreen = async () => {
    const shell = playerShellRef.current;
    if (!shell) return;

    try {
      if (!document.fullscreenElement) {
        await shell.requestFullscreen();
        setPlayerFullscreen(true);
        await lockLandscape();
      } else {
        await document.exitFullscreen();
        setPlayerFullscreen(false);
        await unlockScreenOrientation();
      }
    } catch {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else if (
          videoRef.current &&
          typeof (videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen === 'function'
        ) {
          (videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
        }
      } catch {}
    }
  };

  const togglePlayerPictureInPicture = async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled || typeof video.requestPictureInPicture !== 'function') return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {}
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const onFullscreenChange = () => {
      const active =
        Boolean(document.fullscreenElement) &&
        Boolean(playerShellRef.current) &&
        document.fullscreenElement === playerShellRef.current;
      setPlayerFullscreen(active);
      if (active) void lockLandscape();
      else void unlockScreenOrientation();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;

      const video = videoRef.current;
      if (!video) return;

      if (event.key === ' ' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePlayerPlayback();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seekPlayerBy(-5);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        seekPlayerBy(5);
      } else if (event.key.toLowerCase() === 'j') {
        event.preventDefault();
        seekPlayerBy(-10);
      } else if (event.key.toLowerCase() === 'l') {
        event.preventDefault();
        seekPlayerBy(10);
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        togglePlayerMute();
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        void togglePlayerFullscreen();
      } else if (event.key === 'Escape') {
        setPlayerSettingsOpen(false);
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('keydown', onKeyDown);
      void unlockScreenOrientation();
    };
  }, [direction]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const shell = playerShellRef.current;
    if (!shell) return;

    const showControlsTemporarily = () => {
      playerControlsVisibleRef.current = true;
      setPlayerControlsVisible(true);
      if (playerControlsHideTimerRef.current !== null) {
        window.clearTimeout(playerControlsHideTimerRef.current);
      }
      if (playerPlaying) {
        playerControlsHideTimerRef.current = window.setTimeout(() => {
          playerControlsVisibleRef.current = false;
          setPlayerControlsVisible(false);
          playerControlsHideTimerRef.current = null;
        }, 3000);
      }
    };

    shell.addEventListener('pointermove', showControlsTemporarily);
    showControlsTemporarily();

    return () => {
      shell.removeEventListener('pointermove', showControlsTemporarily);
      if (playerControlsHideTimerRef.current !== null) {
        window.clearTimeout(playerControlsHideTimerRef.current);
        playerControlsHideTimerRef.current = null;
      }
      if (touchSingleTapTimerRef.current !== null) {
        window.clearTimeout(touchSingleTapTimerRef.current);
        touchSingleTapTimerRef.current = null;
      }
    };
  }, [playerPlaying, playbackUrl]);

  const playbackMimeType = /\.mp4(?:$|[?#])/i.test(playbackUrl)
    ? 'video/mp4'
    : /\.m3u8(?:$|[?#])/i.test(playbackUrl)
      ? 'application/vnd.apple.mpegurl'
      : /\.mpd(?:$|[?#])/i.test(playbackUrl)
        ? 'application/dash+xml'
        : playbackSource?.type === 'mp4'
          ? 'video/mp4'
          : playbackSource?.type === 'hls'
            ? 'application/vnd.apple.mpegurl'
            : playbackSource?.type === 'dash'
              ? 'application/dash+xml'
              : undefined;
  const availableSources = useMemo(
    () => collapseProviderQualityDuplicates(
      remotePlaybackSources
        .map(normalizePlaybackSource)
        .filter((source): source is PlaybackSource => Boolean(source))
        .filter((source) => source.isWorking !== false)
        .filter(isPlayableHttpSource)
        .filter(
          (source, index, all) =>
            index === all.findIndex((candidate) => candidate.url === source.url),
        ),
    ),
    [remotePlaybackSources],
  );

  const availableSourceGroups = useMemo(
    () => groupPlaybackSources(availableSources, language),
    [availableSources, language],
  );


  useEffect(() => {
    if (typeof document === 'undefined') return;

    const head = document.head;
    const origins = Array.from(new Set(
      availableSources.map((source) => {
        try {
          return new URL(source.url).origin;
        } catch {
          return '';
        }
      }).filter(Boolean),
    ));

    head.querySelectorAll('link[data-movyz-media-preconnect]').forEach((node) => node.remove());
    head.querySelectorAll('link[data-movyz-media-dns]').forEach((node) => node.remove());

    const created: HTMLElement[] = [];
    for (const origin of origins) {
      const preconnect = document.createElement('link');
      preconnect.rel = 'preconnect';
      preconnect.href = origin;
      preconnect.crossOrigin = 'anonymous';
      preconnect.dataset.movyzMediaPreconnect = 'true';
      head.appendChild(preconnect);
      created.push(preconnect);
    }

    return () => {
      for (const node of created) node.remove();
    };
  }, [availableSources]);

  // Do not prefetch alternate playback streams in the background. Each Akwam relay URL
  // represents a real upstream media request; speculative hidden videos compete with the
  // selected player during startup and can stall playback on mobile networks.

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnter = () => setPlayerPictureInPicture(true);
    const onLeave = () => setPlayerPictureInPicture(false);
    video.addEventListener('enterpictureinpicture', onEnter);
    video.addEventListener('leavepictureinpicture', onLeave);

    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter);
      video.removeEventListener('leavepictureinpicture', onLeave);
    };
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const previousRobots = document.head.querySelector('meta[data-movyz-watch-robots]');

    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow, noimageindex';
    robots.dataset.movyzWatchRobots = 'true';
    document.head.appendChild(robots);

    const googlebot = document.createElement('meta');
    googlebot.name = 'googlebot';
    googlebot.content = 'noindex, nofollow, noimageindex';
    googlebot.dataset.movyzWatchRobots = 'true';
    document.head.appendChild(googlebot);

    return () => {
      robots.remove();
      googlebot.remove();
      previousRobots?.removeAttribute('data-movyz-watch-robots');
    };
  }, []);

  const handleUnlockPlayer = () => {
    setPlayerUnlocked(true);
  };

  const markPlaybackSourceFailed = () => {
    const failedUrl = playbackSource?.url || playbackUrl;
    if (!failedUrl) return;

    failedPlaybackUrlsRef.current.add(failedUrl);
    const nextSource = remotePlaybackSources.find((source) =>
      source.url !== failedUrl &&
      !failedPlaybackUrlsRef.current.has(source.url),
    );

    if (nextSource) {
      qualityResumeTimeRef.current =
        videoRef.current && Number.isFinite(videoRef.current.currentTime)
          ? Math.max(0, videoRef.current.currentTime)
          : 0;
      resumeAfterQualitySwitchRef.current = false;
      qualitySwitchPendingRef.current = false;
      playbackStartedRef.current = false;
      setPlaybackError(null);
      setPlayerUnlocked(true);
      setRemotePlaybackSource(nextSource);
      return;
    }

    setPlaybackError(
      language === 'ar'
        ? 'تعذر تشغيل المصادر المتاحة حاليًا. جرّب إعادة المحاولة.'
        : 'The available playback sources could not be started. Please retry.',
    );
  };

  const handleSelectPlaybackSource = (source: PlaybackSource) => {
    if (source.url === playbackUrl) return;

    const video = videoRef.current;
    qualityResumeTimeRef.current =
      video && Number.isFinite(video.currentTime) && video.currentTime > 0.5
        ? video.currentTime
        : 0;
    resumeAfterQualitySwitchRef.current = !!video && !video.paused;
    qualitySwitchPendingRef.current = true;
    startupTriedUrlsRef.current.add(source.url);
    failedPlaybackUrlsRef.current.delete(source.url);
    playbackStartedRef.current = false;
    setPlaybackError(null);
    setPlayerUnlocked(true);
    setRemotePlaybackSource(source);
  };

  const handleSelectEpisode = (nextSeason: number, nextEpisode: number) => {
    onNavigate(`/watch/tv/${contentId}/${nextSeason}/${nextEpisode}`);
  };

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: content?.title || content?.titleEn || 'Movyz',
          url: window.location.href,
        });
        return;
      }

      await navigator.clipboard?.writeText(window.location.href);
      setToastMessage(language === 'ar' ? 'تم نسخ الرابط' : 'Link copied');
      window.setTimeout(() => setToastMessage(null), 2200);
    } catch {
      // User cancelled share; do nothing.
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackUrl) return;

    let cancelled = false;
    startupTriedUrlsRef.current.add(playbackUrl);
    setPlayerLoadingState(true, language === 'ar' ? 'جارٍ فتح مصدر الفيديو…' : 'Opening playback source…');
    armPlayerLoadTimeout();

    const resetMediaElement = () => {
      video.pause();
      video.removeAttribute('src');
      try { video.srcObject = null; } catch {}
      videoReadyReset();
    };

    const attachNative = () => {
      playbackEngineRef.current?.destroy?.();
      playbackEngineRef.current = null;
      resetMediaElement();
      video.preload = 'metadata';
       setPlayerLoadingState(true, language === 'ar' ? 'جارٍ تحميل الفيديو…' : 'Loading video…');
      armPlayerLoadTimeout();
      video.src = playbackUrl;
      video.load();
    };

    const videoReadyReset = () => {
      setPlayerReady(false);
      setPlayerCurrentTime(0);
      setPlayerDuration(0);
      setPlayerBufferedEnd(0);
    };

    const attachPlayback = async () => {
      const engine = playbackEngineFor(playbackSource);

      if (engine === 'embed') {
        setPlayerReady(true);
        setPlayerPlaying(false);
        return;
      }

      if (engine === 'hls') {
        if (Hls.isSupported()) {
          resetMediaElement();
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 90,
            maxBufferLength: 45,
            maxMaxBufferLength: 90,
            startLevel: -1,
          });
          playbackEngineRef.current = hls;
          hls.on(Hls.Events.FRAG_LOADING, () => {
            if (!cancelled) {
              setPlayerLoadingState(true, language === 'ar' ? 'جارٍ تحميل جزء من الفيديو…' : 'Loading video segment…');
              armPlayerLoadTimeout();
            }
          });
          hls.on(Hls.Events.FRAG_BUFFERED, () => {
            if (!cancelled) {
              clearPlayerLoadTimeout();
              setPlayerLoadingState(false);
              if (resumeAfterBufferingRef.current && video.paused && !video.ended) {
                resumeAfterBufferingRef.current = false;
                void video.play().catch(() => undefined);
              }
            }
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || cancelled) return;
            setPlaybackError(
              language === 'ar'
                ? 'تعذر تهيئة بث HLS من المصدر الحالي.'
                : 'The current HLS source could not be initialized.',
            );
            clearPlayerLoadTimeout();
            setPlayerLoadingState(false);
            hls.destroy();
            playbackEngineRef.current = null;
            markPlaybackSourceFailed();
          });
          hls.attachMedia(video);
          hls.loadSource(playbackUrl);
          return;
        }

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          attachNative();
          return;
        }

        setPlaybackError(
          language === 'ar'
            ? 'هذا المتصفح لا يدعم HLS على هذا الجهاز.'
            : 'This browser does not support HLS on this device.',
        );
        return;
      }

      if (engine === 'dash') {
        try {
          resetMediaElement();
          const module = await import('dashjs');
          if (cancelled) return;
          const dash = (module as any).default ?? module;
          const player = dash.MediaPlayer().create();
          playbackEngineRef.current = player;
          player.initialize(video, playbackUrl, false);
          setPlayerReady(false);
        } catch {
          attachNative();
        }
        return;
      }

      attachNative();
    };

    void attachPlayback();

    // Do not automatically switch sources. A failed source stays selected
    // so the user can retry or choose another quality/provider manually.

    return () => {
      cancelled = true;
      if (startupGuardTimerRef.current !== null) {
        window.clearTimeout(startupGuardTimerRef.current);
        startupGuardTimerRef.current = null;
      }
      playbackEngineRef.current?.destroy?.();
      playbackEngineRef.current = null;
      video.pause();
      if (startupRecoveryTimerRef.current !== null) {
        window.clearTimeout(startupRecoveryTimerRef.current);
        startupRecoveryTimerRef.current = null;
      }
      if (startupWarmupTimerRef.current !== null) {
        window.clearTimeout(startupWarmupTimerRef.current);
        startupWarmupTimerRef.current = null;
      }
      startupRecoveryStageRef.current = 'idle';
    };
  }, [playbackUrl, playbackSource?.type, language, playerReloadKey]);

  useEffect(() => {
    if (isEmbedPlayback) {
      setPlayerReady(true);
      setPlayerPlaying(false);
      setPlayerCurrentTime(0);
      setPlayerDuration(0);
      setPlayerBufferedEnd(0);
      return;
    }

    const video = videoRef.current;
    if (!video || !playbackUrl) return;

    const sync = () => {
      const duration = video.duration;
      const currentTime = video.currentTime;
      if (Number.isFinite(duration) && duration > 0) setPlayerDuration(duration);
      if (Number.isFinite(currentTime) && currentTime >= 0) setPlayerCurrentTime(currentTime);
      if (video.buffered.length) {
        try {
          setPlayerBufferedEnd(video.buffered.end(video.buffered.length - 1));
        } catch {}
      }
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) setPlayerReady(true);
    };

    sync();
    const interval = window.setInterval(sync, 250);
    const stop = window.setTimeout(() => window.clearInterval(interval), 12000);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(stop);
    };
  }, [playbackUrl, playbackSource?.type, isEmbedPlayback]);

  // Mirror the native media element state directly. React's media events are
  // supplemented with native listeners so duration/currentTime/buffering cannot
  // remain at their initial 00:00 state when an engine swaps the media source.
  useEffect(() => {
    if (isEmbedPlayback) return;

    const video = videoRef.current;
    if (!video || !playbackUrl) return;

    const syncDuration = () => {
      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 0) setPlayerDuration(duration);
    };
    const syncTime = () => {
      const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      setPlayerCurrentTime(Math.max(0, current));
      syncDuration();
    };
    const syncBuffered = () => {
      if (!video.buffered.length) return;
      try {
        setPlayerBufferedEnd(video.buffered.end(video.buffered.length - 1));
      } catch {}
    };
    const onMetadata = () => {
      clearPlayerLoadTimeout();
      if (startupGuardTimerRef.current !== null) {
        window.clearTimeout(startupGuardTimerRef.current);
        startupGuardTimerRef.current = null;
      }
      setPlayerReady(true);
      syncDuration();
      syncTime();
      syncBuffered();
      const restore = reloadRestoreRef.current;
      if (restore && Number.isFinite(video.duration) && video.duration > 0) {
        try {
          video.currentTime = Math.min(restore.time, Math.max(0, video.duration - 0.25));
        } catch {
          // Some providers reject a seek until enough data is available.
        }
      }
    };
    const onPlaying = () => {
      clearPlayerLoadTimeout();
      clearPlaybackStallTimer();
      setPlayerLoadingState(false);
      setPlayerPlaying(true);
      setPlayerReady(true);
      setPlaybackError(null);
      syncTime();
      syncBuffered();
      reloadRestoreRef.current = null;
    };
    const onPause = () => { clearPlaybackStallTimer(); setPlayerPlaying(false); };
    const onLoadStart = () => {
      setPlayerLoadingState(true, language === 'ar' ? 'جارٍ تحميل الفيديو…' : 'Loading video…');
      armPlayerLoadTimeout();
    };
    const onSeeking = () => {
      setPlayerLoadingState(true, language === 'ar' ? 'جارٍ الانتقال إلى الموضع…' : 'Seeking…');
      armPlayerLoadTimeout();
      syncTime();
    };
    const onSeeked = () => {
      clearPlayerLoadTimeout();
      setPlayerLoadingState(false);
      syncTime();
    };
    const onWaiting = () => {
      const wasPlaying = !video.paused && !video.ended;
      if (wasPlaying || userPlayRequestedRef.current) {
        resumeAfterBufferingRef.current = true;
      }
      if (!playbackStartedRef.current) setPlaybackError(null);
      setPlayerLoadingState(true, language === 'ar' ? 'جارٍ تحميل البيانات…' : 'Buffering…');
      // Normal short buffering is fine; prolonged stalls rotate the relay
      // candidate instead of leaving the spinner running indefinitely.
      armPlayerLoadTimeout();
      if (playbackStallTimerRef.current !== null) window.clearTimeout(playbackStallTimerRef.current);
      playbackStallTimerRef.current = null;
      syncTime();
      syncBuffered();
    };
    const onVolume = () => {
      setPlayerVolume(video.volume);
      setPlayerMuted(video.muted);
    };
    const events: Array<[string, EventListener]> = [
      ['loadstart', onLoadStart],
      ['loadedmetadata', onMetadata],
      ['durationchange', syncDuration],
      ['loadeddata', () => { setPlayerReady(true); syncTime(); syncBuffered(); }],
      ['canplay', () => {
        clearPlayerLoadTimeout();
        clearPlaybackStallTimer();
        setPlayerLoadingState(false);
        setPlayerReady(true);
        syncDuration();
        syncBuffered();
        const restore = reloadRestoreRef.current;
        if (restore) {
          const shouldPlay = restore.wasPlaying;
          reloadRestoreRef.current = null;
          if (shouldPlay) void video.play().catch(() => undefined);
        }
        if (resumeAfterBufferingRef.current && video.paused && !video.ended) {
          resumeAfterBufferingRef.current = false;
          void video.play().catch(() => undefined);
        }
      }],
      ['canplaythrough', () => {
        clearPlayerLoadTimeout();
        clearPlaybackStallTimer();
        setPlayerLoadingState(false);
        setPlayerReady(true);
        syncDuration();
        syncBuffered();
      }],
      ['timeupdate', syncTime],
      ['progress', syncBuffered],
      ['playing', onPlaying],
      ['pause', onPause],
      ['waiting', onWaiting],
      ['stalled', onWaiting],
      ['seeking', onSeeking],
      ['seeked', onSeeked],
      ['error', () => {
        clearPlayerLoadTimeout();
        setPlayerLoadingState(false);
      }],
      ['volumechange', onVolume],
      ['ended', () => setPlayerPlaying(false)],
    ];

    for (const [name, handler] of events) video.addEventListener(name, handler);
    return () => {
      for (const [name, handler] of events) video.removeEventListener(name, handler);
    };
  }, [playbackUrl, playbackSource?.type, isEmbedPlayback]);


  if (loading) {
    return (
      <div className="min-h-screen bg-[#030406] px-4 py-8">
        <div className="max-w-7xl mx-auto space-y-4">
          <HeroSkeleton />
        </div>
      </div>
    );
  }

  if (error || !content) {
    return (
      <div className="min-h-screen bg-[#030406] flex items-center justify-center p-4">
        <ErrorState
          message={error || undefined}
          onRetry={() => window.location.reload()}
          onGoHome={() => onNavigate('/')}
        />
      </div>
    );
  }

  // Keep the watch page mounted while the live broker resolves a source.
  // A resolver delay is a loading state, not a playback failure.
  if (!playbackUrl && !resolverLoading && playbackError) {
    return (
      <div className="min-h-screen bg-[#030406] text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl rounded-3xl overflow-hidden border border-amber-500/20 bg-black shadow-2xl">
          <div className="relative aspect-video bg-[#07090e]">
            {content.backdropUrl || content.posterUrl ? (
              <img
                src={content.backdropUrl || content.posterUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-45"
                loading="eager"
                decoding="async"
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/20" />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
              <ErrorState
                message={playbackError}
                onRetry={() => window.location.reload()}
                onGoHome={() => onNavigate('/')}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }


  const isMovie = content.type === 'movie';
  const resolvedTmdbId = content.tmdbId;
  const displayTitle = language === 'ar' ? content.title : content.titleEn;
  const originalTitle = language === 'ar' ? content.titleEn : content.originalTitle;
  const overview = isMovie
    ? language === 'ar'
      ? (content as Movie).overview
      : (content as Movie).overviewEn
    : currentEpisode
      ? language === 'ar'
        ? currentEpisode.overview
        : currentEpisode.overviewEn
      : language === 'ar'
        ? (content as Series).overview
        : (content as Series).overviewEn;

  return (
    <div
      className={
        'movyza-watch-page min-h-screen pb-20 transition-colors duration-500 ' +
        (theaterLighting ? 'bg-[#030406]' : 'bg-[#0a0c12]')
      }
    >
      {content.backdropUrl ? (
        <div
          aria-hidden="true"
          className="movyza-watch-backdrop"
          style={{ backgroundImage: `url("${content.backdropUrl}")` }}
        />
      ) : null}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-400 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl text-xs flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="movyza-watch-topbar w-full px-4 sm:px-6 py-3 flex items-center justify-between gap-4 text-xs text-slate-400">
        <button
          onClick={() => onNavigate(isMovie ? `/movies/${content.id}` : `/series/${content.id}`)}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.035] border border-white/[0.06] text-slate-200 hover:text-amber-300 hover:border-amber-400/20 transition-all"
        >
          {direction === 'rtl' ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
          <span>{language === 'ar' ? 'العودة للعمل' : 'Back to title'}</span>
        </button>

        <div className="flex items-center gap-2.5 text-[11px]">
          <button
            onClick={() => setTheaterLighting((value) => !value)}
            className={
              'hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full border transition-all ' +
              (theaterLighting
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                : 'bg-white/5 border-white/10 text-slate-400')
            }
          >
            <Sparkles className="w-3 h-3" />
            <span>{language === 'ar' ? 'إضاءة سينمائية' : 'Cinema lighting'}</span>
          </button>

          <div className="flex items-center gap-2 text-slate-500">
            <span className="text-amber-400/90 font-bold">{playbackSource?.provider || 'MOVYZ SOURCE'}</span>
            <span>·</span>
            <span>{
              isEmbedPlayback
                ? (language === 'ar' ? 'مصدر محفوظ' : 'Persisted source')
                : (language === 'ar' ? 'مصدر محفوظ' : 'Persisted source')
            }</span>
          </div>
        </div>
      </div>

      <div className="relative w-full max-w-7xl mx-auto sm:px-4 pt-3">
        {theaterLighting && (
          <div className="absolute -inset-1 bg-gradient-to-r from-amber-600/15 via-orange-500/10 to-amber-700/15 blur-2xl -z-10 rounded-3xl opacity-75" />
        )}

        {availableSourceGroups.length > 0 && (
          <div dir={direction} className="movyza-source-panel rounded-2xl p-3 sm:p-4 mb-3 space-y-3">
            <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
              <span>{language === 'ar' ? 'مصادر التشغيل:' : 'Playback sources:'}</span>
              <span className="text-amber-400/70">{availableSourceGroups.length}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {availableSourceGroups.map((group) => (
                <div
                  key={group.key}
                  className="movyza-source-group rounded-2xl p-3"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] font-bold text-white">{group.label}</span>
                    <span className="text-[9px] text-slate-500 font-mono">
                      {group.sources.length} {language === 'ar' ? 'جودة' : 'qualities'}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {group.sources.map((source) => {
                      const active = source.url === playbackSource?.url;
                      return (
                        <button
                          key={source.id || source.url}
                          type="button"
                          onClick={() => handleSelectPlaybackSource(source)}
                          className={
                            'movyza-source-chip px-3 py-2 rounded-xl border text-[11px] font-semibold transition-all ' +
                            (active
                              ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm shadow-amber-500/20'
                              : 'bg-[#11151d] text-slate-300 border-white/5 hover:border-amber-500/30 hover:text-white')
                          }
                        >
                          <span>{source.quality || source.labelEn || 'Auto'}</span>
                          <span className="text-[9px] opacity-60 truncate max-w-[140px]">
                            · {playbackHostLabel(source.url)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {resolverLoading && (
          <div className="movyza-source-wait" role="status" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
            <span>
              {language === 'ar'
                ? 'انتظر قليلاً، الموقع يحاول جلب مصدر للفيديو لك…'
                : 'Please wait a moment while the site fetches a video source…'}
            </span>
          </div>
        )}

        <div className="movyza-player-shell overflow-hidden shadow-2xl shadow-black bg-black">
          <div className="aspect-video w-full bg-black">
            <div
                ref={playerShellRef}
                data-player-shell="true"
                tabIndex={-1}
                className="movyza-player-frame relative h-full w-full bg-black"
                              >

              {playbackError ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/75 p-6 text-center">
                  <ErrorState
                    message={playbackError}
                    onRetry={() => {
                      setPlaybackError(null);
                      startupTriedUrlsRef.current.delete(playbackUrl);
                      retriedPlaybackUrlsRef.current.delete(playbackUrl);
                      const video = videoRef.current;
                      if (!video) return;
                      playbackEngineRef.current?.destroy?.();
                      playbackEngineRef.current = null;
                      video.pause();
                      video.removeAttribute('src');
                      video.load();
                      video.src = playbackUrl;
                      video.preload = 'auto';
                      video.load();
                    }}
                    onGoHome={() => onNavigate('/')}
                  />
                </div>
              ) : null}
              {/* Playback starts visibly with the native player; no preparation overlay is rendered. */}

              {isEmbedPlayback ? (
                <iframe
                  key={`${playbackUrl}-${playerReloadKey}`}
                  src={playbackUrl}
                  title={displayTitle || 'Movyz player'}
                  className="absolute inset-0 h-full w-full border-0 bg-black"
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              ) : null}
              <video
                ref={videoRef}
                poster={content.backdropUrl || content.posterUrl}
                className={(isEmbedPlayback ? 'hidden ' : '') + 'block h-full w-full bg-black object-contain'}
                playsInline
                preload="metadata"
                disablePictureInPicture={false}
                onLoadStart={() => {
                  playbackStartedRef.current = false;
                  setPlayerLoadingState(true, language === 'ar' ? 'جارٍ تحميل الفيديو…' : 'Loading video…');
                  armPlayerLoadTimeout();
                  startupRecoveryStageRef.current = 'idle';
                  if (startupRecoveryTimerRef.current !== null) {
                    window.clearTimeout(startupRecoveryTimerRef.current);
                    startupRecoveryTimerRef.current = null;
                  }
                  setPlaybackError(null);
                  if (playbackUrl) startupTriedUrlsRef.current.add(playbackUrl);
                }}
                onPlay={() => {
                  userPlayRequestedRef.current = true;
                  setPlayerPlaying(true);
                }}
                onPause={() => {
                  setPlayerPlaying(false);
                }}
                onLoadedMetadata={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  if (startupGuardTimerRef.current !== null) {
                    window.clearTimeout(startupGuardTimerRef.current);
                    startupGuardTimerRef.current = null;
                  }
                  setPlayerReady(true);
                  if (Number.isFinite(video.duration) && video.duration > 0) setPlayerDuration(video.duration);

                  const reloadRestore = reloadRestoreRef.current;
                  if (reloadRestore && Number.isFinite(video.duration) && video.duration > 0) {
                    try {
                      video.currentTime = Math.min(reloadRestore.time, Math.max(0, video.duration - 0.25));
                    } catch {}
                  }

                  const resumeTime = qualityResumeTimeRef.current;
                  if (resumeTime !== null && Number.isFinite(video.duration) && video.duration > 0) {
                    qualityResumeTimeRef.current = null;
                    try {
                      video.currentTime = Math.min(resumeTime, Math.max(0, video.duration - 0.5));
                    } catch {
                      // Ignore sources that reject a resume seek.
                    }
                  }
                }}

                onDurationChange={() => {
                  const video = videoRef.current;
                  if (video && Number.isFinite(video.duration) && video.duration > 0) {
                    setPlayerDuration(video.duration);
                  }
                }}
                onProgress={() => {
                  const video = videoRef.current;
                  if (!video || video.buffered.length === 0) return;
                  try {
                    setPlayerBufferedEnd(video.buffered.end(video.buffered.length - 1));
                  } catch {}
                }}
                onTimeUpdate={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  setPlayerCurrentTime(
                    startupRecoveryStageRef.current === 'recovering' ? 0 : (video.currentTime || 0),
                  );
                  if (Number.isFinite(video.duration) && video.duration > 0) setPlayerDuration(video.duration);
                  if (video.buffered.length > 0) {
                    try {
                      setPlayerBufferedEnd(video.buffered.end(video.buffered.length - 1));
                    } catch {}
                  }
                }}
                onLoadedData={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  setPlayerReady(true);
                  if (Number.isFinite(video.duration) && video.duration > 0) setPlayerDuration(video.duration);
                  setPlayerCurrentTime(
                    startupRecoveryStageRef.current === 'recovering' ? 0 : (video.currentTime || 0),
                  );
                }}
                onVolumeChange={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  setPlayerVolume(video.volume);
                  setPlayerMuted(video.muted);
                }}
                onCanPlay={() => {
                  const video = videoRef.current;
                  if (!video) return;

                  clearPlayerLoadTimeout();
                  setPlayerLoadingState(false);

                  if (startupGuardTimerRef.current !== null) {
                    window.clearTimeout(startupGuardTimerRef.current);
                    startupGuardTimerRef.current = null;
                  }
                  setPlayerReady(true);
                  if (Number.isFinite(video.duration) && video.duration > 0) setPlayerDuration(video.duration);

                  if (qualitySwitchPendingRef.current) {
                    qualitySwitchPendingRef.current = false;
                    if (resumeAfterQualitySwitchRef.current) {
                      resumeAfterQualitySwitchRef.current = false;
                      void video.play().catch(() => undefined);
                    }
                  }

                }}
                onWaiting={() => {
                  const video = videoRef.current;
                  const wasPlaying = Boolean(video && !video.paused && !video.ended);
                  if (wasPlaying || userPlayRequestedRef.current) {
                    resumeAfterBufferingRef.current = true;
                  }
                  setPlayerLoadingState(true, language === 'ar' ? 'جارٍ تحميل البيانات…' : 'Buffering…');
                  // Metadata-aware armPlayerLoadTimeout() will no-op during normal buffering.
                  armPlayerLoadTimeout();
                  if (!playbackStartedRef.current) {
                    setPlaybackError(null);
                  }
                }}
                onStalled={() => {
                  const video = videoRef.current;
                  const wasPlaying = Boolean(video && !video.paused && !video.ended);
                  if (wasPlaying || userPlayRequestedRef.current) {
                    resumeAfterBufferingRef.current = true;
                  }
                  setPlayerLoadingState(true, language === 'ar' ? 'الاتصال بالمصدر بطيء…' : 'The source is responding slowly…');
                  armPlayerLoadTimeout();
                  if (!playbackStartedRef.current) {
                    setPlaybackError(null);
                  }
                }}
                onSeeking={() => {
                  setPlayerLoadingState(true, language === 'ar' ? 'جارٍ الانتقال…' : 'Seeking…');
                  armPlayerLoadTimeout();
                }}
                onSeeked={() => {
                  clearPlayerLoadTimeout();
                  setPlayerLoadingState(false);
                }}
                onPointerUp={handlePlayerSurfacePointerUp}
                onDoubleClick={(event) => {
                  const target = event.target as HTMLElement | null;
                  if (target?.closest('button,input,select')) return;
                  const rect = playerShellRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  seekPlayerBy(event.clientX - rect.left < rect.width / 2 ? -10 : 10);
                }}
                onPlaying={() => {
                  clearPlayerLoadTimeout();
                  setPlayerLoadingState(false);
                  playbackStartedRef.current = true;
                  setPlaybackError(null);
                }}
                onError={() => {
                  clearPlayerLoadTimeout();
                  setPlayerLoadingState(false);
                  playbackStartedRef.current = false;
                  if (!playbackUrl) return;

                  markPlaybackSourceFailed();
                  const mediaError = videoRef.current?.error;
                  const code = mediaError?.code;
                  const detail =
                    code === MediaError.MEDIA_ERR_ABORTED
                      ? (language === 'ar' ? 'تم إيقاف تحميل المصدر.' : 'The source load was aborted.')
                      : code === MediaError.MEDIA_ERR_NETWORK
                        ? (language === 'ar' ? 'انقطع تحميل المصدر.' : 'The source network request failed.')
                        : code === MediaError.MEDIA_ERR_DECODE
                          ? (language === 'ar' ? 'تعذر فك ترميز الفيديو.' : 'The browser could not decode this video.')
                          : (language === 'ar' ? 'تعذر تشغيل المصدر الحالي.' : 'The current playback source could not start.');
                  setPlaybackError(detail);
                  markPlaybackSourceFailed();
                }}
              >
                {playbackUrl ? null : null}
                {language === 'ar'
                  ? 'المتصفح لا يدعم تشغيل هذا المصدر.'
                  : 'Your browser does not support this playback source.'}
              </video>
 
              
              {!isEmbedPlayback && playerLoading ? (
                <div className="movyza-player-loading pointer-events-none absolute inset-0 z-25 flex items-center justify-center" aria-live="polite">
                  <div className="movyza-player-loading-card">
                    <div className="movyza-player-spinner" />
                    <span>{playerLoadingMessage}</span>
                  </div>
                </div>
              ) : null}

              {seekFeedback ? (
                <div className={"movyza-seek-feedback " + (seekFeedback.delta < 0 ? 'is-left' : 'is-right')} key={seekFeedback.id}>
                  <span>{seekFeedback.delta < 0 ? '−10' : '+10'}</span>
                </div>
              ) : null}

              <div
                className={(isEmbedPlayback ? 'hidden ' : '') + 'pointer-events-none absolute inset-0 z-10'}
              >
                <div className={'movyza-player-controls pointer-events-auto absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/85 to-transparent pt-16 pb-3 px-3 sm:px-4 ' + (playerControlsVisible ? 'is-visible' : 'is-hidden')}>
                  <div className="flex flex-col gap-2">
                    <div className="movyza-progress-track relative">
                      <div
                        className="movyza-progress-buffered"
                        style={{ width: playerDuration > 0 ? `${Math.min(100, Math.max(0, playerBufferedEnd / playerDuration * 100))}%` : '0%' }}
                      />
                      <div
                        className="movyza-progress-played"
                        style={{ width: playerDuration > 0 ? `${Math.min(100, Math.max(0, playerCurrentTime / playerDuration * 100))}%` : '0%' }}
                      />
                      <input
                        aria-label={language === 'ar' ? 'موضع الفيديو' : 'Video position'}
                        type="range"
                        min={0}
                        max={Math.max(playerDuration, 0)}
                        step="0.1"
                        value={Math.min(playerCurrentTime, Math.max(playerDuration, 0))}
                        onChange={(event) => setPlayerProgress(Number(event.target.value))}
                        dir="ltr"
                        className="movyza-player-seek relative z-10 w-full accent-amber-400 cursor-pointer"
                      />
                    </div>
                    <div className="movyza-player-control-row flex items-center gap-2 text-white flex-wrap">
                      <button
                        type="button"
                        onClick={togglePlayerPlayback}
                        className="movyza-player-btn h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                        aria-label={playerPlaying ? (language === 'ar' ? 'إيقاف' : 'Pause') : (language === 'ar' ? 'تشغيل' : 'Play')}
                      >
                        {playerPlaying ? <Pause size={17} /> : <Play size={17} className="translate-x-0.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => seekPlayerBy(-10)}
                        className="movyza-player-btn h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                        aria-label={language === 'ar' ? 'رجوع 10 ثواني' : 'Back 10 seconds'}
                      >
                        <RotateCcw size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() => seekPlayerBy(10)}
                        className="movyza-player-btn h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                        aria-label={language === 'ar' ? 'تقديم 10 ثواني' : 'Forward 10 seconds'}
                      >
                        <RotateCw size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={togglePlayerMute}
                        className="movyza-player-btn h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                        aria-label={playerMuted ? (language === 'ar' ? 'إلغاء الكتم' : 'Unmute') : (language === 'ar' ? 'كتم الصوت' : 'Mute')}
                      >
                        {playerMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                      </button>
                      <input
                        aria-label={language === 'ar' ? 'مستوى الصوت' : 'Volume'}
                        type="range"
                        min={0}
                        max={1}
                        step="0.01"
                        value={playerMuted ? 0 : playerVolume}
                        onChange={(event) => setPlayerVolumeLevel(Number(event.target.value))}
                        className="movyza-volume-slider hidden sm:block w-20 accent-amber-400 cursor-pointer"
                      />
                      <span className="movyza-player-time min-w-20 text-[11px] font-mono text-white/75 tabular-nums">
                        {formatPlayerTime(playerCurrentTime)} / {formatPlayerTime(playerDuration)}
                      </span>
                      <div className="flex-1" />
                      <label className="movyza-player-speed flex items-center gap-1.5 text-[11px] text-white/80">
                        <span className="hidden sm:inline">{language === 'ar' ? 'السرعة' : 'Speed'}</span>
                        <select
                          aria-label={language === 'ar' ? 'سرعة التشغيل' : 'Playback speed'}
                          value={playerSpeed}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            const video = videoRef.current;
                            if (video) video.playbackRate = next;
                            setPlayerSpeed(next);
                          }}
                          className="movyza-player-select bg-white/10 border border-white/10 rounded-md px-1.5 py-1 outline-none"
                        >
                          {[0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                            <option key={speed} value={speed} className="bg-slate-950">{speed}x</option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={reloadPlayer}
                        className="movyza-player-btn h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                        aria-label={language === 'ar' ? 'إعادة تحميل الفيديو' : 'Reload video'}
                        title={language === 'ar' ? 'إعادة تحميل الفيديو' : 'Reload video'}
                      >
                        <RefreshCw size={17} className={playerLoading ? 'animate-spin' : ''} />
                      </button>

                      {document.pictureInPictureEnabled && typeof videoRef.current?.requestPictureInPicture === 'function' ? (
                        <button
                          type="button"
                          onClick={() => void togglePlayerPictureInPicture()}
                          className="movyza-player-btn h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition text-[10px] font-bold"
                          aria-label={playerPictureInPicture ? (language === 'ar' ? 'الخروج من صورة داخل صورة' : 'Exit picture in picture') : (language === 'ar' ? 'صورة داخل صورة' : 'Picture in picture')}
                        >
                          PiP
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void togglePlayerFullscreen()}
                        className="movyza-player-btn h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                        aria-label={playerFullscreen ? (language === 'ar' ? 'الخروج من ملء الشاشة' : 'Exit fullscreen') : (language === 'ar' ? 'ملء الشاشة' : 'Fullscreen')}
                      >
                        {playerFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>           </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-7 sm:pt-9 space-y-7">
        <div className="movyza-watch-meta movyza-watch-meta-modern flex flex-col md:flex-row md:items-start justify-between gap-5 p-5 sm:p-7">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-xs font-bold">
                {isMovie
                  ? language === 'ar' ? 'عرض سينمائي' : 'FEATURE FILM'
                  : language === 'ar' ? 'بث مسلسل' : 'EPISODE STREAM'}
              </span>
               
            </div>

            <h1 className="movyza-watch-title text-2xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight">
              {displayTitle}
            </h1>

            {currentEpisode && (
              <p className="text-sm font-semibold text-amber-400">
                {t('season')} {activeSeason} · {t('episode')} {activeEpisode}: {language === 'ar'
                  ? currentEpisode.title
                  : currentEpisode.titleEn}
              </p>
            )}

            <div className="flex items-center gap-3 flex-wrap text-xs text-slate-400 font-mono">
              <span className="text-slate-300">{originalTitle}</span>
              <span aria-hidden="true" className="text-amber-500/40">·</span>
              <span className="tabular-nums">
                {isMovie ? (content as Movie).year : (content as Series).startYear}
              </span>
              <span aria-hidden="true" className="text-amber-500/40">·</span>
              <span className="inline-flex items-center gap-1 font-bold text-amber-400">
                <Star className="w-3 h-3 fill-current" />
                {content.rating.toFixed(1)}
              </span>
            </div>
          </div>

          <button
            onClick={handleShare}
            className="self-start px-4 py-2.5 rounded-xl bg-white/[0.035] hover:bg-white/[0.07] text-slate-200 hover:text-white border border-white/[0.07] text-xs font-semibold flex items-center gap-2 transition-all"
          >
            <Share2 className="w-4 h-4 text-amber-400" />
            <span>{t('share')}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-7">
          <div className="lg:col-span-2 space-y-4">
            <div className="movyza-story-heading flex items-center gap-2 text-amber-300 text-sm font-bold">
              <Info className="w-4 h-4 text-amber-400" />
              <span>{t('storyOverview')}</span>
            </div>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl whitespace-pre-line">
              {overview || (language === 'ar' ? 'لا توجد نبذة متاحة حاليًا.' : 'No synopsis is available right now.')}
            </p>

            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex items-start gap-3 text-xs text-slate-400">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold text-slate-200">
                  {language === 'ar' ? 'مصدر التشغيل' : 'Playback source'}
                </span>
                <p className="text-[11px] leading-relaxed">
                  {playbackSource
                    ? (language === 'ar'
                      ? `المصدر الحالي: ${playbackSource.provider || playbackSource.providerKey || 'MOVYZ'} — ${playbackSource.quality || playbackSource.label}.`
                      : `Current source: ${playbackSource.provider || playbackSource.providerKey || 'MOVYZ'} — ${playbackSource.quality || playbackSource.labelEn}.`)
                    : (language === 'ar'
                      ? 'لا يوجد مصدر تشغيل متاح لهذا العمل حاليًا.'
                      : 'No playback source is currently available for this title.')}
                </p>
              </div>
            </div>
          </div>

          {!isMovie && (content as Series).seasons?.length > 0 && (
            <div className="movyza-source-panel p-4 sm:p-5 rounded-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-amber-500/15 pb-3">
                <div className="flex items-center gap-2 font-bold text-white text-xs">
                  <Film className="w-4 h-4 text-amber-400" />
                  <span>{t('seasonsAndEpisodes')}</span>
                </div>
                <span className="text-[10px] text-amber-400 font-mono">
                  {language === 'ar' ? `الموسم ${activeSeason}` : `Season ${activeSeason}`}
                </span>
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {((content as Series).seasons.find((s) => s.seasonNumber === activeSeason) ||
                  (content as Series).seasons[0]).episodes.map((ep) => {
                    const isCurrent = ep.episodeNumber === activeEpisode;
                    return (
                      <button
                        key={ep.id}
                        onClick={() => handleSelectEpisode(activeSeason, ep.episodeNumber)}
                        className={
                          'movyza-episode-item w-full text-start p-3.5 rounded-xl text-xs flex items-center justify-between transition-all ' +
                          (isCurrent
                            ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/25'
                            : 'bg-[#10131d] text-slate-300 hover:text-white hover:bg-[#161a27] border border-amber-500/10')
                        }
                      >
                        <span className="truncate pr-2">
                          <span className="font-mono opacity-60 ml-1">#{ep.episodeNumber}</span>{' '}
                          {language === 'ar' ? ep.title : ep.titleEn}
                        </span>
                        <span className="text-[10px] opacity-75 shrink-0 font-mono">
                          {ep.duration ? `${ep.duration} ${t('minutes')}` : ''}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

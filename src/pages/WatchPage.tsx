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

const isPlayableHttpSource = (source: PlaybackSource) =>
  /^https?:\/\//i.test(source.url?.trim() || '');

function playbackEngineFor(source: PlaybackSource | null | undefined) {
  const type = String(source?.type || '').toLowerCase();
  const url = String(source?.url || '').toLowerCase();
  if (type === 'hls' || /\.m3u8(?:[?#]|$)/i.test(url)) return 'hls' as const;
  if (type === 'dash' || /\.mpd(?:[?#]|$)/i.test(url)) return 'dash' as const;
  return 'native' as const;
}

const pickPlaybackSources = (content: Movie | Series, episode?: Episode) => {
  const candidates = episode?.sources ?? (content.type === 'movie' ? content.sources : []);
  return candidates
    .filter(isPlayableHttpSource)
    .sort((a, b) => playbackQualityRank(a) - playbackQualityRank(b));
};

const playbackQualityRank = (source: PlaybackSource) => {
  const match = source.quality?.match(/(\d{3,4})p/i);
  const quality = match ? Number(match[1]) : 0;
  // Lower rank = preferred. Unknown quality stays behind known resolutions.
  return quality > 0 ? 10000 - quality : 20000;
};

const sortPlaybackSources = (sources: PlaybackSource[]) =>
  [...sources].sort((a, b) => playbackQualityRank(a) - playbackQualityRank(b));

const providerDisplayName = (key: string, fallback: string, language: 'ar' | 'en') => {
  const normalized = key.trim().toLowerCase();
  const names: Record<string, [string, string]> = {
    aflaam: ['أفلام', 'Aflam'],
    anime3rb: ['أنمي عرب', 'Anime3rb'],
    anime4up: ['أنمي فور أب', 'Anime4Up'],
  };
  return names[normalized]?.[language === 'ar' ? 0 : 1] || fallback;
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

const PLAYBACK_HOST_HEALTH_KEY = 'movyz:playback-host-health:v1';

function playbackHost(source: PlaybackSource | null | undefined) {
  if (!source?.url) return '';
  try { return new URL(source.url).hostname.toLowerCase(); } catch { return ''; }
}

function playbackHostScores() {
  try {
    const raw = window.localStorage.getItem(PLAYBACK_HOST_HEALTH_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as Record<string, { success: number; failure: number }> : {};
  } catch {
    return {};
  }
}

function playbackHostScore(source: PlaybackSource | null | undefined) {
  const host = playbackHost(source);
  if (!host) return 0;
  const entry = playbackHostScores()[host];
  if (!entry) return 0;
  return (Number(entry.success) || 0) * 3 - (Number(entry.failure) || 0) * 2;
}

function rememberPlaybackHost(source: PlaybackSource | null | undefined, success: boolean) {
  const host = playbackHost(source);
  if (!host) return;
  try {
    const scores = playbackHostScores();
    const current = scores[host] || { success: 0, failure: 0 };
    scores[host] = {
      success: Math.min(20, Math.max(0, current.success + (success ? 1 : 0))),
      failure: Math.min(20, Math.max(0, current.failure + (success ? 0 : 1))),
    };
    window.localStorage.setItem(PLAYBACK_HOST_HEALTH_KEY, JSON.stringify(scores));
  } catch {
    // Ignore storage restrictions.
  }
}

function startupSourceRank(source: PlaybackSource) {
  return playbackHostScore(source) * 100 + (10 - playbackQualityRank(source));
}

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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const qualityResumeTimeRef = useRef<number | null>(null);
  const resumeAfterQualitySwitchRef = useRef(false);
  const qualitySwitchPendingRef = useRef(false);
  const userPlayRequestedRef = useRef(false);
  const playbackStartedRef = useRef(false);
  const startupTriedUrlsRef = useRef<Set<string>>(new Set());
  const retriedPlaybackUrlsRef = useRef<Set<string>>(new Set());
  const startupWarmupUrlsRef = useRef<Set<string>>(new Set());
  const startupGuardTimerRef = useRef<number | null>(null);
  const progressSaveTimerRef = useRef<number | null>(null);
  const lastProgressSaveAtRef = useRef(0);
  const playbackEngineRef = useRef<{ destroy?: () => void; reset?: () => void } | null>(null);
  const activeSeason = seasonNumber || 1;
  const activeEpisode = episodeNumber || 1;

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
          const season =
            series.seasons.find((item) => item.seasonNumber === activeSeason) ||
            series.seasons[0];
          const episode =
            season?.episodes.find((item) => item.episodeNumber === activeEpisode) ||
            season?.episodes[0];

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

  const storedPlaybackSources = useMemo(
    () => (content ? pickPlaybackSources(content, currentEpisode) : []),
    [content, currentEpisode],
  );
  const storedPlaybackSource = [...storedPlaybackSources]
    .filter((source) => source.isWorking)
    .sort((a, b) => startupSourceRank(b) - startupSourceRank(a))
    .find((source) => /720p/i.test(source.quality || source.labelEn || ''))
    ?? [...storedPlaybackSources]
      .filter((source) => source.isWorking)
      .sort((a, b) => startupSourceRank(b) - startupSourceRank(a))[0]
    ?? storedPlaybackSources[0]
    ?? null;
  const routeTmdbId = /^\d+$/.test(contentId) ? Number(contentId) : null;
  const resolveTmdbId = content?.tmdbId ?? routeTmdbId;

  useEffect(() => {
    let mounted = true;

    const applyReadySources = (sources: PlaybackSource[]) => {
      const ready = sortPlaybackSources(
        sources
          .filter(isPlayableHttpSource)
          .filter((source) => source.isWorking !== false)
          .slice(0, 12),
      );

      if (!ready.length) return false;

      setPlaybackError(null);
      setRemotePlaybackSources(ready);
      setRemotePlaybackSource((current) => current ?? (
        ready.find((source) => /720p/i.test(source.quality || source.labelEn || '')) ||
        ready[0]
      ));
      setResolverLoading(false);
      setPlayerUnlocked(true);
      return true;
    };

    if (storedPlaybackSources.length) {
      applyReadySources(storedPlaybackSources);
    } else {
      setRemotePlaybackSources([]);
      setRemotePlaybackSource(null);
    }

    if (!resolveTmdbId) {
      setResolverLoading(false);
      setPlaybackError(language === 'ar' ? 'لا يوجد مصدر تشغيل جاهز لهذا المحتوى.' : 'No ready playback source exists for this title.');
      return () => {
        mounted = false;
      };
    }

    const params = {
      type: mediaType,
      tmdbId: resolveTmdbId,
      ...(mediaType === 'series'
        ? {
            season: currentEpisode?.seasonNumber ?? activeSeason,
            episode: currentEpisode?.episodeNumber ?? activeEpisode,
          }
        : {}),
    } as const;

    setResolverLoading(true);
    setPlaybackError(null);

    void MovyzaApi.getReadyPlaybackSources(params)
      .then(async (response) => {
        if (!mounted) return;
        if (applyReadySources(response.data.sources)) return;

        try {
          const fallback = await MovyzaApi.resolvePlaybackSource(params);
          if (!mounted) return;
          if (applyReadySources(fallback.data.sources)) return;

          setResolverLoading(false);
          setPlayerUnlocked(false);
          setPlaybackError(
            language === 'ar'
              ? 'لم يتم العثور على مصدر تشغيل لهذه الحلقة حاليًا.'
              : 'No playback source is available for this episode right now.',
          );
        } catch {
          if (!mounted) return;
          setResolverLoading(false);
          setPlayerUnlocked(false);
          setPlaybackError(
            language === 'ar'
              ? 'تعذر الحصول على مصدر التشغيل حاليًا.'
              : 'Unable to obtain a playback source right now.',
          );
        }
      })
      .catch(() => {
        if (!mounted) return;
        setResolverLoading(false);
        setPlayerUnlocked(false);
        setPlaybackError(
          language === 'ar'
            ? 'تعذر الوصول إلى مصدر التشغيل حاليًا.'
            : 'Unable to reach the playback source service right now.',
        );
      });

    return () => {
      mounted = false;
    };
  }, [
    resolveTmdbId,
    mediaType,
    activeSeason,
    activeEpisode,
    currentEpisode?.seasonNumber,
    currentEpisode?.episodeNumber,
    storedPlaybackSources.length,
    storedPlaybackSource?.url,
    language,
  ]);

  const playbackSource = remotePlaybackSource ?? storedPlaybackSource;
  const playbackUrl = playbackSource?.url?.trim() || '';

  const formatPlayerTime = (value: number) => {
    if (!Number.isFinite(value) || value < 0) return '00:00';
    const total = Math.floor(value);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const base = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return hours > 0 ? `${String(hours).padStart(2, '0')}:${base}` : base;
  };

  const togglePlayerPlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  const seekPlayerBy = (seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(
      Math.max(0, video.currentTime + seconds),
      Math.max(0, video.duration),
    );
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

  const togglePlayerFullscreen = async () => {
    const shell = playerShellRef.current;
    if (!shell) return;
    try {
      if (!document.fullscreenElement) {
        await shell.requestFullscreen();
        setPlayerFullscreen(true);
      } else {
        await document.exitFullscreen();
        setPlayerFullscreen(false);
      }
    } catch {}
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
    () =>
      sortPlaybackSources(
        [...storedPlaybackSources, ...remotePlaybackSources].filter(
          (source, index, all) =>
            index === all.findIndex((candidate) => candidate.url === source.url),
        ),
      ),
    [storedPlaybackSources, remotePlaybackSources],
  );
  const availableSourceGroups = useMemo(
    () => groupPlaybackSources(availableSources, language),
    [availableSources, language],
  );


  useEffect(() => {
    if (!playbackUrl || typeof document === 'undefined') return;

    let origin: string;
    try {
      origin = new URL(playbackUrl).origin;
    } catch {
      return;
    }

    const head = document.head;
    head.querySelector('link[data-movyz-media-preconnect]')?.remove();
    head.querySelector('link[data-movyz-media-dns]')?.remove();

    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = origin;
    preconnect.crossOrigin = 'anonymous';
    preconnect.dataset.movyzMediaPreconnect = 'true';
    head.appendChild(preconnect);

    const dns = document.createElement('link');
    dns.rel = 'dns-prefetch';
    dns.href = origin;
    dns.dataset.movyzMediaDns = 'true';
    head.appendChild(dns);

    return () => {
      preconnect.remove();
      dns.remove();
    };
  }, [playbackUrl]);

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

  // Automatic source failover is intentionally disabled.
  // A failed source must remain stable so the player never enters a quality-switch loop.
  const markPlaybackSourceFailed = () => {
    rememberPlaybackHost(playbackSource, false);
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

    const resetMediaElement = () => {
      video.pause();
      video.removeAttribute('src');
      try { video.srcObject = null; } catch {}
      video.load();
      videoReadyReset();
    };

    const attachNative = () => {
      playbackEngineRef.current?.destroy?.();
      playbackEngineRef.current = null;
      resetMediaElement();
      video.src = playbackUrl;
      video.preload = 'auto';
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
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || cancelled) return;
            setPlaybackError(
              language === 'ar'
                ? 'تعذر تهيئة بث HLS من المصدر الحالي.'
                : 'The current HLS source could not be initialized.',
            );
            hls.destroy();
            playbackEngineRef.current = null;
          });
          hls.loadSource(playbackUrl);
          hls.attachMedia(video);
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

    // Watchdog only reports a real media initialization failure.
    // It never changes source/quality automatically.
    startupGuardTimerRef.current = window.setTimeout(() => {
      if (cancelled) return;
      const currentVideo = videoRef.current;
      if (!currentVideo || currentVideo.readyState >= HTMLMediaElement.HAVE_METADATA) return;
      setPlaybackError(
        language === 'ar'
          ? 'المصدر لم يرسل بيانات الفيديو بعد. يمكنك إعادة المحاولة يدويًا أو اختيار جودة أخرى.'
          : 'The source has not provided video metadata yet. Retry manually or choose another quality.',
      );
    }, 15000);

    return () => {
      cancelled = true;
      if (startupGuardTimerRef.current !== null) {
        window.clearTimeout(startupGuardTimerRef.current);
        startupGuardTimerRef.current = null;
      }
      playbackEngineRef.current?.destroy?.();
      playbackEngineRef.current = null;
      video.pause();
    };
  }, [playbackUrl, playbackSource?.type, language]);

  useEffect(() => {
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
  }, [playbackUrl, playbackSource?.type]);

  // Mirror the native media element state directly. React's media events are
  // supplemented with native listeners so duration/currentTime/buffering cannot
  // remain at their initial 00:00 state when an engine swaps the media source.
  useEffect(() => {
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
      if (startupGuardTimerRef.current !== null) {
        window.clearTimeout(startupGuardTimerRef.current);
        startupGuardTimerRef.current = null;
      }
      setPlayerReady(true);
      syncDuration();
      syncTime();
      syncBuffered();
    };
    const onPlaying = () => {
      setPlayerPlaying(true);
      setPlayerReady(true);
      setPlaybackError(null);
      syncTime();
      syncBuffered();
    };
    const onPause = () => setPlayerPlaying(false);
    const onWaiting = () => {
      if (!playbackStartedRef.current) setPlaybackError(null);
      syncTime();
      syncBuffered();
    };
    const onVolume = () => {
      setPlayerVolume(video.volume);
      setPlayerMuted(video.muted);
    };
    const events: Array<[string, EventListener]> = [
      ['loadedmetadata', onMetadata],
      ['durationchange', syncDuration],
      ['loadeddata', () => { setPlayerReady(true); syncTime(); syncBuffered(); }],
      ['canplay', () => { setPlayerReady(true); syncDuration(); syncBuffered(); }],
      ['canplaythrough', () => { setPlayerReady(true); syncDuration(); syncBuffered(); }],
      ['timeupdate', syncTime],
      ['progress', syncBuffered],
      ['playing', onPlaying],
      ['pause', onPause],
      ['waiting', onWaiting],
      ['stalled', onWaiting],
      ['volumechange', onVolume],
      ['ended', () => setPlayerPlaying(false)],
    ];

    for (const [name, handler] of events) video.addEventListener(name, handler);
    return () => {
      for (const [name, handler] of events) video.removeEventListener(name, handler);
    };
  }, [playbackUrl, playbackSource?.type]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!videoRef.current || !playerShellRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return;

      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayerPlayback();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seekPlayerBy(-10);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        seekPlayerBy(10);
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        togglePlayerMute();
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        void togglePlayerFullscreen();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

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

  if (!playbackUrl) {
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
              {resolverLoading ? (
                <>
                  <div className="mb-4 h-10 w-10 rounded-full border-2 border-amber-400/25 border-t-amber-400 animate-spin" />
                  <p className="text-sm font-medium text-slate-200">
                    {language === 'ar' ? 'جاري قراءة المصدر الجاهز…' : 'Reading prepared playback source…'}
                  </p>
                </>
              ) : (
                <ErrorState
                  message={playbackError || (language === 'ar' ? 'لا يوجد مصدر تشغيل جاهز حاليًا.' : 'No prepared playback source is currently available.')}
                  onRetry={() => window.location.reload()}
                  onGoHome={() => onNavigate('/')}
                />
              )}
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
        'min-h-screen pb-16 transition-colors duration-500 ' +
        (theaterLighting ? 'bg-[#030406]' : 'bg-[#0a0c12]')
      }
    >
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-400 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl text-xs flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-3 pb-2 flex items-center justify-between gap-4 text-xs border-b border-amber-500/15 text-slate-400">
        <button
          onClick={() => onNavigate(isMovie ? `/movies/${content.id}` : `/series/${content.id}`)}
          className="text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1.5 transition-colors"
        >
          {direction === 'rtl' ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
          <span>{language === 'ar' ? 'العودة لصفحة العمل' : 'Back to title'}</span>
        </button>

        <div className="flex items-center gap-3 text-[11px] font-mono">
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
            <span>{language === 'ar' ? 'مشغل مضمّن مباشرة' : 'Direct embedded player'}</span>
          </div>
        </div>
      </div>

      <div className="relative w-full max-w-7xl mx-auto sm:px-4 pt-3">
        {theaterLighting && (
          <div className="absolute -inset-1 bg-gradient-to-r from-amber-600/15 via-orange-500/10 to-amber-700/15 blur-2xl -z-10 rounded-3xl opacity-75" />
        )}

        {availableSourceGroups.length > 0 && (
          <div dir={direction} className="space-y-2 px-1 pb-2">
            <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
              <span>{language === 'ar' ? 'مصادر التشغيل:' : 'Playback sources:'}</span>
              <span className="text-amber-400/70">{availableSourceGroups.length}/2</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {availableSourceGroups.map((group) => (
                <div
                  key={group.key}
                  className="rounded-xl border border-amber-500/15 bg-[#0a0d13] p-2.5"
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
                            'px-2.5 py-1.5 rounded-lg border text-[10px] font-semibold transition-all ' +
                            (active
                              ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm shadow-amber-500/20'
                              : 'bg-[#11151d] text-slate-300 border-white/5 hover:border-amber-500/30 hover:text-white')
                          }
                        >
                          {source.quality || source.labelEn || 'Auto'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl overflow-hidden border border-amber-500/25 shadow-2xl shadow-black bg-black">
          <div className="aspect-video w-full bg-black">
            <div ref={playerShellRef} className="relative h-full w-full bg-black">

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
              <video
                ref={videoRef}
                poster={content.backdropUrl || content.posterUrl}
                className="block h-full w-full bg-black object-contain"
                playsInline
                preload="auto"
                disablePictureInPicture={false}
                onLoadStart={() => {
                  playbackStartedRef.current = false;
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

                  const resumeTime = qualityResumeTimeRef.current;
                  if (resumeTime === null || !Number.isFinite(video.duration) || video.duration <= 0) return;

                  qualityResumeTimeRef.current = null;
                  try {
                    video.currentTime = Math.min(resumeTime, Math.max(0, video.duration - 0.5));
                  } catch {
                    // Ignore sources that reject a resume seek.
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
                  setPlayerCurrentTime(video.currentTime || 0);
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
                  setPlayerCurrentTime(video.currentTime || 0);
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
                  if (!playbackStartedRef.current) setPlaybackError(null);
                }}
                onStalled={() => {
                  if (!playbackStartedRef.current) setPlaybackError(null);
                }}
                onClick={() => {
                  togglePlayerPlayback();
                }}
                onDoubleClick={() => {
                  void togglePlayerFullscreen();
                }}
                onPlaying={() => {
                  playbackStartedRef.current = true;
                  setPlaybackError(null);
                  rememberPlaybackHost(playbackSource, true);
                }}
                onError={() => {
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
                }}
              >
                {playbackUrl ? null : null}
                {language === 'ar'
                  ? 'المتصفح لا يدعم تشغيل هذا المصدر.'
                  : 'Your browser does not support this playback source.'}
              </video>
 
              
              {!playbackError && !playerReady ? (
                <div className="pointer-events-none absolute inset-0 z-15 flex items-center justify-center">
                  <div className="h-10 w-10 rounded-full border-2 border-white/15 border-t-amber-400 animate-spin" />
                </div>
              ) : null}

              <div
                className="pointer-events-none absolute inset-0 z-10"
              >
                <div className="pointer-events-auto absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/85 to-transparent pt-16 pb-3 px-3 sm:px-4">
                  <div className="flex flex-col gap-2">
                    <div className="relative">
                      <div
                        className="absolute inset-y-0 left-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/15 pointer-events-none"
                        style={{ width: playerDuration > 0 ? `${Math.min(100, Math.max(0, playerBufferedEnd / playerDuration * 100))}%` : '0%' }}
                      />
                      <input
                        aria-label={language === 'ar' ? 'موضع الفيديو' : 'Video position'}
                        type="range"
                        min={0}
                        max={Math.max(playerDuration, 0)}
                        step="0.1"
                        value={Math.min(playerCurrentTime, Math.max(playerDuration, 0))}
                        onChange={(event) => setPlayerProgress(Number(event.target.value))}
                        className="relative z-10 w-full accent-amber-400 cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-white">
                      <button
                        type="button"
                        onClick={togglePlayerPlayback}
                        className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                        aria-label={playerPlaying ? (language === 'ar' ? 'إيقاف' : 'Pause') : (language === 'ar' ? 'تشغيل' : 'Play')}
                      >
                        {playerPlaying ? <Pause size={17} /> : <Play size={17} className="translate-x-0.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => seekPlayerBy(-10)}
                        className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                        aria-label={language === 'ar' ? 'رجوع 10 ثواني' : 'Back 10 seconds'}
                      >
                        <RotateCcw size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() => seekPlayerBy(10)}
                        className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                        aria-label={language === 'ar' ? 'تقديم 10 ثواني' : 'Forward 10 seconds'}
                      >
                        <RotateCw size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={togglePlayerMute}
                        className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
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
                        className="hidden sm:block w-20 accent-amber-400 cursor-pointer"
                      />
                      <span className="min-w-[92px] text-[11px] font-mono text-white/75 tabular-nums">
                        {formatPlayerTime(playerCurrentTime)} / {formatPlayerTime(playerDuration)}
                      </span>
                      <div className="flex-1" />
                      <label className="flex items-center gap-1.5 text-[11px] text-white/80">
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
                          className="bg-white/10 border border-white/10 rounded-md px-1.5 py-1 outline-none"
                        >
                          {[0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                            <option key={speed} value={speed} className="bg-slate-950">{speed}x</option>
                          ))}
                        </select>
                      </label>
                      {document.pictureInPictureEnabled && typeof videoRef.current?.requestPictureInPicture === 'function' ? (
                        <button
                          type="button"
                          onClick={() => void togglePlayerPictureInPicture()}
                          className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition text-[10px] font-bold"
                          aria-label={playerPictureInPicture ? (language === 'ar' ? 'الخروج من صورة داخل صورة' : 'Exit picture in picture') : (language === 'ar' ? 'صورة داخل صورة' : 'Picture in picture')}
                        >
                          PiP
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void togglePlayerFullscreen()}
                        className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-8">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b border-amber-500/15 pb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-xs font-bold">
                {isMovie
                  ? language === 'ar' ? 'عرض سينمائي' : 'FEATURE FILM'
                  : language === 'ar' ? 'بث مسلسل' : 'EPISODE STREAM'}
              </span>
              <span className="text-slate-500 text-xs font-mono">TMDB: {content.tmdbId}</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
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
            className="self-start px-4 py-2.5 rounded-xl bg-[#0f1118] hover:bg-[#151822] text-slate-300 hover:text-white border border-amber-500/20 text-xs font-medium flex items-center gap-2 transition-all"
          >
            <Share2 className="w-4 h-4 text-amber-400" />
            <span>{t('share')}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2 text-amber-300 text-sm font-bold">
              <Info className="w-4 h-4 text-amber-400" />
              <span>{t('storyOverview')}</span>
            </div>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl whitespace-pre-line">
              {overview || (language === 'ar' ? 'لا توجد نبذة متاحة حاليًا.' : 'No synopsis is available right now.')}
            </p>

            <div className="p-4 rounded-2xl bg-[#08090f] border border-amber-500/15 flex items-start gap-3 text-xs text-slate-400">
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
            <div className="p-5 rounded-2xl bg-[#090b10] border border-amber-500/20 space-y-4 shadow-xl">
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
                          'w-full text-start p-3 rounded-xl text-xs flex items-center justify-between transition-all ' +
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

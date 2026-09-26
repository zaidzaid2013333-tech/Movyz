import React, { useState, useRef, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import * as dashjs from 'dashjs';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Server,
  Settings,
  AlertTriangle,
  SkipForward,
  SkipBack,
  ListVideo,
  X,
  CheckCircle,
  RefreshCw,
  FastForward,
  Zap,
} from 'lucide-react';
import { PlaybackSource, Episode, Season, WatchProgress, ContentType } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { MovyzaApi } from '../../services/api';

type PlayerSource = PlaybackSource & {
  embedUrl?: string;
  providerKey?: string;
  providerReference?: string;
};

interface VideoPlayerProps {
  contentId: string;
  contentType: ContentType;
  title: string;
  titleEn: string;
  posterUrl: string;
  backdropUrl: string;
  sources: PlaybackSource[];
  seasonNumber?: number;
  episodeNumber?: number;
  currentEpisode?: Episode;
  allSeasons?: Season[];
  onSelectEpisode?: (seasonNum: number, episodeNum: number) => void;
  onNavigateBack: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  contentId,
  contentType,
  title,
  titleEn,
  posterUrl,
  backdropUrl,
  sources,
  seasonNumber,
  episodeNumber,
  currentEpisode,
  allSeasons,
  onSelectEpisode,
  onNavigateBack,
}) => {
  const { language, t, direction } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  // Source selection & fallback
  const [activeSourceIndex, setActiveSourceIndex] = useState(0);
  const [selectedQuality, setSelectedQuality] = useState<'1080p' | '720p' | '480p' | 'auto'>('1080p');
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [episodeDrawerOpen, setEpisodeDrawerOpen] = useState(false);
  const [fallbackSources, setFallbackSources] = useState<PlaybackSource[]>([]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [resumePrompt, setResumePrompt] = useState<{ position: number; formatted: string } | null>(null);

  // Auto-play Next Episode countdown & Skip Intro
  const [autoPlayCountdown, setAutoPlayCountdown] = useState<number | null>(null);
  const [autoPlayCancelled, setAutoPlayCancelled] = useState(false);
  const [doubleTapNotice, setDoubleTapNotice] = useState<{ side: 'left' | 'right'; label: string } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });

  // Stream report modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportIssueType, setReportIssueType] = useState<'broken_source' | 'audio_sync' | 'subtitle_issue' | 'buffering'>('broken_source');
  const [reportDesc, setReportDesc] = useState('');
  const [reportSuccess, setReportSuccess] = useState(false);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sourceFailoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const dashRef = useRef<dashjs.MediaPlayerClass | null>(null);
  const failedProvidersRef = useRef<Set<string>>(new Set());
  const sourceRefreshInFlightRef = useRef(false);

  const playbackSources = [...sources, ...fallbackSources].filter((source, index, all) => {
    const key = (source as PlayerSource).embedUrl || source.url;
    return all.findIndex((candidate) => ((candidate as PlayerSource).embedUrl || candidate.url) === key) === index;
  }) as PlayerSource[];
  const activeSource = playbackSources[activeSourceIndex] || playbackSources[0];

  const sourceKey = sources.map((source) => source.id).join('|');
  const normalizeProviderKey = (provider?: string) =>
    provider ? provider.toLowerCase().replace(/[^a-z0-9]/g, '') : '';

  useEffect(() => {
    setActiveSourceIndex(0);
    setFallbackSources([]);
    failedProvidersRef.current.clear();
    sourceRefreshInFlightRef.current = false;
    setHasError(false);
    setIsLoading(sources.length > 0);
  }, [contentId, currentEpisode?.id, sourceKey]);

  // Format seconds to mm:ss or hh:mm:ss
  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Check saved progress on load
  useEffect(() => {
    let isMounted = true;
    MovyzaApi.getWatchProgress(contentId, currentEpisode?.id).then((res) => {
      if (isMounted && res.data && res.data.positionSeconds > 10 && !res.data.completed) {
        setResumePrompt({
          position: res.data.positionSeconds,
          formatted: formatTime(res.data.positionSeconds),
        });
      }
    });
    return () => {
      isMounted = false;
    };
  }, [contentId, currentEpisode?.id]);

  // Periodic progress saving (every 5 seconds)
  const saveProgress = useCallback(() => {
    if (!videoRef.current || duration <= 0) return;
    const pos = Math.floor(videoRef.current.currentTime);
    const dur = Math.floor(duration);
    const pct = Math.floor((pos / dur) * 100);

    const progressItem: WatchProgress = {
      contentId,
      contentType,
      title,
      titleEn,
      posterUrl,
      backdropUrl,
      seasonNumber,
      episodeNumber,
      episodeId: currentEpisode?.id,
      positionSeconds: pos,
      durationSeconds: dur,
      percentage: pct,
      lastWatchedAt: new Date().toISOString(),
      completed: pct > 92,
    };

    MovyzaApi.saveWatchProgress(progressItem);
  }, [contentId, contentType, title, titleEn, posterUrl, backdropUrl, seasonNumber, episodeNumber, currentEpisode?.id, duration]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isPlaying) {
        saveProgress();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isPlaying, saveProgress]);

  // Attach the correct playback engine for MP4, HLS and DASH sources.
  useEffect(() => {
    const video = videoRef.current;
    const source = activeSource;

    hlsRef.current?.destroy();
    hlsRef.current = null;
    dashRef.current?.reset();
    dashRef.current = null;

    if (source?.embedUrl) {
      setHasError(false);
      setIsLoading(false);
      setIsPlaying(false);
      return () => {
        if (sourceFailoverTimerRef.current) clearTimeout(sourceFailoverTimerRef.current);
        sourceFailoverTimerRef.current = null;
        hlsRef.current?.destroy();
        hlsRef.current = null;
        dashRef.current?.reset();
        dashRef.current = null;
      };
    }

    if (!video || !source?.url) {
      setHasError(true);
      setIsLoading(false);
      return;
    }

    setHasError(false);
    setIsLoading(true);

    if (sourceFailoverTimerRef.current) clearTimeout(sourceFailoverTimerRef.current);
    sourceFailoverTimerRef.current = setTimeout(() => {
      handleSourceError();
    }, 12_000);

    if (source.type === 'hls') {
      if (video.canPlayType('application/vnd.apple.mpegurl') && !Hls.isSupported()) {
        video.src = source.url;
        video.load();
      } else if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        hlsRef.current = hls;
        hls.loadSource(source.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            handleSourceError();
          }
        });
      } else {
        handleSourceError();
      }
    } else if (source.type === 'dash') {
      if (!dashjs.supportsMediaSource()) {
        handleSourceError();
      } else {
        const dash = dashjs.MediaPlayer().create();
        dashRef.current = dash;
        dash.initialize(video, source.url, false);
        dash.on(dashjs.MediaPlayer.events.ERROR, () => handleSourceError());
      }
    } else {
      video.src = source.url;
      video.load();
    }

    return () => {
      if (sourceFailoverTimerRef.current) clearTimeout(sourceFailoverTimerRef.current);
      sourceFailoverTimerRef.current = null;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      dashRef.current?.reset();
      dashRef.current = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [activeSource?.id, activeSource?.url, activeSource?.type, activeSource?.embedUrl]);

  // Handle controls activity hide
  const resetControlsTimer = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
        setSourceMenuOpen(false);
        setQualityMenuOpen(false);
      }
    }, 3500);
  };

  // Video event handlers
  const handlePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
    resetControlsTimer();
  };

  const handleSeek = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.currentTime + seconds, duration));
    resetControlsTimer();
  };

  const handleProgressScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = Number(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    }
    resetControlsTimer();
  };

  const handleVolumeToggle = () => {
    if (!videoRef.current) return;
    if (isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
      videoRef.current.volume = volume || 0.8;
    } else {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    if (videoRef.current) {
      videoRef.current.volume = newVol;
      videoRef.current.muted = newVol === 0;
      setIsMuted(newVol === 0);
    }
  };

  const handleFullscreenToggle = () => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Fallback locally first, then ask the API for the next provider when the list is exhausted.
  const handleSourceError = async () => {
    console.warn(`[Player] Source ${activeSource?.id} failed, attempting failover...`);
    if (sourceFailoverTimerRef.current) clearTimeout(sourceFailoverTimerRef.current);
    sourceFailoverTimerRef.current = null;
    setHasError(true);
    setIsLoading(false);

    const failedProvider = normalizeProviderKey(activeSource?.provider);
    if (failedProvider) failedProvidersRef.current.add(failedProvider);

    if (activeSourceIndex < playbackSources.length - 1) {
      setTimeout(() => {
        setActiveSourceIndex((index) => index + 1);
        setHasError(false);
        setIsLoading(true);
      }, 700);
      return;
    }

    if (sourceRefreshInFlightRef.current) return;

    const excludedProviders = [...failedProvidersRef.current];
    if (!excludedProviders.length) return;

    sourceRefreshInFlightRef.current = true;
    const existingUrls = new Set(playbackSources.map((source) => source.url));

    try {
      const response = await MovyzaApi.getWatchSources(
        contentId,
        currentEpisode?.id,
        { refresh: true, excludeProviders: excludedProviders },
      );

      const freshSources = response.data.filter((source) => !existingUrls.has(source.url));
      if (freshSources.length) {
        const nextIndex = playbackSources.length;
        setFallbackSources((current) => [...current, ...freshSources]);
        setTimeout(() => {
          setActiveSourceIndex(nextIndex);
          setHasError(false);
          setIsLoading(true);
        }, 0);
      }
    } catch (error) {
      console.error('[Player] Provider refresh failed:', error);
    } finally {
      sourceRefreshInFlightRef.current = false;
    }
  };

  // Resume prompt action
  const handleResume = (confirm: boolean) => {
    if (confirm && resumePrompt && videoRef.current) {
      videoRef.current.currentTime = resumePrompt.position;
      setCurrentTime(resumePrompt.position);
    }
    setResumePrompt(null);
    videoRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
  };

  // Submit issue report
  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSource) return;
    await MovyzaApi.reportIssue({
      contentId,
      contentTitle: title,
      sourceId: activeSource.id,
      issueType: reportIssueType,
      description: reportDesc,
    });
    setReportSuccess(true);
    setTimeout(() => {
      setReportModalOpen(false);
      setReportSuccess(false);
      setReportDesc('');
    }, 2000);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (reportModalOpen) return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        handlePlayPause();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleSeek(10);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleSeek(-10);
      } else if (e.key === 'f') {
        e.preventDefault();
        handleFullscreenToggle();
      } else if (e.key === 'm') {
        e.preventDefault();
        handleVolumeToggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, isMuted, reportModalOpen]);

  // Auto-play Next Episode countdown effect
  useEffect(() => {
    if (!allSeasons || !seasonNumber || !episodeNumber || !onSelectEpisode || autoPlayCancelled) return;
    
    // Check if within 15 seconds of the end of episode
    if (duration > 30 && currentTime >= duration - 15) {
      if (autoPlayCountdown === null) {
        setAutoPlayCountdown(10);
      }
    }
  }, [currentTime, duration, allSeasons, seasonNumber, episodeNumber, autoPlayCancelled, autoPlayCountdown]);

  // Countdown ticker
  useEffect(() => {
    if (autoPlayCountdown === null || autoPlayCountdown <= 0) return;
    const timer = setTimeout(() => {
      if (autoPlayCountdown === 1) {
        setAutoPlayCountdown(null);
        if (allSeasons && seasonNumber && episodeNumber && onSelectEpisode) {
          onSelectEpisode(seasonNumber, episodeNumber + 1);
        }
      } else {
        setAutoPlayCountdown(autoPlayCountdown - 1);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [autoPlayCountdown, allSeasons, seasonNumber, episodeNumber, onSelectEpisode]);

  const handleTouchSeek = (e: React.TouchEvent<HTMLDivElement>) => {
    resetControlsTimer();
    const touch = e.changedTouches[0];
    const now = Date.now();
    const rect = playerContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const tapX = touch.clientX - rect.left;
    const isRightSide = tapX > rect.width / 2;

    if (now - lastTapRef.current.time < 320 && Math.abs(tapX - lastTapRef.current.x) < 90) {
      if (isRightSide) {
        handleSeek(10);
        setDoubleTapNotice({ side: 'right', label: '+10s' });
      } else {
        handleSeek(-10);
        setDoubleTapNotice({ side: 'left', label: '-10s' });
      }
      setTimeout(() => setDoubleTapNotice(null), 700);
      lastTapRef.current = { time: 0, x: 0 };
    } else {
      lastTapRef.current = { time: now, x: tapX };
    }
  };

  if (activeSource?.embedUrl) {
    return (
      <div
        ref={playerContainerRef}
        className="relative w-full aspect-video max-h-[85vh] bg-black overflow-hidden focus:outline-none"
      >
        <iframe
          src={activeSource.embedUrl}
          title={title}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="origin"
          className="w-full h-full min-h-[240px] border-0 bg-black"
        />
        <div className="pointer-events-none absolute top-3 left-3 right-3 flex justify-between items-center">
          <span className="rounded-full bg-black/70 backdrop-blur px-2.5 py-1 text-[10px] font-semibold text-white border border-white/10">
            {activeSource.provider || 'External source'}
          </span>
          <span className="rounded-full bg-black/55 backdrop-blur px-2.5 py-1 text-[10px] text-slate-300 border border-white/10">
            {language === 'ar' ? 'مشغل المصدر الخارجي' : 'External provider player'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={playerContainerRef}
      onMouseMove={resetControlsTimer}
      onTouchStart={handleTouchSeek}
      className="relative w-full aspect-video max-h-[85vh] bg-black select-none overflow-hidden group focus:outline-none"
    >
      {/* HTML5 Video Element with direct CDN stream */}
      <video
        ref={videoRef}
        poster={backdropUrl}
        preload="metadata"
        playsInline
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration);
            if (sourceFailoverTimerRef.current) clearTimeout(sourceFailoverTimerRef.current);
            sourceFailoverTimerRef.current = null;
            setIsLoading(false);
            setHasError(false);
          }
        }}
        onTimeUpdate={() => {
          if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
          }
        }}
        onWaiting={() => {
          setIsLoading(true);
          if (sourceFailoverTimerRef.current) clearTimeout(sourceFailoverTimerRef.current);
          sourceFailoverTimerRef.current = setTimeout(() => {
            handleSourceError();
          }, 10_000);
        }}
        onPlaying={() => {
          if (sourceFailoverTimerRef.current) clearTimeout(sourceFailoverTimerRef.current);
          sourceFailoverTimerRef.current = null;
          setIsLoading(false);
          setIsPlaying(true);
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          saveProgress();
          // If there's a next episode, notify
          if (allSeasons && seasonNumber && episodeNumber && onSelectEpisode) {
            onSelectEpisode(seasonNumber, episodeNumber + 1);
          }
        }}
        onError={handleSourceError}
        onClick={handlePlayPause}
        className="w-full h-full object-contain cursor-pointer"
      />

      {/* Loading Spinner */}
      {isLoading && !hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none z-20">
          <div className="w-12 h-12 rounded-full border-2 border-amber-500/20 border-t-amber-500 animate-spin mb-3" />
          <span className="text-xs text-slate-300 font-medium tracking-wide">
            {language === 'ar' ? 'جاري الاتصال بالسيرفر...' : 'Connecting to stream server...'}
          </span>
        </div>
      )}

      {/* Error Fallback Overlay */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-center p-6 z-30 animate-in fade-in">
          <AlertTriangle className="w-12 h-12 text-amber-500 mb-3" />
          <h4 className="text-base font-bold text-white mb-1">
            {t('sourceUnavailable')}
          </h4>
          <p className="text-xs text-slate-400 max-w-md mb-6">
            {language === 'ar'
              ? 'يمكنك تجربة التبديل إلى سيرفر بديل أو الإبلاغ عن العطل لمراجعته.'
              : 'You can manually switch to an alternative server mirror or submit a stream report.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {playbackSources.map((src, idx) => (
              <button
                key={src.id}
                onClick={() => {
                  setActiveSourceIndex(idx);
                  setHasError(false);
                  setIsLoading(true);
                }}
                className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeSourceIndex === idx
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'bg-white/[0.1] text-white hover:bg-white/[0.2]'
                }`}
              >
                {language === 'ar' ? src.label : src.labelEn}
              </button>
            ))}
            <button
              onClick={() => setReportModalOpen(true)}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/40 text-xs font-semibold transition-all cursor-pointer"
            >
              {t('reportBroken')}
            </button>
          </div>
        </div>
      )}

      {/* Double Tap Seek Feedback Ripple */}
      {doubleTapNotice && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 z-30 pointer-events-none flex flex-col items-center justify-center w-24 h-24 rounded-full bg-black/60 backdrop-blur-sm text-white animate-in zoom-in-75 duration-150 ${
            doubleTapNotice.side === 'right' ? 'right-12' : 'left-12'
          }`}
        >
          <span className="text-sm font-bold font-mono text-amber-400">{doubleTapNotice.label}</span>
          <span className="text-[10px] text-slate-300">
            {doubleTapNotice.side === 'right' ? (direction === 'rtl' ? 'تقديم' : 'Forward') : (direction === 'rtl' ? 'ترجيع' : 'Rewind')}
          </span>
        </div>
      )}

      {/* Skip Intro Floating Button */}
      {currentTime >= 4 && currentTime <= 85 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleSeek(85);
          }}
          className="absolute bottom-20 rtl:left-6 ltr:right-6 z-30 px-3.5 py-2 rounded-xl bg-black/85 hover:bg-black text-white border border-white/20 text-xs font-bold flex items-center gap-2 backdrop-blur-md shadow-2xl transition-all cursor-pointer hover:border-amber-400 group/skip"
        >
          <FastForward className="w-4 h-4 text-amber-400 group-hover/skip:translate-x-0.5 transition-transform" />
          <span>{language === 'ar' ? 'تخطي المقدمة (+85 ث)' : 'Skip Intro (+85s)'}</span>
        </button>
      )}

      {/* Auto-Play Next Episode Countdown Toast */}
      {autoPlayCountdown !== null && allSeasons && seasonNumber && episodeNumber && onSelectEpisode && (
        <div className="absolute bottom-20 rtl:right-6 ltr:left-6 z-40 bg-[#0c0e14]/95 border border-amber-500/40 rounded-2xl p-4 shadow-2xl backdrop-blur-md max-w-xs animate-in slide-in-from-bottom-3 duration-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 fill-amber-400" />
              <span>{language === 'ar' ? 'الحلقة التالية قادمة' : 'Next Episode Up'}</span>
            </span>
            <span className="w-6 h-6 rounded-full bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center font-mono">
              {autoPlayCountdown}
            </span>
          </div>
          <p className="text-[11px] text-slate-300 mb-3">
            {language === 'ar'
              ? `سيتم الانتقال تلقائياً للحلقة ${episodeNumber + 1}.`
              : `Playing episode ${episodeNumber + 1} automatically.`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setAutoPlayCountdown(null);
                onSelectEpisode(seasonNumber, episodeNumber + 1);
              }}
              className="flex-1 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1"
            >
              <Play className="w-3.5 h-3.5 fill-slate-950" />
              <span>{language === 'ar' ? 'تشغيل الآن' : 'Play Now'}</span>
            </button>
            <button
              onClick={() => {
                setAutoPlayCountdown(null);
                setAutoPlayCancelled(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] text-slate-300 text-xs font-medium transition-all cursor-pointer"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Resume Prompt Modal Dialog */}
      {resumePrompt && (
        <div className="absolute bottom-20 rtl:right-6 ltr:left-6 z-40 bg-[#0f121a]/95 border border-amber-500/40 rounded-xl p-4 shadow-2xl backdrop-blur-md max-w-sm animate-in slide-in-from-bottom-3 duration-200">
          <p className="text-xs font-semibold text-white mb-1">
            {t('resumePlayback')} ({resumePrompt.formatted})؟
          </p>
          <p className="text-[11px] text-slate-400 mb-3">
            {language === 'ar'
              ? 'تم رصد تقدم سابق في المشاهدة. هل تود المتابعة؟'
              : 'Previous watch position detected. Would you like to resume?'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleResume(true)}
              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all cursor-pointer"
            >
              {t('resumePlayback')}
            </button>
            <button
              onClick={() => handleResume(false)}
              className="px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] text-slate-300 text-xs font-medium transition-all cursor-pointer"
            >
              {t('startOver')}
            </button>
          </div>
        </div>
      )}

      {/* Top Header Bar inside player */}
      <div
        className={`absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between text-white transition-opacity duration-300 z-20 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onNavigateBack}
            className="p-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.2] transition-colors cursor-pointer"
            title="العودة"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <div className="truncate">
            <h3 className="text-sm font-bold text-white truncate">
              {language === 'ar' ? title : titleEn}
            </h3>
            {currentEpisode && (
              <p className="text-xs text-amber-400 truncate">
                {t('season')} {seasonNumber} · {t('episode')} {episodeNumber}:{' '}
                {language === 'ar' ? currentEpisode.title : currentEpisode.titleEn}
              </p>
            )}
          </div>
        </div>

        {/* Top Right Quick Badges */}
        <div className="flex items-center gap-2">
          {/* Active Server indicator badge */}
          <button
            onClick={() => setSourceMenuOpen(!sourceMenuOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/60 hover:bg-black/90 border border-white/[0.12] text-xs font-medium text-slate-200 transition-colors cursor-pointer"
          >
            <Server className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">
              {language === 'ar' ? activeSource?.label : activeSource?.labelEn}
            </span>
            <span className="sm:hidden">{activeSource?.quality}</span>
          </button>

          {/* Report Button */}
          <button
            onClick={() => setReportModalOpen(true)}
            className="p-2 rounded-lg bg-black/60 hover:bg-black/90 border border-white/[0.12] text-slate-300 hover:text-amber-400 transition-colors cursor-pointer"
            title={t('reportBroken')}
          >
            <AlertTriangle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 inset-x-0 p-3 sm:p-4 bg-gradient-to-t from-black/95 via-black/60 to-transparent transition-opacity duration-300 z-20 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Scrubber Progress Bar */}
        <div className="space-y-1 mb-2">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleProgressScrub}
            className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-amber-500 hover:h-2 transition-all"
            aria-label="Seek progress slider"
          />
          <div className="flex justify-between text-[11px] font-mono text-slate-400 tabular-nums">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Buttons Row */}
        <div className="flex items-center justify-between gap-2">
          {/* Left Controls: Play/Pause, Replay 10, Forward 10, Episodes */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button
              onClick={handlePlayPause}
              className="p-2 rounded-lg text-white hover:text-amber-400 transition-colors cursor-pointer"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </button>

            <button
              onClick={() => handleSeek(-10)}
              className="p-2 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="-10 ثوان"
              aria-label="Seek back 10 seconds"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleSeek(10)}
              className="p-2 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="+10 ثوان"
              aria-label="Seek forward 10 seconds"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume Control */}
            <div className="hidden sm:flex items-center gap-2 group/vol">
              <button
                onClick={handleVolumeToggle}
                className="p-2 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-amber-500"
                aria-label="Volume slider"
              />
            </div>

            {/* Series Episode Drawer Trigger */}
            {allSeasons && (
              <button
                onClick={() => setEpisodeDrawerOpen(!episodeDrawerOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] text-xs text-slate-200 transition-colors cursor-pointer"
              >
                <ListVideo className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">{t('selectEpisode')}</span>
              </button>
            )}
          </div>

          {/* Right Controls: Quality, Server Switcher, Fullscreen */}
          <div className="flex items-center gap-2 relative">
            {/* Quality Selector */}
            <div className="relative">
              <button
                onClick={() => setQualityMenuOpen(!qualityMenuOpen)}
                className="px-2.5 py-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] text-xs font-mono font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                {selectedQuality}
              </button>

              {qualityMenuOpen && (
                <div className="absolute bottom-full mb-2 rtl:left-0 ltr:right-0 bg-[#0f121a] border border-white/[0.1] rounded-xl shadow-xl py-1 w-28 text-xs z-50">
                  {(['1080p', '720p', '480p', 'auto'] as const).map((q) => (
                    <button
                      key={q}
                      onClick={() => {
                        setSelectedQuality(q);
                        setQualityMenuOpen(false);
                      }}
                      className={`w-full text-start px-3 py-1.5 hover:bg-white/[0.08] flex items-center justify-between ${
                        selectedQuality === q ? 'text-amber-400 font-bold' : 'text-slate-300'
                      }`}
                    >
                      <span>{q}</span>
                      {selectedQuality === q && <CheckCircle className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Source Switcher Menu */}
            <div className="relative">
              <button
                onClick={() => setSourceMenuOpen(!sourceMenuOpen)}
                className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                title={t('playerServer')}
              >
                <Settings className="w-4 h-4" />
              </button>

              {sourceMenuOpen && (
                <div className="absolute bottom-full mb-2 rtl:left-0 ltr:right-0 bg-[#0f121a] border border-white/[0.1] rounded-xl shadow-xl py-1 w-56 text-xs z-50">
                  <div className="px-3 py-1 text-slate-400 font-semibold border-b border-white/[0.06]">
                    {t('playerServer')}
                  </div>
                  {playbackSources.map((src, idx) => (
                    <button
                      key={src.id}
                      onClick={() => {
                        setActiveSourceIndex(idx);
                        setSourceMenuOpen(false);
                        setIsLoading(true);
                      }}
                      className={`w-full text-start px-3 py-2 hover:bg-white/[0.08] flex items-center justify-between ${
                        activeSourceIndex === idx ? 'text-amber-400 font-bold' : 'text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          idx === 0 ? 'bg-emerald-400 animate-pulse' : idx === 1 ? 'bg-amber-400' : 'bg-slate-400'
                        }`} />
                        <span className="truncate">
                          {language === 'ar' ? src.label : src.labelEn}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-mono">
                        <span className="text-slate-500">
                          {src.quality || 'auto'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Fullscreen Button */}
            <button
              onClick={handleFullscreenToggle}
              className="p-2 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="ملء الشاشة"
              aria-label="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Episode Drawer for Series */}
      {episodeDrawerOpen && allSeasons && (
        <div className="absolute inset-y-0 rtl:left-0 ltr:right-0 w-80 max-w-[85vw] bg-[#0c0e14]/95 backdrop-blur-md border-s border-white/[0.1] p-4 overflow-y-auto z-40 animate-in slide-in-from-right duration-200">
          <div className="flex items-center justify-between mb-4 border-b border-white/[0.08] pb-2">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <ListVideo className="w-4 h-4 text-amber-400" />
              <span>{t('seasonsAndEpisodes')}</span>
            </h4>
            <button
              onClick={() => setEpisodeDrawerOpen(false)}
              className="p-1 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            {allSeasons.map((season) => (
              <div key={season.id} className="space-y-2">
                <p className="text-xs font-bold text-amber-400">
                  {language === 'ar' ? season.name : season.nameEn}
                </p>
                <div className="space-y-1.5">
                  {season.episodes.map((ep) => {
                    const isSelected =
                      season.seasonNumber === seasonNumber &&
                      ep.episodeNumber === episodeNumber;

                    return (
                      <button
                        key={ep.id}
                        onClick={() => {
                          if (onSelectEpisode) {
                            onSelectEpisode(season.seasonNumber, ep.episodeNumber);
                          }
                          setEpisodeDrawerOpen(false);
                        }}
                        className={`w-full text-start p-2 rounded-lg text-xs transition-colors flex items-center justify-between cursor-pointer ${
                          isSelected
                            ? 'bg-amber-500 text-slate-950 font-bold'
                            : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
                        }`}
                      >
                        <span className="truncate">
                          {ep.episodeNumber}. {language === 'ar' ? ep.title : ep.titleEn}
                        </span>
                        <span className="text-[10px] opacity-75 shrink-0 ml-1">
                          {ep.duration} د
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

      {/* Stream Issue Report Dialog Modal */}
      {reportModalOpen && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-[#0f121a] border border-white/[0.1] rounded-2xl p-5 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <span>{t('reportBroken')}</span>
              </h4>
              <button
                onClick={() => setReportModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {reportSuccess ? (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-2">
                <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
                <p className="text-xs text-emerald-200 font-semibold">{t('reportSent')}</p>
              </div>
            ) : (
              <form onSubmit={handleSubmitReport} className="space-y-3">
                <p className="text-xs text-slate-400">
                  {language === 'ar'
                    ? 'أخبرنا بالمشكلة التي تواجهها مع سيرفر التشغيل وسنقوم بمعالجتها:'
                    : 'Report the issue you encountered with this stream:'}
                </p>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">نوع العطل</label>
                  <select
                    value={reportIssueType}
                    onChange={(e) => setReportIssueType(e.target.value as any)}
                    className="w-full bg-[#161b24] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="broken_source">الرابط لا يعمل أو يتوقف (Broken Stream)</option>
                    <option value="buffering">تقطيع مستمر وتأخر تحميل (Buffering)</option>
                    <option value="audio_sync">عدم تطابق الصوت مع الصورة (Audio Sync)</option>
                    <option value="subtitle_issue">مشكلة في الترجمة (Subtitle Issue)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">تفاصيل إضافية (اختياري)</label>
                  <textarea
                    value={reportDesc}
                    onChange={(e) => setReportDesc(e.target.value)}
                    rows={2}
                    placeholder="اكتب ملاحظاتك لمساعدة الفريق..."
                    className="w-full bg-[#161b24] border border-white/[0.1] rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setReportModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-white/[0.06] text-slate-300 text-xs font-medium hover:bg-white/[0.1] cursor-pointer"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-colors cursor-pointer shadow-lg shadow-amber-500/20"
                  >
                    إرسال البلاغ
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

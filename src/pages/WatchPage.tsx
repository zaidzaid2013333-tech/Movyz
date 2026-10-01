import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Film,
  Info,
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

const isOmegaTechSource = (source: PlaybackSource) =>
  source.providerKey === 'omegatech-akwam' || source.provider === 'OmegaTech';

const pickPlaybackSource = (content: Movie | Series, episode?: Episode) => {
  const candidates = episode?.sources ?? (content.type === 'movie' ? content.sources : []);
  const omegaSources = candidates.filter(isOmegaTechSource);

  return omegaSources.find((source) => source.isWorking && /^https?:\/\//i.test(source.url?.trim() || ''))
    ?? omegaSources.find((source) => /^https?:\/\//i.test(source.url?.trim() || ''))
    ?? null;
};

const playbackQualityRank = (source: PlaybackSource) => {
  const match = source.quality?.match(/(\\d{3,4})p/i);
  const quality = match ? Number(match[1]) : 9999;
  if (quality === 720) return 0;
  if (quality === 480) return 1;
  if (quality === 1080) return 2;
  return 3;
};

const sortPlaybackSources = (sources: PlaybackSource[]) =>
  [...sources].sort((a, b) => playbackQualityRank(a) - playbackQualityRank(b));

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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const startupRecoveryStage = useRef<'idle' | 'recovering' | 'done'>('idle');
  const startupRecoveryTimer = useRef<number | null>(null);

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

        const legacyTmdbId = /^\d+$/.test(contentId) ? Number(contentId) : null;
        const response = mediaType === 'movie'
          ? legacyTmdbId
            ? await MovyzaApi.getMovieByTmdbId(legacyTmdbId)
            : await MovyzaApi.getMovieById(contentId)
          : legacyTmdbId
            ? await MovyzaApi.getSeriesByTmdbId(legacyTmdbId)
            : await MovyzaApi.getSeriesById(contentId);

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

  const recoverStartupBuffer = () => {
    const video = videoRef.current;
    if (
      !video ||
      startupRecoveryStage.current !== 'idle' ||
      !Number.isFinite(video.duration) ||
      video.duration < 45 ||
      video.currentTime >= 20
    ) {
      return;
    }

    startupRecoveryStage.current = 'recovering';
    const originalTime = Math.max(0, video.currentTime);
    const targetTime = Math.min(120, Math.max(video.duration - 15, 1));

    const restoreToStart = () => {
      if (startupRecoveryTimer.current !== null) {
        window.clearTimeout(startupRecoveryTimer.current);
        startupRecoveryTimer.current = null;
      }
      if (startupRecoveryStage.current !== 'recovering') return;

      video.removeEventListener('canplay', restoreToStart);
      try {
        video.currentTime = originalTime;
      } catch {
        // Ignore a provider that rejects seeking.
      }
      startupRecoveryStage.current = 'done';
    };

    video.addEventListener('canplay', restoreToStart, { once: true });
    startupRecoveryTimer.current = window.setTimeout(() => {
      video.removeEventListener('canplay', restoreToStart);
      startupRecoveryTimer.current = null;
      restoreToStart();
    }, 1800);

    try {
      // Prime the upstream file at 02:00, then return to the real start quickly.
      video.currentTime = targetTime;
    } catch {
      restoreToStart();
    }
  };

  const storedPlaybackSource = useMemo(
    () => (content ? pickPlaybackSource(content, currentEpisode) : null),
    [content, currentEpisode],
  );

  useEffect(() => {
    if (loading || !content) return;

    if (storedPlaybackSource) {
      setRemotePlaybackSources([storedPlaybackSource]);
      setRemotePlaybackSource(storedPlaybackSource);
      setResolverLoading(false);
      return;
    }

    if (content.type === 'series' && !currentEpisode) {
      setRemotePlaybackSources([]);
      setRemotePlaybackSource(null);
      setResolverLoading(false);
      return;
    }

    let mounted = true;
    setRemotePlaybackSources([]);
    setRemotePlaybackSource(null);
    setResolverLoading(true);

    void MovyzaApi.resolvePlaybackSource({
      type: content.type,
      tmdbId: content.tmdbId,
      ...(content.type === 'series'
        ? {
            season: currentEpisode?.seasonNumber ?? activeSeason,
            episode: currentEpisode?.episodeNumber ?? activeEpisode,
            ...(currentEpisode?.tmdbId ? { episodeTmdbId: currentEpisode.tmdbId } : {}),
          }
        : {}),
    })
      .then((response) => {
        if (!mounted) return;

        const sources = response.data.sources
          .filter(isOmegaTechSource)
          .filter((candidate) => /^https?:\/\//i.test(candidate.url?.trim() || ''))
          .slice(0, 4);

        const source = sources.find((candidate) => candidate.isWorking) ?? sources[0] ?? null;
        setRemotePlaybackSources(sources);
        setRemotePlaybackSource(source);
      })
      .catch(() => {
        if (mounted) {
          setRemotePlaybackSources([]);
          setRemotePlaybackSource(null);
        }
      })
      .finally(() => {
        if (mounted) setResolverLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [loading, content, currentEpisode, storedPlaybackSource, activeSeason, activeEpisode]);

  const playbackSource = storedPlaybackSource ?? remotePlaybackSource;
  const playbackUrl = playbackSource?.url?.trim() || '';
  const availableSources = storedPlaybackSource ? [storedPlaybackSource] : remotePlaybackSources;

  useEffect(() => {
    startupRecoveryStage.current = 'idle';
    if (startupRecoveryTimer.current !== null) {
      window.clearTimeout(startupRecoveryTimer.current);
      startupRecoveryTimer.current = null;
    }
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
      <div className="min-h-screen bg-black flex items-center justify-center text-slate-300">
        {resolverLoading ? (
          <div className="text-center px-6">
            <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-amber-400/25 border-t-amber-400 animate-spin" />
            <p className="text-sm font-medium text-slate-200">
              {language === 'ar' ? 'جاري تجهيز مصدر التشغيل…' : 'Preparing playback source…'}
            </p>
          </div>
        ) : (
          <ErrorState
            message={language === 'ar' ? 'لا يوجد مصدر تشغيل متاح حاليًا.' : 'No playback source is currently available.'}
            onGoHome={() => onNavigate('/')}
          />
        )}
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

        {availableSources.length > 0 && (
          <div className="flex items-center gap-2 px-1 pb-2 overflow-x-auto scrollbar-none">
            <span className="shrink-0 text-[11px] text-slate-500 font-mono">
              {language === 'ar' ? 'مصدر التشغيل:' : 'Playback:'}
            </span>
            {availableSources.map((source) => {
              const active = source.id === playbackSource?.id;
              return (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => setRemotePlaybackSource(source)}
                  className={
                    'shrink-0 px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all ' +
                    (active
                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                      : 'bg-[#0b0d13] text-slate-300 border-amber-500/15 hover:border-amber-500/35 hover:text-white')
                  }
                >
                  {source.quality || source.labelEn || 'Auto'}
                </button>
              );
            })}
          </div>
        )}

        <div className="rounded-2xl overflow-hidden border border-amber-500/25 shadow-2xl shadow-black bg-black">
          <div className="aspect-video w-full bg-black">
            <video
              ref={videoRef}
              key={playbackUrl}
              src={playbackUrl}
              poster={content.backdropUrl || content.posterUrl}
              className="block h-full w-full bg-black object-contain"
              controls
              playsInline
              preload="auto"
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture={false}
              onLoadedMetadata={() => {
                const video = videoRef.current;
                if (video && video.currentTime < 1) {
                  window.setTimeout(() => recoverStartupBuffer(), 120);
                }
              }}
              onWaiting={() => {
                const video = videoRef.current;
                if (video && video.currentTime < 20) {
                  recoverStartupBuffer();
                }
              }}
              onError={() => {
                const currentIndex = availableSources.findIndex(
                  (source) => source.id === playbackSource?.id,
                );
                const fallback = availableSources.find(
                  (source, index) => index > currentIndex,
                );
                if (fallback) setRemotePlaybackSource(fallback);
              }}
            >
              {language === 'ar'
                ? 'المتصفح لا يدعم تشغيل هذا المصدر.'
                : 'Your browser does not support this playback source.'}
            </video>
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
              <span className="font-bold text-amber-400">★ {content.rating.toFixed(1)}</span>
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
                      ? `المصدر الحالي: OmegaTech Akwam — ${playbackSource.quality || playbackSource.label}.`
                      : `Current source: OmegaTech Akwam — ${playbackSource.quality || playbackSource.labelEn}.`)
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

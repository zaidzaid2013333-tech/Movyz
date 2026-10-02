import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Film,
  Info,
  Play,
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

const pickPlaybackSources = (content: Movie | Series, episode?: Episode) => {
  const candidates = episode?.sources ?? (content.type === 'movie' ? content.sources : []);
  return candidates
    .filter(isPlayableHttpSource)
    .sort((a, b) => playbackQualityRank(a) - playbackQualityRank(b));
};

const playbackQualityRank = (source: PlaybackSource) => {
  const match = source.quality?.match(/(\d{3,4})p/i);
  const quality = match ? Number(match[1]) : 9999;
  if (quality === 720) return 0;
  if (quality === 480) return 1;
  if (quality === 1080) return 2;
  return 3;
};

const sortPlaybackSources = (sources: PlaybackSource[]) =>
  [...sources].sort((a, b) => playbackQualityRank(a) - playbackQualityRank(b));

const providerDisplayName = (key: string, fallback: string, language: 'ar' | 'en') => {
  const normalized = key.trim().toLowerCase();
  const names: Record<string, [string, string]> = {
    aflaam: ['أفلام', 'Aflam'],
    cimaclub: ['سيما كلوب', 'CimaClub'],
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const qualityResumeTimeRef = useRef<number | null>(null);
  const resumeAfterQualitySwitchRef = useRef(false);
  const qualitySwitchPendingRef = useRef(false);
  const userPlayRequestedRef = useRef(false);
  const playbackStartedRef = useRef(false);
  const startupWatchTimerRef = useRef<number | null>(null);
  const startupStallTimerRef = useRef<number | null>(null);
  const startupTriedUrlsRef = useRef<Set<string>>(new Set());
  const retriedPlaybackUrlsRef = useRef<Set<string>>(new Set());
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
        userPlayRequestedRef.current = false;
        playbackStartedRef.current = false;
        startupTriedUrlsRef.current.clear();
        if (startupWatchTimerRef.current !== null) {
          window.clearTimeout(startupWatchTimerRef.current);
          startupWatchTimerRef.current = null;
        }
        if (startupStallTimerRef.current !== null) {
          window.clearTimeout(startupStallTimerRef.current);
          startupStallTimerRef.current = null;
        }

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
      .then((response) => {
        if (!mounted) return;
        if (!applyReadySources(response.data.sources)) {
          setResolverLoading(false);
          setPlayerUnlocked(false);
          setPlaybackError(
            language === 'ar'
              ? 'لا يوجد مصدر جاهز لهذه الحلقة حاليًا.'
              : 'No prepared playback source is available for this episode yet.',
          );
        }
      })
      .catch(() => {
        if (!mounted) return;
        setResolverLoading(false);
        setPlayerUnlocked(false);
        setPlaybackError(
          language === 'ar'
            ? 'تعذر الوصول إلى مصادر التشغيل الجاهزة حاليًا.'
            : 'Unable to read the prepared playback sources right now.',
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
    if (typeof document === 'undefined') return;

    const previousRobots = document.head.querySelector('meta[data-movyz-watch-robots]');
    const previousReferrer = document.head.querySelector('meta[data-movyz-watch-referrer]');

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

    const referrer = document.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    referrer.dataset.movyzWatchReferrer = 'true';
    document.head.appendChild(referrer);

    return () => {
      robots.remove();
      googlebot.remove();
      referrer.remove();
      previousRobots?.removeAttribute('data-movyz-watch-robots');
      previousReferrer?.removeAttribute('data-movyz-watch-referrer');
    };
  }, []);

  const handleUnlockPlayer = () => {
    setPlayerUnlocked(true);
  };

  const clearStartupWatch = () => {
    if (startupWatchTimerRef.current !== null) {
      window.clearTimeout(startupWatchTimerRef.current);
      startupWatchTimerRef.current = null;
    }
  };

  const clearStartupStall = () => {
    if (startupStallTimerRef.current !== null) {
      window.clearTimeout(startupStallTimerRef.current);
      startupStallTimerRef.current = null;
    }
  };

  const tryNextStartupSource = () => {
    const video = videoRef.current;
    if (!video || availableSources.length < 2) return false;

    const candidates = availableSources
      .filter((candidate) => candidate.url !== playbackUrl && /^https?:\/\//i.test(candidate.url))
      .filter((candidate) => !startupTriedUrlsRef.current.has(candidate.url))
      .sort((a, b) => startupSourceRank(b) - startupSourceRank(a));

    const next = candidates[0];
    if (!next) return false;

    startupTriedUrlsRef.current.add(next.url);
    qualityResumeTimeRef.current =
      Number.isFinite(video.currentTime) && video.currentTime > 0.5
        ? video.currentTime
        : 0;
    resumeAfterQualitySwitchRef.current = userPlayRequestedRef.current || !video.paused;
    qualitySwitchPendingRef.current = true;
    setPlaybackError(null);
    clearStartupStall();
    rememberPlaybackHost(playbackSource, false);
    setRemotePlaybackSource(next);
    return true;
  };

  useEffect(() => {
    clearStartupWatch();
    if (!playbackUrl || !playerUnlocked || !userPlayRequestedRef.current || !qualitySwitchPendingRef.current) return;

    startupWatchTimerRef.current = window.setTimeout(() => {
      startupWatchTimerRef.current = null;
      const video = videoRef.current;
      if (!video || !qualitySwitchPendingRef.current || video.paused || video.readyState >= 3) return;
      tryNextStartupSource();
    }, 4500);

    return clearStartupWatch;
  }, [playbackUrl, playerUnlocked]);

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
    clearStartupWatch();
    clearStartupStall();
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

    const current = video.getAttribute('src') || '';
    if (current === playbackUrl) return;

    video.pause();
    video.setAttribute('src', playbackUrl);
    video.preload = 'auto';
    video.load();
  }, [playbackUrl, playerUnlocked]);

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

der-t border-amber-500/15">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="text-xs text-amber-400 hover:text-amber-300"
            >
              {language === 'ar' ? 'العودة للرئيسية' : 'Back to home'}
            </button>
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
            <div className="relative h-full w-full bg-black">

              {playbackError ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/75 p-6 text-center">
                  <ErrorState
                    message={playbackError}
                    onRetry={() => {
                      setPlaybackError(null);
                      startupTriedUrlsRef.current.delete(playbackUrl);
                      retriedPlaybackUrlsRef.current.delete(playbackUrl);
                      const video = videoRef.current;
                      if (video) {
                        video.preload = 'auto';
                        video.load();
                      }
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
                controls
                playsInline
                preload="auto"
                controlsList="nodownload noplaybackrate"
                disablePictureInPicture={false}
                onLoadStart={() => {
                  playbackStartedRef.current = false;
                  setPlaybackError(null);
                  if (playbackUrl) startupTriedUrlsRef.current.add(playbackUrl);

                  clearStartupStall();
                  startupStallTimerRef.current = window.setTimeout(() => {
                    startupStallTimerRef.current = null;
                    const video = videoRef.current;
                    if (!video || playbackStartedRef.current || !playbackUrl) return;

                    if (!tryNextStartupSource()) {
                      setPlaybackError(
                        language === 'ar'
                          ? 'المصدر لم يبدأ التشغيل. جرّب مصدرًا آخر.'
                          : 'This source did not start. Try another source.',
                      );
                    }
                  }, 8000);
                }}
                onPlay={() => {
                  userPlayRequestedRef.current = true;
                }}
                onLoadedMetadata={() => {
                  const video = videoRef.current;
                  const resumeTime = qualityResumeTimeRef.current;
                  if (!video || resumeTime === null || !Number.isFinite(video.duration)) return;

                  qualityResumeTimeRef.current = null;
                  try {
                    video.currentTime = Math.min(resumeTime, Math.max(0, video.duration - 0.5));
                  } catch {
                    // Ignore sources that reject a resume seek.
                  }
                }}
                onDurationChange={() => undefined}
                onLoadedData={() => {
                }}
                onCanPlay={() => {
                  clearStartupStall();
                  if (qualitySwitchPendingRef.current) {
                    qualitySwitchPendingRef.current = false;
                    if (resumeAfterQualitySwitchRef.current) {
                      resumeAfterQualitySwitchRef.current = false;
                      const video = videoRef.current;
                      if (video) void video.play().catch(() => undefined);
                    }
                  }
                }}
                onWaiting={() => {
                  clearStartupStall();
                  startupStallTimerRef.current = window.setTimeout(() => {
                    startupStallTimerRef.current = null;
                    if (playbackStartedRef.current) return;
                    if (!tryNextStartupSource()) {
                      setPlaybackError(
                        language === 'ar'
                          ? 'المصدر عالق أثناء البدء. جرّب مصدرًا آخر.'
                          : 'The source is stuck while starting. Try another source.',
                      );
                    }
                  }, 7000);
                }}
                onPlaying={() => {
                  playbackStartedRef.current = true;
                  clearStartupWatch();
                  clearStartupStall();
                  setPlaybackError(null);
                  rememberPlaybackHost(playbackSource, true);
                }}
                onError={() => {
                  const wasPlaying = playbackStartedRef.current;
                  playbackStartedRef.current = false;
                  clearStartupStall();
                  if (!playbackUrl) return;

                  rememberPlaybackHost(playbackSource, false);

                  const video = videoRef.current;
                  if (!video) return;

                  if (wasPlaying) {
                    if (retriedPlaybackUrlsRef.current.has(playbackUrl)) return;
                    retriedPlaybackUrlsRef.current.add(playbackUrl);
                    window.setTimeout(() => {
                      if (videoRef.current !== video) return;
                      video.preload = 'auto';
                      video.load();
                    }, 400);
                    return;
                  }

                  if (tryNextStartupSource()) return;

                  setPlaybackError(
                    language === 'ar'
                      ? 'تعذر تشغيل المصدر الحالي.'
                      : 'The current playback source could not start.',
                  );
                }}
              >
                {playbackUrl ? null : null}
                {language === 'ar'
                  ? 'المتصفح لا يدعم تشغيل هذا المصدر.'
                  : 'Your browser does not support this playback source.'}
              </video>
            </div>
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

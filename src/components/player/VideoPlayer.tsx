import React, { useEffect, useRef, useState } from 'react';
import {
  MediaPlayer,
  MediaProvider,
  isVideoProvider,
} from '@vidstack/react';
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
} from '@vidstack/react/player/layouts/default';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
import { CheckCircle2, Loader2, Settings2, Subtitles } from 'lucide-react';
import { Episode, Season, ContentType } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { MovyzaApi } from '../../services/api';

interface VideoPlayerProps {
  contentId: string;
  contentType: ContentType;
  title: string;
  titleEn: string;
  posterUrl: string;
  backdropUrl: string;
  tmdbId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  currentEpisode?: Episode;
  allSeasons?: Season[];
  onSelectEpisode?: (seasonNum: number, episodeNum: number) => void;
  onNavigateBack: () => void;
}

type PlaybackSource = {
  id: string;
  url: string;
  type: 'hls' | 'mp4' | 'dash';
  quality: string;
  language: string;
  label: string;
  provider: string;
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  contentId,
  title,
  titleEn,
  posterUrl,
  backdropUrl,
  tmdbId,
  contentType,
  seasonNumber,
  episodeNumber,
  currentEpisode,
}) => {
  const { language } = useLanguage();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [streamUrl, setStreamUrl] = useState('');
  const [streamType, setStreamType] = useState<'hls' | 'mp4' | 'dash'>('hls');
  const [availableSources, setAvailableSources] = useState<PlaybackSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fallbackEmbedUrl, setFallbackEmbedUrl] = useState('');
  const [reportMessage, setReportMessage] = useState('');
  const failedSourceIdsRef = useRef<Set<string>>(new Set());
  const progressLoadedRef = useRef(false);
  const lastSavedAtRef = useRef(0);

  const isMovie = contentType === 'movie';
  const safeTmdbId = Number(tmdbId || 0);

  const saveProgress = async (video: HTMLVideoElement, force = false) => {
    const duration = Number.isFinite(video.duration) ? Math.floor(video.duration) : 0;
    const position = Math.floor(video.currentTime || 0);
    if (duration <= 0 || position < 0) return;

    const now = Date.now();
    if (!force && now - lastSavedAtRef.current < 8000) return;
    lastSavedAtRef.current = now;

    try {
      await MovyzaApi.saveWatchProgress({
        contentId,
        contentType,
        title,
        titleEn,
        posterUrl,
        backdropUrl,
        episodeId: currentEpisode?.id,
        seasonNumber,
        episodeNumber,
        positionSeconds: position,
        durationSeconds: duration,
        percentage: Math.min(100, Math.floor((position / duration) * 100)),
        lastWatchedAt: new Date().toISOString(),
        completed: position >= Math.max(0, duration - 10),
      });
    } catch {
      // Progress is best-effort and should never block playback.
    }
  };

  const buildFallbackEmbedUrl = () =>
    isMovie
      ? `https://ezvidapi.com/embed/movie/${safeTmdbId}`
      : `https://ezvidapi.com/embed/tv/${safeTmdbId}/${Number(seasonNumber || 1)}/${Number(episodeNumber || 1)}`;

  const handleSourceChange = (sourceId: string) => {
    const source = availableSources.find((item) => item.id === sourceId);
    if (!source) return;

    failedSourceIdsRef.current.delete(source.id);
    setSelectedSourceId(source.id);
    setStreamType(source.type);
    setStreamUrl(source.url);
    setFallbackEmbedUrl('');
    setError('');
    setLoading(true);
  };

  const handleReportSource = async () => {
    const playbackContentId = isMovie ? contentId : (currentEpisode?.id || contentId);
    if (!selectedSourceId) return;

    try {
      await MovyzaApi.reportIssue({
        contentId: playbackContentId,
        contentType: isMovie ? 'movie' : 'episode',
        contentTitle: isMovie ? title : (currentEpisode?.title || title),
        sourceId: selectedSourceId,
        issueType: 'broken_source',
        description:
          language === 'ar'
            ? 'المصدر الحالي لا يعمل.'
            : 'The selected playback source is not working.',
      });
      setReportMessage(language === 'ar' ? 'تم إرسال البلاغ.' : 'Report sent.');
    } catch {
      setReportMessage(
        language === 'ar'
          ? 'سجّل الدخول أولًا لإرسال البلاغ.'
          : 'Sign in to send a report.',
      );
    }

    setTimeout(() => setReportMessage(''), 3000);
  };

  const switchToNextSourceOrFallback = () => {
    if (availableSources.length > 0 && selectedSourceId) {
      failedSourceIdsRef.current.add(selectedSourceId);

      const nextSource =
        availableSources.find(
          (source) =>
            source.id !== selectedSourceId &&
            !failedSourceIdsRef.current.has(source.id),
        ) ||
        availableSources.find((source) => source.id !== selectedSourceId);

      if (nextSource) {
        setSelectedSourceId(nextSource.id);
        setStreamType(nextSource.type);
        setStreamUrl(nextSource.url);
        setFallbackEmbedUrl('');
        setLoading(true);
        setError('');
        return;
      }
    }

    if (!fallbackEmbedUrl) {
      setFallbackEmbedUrl(buildFallbackEmbedUrl());
      setLoading(true);
      setError('');
      return;
    }

    setLoading(false);
    setError(
      language === 'ar'
        ? 'تعذر تشغيل مصدر الفيديو.'
        : 'The video source could not be played.',
    );
  };

  useEffect(() => {
    let cancelled = false;

    const loadStream = async () => {
      if (!safeTmdbId) {
        setStreamUrl('');
        setStreamType('hls');
        setError(
          language === 'ar'
            ? 'معرّف TMDB غير متاح لهذا العنوان.'
            : 'TMDB id is unavailable for this title.',
        );
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');
      setStreamUrl('');
      setStreamType('hls');
      setAvailableSources([]);
      setSelectedSourceId('');
      setFallbackEmbedUrl('');
      failedSourceIdsRef.current.clear();
      progressLoadedRef.current = false;

      try {
        const playbackContentId = isMovie
          ? contentId
          : (currentEpisode?.id || contentId);

        const response = await MovyzaApi.getPlaybackSources(
          isMovie ? 'movie' : 'episode',
          playbackContentId,
        );

        const normalizedSources: PlaybackSource[] = (response.data || [])
          .filter((source) => source.url)
          .map((source) => ({
            id: source.id,
            url: source.url,
            type: source.type,
            quality: source.quality,
            language: source.language,
            label: source.label || source.provider,
            provider: source.provider,
          }));

        const initialSource =
          normalizedSources.find((source) => source.type === 'hls') ||
          normalizedSources[0];

        if (!initialSource?.url) {
          throw new Error('No playable stream returned');
        }

        if (!cancelled) {
          failedSourceIdsRef.current.clear();
          setAvailableSources(normalizedSources);
          setSelectedSourceId(initialSource.id);
          setStreamType(initialSource.type);
          setStreamUrl(initialSource.url);
        }
      } catch (err) {
        if (!cancelled) {
          setFallbackEmbedUrl(buildFallbackEmbedUrl());
          setLoading(true);
          setError('');
          setAvailableSources([]);
          setSelectedSourceId('');
          console.warn(
            '[ezvidapi] direct resolver failed; falling back to official embed',
            err,
          );
        }
      }
    };

    void loadStream();

    return () => {
      cancelled = true;
    };
  }, [contentId, currentEpisode?.id, episodeNumber, isMovie, language, safeTmdbId, seasonNumber]);

  useEffect(() => {
    progressLoadedRef.current = false;
  }, [streamUrl]);

  const restoreProgress = async () => {
    const video = videoRef.current;
    if (!video || progressLoadedRef.current) return;

    progressLoadedRef.current = true;

    try {
      const result = await MovyzaApi.getWatchProgress(
        contentId,
        currentEpisode?.id,
      );
      const progress = result.data;

      if (
        progress &&
        progress.positionSeconds > 5 &&
        Number.isFinite(video.duration) &&
        progress.positionSeconds < video.duration - 5
      ) {
        video.currentTime = progress.positionSeconds;
      }
    } catch {
      // Guests or expired sessions simply start from the beginning.
    }
  };

  const playerSource =
    streamType === 'hls'
      ? { src: streamUrl, type: 'application/x-mpegurl' }
      : streamType === 'dash'
        ? { src: streamUrl, type: 'application/dash+xml' }
        : { src: streamUrl, type: 'video/mp4' };

  const showPlayer = Boolean(streamUrl && !fallbackEmbedUrl);

  if (!safeTmdbId) {
    return (
      <div className="aspect-video w-full flex items-center justify-center bg-black text-slate-400 text-sm">
        {language === 'ar'
          ? 'معرّف TMDB غير متاح لهذا العنوان.'
          : 'TMDB id is unavailable for this title.'}
      </div>
    );
  }

  return (
    <div className="relative w-full bg-black overflow-visible" dir="rtl">
      <div className="movyza-player-shell relative w-full aspect-video overflow-hidden bg-black">
        {fallbackEmbedUrl ? (
          <iframe
            key={fallbackEmbedUrl}
            src={fallbackEmbedUrl}
            title={isMovie ? title : titleEn || title}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            loading="eager"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(
                language === 'ar'
                  ? 'تعذر تحميل مشغل ezvidapi.'
                  : 'The ezvidapi player could not be loaded.',
              );
            }}
            className="absolute inset-0 w-full h-full border-0 bg-black"
          />
        ) : showPlayer ? (
          <MediaPlayer
            className="movyza-player absolute inset-0 h-full w-full"
            title={isMovie ? title : titleEn || title}
            src={playerSource}
            playsInline
            onProviderSetup={(provider) => {
              if (isVideoProvider(provider)) {
                videoRef.current = provider.video;
              }
            }}
            onCanPlay={() => {
              setLoading(false);
              setError('');
              void restoreProgress();
            }}
            onLoadedMetadata={() => {
              void restoreProgress();
            }}
            onTimeUpdate={() => {
              const video = videoRef.current;
              if (video) void saveProgress(video);
            }}
            onPause={() => {
              const video = videoRef.current;
              if (video) void saveProgress(video, true);
            }}
            onEnded={() => {
              const video = videoRef.current;
              if (video) void saveProgress(video, true);
            }}
            onError={(playbackError) => {
              console.warn('[movyza-player] playback error', playbackError);
              switchToNextSourceOrFallback();
            }}
            onWaiting={() => setLoading(true)}
            onPlaying={() => {
              setLoading(false);
              setError('');
            }}
          >
            <MediaProvider />
            <DefaultVideoLayout
              colorScheme="dark"
              icons={defaultLayoutIcons}
              playbackRates={[0.5, 0.75, 1, 1.25, 1.5, 2]}
              seekStep={10}
              translations={{
                play: language === 'ar' ? 'تشغيل' : 'Play',
                pause: language === 'ar' ? 'إيقاف مؤقت' : 'Pause',
                mute: language === 'ar' ? 'كتم' : 'Mute',
                unmute: language === 'ar' ? 'إلغاء الكتم' : 'Unmute',
                fullscreen: language === 'ar' ? 'ملء الشاشة' : 'Fullscreen',
                settings: language === 'ar' ? 'الإعدادات' : 'Settings',
              }}
            />
          </MediaPlayer>
        ) : (
          <div className="absolute inset-0 bg-black" />
        )}

        {(loading || error) && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/65 pointer-events-none">
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              {loading && !error && (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-amber-300" />
                  <span className="text-xs text-slate-300">
                    {language === 'ar'
                      ? 'جاري تشغيل المصدر…'
                      : 'Loading source…'}
                  </span>
                </>
              )}
              {error && (
                <span className="text-sm text-red-300">{error}</span>
              )}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute top-3 start-3 z-40 flex items-center gap-2">
          <span className="movyza-player-badge rounded-full px-3 py-1 text-[10px] font-semibold text-white backdrop-blur border">
            {fallbackEmbedUrl
              ? 'EZVIDAPI EMBED'
              : `MOVYZA · ${streamType.toUpperCase()}`}
          </span>
          <span className="rounded-full bg-black/65 px-2.5 py-1 text-[10px] text-slate-300 backdrop-blur border border-white/10">
            {language === 'ar' ? 'مشغل Movyza' : 'Movyza Player'}
          </span>
        </div>

        <div className="pointer-events-none absolute bottom-3 end-3 z-40 flex items-center gap-2 rounded-full bg-black/65 backdrop-blur px-3 py-1 text-[10px] text-emerald-300 border border-white/10">
          <CheckCircle2 className="w-3 h-3" />
          <span>
            {fallbackEmbedUrl
              ? 'TMDB ← ezvidapi'
              : `TMDB ← Movyza ← ${availableSources.find((source) => source.id === selectedSourceId)?.provider || 'Source'}`}
          </span>
        </div>
      </div>

      <section
        className="w-full border-t border-white/10 bg-[#0b0d13] p-3 sm:p-4"
        aria-label="إعدادات التشغيل"
      >
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="w-4 h-4 text-amber-300" />
          <div>
            <h3 className="text-sm font-bold text-white">
              {language === 'ar' ? 'إعدادات المشاهدة' : 'Watch settings'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {language === 'ar'
                ? fallbackEmbedUrl
                  ? 'تعذر حل المصدر المباشر، لذلك تم التحويل تلقائيًا إلى مشغل ezvidapi الرسمي.'
                  : 'المصدر يُحل عبر خادم Movyza ثم يُشغّل عبر Player جاهز ومهيأ للموقع.'
                : fallbackEmbedUrl
                  ? 'Direct source resolution failed, so Movyza switched to the official ezvidapi player.'
                  : 'Movyza resolves the source server-side, then plays it through a ready-made player customized for the site.'}
            </p>
          </div>
        </div>

        {availableSources.length > 0 && (
          <div className="mb-3 rounded-2xl border border-amber-400/20 bg-white/[0.03] p-3">
            <label className="mb-2 block text-xs font-bold text-white">
              {language === 'ar' ? 'مصدر التشغيل' : 'Playback source'}
            </label>

            <select
              value={selectedSourceId}
              onChange={(event) => handleSourceChange(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#10131d] px-3 py-2 text-xs text-white outline-none"
            >
              {availableSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {[source.label || source.provider, source.quality, source.language]
                    .filter(Boolean)
                    .join(' · ')}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => {
                void handleReportSource();
              }}
              className="mt-2 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-400/15"
            >
              {language === 'ar'
                ? 'الإبلاغ عن المصدر'
                : 'Report source'}
            </button>

            {reportMessage && (
              <div className="mt-2 text-[11px] text-slate-300">
                {reportMessage}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-white">
              <span>⚡</span>
              {language === 'ar' ? 'المصدر' : 'Source'}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              {language === 'ar'
                ? 'يدعم المشغل الجاهز روابط الفيديو المباشرة التي يعيدها نظام المصادر في Movyza.'
                : 'The ready-made player handles direct video sources returned by Movyza.'}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-white">
              <Subtitles className="w-4 h-4" />
              {language === 'ar' ? 'الترجمة العربية' : 'Arabic subtitles'}
            </div>

            <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2">
              <div className="text-xs font-semibold text-sky-100">
                {language === 'ar'
                  ? 'الترجمة تبقى مرتبطة بالمصدر'
                  : 'Subtitles remain source-dependent'}
              </div>
              <div className="mt-1 text-[10px] text-sky-100/65">
                {language === 'ar'
                  ? 'يمكننا ربط VTT/WebVTT لاحقًا بدون تغيير المشغل الأساسي.'
                  : 'VTT/WebVTT tracks can be wired later without replacing the player.'}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

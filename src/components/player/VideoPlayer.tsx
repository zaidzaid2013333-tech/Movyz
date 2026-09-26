import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MediaPlayer,
  MediaProvider,
  isVideoProvider,
  type MediaPlayerInstance,
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

type StreamType = 'hls' | 'mp4' | 'dash';

type PlaybackSource = {
  id: string;
  url: string;
  type: StreamType;
  quality: string;
  language: string;
  label: string;
  provider: string;
  providerKey?: string;
};

const streamMime: Record<StreamType, string> = {
  hls: 'application/x-mpegurl',
  mp4: 'video/mp4',
  dash: 'application/dash+xml',
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
  const playerRef = useRef<MediaPlayerInstance | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const failedSourceIdsRef = useRef<Set<string>>(new Set());
  const lastSavedAtRef = useRef(0);
  const progressLoadedRef = useRef(false);

  const [sources, setSources] = useState<PlaybackSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [streamUrl, setStreamUrl] = useState('');
  const [streamType, setStreamType] = useState<StreamType>('hls');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fallbackEmbedUrl, setFallbackEmbedUrl] = useState('');
  const [reportMessage, setReportMessage] = useState('');

  const isMovie = contentType === 'movie';
  const safeTmdbId = Number(tmdbId || 0);

  const currentLabel = useMemo(() => {
    const source = sources.find((item) => item.id === selectedSourceId);
    return source ? [source.provider, source.quality, source.type.toUpperCase()].filter(Boolean).join(' · ') : '';
  }, [selectedSourceId, sources]);

  const fallbackUrl = useMemo(() => (
    isMovie
      ? `https://ezvidapi.com/embed/movie/${safeTmdbId}`
      : `https://ezvidapi.com/embed/tv/${safeTmdbId}/${Number(seasonNumber || 1)}/${Number(episodeNumber || 1)}`
  ), [isMovie, safeTmdbId, seasonNumber, episodeNumber]);

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
      // Watch progress is best-effort.
    }
  };

  const restoreProgress = async () => {
    const video = videoRef.current;
    if (!video || progressLoadedRef.current) return;

    progressLoadedRef.current = true;

    try {
      const result = await MovyzaApi.getWatchProgress(contentId, currentEpisode?.id);
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
      // Guests and expired sessions start from the beginning.
    }
  };

  const selectSource = (source: PlaybackSource) => {
    failedSourceIdsRef.current.delete(source.id);
    setSelectedSourceId(source.id);
    setStreamType(source.type);
    setStreamUrl(source.url);
    setFallbackEmbedUrl('');
    setError('');
    setLoading(true);
  };

  const moveToNextSource = () => {
    const current = selectedSourceId;
    if (current) failedSourceIdsRef.current.add(current);

    const next = sources.find(
      (source) => !failedSourceIdsRef.current.has(source.id),
    );

    if (next) {
      selectSource(next);
      return;
    }

    if (!fallbackEmbedUrl) {
      setFallbackEmbedUrl(fallbackUrl);
      setLoading(true);
      setError('');
      return;
    }

    setLoading(false);
    setError(
      language === 'ar'
        ? 'تعذر تشغيل جميع مصادر الفيديو.'
        : 'All playback sources failed.',
    );
  };

  const handleReportSource = async () => {
    if (!selectedSourceId) return;

    try {
      await MovyzaApi.reportIssue({
        contentId: isMovie ? contentId : (currentEpisode?.id || contentId),
        contentType: isMovie ? 'movie' : 'episode',
        contentTitle: isMovie ? title : (currentEpisode?.title || title),
        sourceId: selectedSourceId,
        issueType: 'broken_source',
        description: language === 'ar'
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

    window.setTimeout(() => setReportMessage(''), 3000);
  };

  useEffect(() => {
    let cancelled = false;

    const loadSources = async () => {
      if (!safeTmdbId) {
        setLoading(false);
        setError(
          language === 'ar'
            ? 'معرّف TMDB غير متاح لهذا العنوان.'
            : 'TMDB id is unavailable for this title.',
        );
        return;
      }

      setLoading(true);
      setError('');
      setSources([]);
      setSelectedSourceId('');
      setStreamUrl('');
      setFallbackEmbedUrl('');
      setStreamType('hls');
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

        const normalized: PlaybackSource[] = (response.data || [])
          .filter((source) => Boolean(source.url))
          .map((source, index) => ({
            id:
              source.id ||
              `${source.providerKey || source.provider || 'source'}-${source.type}-${index}`,
            url: source.url,
            type: source.type,
            quality: source.quality || 'auto',
            language: source.language || 'und',
            label: source.label || source.provider || 'Source',
            provider: source.provider || 'Provider',
            providerKey: source.providerKey,
          }));

        if (!normalized.length) {
          throw new Error('No playable stream returned');
        }

        const initial =
          normalized.find((source) => source.type === 'hls') ||
          normalized.find((source) => source.type === 'dash') ||
          normalized[0];

        if (!cancelled) {
          setSources(normalized);
          setSelectedSourceId(initial.id);
          setStreamType(initial.type);
          setStreamUrl(initial.url);
        }
      } catch (loadError) {
        if (cancelled) return;

        console.warn('[movyza-player] direct playback unavailable', loadError);
        setSources([]);
        setSelectedSourceId('');
        setStreamUrl('');
        setFallbackEmbedUrl(fallbackUrl);
        setLoading(true);
        setError('');
      }
    };

    void loadSources();

    return () => {
      cancelled = true;
    };
  }, [
    contentId,
    currentEpisode?.id,
    isMovie,
    language,
    safeTmdbId,
    seasonNumber,
    episodeNumber,
    fallbackUrl,
  ]);

  useEffect(() => {
    progressLoadedRef.current = false;
  }, [streamUrl]);

  const playerSource = streamUrl
    ? { src: streamUrl, type: streamMime[streamType] }
    : undefined;

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
    <div className="movyza-player-root relative w-full bg-black" dir="rtl">
      <div className="movyza-player-shell relative aspect-video w-full overflow-hidden bg-black">
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
            className="absolute inset-0 h-full w-full border-0 bg-black"
          />
        ) : playerSource ? (
          <MediaPlayer
            ref={playerRef}
            className="movyza-player absolute inset-0 h-full w-full"
            title={isMovie ? title : titleEn || title}
            src={playerSource}
            playsInline
            crossorigin="anonymous"
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
              console.warn('[movyza-player] source error', playbackError);
              moveToNextSource();
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
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 pointer-events-none">
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              {loading && !error && (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-amber-300" />
                  <span className="text-xs text-slate-300">
                    {language === 'ar' ? 'جاري تشغيل المصدر…' : 'Loading source…'}
                  </span>
                </>
              )}
              {error && (
                <span className="text-sm text-red-300">{error}</span>
              )}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute start-3 top-3 z-40 flex items-center gap-2">
          <span className="movyza-player-badge rounded-full px-3 py-1 text-[10px] font-semibold text-white backdrop-blur border">
            {fallbackEmbedUrl
              ? 'EZVIDAPI FALLBACK'
              : `MOVYZA · ${streamType.toUpperCase()}`}
          </span>
          <span className="rounded-full border border-white/10 bg-black/65 px-2.5 py-1 text-[10px] text-slate-300 backdrop-blur">
            {language === 'ar' ? 'مشغل Movyza' : 'Movyza Player'}
          </span>
        </div>

        <div className="pointer-events-none absolute bottom-3 end-3 z-40 flex items-center gap-2 rounded-full border border-white/10 bg-black/65 px-3 py-1 text-[10px] text-emerald-300 backdrop-blur">
          <CheckCircle2 className="h-3 w-3" />
          <span>
            {fallbackEmbedUrl
              ? 'Movyza → ezvidapi'
              : currentLabel || 'Movyza → direct stream'}
          </span>
        </div>
      </div>

      <section className="w-full border-t border-white/10 bg-[#0b0d13] p-3 sm:p-4" aria-label="إعدادات التشغيل">
        <div className="mb-3 flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-amber-300" />
          <div>
            <h3 className="text-sm font-bold text-white">
              {language === 'ar' ? 'مشغل Movyza' : 'Movyza Player'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {fallbackEmbedUrl
                ? language === 'ar'
                  ? 'لم يرجع الـAPI رابطًا خامًا حاليًا، لذلك استُخدم مشغل ezvidapi الرسمي كاحتياط.'
                  : 'The API did not return a raw stream, so the official ezvidapi embed is used as a fallback.'
                : language === 'ar'
                  ? 'الرابط يأتي من API تاع Movyza ويتشغل مباشرة داخل Player الجاهز.'
                  : 'Movyza API returns the source URL and the ready-made player plays it directly.'}
            </p>
          </div>
        </div>

        {sources.length > 0 && (
          <div className="mb-3 rounded-2xl border border-amber-400/20 bg-white/[0.03] p-3">
            <label className="mb-2 block text-xs font-bold text-white">
              {language === 'ar' ? 'مصدر التشغيل' : 'Playback source'}
            </label>

            <select
              value={selectedSourceId}
              onChange={(event) => {
                const next = sources.find((source) => source.id === event.target.value);
                if (next) selectSource(next);
              }}
              className="w-full rounded-xl border border-white/10 bg-[#10131d] px-3 py-2 text-xs text-white outline-none"
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {[source.label, source.quality, source.type.toUpperCase(), source.language !== 'und' ? source.language : '']
                    .filter(Boolean)
                    .join(' · ')}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void handleReportSource()}
              className="mt-2 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-400/15"
            >
              {language === 'ar' ? 'الإبلاغ عن المصدر' : 'Report source'}
            </button>

            {reportMessage && (
              <div className="mt-2 text-[11px] text-slate-300">{reportMessage}</div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-white">
              <span>⚡</span>
              {language === 'ar' ? 'تشغيل خام' : 'Raw playback'}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              {language === 'ar'
                ? 'HLS وMP4 وDASH كلها تدخل للمشغل بنفس واجهة Movyza.'
                : 'HLS, MP4, and DASH sources use the same Movyza player UI.'}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-white">
              <Subtitles className="h-4 w-4" />
              {language === 'ar' ? 'الترجمة' : 'Subtitles'}
            </div>
            <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2">
              <div className="text-xs font-semibold text-sky-100">
                {language === 'ar' ? 'جاهزة للمسارات المضافة' : 'Ready for external tracks'}
              </div>
              <div className="mt-1 text-[10px] text-sky-100/65">
                {language === 'ar'
                  ? 'يمكن ربط WebVTT بدون تغيير المشغل الأساسي.'
                  : 'WebVTT tracks can be added without replacing the player.'}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

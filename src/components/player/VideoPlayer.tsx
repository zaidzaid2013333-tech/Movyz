import React, { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useLanguage } from '../../context/LanguageContext';
import { MovyzaApi } from '../../services/api';

interface VideoPlayerProps {
  contentId: string;
  contentType: 'movie' | 'series';
  title: string;
  titleEn: string;
  posterUrl: string;
  backdropUrl: string;
  tmdbId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  currentEpisode?: {
    id?: string;
    title?: string;
    titleEn?: string;
  };
  allSeasons?: unknown[];
  onSelectEpisode?: (seasonNum: number, episodeNum: number) => void;
  onNavigateBack: () => void;
}

type SubtitleTrack = {
  url: string;
  type?: string;
  language?: string;
  label?: string;
  labelEn?: string;
  default?: boolean;
};

type PlaybackSource = {
  id?: string;
  url?: string;
  type?: string;
  quality?: string;
  language?: string;
  label?: string;
  labelEn?: string;
  provider?: string;
  providerKey?: string;
  iframeUrl?: string;
  subtitleTracks?: SubtitleTrack[];
};

const MAX_VISIBLE_SOURCES = 4;
const MEDIA_LOAD_TIMEOUT_MS = 45_000;

const getConnectionHintOrigin = (value?: string) => {
  try {
    return value ? new URL(value).origin : '';
  } catch {
    return '';
  }
};

const normalizeSourceType = (value?: string) => String(value || '').trim().toLowerCase();

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  contentType,
  title,
  titleEn,
  tmdbId,
  seasonNumber,
  episodeNumber,
  currentEpisode,
}) => {
  const { language } = useLanguage();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [sources, setSources] = useState<PlaybackSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  const isMovie = contentType === 'movie';
  const displayTitle = isMovie
    ? (titleEn || title)
    : (currentEpisode?.titleEn || currentEpisode?.title || titleEn || title);

  const activeSource = useMemo(
    () => sources.find((source) => String(source.id) === selectedSourceId) || sources[0] || null,
    [selectedSourceId, sources],
  );

  useEffect(() => {
    let cancelled = false;

    const loadWatchSources = async () => {
      if (!Number.isFinite(Number(tmdbId)) || Number(tmdbId) <= 0) {
        setLoading(false);
        setError(language === 'ar' ? 'معرّف TMDB غير متاح.' : 'TMDB id is unavailable.');
        return;
      }

      setLoading(true);
      setError('');
      setSources([]);
      setSelectedSourceId('');

      try {
        const response = await MovyzaApi.getWatchSources(
          Number(tmdbId),
          isMovie ? 'movie' : 'series',
          seasonNumber,
          episodeNumber,
        );

        const rawSources = Array.isArray(response?.data)
          ? (response.data as PlaybackSource[])
          : [];

        const resolvedSources = rawSources
          .map((source, index) => ({
            ...source,
            id: String(source.id || `watch-source-${index + 1}`),
            url: String(source.url || '').trim(),
            type: normalizeSourceType(source.type || 'mp4'),
            iframeUrl: String(source.iframeUrl || '').trim(),
          }))
          .filter((source) => /^https:\/\//i.test(String(source.url || source.iframeUrl || '')))
          .slice(0, MAX_VISIBLE_SOURCES);

        if (!resolvedSources.length) {
          throw new Error('Watch API returned no usable playback sources.');
        }

        if (!cancelled) {
          setSources(resolvedSources);
          const mobile =
            typeof window !== 'undefined' &&
            window.matchMedia('(max-width: 767px)').matches;
          const preferredSource = mobile
            ? resolvedSources.find((source) => String(source.quality || '').toLowerCase() === '720p') ||
              resolvedSources.find((source) => String(source.quality || '').toLowerCase() === '576p') ||
              resolvedSources[0]
            : resolvedSources[0];
          setSelectedSourceId(String(preferredSource.id));
          setLoading(true);
        }
      } catch (loadError) {
        if (cancelled) return;

        console.error('[movyza-player] watch sources unavailable', loadError);
        setLoading(false);
        setError(
          language === 'ar'
            ? 'تعذر الحصول على مصدر تشغيل صالح حاليًا.'
            : 'Unable to get a playable source right now.',
        );
      }
    };

    void loadWatchSources();

    return () => {
      cancelled = true;
    };
  }, [episodeNumber, isMovie, language, retryNonce, seasonNumber, tmdbId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeSource) return;

    const sourceType = normalizeSourceType(activeSource.type);
    const mediaUrl = String(activeSource.url || '').trim();
    const iframeUrl = String(activeSource.iframeUrl || '').trim();
    const isWeb = sourceType === 'web' || Boolean(iframeUrl && !mediaUrl);

    let hls: Hls | null = null;
    let timeoutId: number | undefined;

    setError('');
    setLoading(true);

    const markReady = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      setLoading(false);
    };

    const fail = () => {
      setLoading(false);
      setError(
        language === 'ar'
          ? 'تعذر تشغيل هذا المصدر. جرّب سيرفرًا آخر.'
          : 'This source could not be played. Try another server.',
      );
    };

    if (isWeb) {
      return;
    }

    if (!/^https:\/\//i.test(mediaUrl)) {
      setLoading(false);
      setError(
        language === 'ar'
          ? 'رابط التشغيل غير صالح.'
          : 'The playback URL is invalid.',
      );
      return;
    }

    if (sourceType === 'hls') {
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          capLevelToPlayerSize: true,
          startFragPrefetch: true,
          maxBufferLength: 12,
          maxMaxBufferLength: 24,
          backBufferLength: 10,
        });
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          hls?.loadSource(mediaUrl);
        });
        hls.on(Hls.Events.MANIFEST_PARSED, markReady);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data?.fatal) fail();
        });
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = mediaUrl;
        video.addEventListener('loadedmetadata', markReady, { once: true });
        video.load();
      } else {
        fail();
      }
    } else if (sourceType === 'dash') {
      fail();
    } else {
      video.src = mediaUrl;
      video.addEventListener('loadedmetadata', markReady, { once: true });
      video.addEventListener('canplay', markReady, { once: true });
      video.load();
    }

    timeoutId = window.setTimeout(() => {
      if (loading) {
        setLoading(false);
        setError(
          language === 'ar'
            ? 'مصدر التشغيل لم يستجب ضمن الوقت المتوقع.'
            : 'The selected source did not respond in time.',
        );
      }
    }, MEDIA_LOAD_TIMEOUT_MS);

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      video.pause();
      video.removeAttribute('src');
      video.load();
      hls?.destroy();
    };
  }, [activeSource?.id, activeSource?.type, activeSource?.url, language]);

  const handleSourceSelect = (source: PlaybackSource) => {
    setError('');
    setSelectedSourceId(String(source.id));
  };

  const activeType = normalizeSourceType(activeSource?.type);
  const activeIframe = String(activeSource?.iframeUrl || '').trim();
  const showIframe = activeType === 'web' && /^https:\/\//i.test(activeIframe);
  const connectionHintOrigin = getConnectionHintOrigin(
    showIframe ? activeIframe : String(activeSource?.url || '').trim(),
  );

  if (error && !sources.length) {
    return (
      <div className="relative w-full bg-black">
        <div className="flex min-h-48 items-center justify-center px-6 py-10 text-center">
          <div className="max-w-lg">
            <p className="text-sm text-slate-300">{error}</p>
            <button
              type="button"
              className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15"
              onClick={() => setRetryNonce((value) => value + 1)}
            >
              {language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-black">
      {connectionHintOrigin && (
        <>
          <link rel="dns-prefetch" href={connectionHintOrigin} />
          <link rel="preconnect" href={connectionHintOrigin} />
        </>
      )}
      {sources.length > 0 && (
        <div className="border-b border-white/10 bg-[#080a0f] px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-400">
              {language === 'ar' ? 'سيرفر التشغيل' : 'Playback server'}
            </span>

            <div className="flex flex-wrap gap-2">
              {sources.map((source, index) => {
                const active = String(source.id) === String(activeSource?.id);
                const label = language === 'ar'
                  ? (source.label || source.provider || `سيرفر ${index + 1}`)
                  : (source.labelEn || source.provider || `Server ${index + 1}`);
                const quality =
                  source.quality && source.quality.toLowerCase() !== 'auto'
                    ? ` · ${source.quality}`
                    : '';

                return (
                  <button
                    key={String(source.id)}
                    type="button"
                    onClick={() => handleSourceSelect(source)}
                    className={
                      active
                        ? 'rounded-lg border border-amber-400/60 bg-amber-400/15 px-3 py-1.5 text-[11px] font-bold text-amber-300'
                        : 'rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white'
                    }
                  >
                    {label}{quality}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {showIframe ? (
          <>
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black text-sm text-slate-300">
                {language === 'ar' ? 'جارٍ تحميل المشغل…' : 'Loading player…'}
              </div>
            )}
            <iframe
              key={activeIframe}
              src={activeIframe}
              title={displayTitle}
              className="absolute inset-0 h-full w-full border-0 bg-black"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              loading="eager"
              referrerPolicy="no-referrer"
              onLoad={() => setLoading(false)}
            />
          </>
        ) : (
          <>
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black text-sm text-slate-300">
                {language === 'ar' ? 'جارٍ تحميل المشغل…' : 'Loading player…'}
              </div>
            )}
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full bg-black"
              controls
              playsInline
              preload="metadata"
              poster=""
              onLoadedMetadata={() => setLoading(false)}
              onCanPlay={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError(
                  language === 'ar'
                    ? 'تعذر تشغيل الفيديو من هذا السيرفر.'
                    : 'The video could not be played from this server.',
                );
              }}
            >
              {(activeSource?.subtitleTracks || []).map((track, index) => (
                <track
                  key={`${track.url}-${index}`}
                  kind="subtitles"
                  src={track.url}
                  srcLang={track.language || 'und'}
                  label={language === 'ar' ? (track.label || track.labelEn || 'Subtitles') : (track.labelEn || track.label || 'Subtitles')}
                  default={track.default === true}
                />
              ))}
            </video>
          </>
        )}
      </div>

      {error && sources.length > 0 && (
        <div className="border-t border-white/10 bg-[#080a0f] px-4 py-3 text-center text-xs text-slate-300">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15"
            onClick={() => setRetryNonce((value) => value + 1)}
          >
            {language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}
    </div>
  );
};

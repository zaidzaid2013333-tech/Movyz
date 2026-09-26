import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
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
  const hlsRef = useRef<Hls | null>(null);
  const [streamUrl, setStreamUrl] = useState('');
  const [streamType, setStreamType] = useState<'hls' | 'mp4' | 'dash'>('hls');
  const [availableSources, setAvailableSources] = useState<Array<{ id: string; url: string; type: 'hls' | 'mp4' | 'dash'; quality: string; language: string; label: string; provider: string }>>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fallbackEmbedUrl, setFallbackEmbedUrl] = useState('');
  const [reportMessage, setReportMessage] = useState('');
  const failedSourceIdsRef = useRef<Set<string>>(new Set());
  const progressLoadedRef = useRef(false);
  const lastSavedAtRef = useRef(0);
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

  const isMovie = contentType === 'movie';
  const safeTmdbId = Number(tmdbId || 0);

  const handleSourceChange = (sourceId: string) => {
    const source = availableSources.find((item) => item.id === sourceId);
    if (!source) return;
    setSelectedSourceId(source.id);
    setStreamType(source.type);
    setStreamUrl(source.url);
    failedSourceIdsRef.current.delete(source.id);
    setError('');
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
        description: language === 'ar' ? 'المصدر الحالي لا يعمل.' : 'The selected playback source is not working.',
      });
      setReportMessage(language === 'ar' ? 'تم إرسال البلاغ.' : 'Report sent.');
    } catch {
      setReportMessage(language === 'ar' ? 'سجّل الدخول أولًا لإرسال البلاغ.' : 'Sign in to send a report.');
    }
    setTimeout(() => setReportMessage(''), 3000);
  };


  useEffect(() => {
    let cancelled = false;

    const loadStream = async () => {
if (!safeTmdbId) {
        setStreamUrl('');
      setStreamType('hls');
        setError(language === 'ar' ? 'معرّف TMDB غير متاح لهذا العنوان.' : 'TMDB id is unavailable for this title.');
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
        const playbackContentId = isMovie ? contentId : (currentEpisode?.id || contentId);
        const response = await MovyzaApi.getPlaybackSources(isMovie ? 'movie' : 'episode', playbackContentId);
        const normalizedSources = (response.data || []).filter((source) => source.url).map((source) => ({
          id: source.id,
          url: source.url,
          type: source.type,
          quality: source.quality,
          language: source.language,
          label: source.label || source.provider,
          provider: source.provider,
        }));
        const initialSource = normalizedSources.find((source) => source.type === 'hls') || normalizedSources[0];

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
          const fallbackUrl = isMovie
            ? `https://ezvidapi.com/embed/movie/${safeTmdbId}`
            : `https://ezvidapi.com/embed/tv/${safeTmdbId}/${Number(seasonNumber || 1)}/${Number(episodeNumber || 1)}`;

          setFallbackEmbedUrl(fallbackUrl);
          setLoading(true);
          setError('');
          setAvailableSources([]);
          setSelectedSourceId('');
          console.warn('[ezvidapi] direct HLS resolver failed; falling back to official embed', err);
        }
      }
    };

    void loadStream();

    return () => {
      cancelled = true;
    };
  }, [episodeNumber, isMovie, language, safeTmdbId, seasonNumber]);

  useEffect(() => {
    const video = videoRef.current;
    if (fallbackEmbedUrl || !video || !streamUrl) return;

    setLoading(true);
    setError('');

    hlsRef.current?.destroy();
    hlsRef.current = null;

    const handleCanPlay = () => setLoading(false);
    const restoreProgress = async () => {
      if (progressLoadedRef.current) return;
      progressLoadedRef.current = true;
      try {
        const result = await MovyzaApi.getWatchProgress(contentId, currentEpisode?.id);
        const progress = result.data;
        if (progress && progress.positionSeconds > 5 && Number.isFinite(video.duration) && progress.positionSeconds < video.duration - 5) {
          video.currentTime = progress.positionSeconds;
        }
      } catch {
        // Guests or expired sessions simply start from the beginning.
      }
    };
    const handleTimeUpdate = () => { void saveProgress(video); };
    const handlePause = () => { void saveProgress(video, true); };
    const handleEnded = () => { void saveProgress(video, true); };
    const handleSourceError = () => {
      setLoading(false);
      handlePlaybackFailure();
    };
    const handlePlaybackFailure = () => {
      if (availableSources.length <= 1) {
        setLoading(false);
        setError(language === 'ar' ? 'تعذر تشغيل مصدر الفيديو.' : 'The video source could not be played.');
        return;
      }

      failedSourceIdsRef.current.add(selectedSourceId);
      const nextSource =
        availableSources.find((source) => source.id !== selectedSourceId && !failedSourceIdsRef.current.has(source.id)) ||
        availableSources.find((source) => source.id !== selectedSourceId);

      if (!nextSource) {
        setLoading(false);
        setError(language === 'ar' ? 'تعذر تشغيل جميع المصادر المتاحة.' : 'All available playback sources failed.');
        return;
      }

      setLoading(true);
      setError('');
      setSelectedSourceId(nextSource.id);
      setStreamType(nextSource.type);
      setStreamUrl(nextSource.url);
    };

    const handleError = () => {
      setLoading(false);
      setError(language === 'ar' ? 'تعذر تشغيل مصدر الفيديو.' : 'The video source could not be played.');
    };

    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('loadedmetadata', () => { void restoreProgress(); });
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handlePlaybackFailure);

    if (streamType === 'mp4') {
      video.src = streamUrl;
      video.load();
    } else if (streamType === 'dash') {
      setLoading(false);
      handlePlaybackFailure();
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });

      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => setLoading(false));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          handlePlaybackFailure();
        }
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.load();
    } else {
      setLoading(false);
      setError(language === 'ar' ? 'هذا الجهاز لا يدعم تشغيل HLS.' : 'This device does not support HLS playback.');
    }

    return () => {
      void saveProgress(video, true);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handlePlaybackFailure);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [fallbackEmbedUrl, language, streamUrl, streamType, contentId, currentEpisode?.id]);

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

      <div className="relative w-full aspect-video overflow-hidden bg-black">
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
            className="absolute inset-0 w-full h-full border-0 bg-black"
          />
        ) : (
          <video
            ref={videoRef}
            controls
            playsInline
            preload="metadata"
            poster={posterUrl || undefined}
            className="absolute inset-0 w-full h-full bg-black object-contain"
            aria-label={isMovie ? title : titleEn || title}
          />
        )}

        {(loading || error) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
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
                <>
                  <span className="text-sm text-red-300">{error}</span>
                </>
              )}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute top-3 start-3 z-20 flex items-center gap-2">
          <span className="rounded-full bg-black/70 backdrop-blur px-3 py-1 text-[10px] font-semibold text-white border border-white/10">
            {fallbackEmbedUrl ? 'ezvidapi EMBED' : `Movyza ${streamType.toUpperCase()} · ${availableSources.find((source) => source.id === selectedSourceId)?.provider || 'Source'}`}
          </span>
          <span className="rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[10px] text-slate-300 border border-white/10">
            مشغل Movyza
          </span>
        </div>

        <div className="pointer-events-none absolute bottom-3 end-3 z-20 flex items-center gap-2 rounded-full bg-black/60 backdrop-blur px-3 py-1 text-[10px] text-emerald-300 border border-white/10">
          <CheckCircle2 className="w-3 h-3" />
          <span>{fallbackEmbedUrl ? 'TMDB ← ezvidapi embed' : 'TMDB ← Movyza'}</span>
        </div>
      </div>

      <section className="w-full border-t border-white/10 bg-[#0b0d13] p-3 sm:p-4" aria-label="إعدادات التشغيل">
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="w-4 h-4 text-amber-300" />
          <div>
            <h3 className="text-sm font-bold text-white">
              {language === 'ar' ? 'إعدادات المشاهدة' : 'Watch settings'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {language === 'ar'
                ? (fallbackEmbedUrl
                    ? 'تعذر حل HLS المباشر مؤقتًا، لذلك تم التحويل تلقائيًا إلى مشغل ezvidapi الرسمي.'
                    : 'يتم حل مصدر التشغيل من خادم Movyza وتشغيل المصدر المختار داخل المشغل.')
                : (fallbackEmbedUrl
                    ? 'Direct HLS resolution failed temporarily, so Movyza switched to the official ezvidapi player.'
                    : 'Movyza resolves the playback source server-side, then plays the selected source locally.')}
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
                  {[source.label || source.provider, source.quality, source.language].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => { void handleReportSource(); }}
              className="mt-2 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-400/15"
            >
              {language === 'ar' ? 'الإبلاغ عن المصدر' : 'Report source'}
            </button>
            {reportMessage && <div className="mt-2 text-[11px] text-slate-300">{reportMessage}</div>}
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
                ? 'تظهر هنا المصادر التي أعادها نظام التشغيل في Movyza ويمكن تبديلها مباشرة.'
                : 'Available playback sources are returned by Movyza and can be switched directly.'}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-white">
              <Subtitles className="w-4 h-4" />
              {language === 'ar' ? 'الترجمة العربية' : 'Arabic subtitles'}
            </div>
            <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2">
              <div className="text-xs font-semibold text-sky-100">
                {language === 'ar' ? 'الترجمة تظل مرتبطة بالمصدر' : 'Subtitles remain source-dependent'}
              </div>
              <div className="mt-1 text-[10px] text-sky-100/65">
                {language === 'ar'
                  ? 'سنثبت مسار العربية بعد التأكد من أول تشغيل HLS بنجاح.'
                  : 'Arabic subtitle wiring can be added once HLS playback is confirmed.'}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

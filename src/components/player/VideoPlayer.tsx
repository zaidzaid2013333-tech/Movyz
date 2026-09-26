import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { CheckCircle2, Loader2, Settings2, Subtitles } from 'lucide-react';
import { Episode, Season, ContentType } from '../../types';
import { useLanguage } from '../../context/LanguageContext';

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

const EZVIDAPI_API_ORIGIN = 'https://api.ezvidapi.com';

type EzvidApiResponse = {
  stream_url?: string;
  url?: string;
  hls?: string;
  streamUrl?: string;
  data?: {
    stream_url?: string;
    url?: string;
    hls?: string;
    streamUrl?: string;
  };
};

function extractStreamUrl(payload: EzvidApiResponse) {
  return payload.stream_url
    || payload.streamUrl
    || payload.url
    || payload.hls
    || payload.data?.stream_url
    || payload.data?.streamUrl
    || payload.data?.url
    || payload.data?.hls
    || '';
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  title,
  titleEn,
  posterUrl,
  tmdbId,
  contentType,
  seasonNumber,
  episodeNumber,
}) => {
  const { language } = useLanguage();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [streamUrl, setStreamUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const isMovie = contentType === 'movie';
  const safeTmdbId = Number(tmdbId || 0);

  useEffect(() => {
    let cancelled = false;

    const loadStream = async () => {
      if (!safeTmdbId) {
        setStreamUrl('');
        setError(language === 'ar' ? 'معرّف TMDB غير متاح لهذا العنوان.' : 'TMDB id is unavailable for this title.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');
      setStreamUrl('');

      try {
        const url = isMovie
          ? `${EZVIDAPI_API_ORIGIN}/movie/vidsrc/${safeTmdbId}`
          : `${EZVIDAPI_API_ORIGIN}/tv/vidsrc/${safeTmdbId}?season=${Number(seasonNumber || 1)}&episode=${Number(episodeNumber || 1)}`;

        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`ezvidapi HTTP ${response.status}`);
        }

        const payload = await response.json() as EzvidApiResponse;
        const resolvedUrl = extractStreamUrl(payload);

        if (!resolvedUrl) {
          throw new Error('No HLS stream returned');
        }

        if (!cancelled) setStreamUrl(resolvedUrl);
      } catch (err) {
        if (!cancelled) {
          setLoading(false);
          setError(
            language === 'ar'
              ? 'تعذر الحصول على رابط الفيديو من ezvidapi حاليًا.'
              : 'ezvidapi did not return a playable video stream.'
          );
          console.error('[ezvidapi]', err);
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
    if (!video || !streamUrl) return;

    setLoading(true);
    setError('');

    hlsRef.current?.destroy();
    hlsRef.current = null;

    const handleCanPlay = () => setLoading(false);
    const handleError = () => {
      setLoading(false);
      setError(language === 'ar' ? 'تعذر تشغيل مصدر الفيديو.' : 'The video source could not be played.');
    };

    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });

      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => setLoading(false));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setLoading(false);
          setError(language === 'ar' ? 'تعذر تشغيل مصدر الفيديو.' : 'The video source could not be played.');
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
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [language, streamUrl]);

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
      <link rel="preconnect" href={EZVIDAPI_API_ORIGIN} />
      <link rel="dns-prefetch" href={EZVIDAPI_API_ORIGIN} />

      <div className="relative w-full aspect-video overflow-hidden bg-black">
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          poster={posterUrl || undefined}
          className="absolute inset-0 w-full h-full bg-black object-contain"
          aria-label={isMovie ? title : titleEn || title}
        />

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
            ezvidapi HLS
          </span>
          <span className="rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[10px] text-slate-300 border border-white/10">
            مشغل Movyza
          </span>
        </div>

        <div className="pointer-events-none absolute bottom-3 end-3 z-20 flex items-center gap-2 rounded-full bg-black/60 backdrop-blur px-3 py-1 text-[10px] text-emerald-300 border border-white/10">
          <CheckCircle2 className="w-3 h-3" />
          <span>TMDB ← ezvidapi</span>
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
                ? 'يتم جلب رابط HLS مباشر من ezvidapi وتشغيله داخل مشغل Movyza.'
                : 'Movyza fetches a direct HLS stream from ezvidapi and plays it locally.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-white">
              <span>⚡</span>
              {language === 'ar' ? 'المصدر' : 'Source'}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              {language === 'ar'
                ? 'الإصدار الحالي يستخدم vidsrc داخل ezvidapi كمصدر HLS.'
                : 'The current integration uses vidsrc through ezvidapi for HLS playback.'}
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

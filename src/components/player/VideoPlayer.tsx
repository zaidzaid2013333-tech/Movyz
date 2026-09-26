import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Settings2, Subtitles } from 'lucide-react';
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

const EZVIDAPI_ORIGIN = 'https://ezvidapi.com';

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  contentType,
  title,
  titleEn,
  tmdbId,
  seasonNumber,
  episodeNumber,
}) => {
  const { language } = useLanguage();
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const isMovie = contentType === 'movie';
  const safeTmdbId = Number(tmdbId || 0);

  const embedUrl = useMemo(() => {
    if (!safeTmdbId) return '';

    return isMovie
      ? `${EZVIDAPI_ORIGIN}/embed/movie/${safeTmdbId}?provider=vidsrc&autoplay=true`
      : `${EZVIDAPI_ORIGIN}/embed/tv/${safeTmdbId}/${Number(seasonNumber || 1)}/${Number(episodeNumber || 1)}?provider=vidsrc&autoplay=true`;
  }, [episodeNumber, isMovie, safeTmdbId, seasonNumber]);

  useEffect(() => {
    setIframeLoaded(false);
  }, [embedUrl]);

  if (!embedUrl) {
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
      <link rel="preconnect" href={EZVIDAPI_ORIGIN} />
      <link rel="dns-prefetch" href={EZVIDAPI_ORIGIN} />

      <div className="relative w-full aspect-video overflow-hidden">
        {!iframeLoaded && (
          <div className="absolute inset-0 z-[1] flex items-center justify-center bg-black" aria-hidden="true">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-amber-300" />
              <span className="text-xs">
                {language === 'ar' ? 'جاري تشغيل المصدر…' : 'Loading source…'}
              </span>
            </div>
          </div>
        )}

        <iframe
          key={embedUrl}
          src={embedUrl}
          title={isMovie ? title : titleEn || title}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="eager"
          onLoad={() => setIframeLoaded(true)}
          className="absolute inset-0 w-full h-full border-0 bg-black"
        />

        <div className="pointer-events-none absolute top-3 start-3 z-10 flex items-center gap-2">
          <span className="rounded-full bg-black/70 backdrop-blur px-3 py-1 text-[10px] font-semibold text-white border border-white/10">
            ezvidapi
          </span>
          <span className="rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[10px] text-slate-300 border border-white/10">
            مشغل خارجي
          </span>
        </div>

        <div className="pointer-events-none absolute bottom-3 end-3 z-10 flex items-center gap-2 rounded-full bg-black/60 backdrop-blur px-3 py-1 text-[10px] text-emerald-300 border border-white/10">
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
                ? 'ezvidapi يوفّر مشغلًا خارجيًا؛ توفر الفيديو يعتمد على المصدر.'
                : 'ezvidapi provides an external player; video availability depends on the source.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-white">
              <span>⚡</span>
              {language === 'ar' ? 'المصادر' : 'Sources'}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              {language === 'ar'
                ? 'يعتمد توفر التشغيل على الفيلم أو الحلقة والمصادر التي يوفّرها ezvidapi.'
                : 'Playback availability depends on the title and the provider servers.'}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-white">
              <Subtitles className="w-4 h-4" />
              {language === 'ar' ? 'الترجمة العربية' : 'Arabic subtitles'}
            </div>
            <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2">
              <div className="text-xs font-semibold text-sky-100">
                {language === 'ar' ? 'العربية ضمن اللغات المدعومة' : 'Arabic is supported'}
              </div>
              <div className="mt-1 text-[10px] text-sky-100/65">
                {language === 'ar'
                  ? 'اختيار مسار العربية يتم من داخل المشغل عندما تكون الترجمة العربية متاحة.'
                  : 'Select the Arabic track inside the player when an Arabic subtitle track is available.'}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

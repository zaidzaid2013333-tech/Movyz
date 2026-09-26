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

const YAPGRID_ORIGIN = 'https://yapgrid.com';

type ServerId = 'x' | 'y' | 'z';

const SERVERS: Array<{ id: ServerId; label: string; description: string }> = [
  { id: 'x', label: 'السيرفر X', description: 'Primary' },
  { id: 'y', label: 'السيرفر Y', description: 'Backup' },
  { id: 'z', label: 'السيرفر Z', description: 'Edge' },
];

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  contentType,
  title,
  titleEn,
  tmdbId,
  seasonNumber,
  episodeNumber,
}) => {
  const { language } = useLanguage();
  const [selectedServer, setSelectedServer] = useState<ServerId>('x');
  const [iframeLoaded, setIframeLoaded] = useState(false);

  useEffect(() => {
    setIframeLoaded(false);
  }, [embedUrl]);

  const isMovie = contentType === 'movie';
  const safeTmdbId = Number(tmdbId || 0);

  const embedUrl = useMemo(() => {
    if (!safeTmdbId) return '';

    const path = isMovie
      ? `/embed/movie/${safeTmdbId}`
      : `/embed/tv/${safeTmdbId}/${Number(seasonNumber || 1)}/${Number(episodeNumber || 1)}`;

    const params = new URLSearchParams({
      autoplay: '1',
      server: selectedServer,
      lang: 'ar',
      title: isMovie ? title : `${title} · S${seasonNumber} E${episodeNumber}`,
      theme: 'dark',
    });

    return `${YAPGRID_ORIGIN}${path}?${params.toString()}`;
  }, [episodeNumber, isMovie, safeTmdbId, seasonNumber, selectedServer, title]);

  if (!embedUrl) {
    return (
      <div className="aspect-video w-full flex items-center justify-center bg-black text-slate-400 text-sm">
        {language === 'ar' ? 'معرّف TMDB غير متاح لهذا العنوان.' : 'TMDB id is unavailable for this title.'}
      </div>
    );
  }

  return (
    <div className="relative w-full bg-black overflow-visible" dir="rtl">
      <link rel="preconnect" href={YAPGRID_ORIGIN} />
      <link rel="dns-prefetch" href={YAPGRID_ORIGIN} />
      <div className="relative w-full aspect-video overflow-hidden">
        {!iframeLoaded && (
          <div className="absolute inset-0 z-[1] flex items-center justify-center bg-black" aria-hidden="true">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-amber-300" />
              <span className="text-xs">جاري تشغيل المصدر…</span>
            </div>
          </div>
        )}
        <iframe
          key={embedUrl}
          src={embedUrl}
          title={isMovie ? title : titleEn || title}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="eager"
          onLoad={() => setIframeLoaded(true)}
          className="absolute inset-0 w-full h-full border-0 bg-black"
        />
        <div className="pointer-events-none absolute top-3 start-3 z-10 flex items-center gap-2">
          <span className="rounded-full bg-black/70 backdrop-blur px-3 py-1 text-[10px] font-semibold text-white border border-white/10">
            YapGrid
          </span>
          <span className="rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[10px] text-slate-300 border border-white/10">
            مشغل خارجي
          </span>
        </div>
        <div className="pointer-events-none absolute bottom-3 end-3 z-10 flex items-center gap-2 rounded-full bg-black/60 backdrop-blur px-3 py-1 text-[10px] text-emerald-300 border border-white/10">
          <CheckCircle2 className="w-3 h-3" />
          <span>TMDB ← YapGrid</span>
        </div>
      </div>

      <section className="w-full border-t border-white/10 bg-[#0b0d13] p-3 sm:p-4" aria-label="إعدادات التشغيل">
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="w-4 h-4 text-amber-300" />
          <div>
            <h3 className="text-sm font-bold text-white">إعدادات المشاهدة</h3>
            <p className="text-[11px] text-slate-400">
              العربية محددة كلغة الترجمة الافتراضية، والسيرفر يمكن تغييره من هنا.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-white">
              <span>🎬</span> السيرفرات
            </div>

            <div className="flex flex-wrap gap-2">
              {SERVERS.map((server) => (
                <button
                  key={server.id}
                  type="button"
                  onClick={() => setSelectedServer(server.id)}
                  aria-pressed={selectedServer === server.id}
                  className={
                    selectedServer === server.id
                      ? 'rounded-xl border border-amber-300/50 bg-amber-300/15 px-3 py-2 text-xs font-semibold text-amber-100'
                      : 'rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.07]'
                  }
                >
                  <span className="block">{server.label}</span>
                  <span className="block text-[9px] opacity-60">{server.description}</span>
                </button>
              ))}
            </div>

            <p className="mt-2 text-[10px] text-slate-500">
              تغيير السيرفر يعيد تحميل المصدر الحالي على الاختيار الجديد.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-white">
              <Subtitles className="w-4 h-4" /> الترجمة العربية
            </div>

            <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2">
              <div className="text-xs font-semibold text-sky-100">العربية — مفعّلة افتراضيًا</div>
              <div className="mt-1 text-[10px] text-sky-100/65">
                نرسل `lang=ar` مباشرة إلى YapGrid عند فتح الفيلم أو الحلقة.
              </div>
            </div>

            <p className="mt-2 text-[10px] text-slate-500">
              توفر مسار عربي فعلي يعتمد على توفره للعنوان داخل YapGrid.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

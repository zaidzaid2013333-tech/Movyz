import React, { useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface WatchPageProps {
  mediaType: 'movie' | 'series';
  contentId: string;
  seasonNumber?: number;
  episodeNumber?: number;
  onNavigate: (path: string) => void;
}

export const WatchPage: React.FC<WatchPageProps> = ({
  mediaType,
  contentId,
  seasonNumber,
  episodeNumber,
  onNavigate,
}) => {
  const { language } = useLanguage();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const isSeries = mediaType === 'series';
  const validEpisode = isSeries
    && Number.isFinite(Number(seasonNumber))
    && Number(seasonNumber) > 0
    && Number.isFinite(Number(episodeNumber))
    && Number(episodeNumber) > 0;

  const embedUrl = isSeries && validEpisode
    ? `https://vidsrc.sh/embed/tv/${encodeURIComponent(contentId)}/${Number(seasonNumber)}/${Number(episodeNumber)}`
    : !isSeries
      ? `https://vidsrc.sh/embed/movie/${encodeURIComponent(contentId)}`
      : '';

  const detailsPath = isSeries ? `/series/${contentId}` : `/movies/${contentId}`;

  if (!contentId || !embedUrl) {
    return (
      <div className="min-h-screen bg-[#07090e] text-white flex items-center justify-center p-6">
        <div className="w-full max-w-lg text-center space-y-5">
          <h1 className="text-2xl font-bold">
            {language === 'ar' ? 'تعذّر فتح الحلقة' : 'Unable to open episode'}
          </h1>
          <p className="text-sm text-slate-400">
            {language === 'ar'
              ? 'رابط المشاهدة غير صالح لهذه الحلقة.'
              : 'The playback URL for this episode is invalid.'}
          </p>
          <button
            onClick={() => onNavigate(detailsPath)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-amber-500 text-slate-950 font-bold"
          >
            <ArrowLeft className="w-4 h-4" />
            {language === 'ar' ? 'العودة للتفاصيل' : 'Back to details'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="shrink-0 h-14 sm:h-16 px-3 sm:px-5 flex items-center justify-between border-b border-white/10 bg-[#08090d]">
        <button
          onClick={() => onNavigate(detailsPath)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-slate-200 hover:text-white hover:bg-white/[0.06] transition-colors"
          aria-label={language === 'ar' ? 'العودة' : 'Back'}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{language === 'ar' ? 'العودة' : 'Back'}</span>
        </button>

        <a
          href={embedUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/[0.06]"
        >
          <ExternalLink className="w-4 h-4" />
          <span>{language === 'ar' ? 'فتح المشغل' : 'Open player'}</span>
        </a>
      </header>

      <main className="flex-1 flex items-center justify-center bg-black">
        <div className="relative w-full max-w-[1600px] aspect-video bg-[#050505] overflow-hidden">
          {!loaded && !failed && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
              <div className="flex flex-col items-center gap-3 text-slate-300">
                <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
                <span className="text-sm">{language === 'ar' ? 'جاري تحميل المشغل…' : 'Loading player…'}</span>
              </div>
            </div>
          )}

          {failed ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <div className="max-w-md space-y-4">
                <h2 className="text-lg font-bold text-white">
                  {language === 'ar' ? 'تعذّر تحميل المشغل' : 'Player failed to load'}
                </h2>
                <p className="text-sm leading-6 text-slate-400">
                  {language === 'ar'
                    ? 'قد يكون المشغل الخارجي غير متاح مؤقتاً. جرّب فتحه مباشرة.'
                    : 'The external player may be temporarily unavailable. Try opening it directly.'}
                </p>
                <a
                  href={embedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm"
                >
                  <ExternalLink className="w-4 h-4" />
                  {language === 'ar' ? 'فتح المشغل مباشرة' : 'Open player directly'}
                </a>
              </div>
            </div>
          ) : (
            <iframe
              key={embedUrl}
              src={embedUrl}
              title={isSeries
                ? `VidSrc TV ${contentId} S${seasonNumber} E${episodeNumber}`
                : `VidSrc Movie ${contentId}`}
              className="w-full h-full border-0 bg-black"
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          )}
        </div>
      </main>
    </div>
  );
};

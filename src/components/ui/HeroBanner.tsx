import React from 'react';
import { Play, Info, Star, Bookmark, Check, Award } from 'lucide-react';
import { Movie, Series } from '../../types';
import { useLanguage } from '../../context/LanguageContext';

interface HeroBannerProps {
  item: Movie | Series;
  onWatch: (id: string, type: 'movie' | 'series') => void;
  onDetails: (id: string, type: 'movie' | 'series') => void;
  onToggleWatchlist: (item: Movie | Series) => void;
  isSaved?: boolean;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  item,
  onWatch,
  onDetails,
  onToggleWatchlist,
  isSaved = false,
}) => {
  const { language, t } = useLanguage();
  const titlePrimary = item.title || item.titleEn;
  const titleSecondary = item.originalTitle !== titlePrimary ? item.originalTitle : '';
  const overview = item.overview || item.overviewEn;
  const year = item.type === 'movie' ? item.year : item.startYear;
  const durationLabel = item.type === 'movie'
    ? item.runtime + ' ' + t('minutes')
    : item.seasonsCount + ' ' + t('seasons');

  return (
    <div className="w-full px-2 sm:px-4 pt-2">
      <div className="relative min-h-[500px] sm:min-h-[560px] overflow-hidden rounded-[28px] bg-[#080a0f] border border-white/[0.06] shadow-2xl">
        <img
          src={item.backdropUrl}
          alt={titlePrimary}
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover object-center scale-[1.02]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#040507] via-[#040507]/65 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#040507]/95 via-[#040507]/60 to-transparent rtl:bg-gradient-to-l" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#040507] to-transparent" />

        <div className="relative z-10 min-h-[500px] sm:min-h-[560px] flex items-end p-6 sm:p-10 lg:p-12">
          <div className="max-w-2xl space-y-5 sm:space-y-6 movyza-enter">
            <div className="inline-flex items-center gap-2 rounded-full bg-black/35 border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-amber-300 backdrop-blur-md">
              <Award className="w-3.5 h-3.5" />
              <span>{language === 'ar' ? 'مختار من Movyza' : 'Movyza Spotlight'}</span>
            </div>

            <div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold font-cinema-title tracking-tight leading-[1.05] text-white">
                {titlePrimary}
              </h1>
              {titleSecondary && <p className="mt-2 text-sm sm:text-base text-white/65 font-cinzel">{titleSecondary}</p>}
            </div>

            <div className="flex flex-wrap items-center gap-2.5 text-xs text-white/70">
              <span className="inline-flex items-center gap-1 font-bold text-amber-300">
                <Star className="w-3.5 h-3.5 fill-amber-300 text-amber-300" />
                {item.rating.toFixed(1)}
              </span>
              <span className="text-white/25">•</span>
              <span>{year}</span>
              <span className="text-white/25">•</span>
              <span>{durationLabel}</span>
              <span className="text-white/25">•</span>
              <span>{item.ageRating}</span>
            </div>

            <p className="max-w-xl text-sm leading-7 text-white/75 line-clamp-3">{overview}</p>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => onWatch(item.id, item.type)}
                className="min-h-11 px-6 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm flex items-center gap-2.5 shadow-xl shadow-amber-500/15 active:scale-[0.98] transition-all cursor-pointer"
              >
                <Play className="w-4 h-4 fill-slate-950" />
                <span>{t('watchNow')}</span>
              </button>

              <button
                onClick={() => onDetails(item.id, item.type)}
                className="min-h-11 px-4 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] text-white border border-white/10 font-semibold text-sm flex items-center gap-2 backdrop-blur-md active:scale-[0.98] transition-all cursor-pointer"
              >
                <Info className="w-4 h-4 text-white/70" />
                <span>{t('details')}</span>
              </button>

              <button
                onClick={() => onToggleWatchlist(item)}
                className={
                  'min-h-11 min-w-11 rounded-xl border flex items-center justify-center transition-all cursor-pointer ' +
                  (isSaved
                    ? 'bg-amber-400 text-slate-950 border-amber-300'
                    : 'bg-white/[0.07] text-white border-white/10 hover:bg-white/[0.12]')
                }
                title={isSaved ? t('inWatchlist') : t('addToWatchlist')}
                aria-label={isSaved ? t('inWatchlist') : t('addToWatchlist')}
              >
                {isSaved ? <Check className="w-4 h-4 stroke-[3]" /> : <Bookmark className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        <div className="absolute left-5 top-5 hidden sm:flex items-center gap-2 rounded-full bg-black/30 border border-white/10 px-3 py-1.5 text-[10px] text-white/60 backdrop-blur-md">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(242,184,75,0.75)]" />
          <span>{language === 'ar' ? 'جاهز للمشاهدة' : 'Ready to watch'}</span>
        </div>
      </div>
    </div>
  );
};
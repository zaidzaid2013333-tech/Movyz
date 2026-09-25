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

  const titlePrimary = language === 'ar' ? item.title : item.titleEn;
  const titleSecondary = language === 'ar' ? item.titleEn : item.originalTitle;
  const overview = language === 'ar' ? item.overview : item.overviewEn;
  const year = item.type === 'movie' ? item.year : item.startYear;
  const durationLabel =
    item.type === 'movie'
      ? `${item.runtime} ${t('minutes')}`
      : `${item.seasonsCount} ${t('seasons')}`;

  return (
    <div className="relative w-full max-w-7xl mx-auto px-3 sm:px-6 pt-2 pb-4 select-none">
      {/* Outer Cinema Stage Container */}
      <div className="relative rounded-3xl overflow-hidden bg-[#07090e] shadow-2xl shadow-black">
        {/* Ambient Backlight Aura */}
        <div className="absolute -top-32 -inset-x-20 h-64 bg-amber-500/10 blur-[100px] pointer-events-none rounded-full" />

        {/* Main Cinema Screen & Editorial Split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[420px] lg:min-h-[480px]">
          {/* Right/Top Side in RTL: Content Details (5 Cols) */}
          <div className="lg:col-span-5 p-6 sm:p-8 lg:p-10 flex flex-col justify-between z-10 space-y-6">
            <div className="space-y-3.5">
              {/* Feature Pill */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs font-semibold">
                <Award className="w-3.5 h-3.5 text-amber-400" />
                <span>{language === 'ar' ? 'عمل سينمائي مميز' : 'Featured Spotlight'}</span>
              </div>

              {/* Title Block */}
              <div className="space-y-1">
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold font-cinema-title text-white tracking-tight leading-tight">
                  {titlePrimary}
                </h1>
                {titleSecondary && (
                  <p className="text-xs sm:text-sm font-medium text-amber-400/80 font-cinzel">
                    {titleSecondary}
                  </p>
                )}
              </div>

              {/* Clean Metadata Line */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 font-mono">
                <span className="flex items-center gap-1 font-bold text-amber-400">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  <span>{item.rating.toFixed(1)}</span>
                </span>
                <span className="text-slate-600">·</span>
                <span>{year}</span>
                <span className="text-slate-600">·</span>
                <span>{durationLabel}</span>
                <span className="text-slate-600">·</span>
                <span className="px-1.5 py-0.5 rounded border border-white/15 text-[10px]">
                  {item.ageRating}
                </span>
              </div>

              {/* Genres Line */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                {item.genres.map((g, idx) => (
                  <React.Fragment key={g.id}>
                    <span>{language === 'ar' ? g.name : g.nameEn}</span>
                    {idx < item.genres.length - 1 && <span className="text-slate-600">·</span>}
                  </React.Fragment>
                ))}
              </div>

              {/* Synopsis */}
              <p className="text-xs sm:text-sm text-slate-300 line-clamp-3 leading-relaxed">
                {overview}
              </p>
            </div>

            {/* Actions: Watch, Details, Watchlist */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={() => onWatch(item.id, item.type)}
                className="min-h-[44px] px-6 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 font-bold text-xs sm:text-sm flex items-center gap-2.5 shadow-lg shadow-amber-500/20 active:scale-98 transition-all cursor-pointer"
              >
                <Play className="w-4 h-4 fill-slate-950 translate-x-0.5" />
                <span>{t('watchNow')}</span>
              </button>

              <button
                onClick={() => onDetails(item.id, item.type)}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white border border-white/[0.1] font-semibold text-xs sm:text-sm flex items-center gap-2 backdrop-blur-md active:scale-98 transition-all cursor-pointer"
              >
                <Info className="w-4 h-4 text-slate-400" />
                <span>{t('details')}</span>
              </button>

              <button
                onClick={() => onToggleWatchlist(item)}
                className={`min-h-[44px] min-w-[44px] p-2.5 rounded-xl border transition-all active:scale-98 flex items-center justify-center cursor-pointer ${
                  isSaved
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                    : 'bg-white/[0.05] border-white/[0.1] text-slate-300 hover:text-white hover:bg-white/[0.1]'
                }`}
                title={isSaved ? t('inWatchlist') : t('addToWatchlist')}
                aria-label={isSaved ? t('inWatchlist') : t('addToWatchlist')}
              >
                {isSaved ? <Check className="w-4 h-4 stroke-[3]" /> : <Bookmark className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Left/Screen Side in RTL: High-Def Backdrop Still (7 Cols) */}
          <div className="lg:col-span-7 relative min-h-[260px] sm:min-h-[340px] lg:min-h-full overflow-hidden bg-slate-950 group">
            <img
              src={item.backdropUrl}
              alt={titlePrimary}
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover object-center scale-[1.02] group-hover:scale-105 transition-transform duration-700"
            />
            
            {/* Cinematic Lens Shading Gradients */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#07090e] via-transparent to-transparent lg:hidden" />
            <div className="hidden lg:block absolute inset-0 rtl:bg-gradient-to-l ltr:bg-gradient-to-r from-transparent via-[#07090e]/40 to-[#07090e]" />
            <div className="absolute inset-0 bg-black/20" />

            {/* Center Play Button Overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                onClick={() => onWatch(item.id, item.type)}
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-amber-500/90 hover:bg-amber-400 text-slate-950 flex items-center justify-center shadow-2xl shadow-amber-500/40 backdrop-blur-md transform group-hover:scale-110 active:scale-95 transition-all cursor-pointer border border-amber-300/40"
                aria-label={t('watchNow')}
              >
                <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-slate-950 translate-x-0.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

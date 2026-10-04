import React, { useState } from 'react';
import { Star, Play, Bookmark, Check, Tv } from 'lucide-react';
import { Series } from '../../types';
import { useLanguage } from '../../context/LanguageContext';

interface SeriesCardProps {
  series: Series;
  onSelect: (seriesId: string) => void;
  onToggleWatchlist?: (series: Series) => void;
  isSaved?: boolean;
  layout?: 'poster' | 'still';
}

export const SeriesCard: React.FC<SeriesCardProps> = ({
  series,
  onSelect,
  onToggleWatchlist,
  isSaved = false,
  layout = 'poster',
}) => {
  const { language, t } = useLanguage();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const displayTitle = language === 'ar' ? series.title : series.titleEn || series.title;
  const isStill = layout === 'still';

  return (
    <div
      onClick={() => onSelect(series.id)}
      className="movyza-card group relative flex flex-col cursor-pointer transition-all duration-200 select-none"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(series.id);
        }
      }}
      aria-label={displayTitle}
    >
      <div
        className={`movyza-card-media relative w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0b0d12] ${isStill ? 'aspect-video' : 'aspect-[2/3]'}`}
      >
        {!imageLoaded && !imageError && <div className="absolute inset-0 skeleton-shimmer" />}
        {!imageError ? (
          <img
            src={isStill ? series.backdropUrl || series.posterUrl : series.posterUrl}
            alt={displayTitle}
            draggable={false}
            referrerPolicy="no-referrer"
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
            className={`h-full w-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center p-4 bg-[#11141a] text-center">
            <Tv className="w-8 h-8 text-amber-400/50 mb-2" />
            <span className="text-xs font-semibold text-slate-300 line-clamp-2">{displayTitle}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        {onToggleWatchlist && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleWatchlist(series);
            }}
            className={`absolute top-2.5 rtl:left-2.5 ltr:right-2.5 w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md border transition-all ${isSaved ? 'bg-amber-500 text-slate-950 border-amber-400/60' : 'bg-black/55 text-white border-white/10 hover:text-amber-300 hover:bg-black/75 opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`}
            title={isSaved ? 'في قائمتي' : 'أضف لقائمتي'}
            aria-label={isSaved ? 'في قائمتي' : 'أضف لقائمتي'}
          >
            {isSaved ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Bookmark className="w-3.5 h-3.5" />}
          </button>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          <div className="movyza-card-play w-11 h-11 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center transform scale-90 group-hover:scale-100 transition-transform">
            <Play className="w-4 h-4 fill-slate-950 translate-x-0.5" />
          </div>
        </div>
      </div>
      <div className="mt-3 space-y-1 px-0.5">
        <h3 className="text-sm sm:text-[15px] font-semibold text-white line-clamp-1 group-hover:text-amber-300 transition-colors tracking-[-0.01em]">{displayTitle}</h3>
        <div className="flex items-center gap-2.5 text-[11px] text-slate-500">
          <span className="flex items-center gap-1 text-amber-300 font-bold bg-amber-400/8 border border-amber-400/10 px-1.5 py-0.5 rounded-md">
            <Star className="w-3 h-3 fill-amber-300 text-amber-300" />
            <span>{series.rating.toFixed(1)}</span>
          </span>
          <span className="text-slate-700">·</span>
          <span>{series.seasonsCount} {t('seasons')}</span>
        </div>
      </div>
    </div>
  );
};
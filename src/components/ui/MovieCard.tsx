import React, { useState } from 'react';
import { Star, Play, Bookmark, Check, Film } from 'lucide-react';
import { Movie } from '../../types';
import { useLanguage } from '../../context/LanguageContext';

interface MovieCardProps {
  movie: Movie;
  onSelect: (movieId: string) => void;
  onWatch?: (movieId: string) => void;
  onToggleWatchlist?: (movie: Movie) => void;
  isSaved?: boolean;
  layout?: 'poster' | 'still';
}

export const MovieCard: React.FC<MovieCardProps> = ({
  movie,
  onSelect,
  onToggleWatchlist,
  isSaved = false,
  layout = 'poster',
}) => {
  const { language } = useLanguage();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const displayTitle = language === 'ar' ? movie.title : movie.titleEn || movie.title;
  const isStill = layout === 'still';

  return (
    <div
      onClick={() => onSelect(movie.id)}
      className="movyza-card group relative flex flex-col cursor-pointer transition-all duration-200 select-none"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(movie.id);
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
            src={isStill ? movie.backdropUrl || movie.posterUrl : movie.posterUrl}
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
            <Film className="w-8 h-8 text-amber-400/50 mb-2" />
            <span className="text-xs font-semibold text-slate-300 line-clamp-2">{displayTitle}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        {onToggleWatchlist && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleWatchlist(movie);
            }}
            className={`absolute top-2.5 rtl:left-2.5 ltr:right-2.5 w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md border transition-all ${isSaved ? 'bg-amber-500 text-slate-950 border-amber-400/60' : 'bg-black/55 text-white border-white/10 hover:text-amber-300 hover:bg-black/75 opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`}
            title={isSaved ? 'في قائمتي' : 'أضف لقائمتي'}
            aria-label={isSaved ? 'في قائمتي' : 'أضف لقائمتي'}
          >
            {isSaved ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Bookmark className="w-3.5 h-3.5" />}
          </button>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          <div className="w-11 h-11 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center shadow-xl transform scale-90 group-hover:scale-100 transition-transform">
            <Play className="w-4 h-4 fill-slate-950 translate-x-0.5" />
          </div>
        </div>
      </div>
      <div className="mt-2.5 space-y-0.5 px-0.5">
        <h3 className="text-xs sm:text-sm font-semibold text-white line-clamp-1 group-hover:text-amber-300 transition-colors">{displayTitle}</h3>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-0.5 text-amber-300 font-bold">
            <Star className="w-3 h-3 fill-amber-300 text-amber-300" />
            <span>{movie.rating.toFixed(1)}</span>
          </span>
          <span className="text-slate-700">·</span>
          <span>{movie.year}</span>
        </div>
      </div>
    </div>
  );
};
import React, { useState, useEffect } from 'react';
import { WatchlistItem, Movie, Series } from '../types';
import { MovyzaApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { MovieCard } from '../components/ui/MovieCard';
import { SeriesCard } from '../components/ui/SeriesCard';
import { CardGridSkeleton } from '../components/ui/Skeletons';
import { EmptyState } from '../components/ui/FeedbackStates';
import { Bookmark, Film, Tv, SlidersHorizontal } from 'lucide-react';

interface WatchlistPageProps {
  onNavigate: (path: string) => void;
  watchlist: string[];
  onToggleWatchlist: (item: Movie | Series) => void;
}

export const WatchlistPage: React.FC<WatchlistPageProps> = ({
  onNavigate,
  watchlist,
  onToggleWatchlist,
}) => {
  const { language, t } = useLanguage();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [fullMedia, setFullMedia] = useState<(Movie | Series)[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'movie' | 'series'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'rating' | 'year'>('recent');
  const [loading, setLoading] = useState(true);

  const fetchWatchlist = async () => {
    setLoading(true);
    const res = await MovyzaApi.getWatchlist();
    setItems(res.data);

    const [moviesRes, seriesRes] = await Promise.all([
      MovyzaApi.getMovies(),
      MovyzaApi.getSeries(),
    ]);

    const all = [...moviesRes.data, ...seriesRes.data];
    const filteredMedia = all.filter((m) =>
      res.data.some((wl) => wl.contentId === m.id)
    );
    setFullMedia(filteredMedia);
    setLoading(false);
  };

  useEffect(() => {
    fetchWatchlist();
  }, [watchlist]);

  let displayedMedia = fullMedia.filter((m) =>
    filterType === 'all' ? true : m.type === filterType
  );

  if (sortBy === 'rating') {
    displayedMedia.sort((a, b) => b.rating - a.rating);
  } else if (sortBy === 'year') {
    displayedMedia.sort((a, b) => {
      const yearA = a.type === 'movie' ? (a as Movie).year : (a as Series).startYear;
      const yearB = b.type === 'movie' ? (b as Movie).year : (b as Series).startYear;
      return yearB - yearA;
    });
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-in fade-in duration-300">
      {/* Clean Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-cinema-title font-bold text-white tracking-wide">
            {t('watchlist')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            {language === 'ar'
              ? `قائمتك الشخصية المحفوظة للمشاهدة لاحقاً (${fullMedia.length} أعمال مختارة).`
              : `Your saved watchlist for later streaming (${fullMedia.length} titles).`}
          </p>
        </div>

        {/* Filter & Sort Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-[#090b10] rounded-xl border border-white/10">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                filterType === 'all'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {t('all')}
            </button>
            <button
              onClick={() => setFilterType('movie')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                filterType === 'movie'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>{t('movies')}</span>
            </button>
            <button
              onClick={() => setFilterType('series')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                filterType === 'series'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              <span>{t('series')}</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 bg-[#090b10] px-2.5 py-1.5 rounded-xl border border-white/10 text-xs text-slate-400">
            <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-slate-200 focus:outline-none cursor-pointer font-medium"
            >
              <option value="recent" className="bg-[#090b10] text-white">{language === 'ar' ? 'الأحدث إضافة' : 'Recently Added'}</option>
              <option value="rating" className="bg-[#090b10] text-white">{language === 'ar' ? 'الأعلى تقييماً' : 'Highest Rated'}</option>
              <option value="year" className="bg-[#090b10] text-white">{language === 'ar' ? 'سنة الإنتاج' : 'Release Year'}</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <CardGridSkeleton count={6} />
      ) : displayedMedia.length === 0 ? (
        <EmptyState
          title={t('emptyWatchlistTitle')}
          description={t('emptyWatchlistDesc')}
          actionLabel={language === 'ar' ? 'استكشف الأعمال' : 'Explore Titles'}
          onAction={() => onNavigate('/movies')}
          icon="watchlist"
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5 sm:gap-5">
          {displayedMedia.map((item) => {
            const isMovie = item.type === 'movie';
            return isMovie ? (
              <MovieCard
                key={item.id}
                movie={item as Movie}
                onSelect={(id) => onNavigate(`/movies/${id}`)}
                onToggleWatchlist={() => onToggleWatchlist(item)}
                isSaved={true}
              />
            ) : (
              <SeriesCard
                key={item.id}
                series={item as Series}
                onSelect={(id) => onNavigate(`/series/${id}`)}
                onToggleWatchlist={() => onToggleWatchlist(item)}
                isSaved={true}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

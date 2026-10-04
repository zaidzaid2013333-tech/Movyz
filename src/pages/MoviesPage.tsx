import React, { useState, useEffect } from 'react';
import { Movie, Genre } from '../types';
import { MovyzaApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { MovieCard } from '../components/ui/MovieCard';
import { CardGridSkeleton } from '../components/ui/Skeletons';
import { EmptyState, ErrorState } from '../components/ui/FeedbackStates';
import {
  Filter,
  SlidersHorizontal,
  ChevronRight,
  ChevronLeft,
  RotateCcw,
  Film,
  Sparkles,
  LayoutGrid,
  Maximize2,
  Award,
} from 'lucide-react';

interface MoviesPageProps {
  onNavigate: (path: string) => void;
  watchlist: string[];
  onToggleWatchlist: (movie: Movie) => void;
  initialGenreId?: number;
}

export const MoviesPage: React.FC<MoviesPageProps> = ({
  onNavigate,
  watchlist,
  onToggleWatchlist,
  initialGenreId,
}) => {
  const { language, t, direction } = useLanguage();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [selectedGenre, setSelectedGenre] = useState<number | undefined>(initialGenreId);
  const [selectedYear, setSelectedYear] = useState<number | undefined>(undefined);
  const [selectedMinRating, setSelectedMinRating] = useState<number | undefined>(undefined);
  const [sortBy, setSortBy] = useState<'popular' | 'rating' | 'newest'>('popular');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Fetch genres
  useEffect(() => {
    MovyzaApi.getGenres().then((res) => setGenres(res.data));
  }, []);

  // Fetch movies
  const fetchMovies = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await MovyzaApi.getMovies({
        genreId: selectedGenre,
        year: selectedYear,
        minRating: selectedMinRating,
        sortBy,
        page,
        limit: 12,
      });
      setMovies(res.data);
      setTotalPages(res.meta?.totalPages || 1);
      setTotalCount(res.meta?.total || res.data.length);
    } catch (err: any) {
      setError(err?.message || 'Failed to load movies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMovies();
  }, [selectedGenre, selectedYear, selectedMinRating, sortBy, page]);

  const handleResetFilters = () => {
    setSelectedGenre(undefined);
    setSelectedYear(undefined);
    setSelectedMinRating(undefined);
    setSortBy('popular');
    setPage(1);
  };

  const years = [2026, 2025, 2024, 2023, 2022, 2020];

  return (
    <div className="movyza-shell max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 sm:py-9 space-y-8 movyza-enter">
      {/* Page Header */}
      <div className="movyza-page-intro rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-cinema-title font-bold text-white tracking-wide">
            {language === 'ar' ? 'الأفلام السينمائية' : 'Movies'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            {language === 'ar'
              ? `مكتبة الأفلام السينمائية المختارة (${totalCount} فيلم متاح).`
              : `Explore curated feature films (${totalCount} titles).`}
          </p>
        </div>

        {/* Quick Sort Switcher */}
        <div className="flex items-center gap-2 bg-[#0d101a] p-1.5 rounded-xl border border-white/10 self-start md:self-auto">
          <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400 ml-1.5" />
          <span className="text-xs text-slate-400">{t('sortBy')}:</span>
          <select
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as any);
              setPage(1);
            }}
            className="bg-[#141824] border border-white/10 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-amber-400 cursor-pointer font-medium"
          >
            <option value="popular">{t('sortPopular')}</option>
            <option value="rating">{t('sortRating')}</option>
            <option value="newest">{t('sortNewest')}</option>
          </select>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="movyza-filter-panel p-3.5 sm:p-4 rounded-2xl space-y-3">
        <div className="flex items-center justify-between text-xs border-b border-white/[0.06] pb-2.5">
          <div className="flex items-center gap-2 font-semibold text-slate-300">
            <Filter className="w-3.5 h-3.5 text-amber-400" />
            <span>{language === 'ar' ? 'تصفية حسب التصنيف' : 'Filter by Genre'}</span>
          </div>

          {(selectedGenre || selectedYear || selectedMinRating) && (
            <button
              onClick={handleResetFilters}
              className="text-amber-400 hover:text-amber-300 text-xs flex items-center gap-1.5 cursor-pointer font-medium"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t('resetFilters')}</span>
            </button>
          )}
        </div>

        {/* Genre Badges */}
        <div dir={direction} className="touch-chip-scroll pb-1">
          <button
            onClick={() => {
              setSelectedGenre(undefined);
              setPage(1);
            }}
            className={`min-h-[36px] px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              selectedGenre === undefined
                ? 'bg-amber-400 text-slate-950 font-bold'
                : 'bg-white/[0.035] text-slate-300 hover:text-white border border-white/[0.07]'
            }`}
          >
            {t('allGenres')}
          </button>
          {genres.map((genre) => {
            const isSelected = selectedGenre === genre.id;
            return (
              <button
                key={genre.id}
                onClick={() => {
                  setSelectedGenre(isSelected ? undefined : genre.id);
                  setPage(1);
                }}
                className={`min-h-[36px] px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/25'
                    : 'bg-[#11141e] text-slate-300 hover:text-white border border-amber-500/10'
                }`}
              >
                {language === 'ar' ? genre.name : genre.nameEn}
              </button>
            );
          })}
        </div>

        {/* Year & Rating Strip */}
        <div dir={direction} className="touch-chip-scroll pt-3 border-t border-white/[0.06] text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-mono">{t('year')}:</span>
            <div className="flex gap-1.5 shrink-0">
              {years.map((y) => (
                <button
                  key={y}
                  onClick={() => {
                    setSelectedYear(selectedYear === y ? undefined : y);
                    setPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all cursor-pointer ${
                    selectedYear === y
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                      : 'bg-[#11141e] text-slate-400 hover:text-white'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-mono">{t('rating')}:</span>
            {[8.0, 8.5].map((r) => (
              <button
                key={r}
                onClick={() => {
                  setSelectedMinRating(selectedMinRating === r ? undefined : r);
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all cursor-pointer ${
                  selectedMinRating === r
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                    : 'bg-[#11141e] text-slate-400 hover:text-white'
                }`}
              >
                ★ {r}+
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Movies Grid */}
      {loading ? (
        <CardGridSkeleton count={12} />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchMovies} />
      ) : movies.length === 0 ? (
        <EmptyState
          title={t('noMoviesFound')}
          description={
            language === 'ar'
              ? 'لم يتم العثور على أي أعمال مطابقة لمعايير الفلترة الحالية'
              : 'No movies match your current filtering criteria.'
          }
          actionLabel={t('resetFilters')}
          onAction={handleResetFilters}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5 sm:gap-5">
          {movies.map((movie) => (
            <MovieCard
              key={movie.id}
              movie={movie}
              onSelect={(id) => onNavigate(`/movies/${id}`)}
              onToggleWatchlist={() => onToggleWatchlist(movie)}
              isSaved={watchlist.includes(movie.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && !loading && (
        <div className="flex items-center justify-center gap-3 pt-6 border-t border-amber-500/15">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="min-h-[40px] px-4 rounded-xl bg-[#0d101a] border border-amber-500/15 text-slate-300 hover:text-white hover:border-amber-500/40 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
          >
            {direction === 'rtl' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            <span>{t('previous')}</span>
          </button>

          <span className="text-xs font-mono text-amber-300 font-bold px-3">
            {page} / {totalPages}
          </span>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="min-h-[40px] px-4 rounded-xl bg-[#0d101a] border border-amber-500/15 text-slate-300 hover:text-white hover:border-amber-500/40 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <span>{t('next')}</span>
            {direction === 'rtl' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      )}
    </div>
  );
};

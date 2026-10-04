import React, { useState, useEffect } from 'react';
import { Series, Genre } from '../types';
import { MovyzaApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { SeriesCard } from '../components/ui/SeriesCard';
import { CardGridSkeleton } from '../components/ui/Skeletons';
import { EmptyState, ErrorState } from '../components/ui/FeedbackStates';
import {
  Filter,
  SlidersHorizontal,
  ChevronRight,
  ChevronLeft,
  RotateCcw,
  Tv,
  Sparkles,
  Disc,
} from 'lucide-react';

interface SeriesPageProps {
  onNavigate: (path: string) => void;
  watchlist: string[];
  onToggleWatchlist: (series: Series) => void;
  initialGenreId?: number;
}

export const SeriesPage: React.FC<SeriesPageProps> = ({
  onNavigate,
  watchlist,
  onToggleWatchlist,
  initialGenreId,
}) => {
  const { language, t, direction } = useLanguage();
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [selectedGenre, setSelectedGenre] = useState<number | undefined>(initialGenreId);
  const [selectedYear, setSelectedYear] = useState<number | undefined>(undefined);
  const [sortBy, setSortBy] = useState<'popular' | 'rating' | 'newest'>('popular');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    MovyzaApi.getGenres().then((res) => setGenres(res.data));
  }, []);

  const fetchSeries = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await MovyzaApi.getSeries({
        genreId: selectedGenre,
        year: selectedYear,
        sortBy,
        page,
        limit: 12,
      });
      setSeriesList(res.data);
      setTotalPages(res.meta?.totalPages || 1);
      setTotalCount(res.meta?.total || res.data.length);
    } catch (err: any) {
      setError(err?.message || 'Failed to load series');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSeries();
  }, [selectedGenre, selectedYear, sortBy, page]);

  const handleResetFilters = () => {
    setSelectedGenre(undefined);
    setSelectedYear(undefined);
    setSortBy('popular');
    setPage(1);
  };

  const years = [2026, 2025, 2024, 2023, 2022];

  return (
    <div className="movyza-shell max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 sm:py-9 space-y-8 movyza-enter">
      {/* Page Header */}
      <div className="movyza-page-intro rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-cinema-title font-bold text-white tracking-wide">
            {language === 'ar' ? 'المسلسلات التلفزيونية' : 'Series'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            {language === 'ar'
              ? `إنتاجات درامية كاملة المواسم والحلقات (${totalCount} عمل درامي).`
              : `Premier TV series with full seasons (${totalCount} titles).`}
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

          {(selectedGenre || selectedYear) && (
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

        {/* Year Filter Strip */}
        <div dir={direction} className="touch-chip-scroll pt-3 border-t border-white/[0.06] text-xs">
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
      </div>

      {/* Series Grid */}
      {loading ? (
        <CardGridSkeleton count={12} />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchSeries} />
      ) : seriesList.length === 0 ? (
        <EmptyState
          title={t('noSeriesFound')}
          description={
            language === 'ar'
              ? 'لم يتم العثور على أي مسلسلات مطابقة لمعايير الفلترة الحالية'
              : 'No TV series match your current filtering criteria.'
          }
          actionLabel={t('resetFilters')}
          onAction={handleResetFilters}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5 sm:gap-5">
          {seriesList.map((series) => (
            <SeriesCard
              key={series.id}
              series={series}
              onSelect={(id) => onNavigate(`/series/${id}`)}
              onToggleWatchlist={() => onToggleWatchlist(series)}
              isSaved={watchlist.includes(series.id)}
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

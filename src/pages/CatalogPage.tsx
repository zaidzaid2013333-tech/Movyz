import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Film, Flame, Layers3, Tv } from 'lucide-react';
import { Movie, Series } from '../types';
import { MovyzaApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { MovieCard } from '../components/ui/MovieCard';
import { SeriesCard } from '../components/ui/SeriesCard';
import { CardGridSkeleton } from '../components/ui/Skeletons';
import { ErrorState } from '../components/ui/FeedbackStates';

interface CatalogPageProps {
  onNavigate: (path: string) => void;
  watchlist: string[];
  onToggleWatchlist: (item: Movie | Series) => void;
}

type CatalogFilter = 'all' | 'movie' | 'series';

const PAGE_SIZE = 24;

export const CatalogPage: React.FC<CatalogPageProps> = ({
  onNavigate,
  watchlist,
  onToggleWatchlist,
}) => {
  const { language, direction } = useLanguage();
  const [items, setItems] = useState<(Movie | Series)[]>([]);
  const [filter, setFilter] = useState<CatalogFilter>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    MovyzaApi.getTop1000Catalog()
      .then((res) => {
        if (active) setItems(res.data.items);
      })
      .catch((err: any) => {
        if (active) setError(err?.message || (language === 'ar' ? 'تعذر تحميل الكتالوج' : 'Unable to load the catalog'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [language]);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  const filteredItems = useMemo(
    () => filter === 'all' ? items : items.filter((item) => item.type === filter),
    [items, filter],
  );

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleItems = filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const labels = {
    title: language === 'ar' ? 'أفضل 1000 في Movyz' : 'Movyz Top 1000',
    description: language === 'ar'
      ? 'أقوى مزيج من الشهرة والاهتمام الحالي والتقييم وإعادة المشاهدة — يتجدد تلقائيًا مع TMDB.'
      : 'A ranked mix of popularity, current interest, ratings and rewatch value — refreshed from TMDB.',
    all: language === 'ar' ? 'الكل' : 'All',
    movies: language === 'ar' ? 'أفلام' : 'Movies',
    series: language === 'ar' ? 'مسلسلات' : 'Series',
    total: language === 'ar' ? 'عنوان مرتب' : 'ranked titles',
    previous: language === 'ar' ? 'السابق' : 'Previous',
    next: language === 'ar' ? 'التالي' : 'Next',
    rank: language === 'ar' ? 'ترتيب' : 'Rank',
  };

  const tabs: Array<{ id: CatalogFilter; label: string; icon: typeof Layers3 }> = [
    { id: 'all', label: labels.all, icon: Layers3 },
    { id: 'movie', label: labels.movies, icon: Film },
    { id: 'series', label: labels.series, icon: Tv },
  ];

  return (
    <div className="movyza-shell max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 sm:py-9 space-y-7 movyza-enter">
      <section className="movyza-page-intro rounded-3xl p-5 sm:p-7 border border-amber-500/10">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-400/10 border border-amber-400/15 px-3 py-1.5 text-[10px] font-bold text-amber-300 uppercase tracking-[0.16em]">
              <Flame className="w-3.5 h-3.5" />
              MOVYZ 1000
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-cinema-title font-bold text-white tracking-wide">
              {labels.title}
            </h1>
            <p dir={direction} className="max-w-3xl text-xs sm:text-sm leading-6 text-slate-400">
              {labels.description}
            </p>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="font-mono text-amber-300 font-bold">{filteredItems.length}</span>
            <span>{labels.total}</span>
          </div>
        </div>

        <div dir={direction} className="touch-chip-scroll mt-5 pt-4 border-t border-white/[0.06]">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={
                  'inline-flex items-center gap-2 min-h-[40px] px-4 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ' +
                  (active
                    ? 'bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/15'
                    : 'bg-white/[0.035] border border-white/[0.07] text-slate-300 hover:text-white hover:bg-white/[0.06]')
                }
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {loading ? (
        <CardGridSkeleton count={24} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      ) : visibleItems.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-10 text-center text-sm text-slate-400">
          {language === 'ar' ? 'لا توجد نتائج في هذا القسم.' : 'No titles in this section.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5 sm:gap-5">
            {visibleItems.map((item, index) => {
              const globalRank = (safePage - 1) * PAGE_SIZE + index + 1;
              return (
                <div key={item.id} className="relative min-w-0">
                  <div className="absolute top-2 left-2 z-10 rounded-lg bg-black/75 border border-white/10 backdrop-blur-md px-2 py-1 text-[9px] font-mono font-bold text-amber-300">
                    {labels.rank} #{globalRank}
                  </div>
                  {item.type === 'movie' ? (
                    <MovieCard
                      movie={item as Movie}
                      onSelect={(id) => onNavigate('/movies/' + id)}
                      onToggleWatchlist={() => onToggleWatchlist(item)}
                      isSaved={watchlist.includes(item.id)}
                    />
                  ) : (
                    <SeriesCard
                      series={item as Series}
                      onSelect={(id) => onNavigate('/series/' + id)}
                      onToggleWatchlist={() => onToggleWatchlist(item)}
                      isSaved={watchlist.includes(item.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-6 border-t border-amber-500/10">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="min-h-[42px] px-4 rounded-xl bg-[#0d101a] border border-white/10 text-slate-300 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              >
                {direction === 'rtl' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                {labels.previous}
              </button>

              <span className="px-3 text-xs font-mono font-bold text-amber-300 tabular-nums">
                {safePage} / {totalPages}
              </span>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="min-h-[42px] px-4 rounded-xl bg-[#0d101a] border border-white/10 text-slate-300 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              >
                {labels.next}
                {direction === 'rtl' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

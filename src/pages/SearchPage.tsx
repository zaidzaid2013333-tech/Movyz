import React, { useState, useEffect, useRef } from 'react';
import { Movie, Series } from '../types';
import { MovyzaApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { MovieCard } from '../components/ui/MovieCard';
import { SeriesCard } from '../components/ui/SeriesCard';
import { CardGridSkeleton } from '../components/ui/Skeletons';
import { EmptyState } from '../components/ui/FeedbackStates';
import { Search, X, Sparkles, User, Film, Tv, Clapperboard } from 'lucide-react';
import { SeoHead } from '../components/SEOHead';

interface SearchPageProps {
  onNavigate: (path: string) => void;
  watchlist: string[];
  onToggleWatchlist: (item: Movie | Series) => void;
}

export const SearchPage: React.FC<SearchPageProps> = ({
  onNavigate,
  watchlist,
  onToggleWatchlist,
}) => {
  const { language, t } = useLanguage();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'movies' | 'series' | 'cast'>('all');
  const [results, setResults] = useState<{
    movies: Movie[];
    series: Series[];
    cast: { name: string; nameEn: string; worksCount: number; avatarUrl: string }[];
  }>({ movies: [], series: [], cast: [] });

  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('movyza_recent_searches');
      return saved ? JSON.parse(saved) : ['صائد الظلال', 'حارة الأسرار', 'تيم حسن', 'دراما'];
    } catch {
      return ['صائد الظلال', 'حارة الأسرار', 'تيم حسن'];
    }
  });

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus search input on page load
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Debounced server search
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults({ movies: [], series: [], cast: [] });
      setLoading(false);
      return;
    }

    setLoading(true);
    const timeout = setTimeout(() => {
      MovyzaApi.searchCatalog(trimmed)
        .then((res) => {
          setResults(res.data);
          setLoading(false);

          if (res.data.movies.length > 0 || res.data.series.length > 0) {
            setRecentSearches((prev) => {
              const updated = [trimmed, ...prev.filter((item) => item !== trimmed)].slice(0, 8);
              localStorage.setItem('movyza_recent_searches', JSON.stringify(updated));
              return updated;
            });
          }
        })
        .catch(() => setLoading(false));
    }, 250);

    return () => clearTimeout(timeout);
  }, [query]);

  const handleClear = () => {
    setQuery('');
    setResults({ movies: [], series: [], cast: [] });
    searchInputRef.current?.focus();
  };

  const handleTagClick = (tag: string) => {
    setQuery(tag);
  };

  const hasResults =
    results.movies.length > 0 || results.series.length > 0 || results.cast.length > 0;

  return (
    <>
      <SeoHead
        title={language === 'ar' ? 'البحث عن الأفلام والمسلسلات | موفيزا' : 'Search Movies & TV | Movyza'}
        description={language === 'ar' ? 'ابحث عن فيلم أو مسلسل أو ممثل أو مخرج في كتالوج موفيزا.' : 'Search movies, TV series, actors and directors in the Movyza catalog.'}
        noindex
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-in fade-in duration-300">
      {/* Search Input Marquee Box */}
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="relative rounded-3xl p-1 bg-gradient-to-r from-amber-500/30 via-amber-400/10 to-amber-600/30 shadow-2xl">
          <div className="relative flex items-center bg-[#07090e] rounded-[22px]">
            <Search className="absolute rtl:right-5 ltr:left-5 w-5 h-5 text-amber-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                language === 'ar'
                  ? 'ابحث بالاسم العربي، العنوان الأصلي، الممثل، المخرج...'
                  : 'Search by Arabic title, original name, actor, director...'
              }
              className="w-full h-15 rtl:pr-14 rtl:pl-14 ltr:pl-14 ltr:pr-14 rounded-[22px] bg-transparent text-white placeholder-slate-500 text-sm sm:text-base focus:outline-none transition-all"
              aria-label="Search"
            />
            {query && (
              <button
                onClick={handleClear}
                className="absolute rtl:left-4 ltr:right-4 p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                aria-label="Clear Search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Search Category Filter Chips */}
        {hasResults && (
          <div className="flex items-center justify-center gap-2 pt-1">
            {[
              { id: 'all', label: language === 'ar' ? 'الكل' : 'All' },
              { id: 'movies', label: `${t('movies')} (${results.movies.length})` },
              { id: 'series', label: `${t('series')} (${results.series.length})` },
              { id: 'cast', label: `${language === 'ar' ? 'الممثلين' : 'Cast'} (${results.cast.length})` },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id as any)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                  filterType === f.id
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/25'
                    : 'bg-[#0f1118] text-slate-300 hover:text-white border border-amber-500/15'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* Recent Searches Tags (When input is empty or query short) */}
        {!query && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-amber-400 font-cinema-title">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t('recentSearches')}</span>
              </div>
              {recentSearches.length > 0 && (
                <button
                  onClick={() => {
                    setRecentSearches([]);
                    localStorage.removeItem('movyza_recent_searches');
                  }}
                  className="text-[11px] text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                >
                  {language === 'ar' ? 'مسح السجل' : 'Clear History'}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((term) => (
                <button
                  key={term}
                  onClick={() => handleTagClick(term)}
                  className="px-3 py-1.5 rounded-xl bg-[#090b10] hover:bg-[#121520] hover:border-white/20 border border-white/10 text-xs text-slate-300 hover:text-white transition-all cursor-pointer"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Results View */}
      {loading ? (
        <div className="space-y-4 pt-4 max-w-7xl mx-auto">
          <div className="w-36 h-4 rounded bg-amber-500/10 animate-pulse" />
          <CardGridSkeleton count={6} />
        </div>
      ) : query && !hasResults ? (
        <EmptyState
          title={`${t('noResultsFor')} "${query}"`}
          description={t('searchSuggestions')}
          actionLabel={language === 'ar' ? 'مسح البحث' : 'Clear search'}
          onAction={handleClear}
          icon="search"
        />
      ) : (
        <div className="space-y-10">
          {/* Cast Matches */}
          {(filterType === 'all' || filterType === 'cast') && results.cast.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-amber-300 font-cinema-title tracking-wider flex items-center gap-2">
                <Clapperboard className="w-4 h-4 text-amber-400" />
                <span>{language === 'ar' ? 'طاقم العمل والممثلين' : 'Actors & Cast'}</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {results.cast.map((actor) => (
                  <div
                    key={actor.name}
                    className="movyza-glass-panel is-interactive flex items-center gap-3 p-3 rounded-2xl bg-[#090b10] border border-amber-500/15 hover:border-amber-500/30 transition-all"
                  >
                    <img
                      src={actor.avatarUrl}
                      alt={actor.name}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-full object-cover shrink-0 border border-amber-500/30"
                    />
                    <div className="truncate">
                      <p className="text-xs font-semibold text-white truncate">
                        {language === 'ar' ? actor.name : actor.nameEn}
                      </p>
                      <p className="text-[10px] text-amber-400 font-mono">
                        {actor.worksCount} {language === 'ar' ? 'أعمال' : 'titles'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Movies Results */}
          {(filterType === 'all' || filterType === 'movies') && results.movies.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-base sm:text-lg font-cinema-title font-bold text-white tracking-wide flex items-center gap-2">
                <Film className="w-4 h-4 text-amber-400" />
                <span>{t('movies')} ({results.movies.length})</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5 sm:gap-5">
                {results.movies.map((movie) => (
                  <MovieCard
                    key={movie.id}
                    movie={movie}
                    onSelect={(id) => onNavigate(`/movies/${id}`)}
                    onToggleWatchlist={onToggleWatchlist}
                    isSaved={watchlist.includes(movie.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Series Results */}
          {(filterType === 'all' || filterType === 'series') && results.series.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-base sm:text-lg font-cinema-title font-bold text-white tracking-wide flex items-center gap-2">
                <Tv className="w-4 h-4 text-amber-400" />
                <span>{t('series')} ({results.series.length})</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5 sm:gap-5">
                {results.series.map((series) => (
                  <SeriesCard
                    key={series.id}
                    series={series}
                    onSelect={(id) => onNavigate(`/series/${id}`)}
                    onToggleWatchlist={onToggleWatchlist}
                    isSaved={watchlist.includes(series.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </>
  );
};

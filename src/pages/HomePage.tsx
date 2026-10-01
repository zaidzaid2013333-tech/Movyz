import React, { useState, useEffect } from 'react';
import { Movie, Series, Genre, WatchProgress } from '../types';
import { MovyzaApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { HeroBanner } from '../components/ui/HeroBanner';
import { SectionRow } from '../components/ui/SectionRow';
import { MovieCard } from '../components/ui/MovieCard';
import { SeriesCard } from '../components/ui/SeriesCard';
import { HeroSkeleton, CardSkeleton } from '../components/ui/Skeletons';
import { ErrorState } from '../components/ui/FeedbackStates';
import { Play, Sparkles } from 'lucide-react';

interface HomePageProps {
  onNavigate: (path: string) => void;
  watchlist: string[];
  onToggleWatchlist: (item: Movie | Series) => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onNavigate, watchlist, onToggleWatchlist }) => {
  const { language, t, direction } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hero, setHero] = useState<Movie | Series | null>(null);
  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);
  const [trending, setTrending] = useState<(Movie | Series)[]>([]);
  const [popularMovies, setPopularMovies] = useState<Movie[]>([]);
  const [featuredSeries, setFeaturedSeries] = useState<Series[]>([]);
  const [recentAdded, setRecentAdded] = useState<(Movie | Series)[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);

  const fetchHomeData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await MovyzaApi.getHomeData();
      setHero(res.data.hero);
      setContinueWatching(res.data.continueWatching);
      setTrending(res.data.trending);
      setPopularMovies(res.data.popularMovies);
      setFeaturedSeries(res.data.featuredSeries);
      setRecentAdded(res.data.recentAdded);
      setGenres(res.data.genres);
    } catch (err: any) {
      setError(err?.message || 'Failed to load home data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchHomeData(); }, []);

  if (loading) {
    return (
      <div className="space-y-8 max-w-7xl mx-auto px-4 py-8 movyza-enter">
        <HeroSkeleton />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  if (error || !hero) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <ErrorState message={error || undefined} onRetry={fetchHomeData} onGoHome={fetchHomeData} />
      </div>
    );
  }

  return (
    <div className="space-y-7 pb-20 movyza-enter">
      <HeroBanner
        item={hero}
        onWatch={() => onNavigate(hero.type === 'movie' ? `/watch/movie/${hero.id}` : `/watch/tv/${hero.id}/1/1`)}
        onDetails={(id, type) => onNavigate(type === 'movie' ? `/movies/${id}` : `/series/${id}`)}
        onToggleWatchlist={onToggleWatchlist}
        isSaved={watchlist.includes(hero.id)}
      />

      {continueWatching.length > 0 && (
        <SectionRow title={t('continueWatching')} actionLabel={t('all')} onAction={() => onNavigate('/history')}>
          {continueWatching.map((item) => (
            <div
              key={item.contentId}
              onClick={() => onNavigate(item.contentType === 'movie'
                ? `/watch/movie/${item.contentId}`
                : `/watch/tv/${item.contentId}/${item.seasonNumber || 1}/${item.episodeNumber || 1}`)}
              className="w-64 sm:w-72 shrink-0 group cursor-pointer space-y-2.5 select-none"
            >
              <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-900 border border-white/[0.06] shadow-lg group-hover:-translate-y-0.5 transition-transform duration-200">
                <img
                  src={item.backdropUrl || item.posterUrl}
                  alt={language === 'ar' ? item.title : item.titleEn}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent flex items-center justify-center">
                  <div className="w-11 h-11 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center shadow-xl">
                    <Play className="w-5 h-5 fill-slate-950 translate-x-0.5" />
                  </div>
                </div>
                <div className="absolute bottom-0 inset-x-0 h-1 bg-white/15">
                  <div className="h-full bg-amber-400" style={{ width: Math.max(0, Math.min(100, item.percentage)) + '%' }} />
                </div>
              </div>
              <div className="px-1">
                <h4 className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-amber-300 transition-colors">
                  {language === 'ar' ? item.title : item.titleEn}
                </h4>
                <p className="text-[11px] text-slate-500">{item.percentage}% {language === 'ar' ? 'مكتمل' : 'completed'}</p>
              </div>
            </div>
          ))}
        </SectionRow>
      )}

      <SectionRow title={t('trendingNow')} actionLabel={t('all')} onAction={() => onNavigate('/movies')}>
        {trending.map((item) => (
          <div key={item.id} className="w-[43vw] max-w-52 sm:w-44 md:w-48 lg:w-52 shrink-0">
            {item.type === 'movie'
              ? <MovieCard movie={item as Movie} onSelect={(id) => onNavigate(`/movies/${id}`)} onToggleWatchlist={onToggleWatchlist} isSaved={watchlist.includes(item.id)} />
              : <SeriesCard series={item as Series} onSelect={(id) => onNavigate(`/series/${id}`)} onToggleWatchlist={onToggleWatchlist} isSaved={watchlist.includes(item.id)} />}
          </div>
        ))}
      </SectionRow>

      {genres.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-300" />
            <h3 className="text-sm sm:text-base font-bold font-cinema-title text-white">
              {language === 'ar' ? 'استكشف حسب النوع' : 'Browse by genre'}
            </h3>
          </div>
          <div dir={direction} className="touch-chip-scroll pb-1">
            {genres.map((genre) => (
              <button
                key={genre.id}
                onClick={() => onNavigate(`/movies?genre=${genre.id}`)}
                className="px-3.5 py-2.5 rounded-full bg-white/[0.035] hover:bg-white/[0.07] border border-white/[0.06] text-xs font-semibold text-slate-300 hover:text-white transition-all whitespace-nowrap cursor-pointer shrink-0"
              >
                {language === 'ar' ? genre.name : genre.nameEn}
              </button>
            ))}
          </div>
        </div>
      )}

      <SectionRow title={t('popularMovies')} actionLabel={t('all')} onAction={() => onNavigate('/movies')}>
        {popularMovies.map((movie) => (
          <div key={movie.id} className="w-[43vw] max-w-52 sm:w-44 md:w-48 lg:w-52 shrink-0">
            <MovieCard movie={movie} onSelect={(id) => onNavigate(`/movies/${id}`)} onToggleWatchlist={onToggleWatchlist} isSaved={watchlist.includes(movie.id)} />
          </div>
        ))}
      </SectionRow>

      <SectionRow title={t('featuredSeries')} actionLabel={t('all')} onAction={() => onNavigate('/series')}>
        {featuredSeries.map((series) => (
          <div key={series.id} className="w-[43vw] max-w-52 sm:w-44 md:w-48 lg:w-52 shrink-0">
            <SeriesCard series={series} onSelect={(id) => onNavigate(`/series/${id}`)} onToggleWatchlist={onToggleWatchlist} isSaved={watchlist.includes(series.id)} />
          </div>
        ))}
      </SectionRow>

      <SectionRow title={t('recentlyAdded')} actionLabel={t('all')} onAction={() => onNavigate('/movies')}>
        {recentAdded.map((item) => (
          <div key={item.id} className="w-[43vw] max-w-52 sm:w-44 md:w-48 lg:w-52 shrink-0">
            {item.type === 'movie'
              ? <MovieCard movie={item as Movie} onSelect={(id) => onNavigate(`/movies/${id}`)} onToggleWatchlist={onToggleWatchlist} isSaved={watchlist.includes(item.id)} />
              : <SeriesCard series={item as Series} onSelect={(id) => onNavigate(`/series/${id}`)} onToggleWatchlist={onToggleWatchlist} isSaved={watchlist.includes(item.id)} />}
          </div>
        ))}
      </SectionRow>
    </div>
  );
};
import React, { useState, useEffect } from 'react';
import { Movie, Series, Genre } from '../types';
import { MovyzaApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { MovieCard } from '../components/ui/MovieCard';
import { SeriesCard } from '../components/ui/SeriesCard';
import { CardGridSkeleton } from '../components/ui/Skeletons';
import {
  Compass,
  Flame,
  Sparkles,
  Award,
  Film,
  Dices,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface DiscoverPageProps {
  onNavigate: (path: string) => void;
  watchlist: string[];
  onToggleWatchlist: (item: Movie | Series) => void;
}

export const DiscoverPage: React.FC<DiscoverPageProps> = ({
  onNavigate,
  watchlist,
  onToggleWatchlist,
}) => {
  const { language, t } = useLanguage();
  const { openSurprise } = useTheme();
  const [items, setItems] = useState<(Movie | Series)[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [activeMood, setActiveMood] = useState<'trending' | 'critics' | 'recent' | 'arab_cinema'>('arab_cinema');
  const [selectedGenreId, setSelectedGenreId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    MovyzaApi.getGenres().then((res) => setGenres(res.data));
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      MovyzaApi.getMovies({ genreId: selectedGenreId || undefined }),
      MovyzaApi.getSeries({ genreId: selectedGenreId || undefined }),
    ]).then(([moviesRes, seriesRes]) => {
      let combined: (Movie | Series)[] = [...moviesRes.data, ...seriesRes.data];

      if (activeMood === 'arab_cinema') {
        // High rated / featured Arab titles
        combined = combined.filter((i) => i.id === 'm1' || i.id === 's1' || i.id === 'm4' || i.rating >= 8.5);
      } else if (activeMood === 'trending') {
        combined = combined.filter((i) => i.isTrending || i.rating >= 8.5);
      } else if (activeMood === 'critics') {
        combined.sort((a, b) => b.rating - a.rating);
      } else if (activeMood === 'recent') {
        combined.sort(
          (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
        );
      }

      setItems(combined);
      setLoading(false);
    });
  }, [activeMood, selectedGenreId]);

  const moods = [
    {
      id: 'arab_cinema' as const,
      label: language === 'ar' ? 'سينما عربية وخليجية' : 'Arab & Gulf',
      desc: language === 'ar' ? 'اختيارات من أفلام عربية وخليجية' : 'Selected Arab and Gulf titles',
      icon: Award,
      badge: 'RED CARPET',
    },
    {
      id: 'critics' as const,
      label: language === 'ar' ? 'اختيارات النقاد' : 'Critics',
      desc: language === 'ar' ? 'أعمال بتقييمات مرتفعة' : 'Highly rated titles',
      icon: Film,
      badge: 'GRAND PRIX',
    },
    {
      id: 'trending' as const,
      label: language === 'ar' ? 'الأكثر تداولًا' : 'Trending now',
      desc: language === 'ar' ? 'أعمال يكثر البحث والمشاهدة عنها' : 'Titles people are watching now',
      icon: Flame,
      badge: 'HOT REEL',
    },
    {
      id: 'recent' as const,
      label: language === 'ar' ? 'أضيف حديثًا' : 'Recently added',
      desc: language === 'ar' ? 'أحدث الأعمال المضافة للمكتبة' : 'Newest additions to the library',
      icon: Sparkles,
      badge: 'NEW PRINTS',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-7 movyza-enter">
      {/* Editorial Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-cinema-title font-bold text-white tracking-wide">
            {t('discover')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            {language === 'ar'
              ? 'استكشف عوالم السينما والتلفزيون بأسلوب بصري مشوق عبر المزاج الفني والتصنيفات'
              : 'Explore cinematic collections tailored by artistic mood and genres.'}
          </p>
        </div>

        {/* Surprise Me Button */}
        <button
          onClick={openSurprise}
          className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-amber-500/20 self-start md:self-auto active:scale-95"
        >
          <Dices className="w-4 h-4" />
          <span>{language === 'ar' ? 'اختر لي فيلماً عشوائياً' : 'Surprise Me!'}</span>
        </button>
      </div>

      {/* Mood Showcase Editorial Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {moods.map((m) => {
          const Icon = m.icon;
          const isActive = activeMood === m.id;

          return (
            <button
              key={m.id}
              onClick={() => setActiveMood(m.id)}
              className={`p-5 rounded-2xl border text-start transition-all duration-300 relative overflow-hidden group cursor-pointer flex flex-col justify-between min-h-[124px] ${
                isActive
                  ? 'bg-[#121624] border-white/[0.12] bg-white/[0.06]'
                  : 'bg-white/[0.025] border-white/[0.07] hover:border-white/[0.13] hover:bg-white/[0.045]'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                    isActive ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-[#151926] text-amber-400'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <span className="font-mono text-[10px] text-amber-300/80 uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-black/40 border border-amber-500/20">
                  {m.badge}
                </span>
              </div>

              <div className="mt-3">
                <h3
                  className={`text-sm font-cinema-title font-bold transition-colors ${
                    isActive ? 'text-amber-300' : 'text-white group-hover:text-amber-200'
                  }`}
                >
                  {m.label}
                </h3>
                <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                  {m.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Genre Filter Tags */}
      <div className="touch-scroll-x flex items-center gap-2 pb-1">
        <button
          onClick={() => setSelectedGenreId(null)}
          className={`min-h-[36px] px-4 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
            selectedGenreId === null
              ? 'bg-amber-400 text-slate-950 font-bold'
              : 'bg-white/[0.035] text-slate-300 hover:text-white border border-white/[0.07]'
          }`}
        >
          {t('allGenres')}
        </button>
        {genres.map((g) => (
          <button
            key={g.id}
            onClick={() => setSelectedGenreId(g.id === selectedGenreId ? null : g.id)}
            className={`min-h-[36px] px-4 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
              selectedGenreId === g.id
                ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/25'
                : 'bg-[#0f1118] text-slate-300 hover:text-white border border-amber-500/15'
            }`}
          >
            {language === 'ar' ? g.name : g.nameEn}
          </button>
        ))}
      </div>

      {/* Grid of Results */}
      {loading ? (
        <CardGridSkeleton count={8} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5 sm:gap-5">
          {items.map((item) => {
            const isMovie = item.type === 'movie';
            return isMovie ? (
              <MovieCard
                key={item.id}
                movie={item as Movie}
                onSelect={(id) => onNavigate(`/movies/${id}`)}
                onToggleWatchlist={() => onToggleWatchlist(item)}
                isSaved={watchlist.includes(item.id)}
              />
            ) : (
              <SeriesCard
                key={item.id}
                series={item as Series}
                onSelect={(id) => onNavigate(`/series/${id}`)}
                onToggleWatchlist={() => onToggleWatchlist(item)}
                isSaved={watchlist.includes(item.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

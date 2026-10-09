import React, { useState, useEffect } from 'react';
import { Movie } from '../types';
import { MovyzaApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { MovieCard } from '../components/ui/MovieCard';
import { SectionRow } from '../components/ui/SectionRow';
import { HeroSkeleton } from '../components/ui/Skeletons';
import { ErrorState } from '../components/ui/FeedbackStates';
import { ShareButton } from '../components/ui/ShareButton';
import { QuickRating } from '../components/ui/QuickRating';
import { SeoHead } from '../components/SEOHead';
import {
  Play,
  Bookmark,
  Check,
  Star,
  Calendar,
  Clock,
  Clapperboard,
  Award,
  Disc,
  Radio,
  Volume2,
} from 'lucide-react';

interface MovieDetailsPageProps {
  movieId: string;
  onNavigate: (path: string) => void;
  watchlist: string[];
  onToggleWatchlist: (movie: Movie) => void;
}

export const MovieDetailsPage: React.FC<MovieDetailsPageProps> = ({
  movieId,
  onNavigate,
  watchlist,
  onToggleWatchlist,
}) => {
  const { language, t } = useLanguage();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [similar, setSimilar] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    MovyzaApi.getMovieById(movieId)
      .then((res) => {
        if (isMounted) {
          setMovie(res.data.movie);
          setSimilar(res.data.similar);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || 'Movie not found');
          setLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [movieId]);

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setToastMessage(t('linkCopied'));
      setTimeout(() => setToastMessage(null), 2500);
    }
  };

  if (loading) {
    return <HeroSkeleton />;
  }

  if (error || !movie) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <ErrorState
          message={error || undefined}
          onRetry={() => onNavigate(`/movies/${movieId}`)}
          onGoHome={() => onNavigate('/movies')}
        />
      </div>
    );
  }

  const isSaved = watchlist.includes(movie.id);
  const titlePrimary = movie.title || movie.titleEn || movie.originalTitle;
  const titleSecondary = movie.originalTitle !== titlePrimary ? movie.originalTitle : '';
  const overview = movie.overview || movie.overviewEn || '';
  const seoDescription = overview || `${titlePrimary} — Movyza`;


  return (
    <>
      <SeoHead
        title={language === 'ar' ? `${movie.originalTitle || titlePrimary} مترجم عربي | ${titlePrimary} | موفيزا` : `${movie.originalTitle || titlePrimary} | ${titlePrimary} | Movyza`}
        description={seoDescription}
        keywords={[movie.originalTitle, movie.title, ...movie.genres.map((genre) => genre.name).filter(Boolean)]}
        image={movie.backdropUrl || movie.posterUrl}
        type="video.movie"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Movie',
          name: titlePrimary,
          alternateName: movie.originalTitle,
          image: movie.posterUrl ? [movie.posterUrl] : undefined,
          dateCreated: movie.releaseDate || undefined,
          description: seoDescription,
          aggregateRating: movie.rating > 0 ? {
            '@type': 'AggregateRating',
            ratingValue: movie.rating.toFixed(1),
            bestRating: '10',
            ratingCount: String(movie.votesCount || 1),
          } : undefined,
          url: window.location.href,
        }}
      />
      <div className="movyza-shell space-y-12 pb-20 animate-in fade-in duration-300">
      {/* Toast Notice */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl text-xs flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Cinematic Showcase Frame */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-2">
        <div className="movyza-detail-hero relative rounded-3xl overflow-hidden bg-[#07090e]">
          {/* Banner Media Backdrop */}
          <div className="relative min-h-[460px] lg:h-[62vh] max-h-[680px] overflow-hidden">
            <img
              src={movie.backdropUrl}
              alt={titlePrimary}
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover object-center scale-[1.02]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#07090e] via-[#07090e]/75 to-transparent" />
            <div className="absolute inset-0 rtl:bg-gradient-to-r ltr:bg-gradient-to-l from-[#07090e]/95 via-[#07090e]/60 to-transparent" />

            <div className="relative h-full max-w-6xl mx-auto px-6 lg:px-10 flex flex-col lg:flex-row items-end lg:items-center gap-8 pt-16 pb-12 z-10">
              {/* Poster Art with Gold Brackets */}
              <div className="movyza-detail-poster hidden sm:block w-48 lg:w-60 aspect-[2/3] rounded-2xl overflow-hidden border border-amber-500/30 shrink-0">
                <img
                  src={movie.posterUrl}
                  alt={titlePrimary}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Title & Metadata */}
              <div className="flex-1 space-y-4 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-300 font-mono">
                  <span className="flex items-center gap-1 font-bold text-amber-400">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    <span>{movie.rating.toFixed(1)}</span>
                  </span>
                  <span className="text-slate-600">·</span>
                  <span>{movie.year}</span>
                  <span className="text-slate-600">·</span>
                  <span>{movie.runtime} {t('minutes')}</span>
                  <span className="text-slate-600">·</span>
                  <span className="border border-amber-500/30 px-1.5 py-0.5 rounded text-[10px] text-amber-300">
                    {movie.ageRating}
                  </span>
                </div>

                <div className="space-y-1">
                  <h1 className="text-2xl sm:text-4xl font-bold font-cinema-title text-white tracking-tight leading-tight">
                    {titlePrimary}
                  </h1>
                  {titleSecondary && (
                    <p className="text-xs sm:text-sm font-semibold text-amber-400/80 font-cinzel tracking-wider">
                      {titleSecondary}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  {movie.genres.map((g, idx) => (
                    <React.Fragment key={g.id}>
                      <span>{language === 'ar' ? g.name : g.nameEn}</span>
                      {idx < movie.genres.length - 1 && <span className="text-slate-600">·</span>}
                    </React.Fragment>
                  ))}
                </div>

                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {overview}
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    onClick={() => onNavigate(`/watch/movie/${movie.id}`)}
                    className="min-h-[46px] px-7 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 font-bold text-xs sm:text-sm flex items-center gap-2.5 shadow-lg shadow-amber-500/25 active:scale-98 transition-all cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-slate-950 translate-x-0.5" />
                    <span>{t('watchNow')}</span>
                  </button>

                  <button
                    onClick={() => onToggleWatchlist(movie)}
                    className={`min-h-[44px] px-4 py-2 rounded-xl border text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all active:scale-98 cursor-pointer ${
                      isSaved
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                        : 'bg-white/[0.06] hover:bg-white/[0.12] text-white border-white/[0.1]'
                    }`}
                  >
                    {isSaved ? <Check className="w-4 h-4 stroke-[3]" /> : <Bookmark className="w-4 h-4" />}
                    <span>{isSaved ? t('inWatchlist') : t('addToWatchlist')}</span>
                  </button>

                  <ShareButton
                    title={titlePrimary}
                    onToast={(msg) => {
                      setToastMessage(msg);
                      setTimeout(() => setToastMessage(null), 2500);
                    }}
                  />

                  <QuickRating contentId={movie.id} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Cast & Technical Specifications */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 space-y-12">
        {/* Technical Projection Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-2xl bg-[#090b10] border border-amber-500/15 text-xs min-w-0 overflow-hidden">
          <div className="min-w-0">
            <span className="text-[10px] text-slate-500 block">{t('director')}</span>
            <span className="font-bold text-white font-cinema-title break-words">
              {movie.director || movie.directorEn}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block">نسبة العرض البصري</span>
            <span className="font-mono text-amber-400 font-bold break-words">2.39:1 Anamorphic</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block">نظام الصوت</span>
            <span className="font-mono text-white font-bold break-words">Dolby Atmos 7.1</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block">دقة العرض الرئيسية</span>
            <span className="font-mono text-emerald-400 font-bold break-words">4K Ultra HD</span>
          </div>
        </div>

        {/* Cast Gallery */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-white/[0.06] pb-3">
            <Clapperboard className="w-5 h-5 text-amber-400" />
            <h2 className="text-base sm:text-lg font-bold font-cinema-title text-white tracking-tight">
              {t('castAndCrew')}
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 min-w-0">
            {movie.cast.map((actor) => (
              <div
                key={actor.id}
                className="flex items-center gap-3 p-3 rounded-2xl bg-[#090b10] border border-amber-500/15 hover:border-amber-400/40 transition-all shadow-md min-w-0"
              >
                <img
                  src={actor.avatarUrl}
                  alt={actor.name}
                  referrerPolicy="no-referrer"
                  className="w-11 h-11 rounded-full object-cover shrink-0 border border-amber-500/30"
                />
                <div className="truncate">
                  <h4 className="text-xs font-bold font-cinema-title text-white truncate">
                    {actor.name || actor.nameEn}
                  </h4>
                  <p className="text-[10px] text-amber-400 truncate">
                    {actor.character || actor.characterEn}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Similar Titles */}
        {similar.length > 0 && (
          <SectionRow title={t('similarContent')}>
            {similar.map((item) => (
              <div key={item.id} className="w-36 sm:w-44 md:w-48 shrink-0">
                <MovieCard
                  movie={item}
                  onSelect={(id) => onNavigate(`/movies/${id}`)}
                  onToggleWatchlist={onToggleWatchlist}
                  isSaved={watchlist.includes(item.id)}
                />
              </div>
            ))}
          </SectionRow>
        )}
      </div>
      </div>
    </>
  );
};

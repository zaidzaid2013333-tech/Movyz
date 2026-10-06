import React, { useState, useEffect } from 'react';
import { Series, Season, Episode } from '../types';
import { MovyzaApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { SeriesCard } from '../components/ui/SeriesCard';
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
  Clapperboard,
  Tv,
  ListVideo,
  Award,
  Radio,
  Disc,
  Clock,
  Film,
} from 'lucide-react';

interface SeriesDetailsPageProps {
  seriesId: string;
  onNavigate: (path: string) => void;
  watchlist: string[];
  onToggleWatchlist: (series: Series) => void;
}

export const SeriesDetailsPage: React.FC<SeriesDetailsPageProps> = ({
  seriesId,
  onNavigate,
  watchlist,
  onToggleWatchlist,
}) => {
  const { language, t, direction } = useLanguage();
  const [series, setSeries] = useState<Series | null>(null);
  const [similar, setSimilar] = useState<Series[]>([]);
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    MovyzaApi.getSeriesById(seriesId)
      .then((res) => {
        if (isMounted) {
          setSeries(res.data.series);
          setSimilar(res.data.similar);
          setSelectedSeasonNumber(res.data.series.seasons[0]?.seasonNumber || 1);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || 'Series not found');
          setLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [seriesId]);

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

  if (error || !series) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <ErrorState
          message={error || undefined}
          onRetry={() => onNavigate(`/series/${seriesId}`)}
          onGoHome={() => onNavigate('/series')}
        />
      </div>
    );
  }

  const isSaved = watchlist.includes(series.id);
  const titlePrimary = series.title || series.titleEn || series.originalTitle;
  const titleSecondary = series.originalTitle !== titlePrimary ? series.originalTitle : '';
  const overview = series.overview || series.overviewEn || '';
  const seoDescription = overview || `${titlePrimary} — Movyza`;


  const activeSeason =
    series.seasons.find((s) => s.seasonNumber === selectedSeasonNumber) ||
    series.seasons[0];

  return (
    <>
      <SeoHead
        title={`${titlePrimary} | Movyza`}
        description={seoDescription}
        keywords={[series.originalTitle, series.title, ...series.genres.map((genre) => genre.name).filter(Boolean)]}
        image={series.backdropUrl || series.posterUrl}
        type="video.tv_show"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'TVSeries',
          name: titlePrimary,
          alternateName: series.originalTitle,
          image: series.posterUrl ? [series.posterUrl] : undefined,
          startDate: series.releaseDate || undefined,
          description: seoDescription,
          aggregateRating: series.rating > 0 ? {
            '@type': 'AggregateRating',
            ratingValue: series.rating.toFixed(1),
            bestRating: '10',
            ratingCount: String(series.votesCount || 1),
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

      {/* Bespoke Showcase Frame */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-2">
        <div className="movyza-detail-hero relative rounded-3xl overflow-hidden bg-[#07090e]">
          {/* Anamorphic Backdrop & Content */}
          <div className="relative min-h-[440px] lg:min-h-[500px] flex flex-col justify-end p-6 sm:p-10 lg:p-12">
            <img
              src={series.backdropUrl}
              alt={titlePrimary}
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover object-center brightness-[0.45] saturate-[1.2]"
            />
            {/* Film grain and vignette */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#07090e] via-[#07090e]/75 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#07090e]/90 via-[#07090e]/50 to-transparent" />

            <div className="relative z-10 flex flex-col md:flex-row items-start md:items-end gap-6 lg:gap-10">
              {/* Poster with Celluloid Border */}
              <div className="hidden sm:block w-44 lg:w-56 aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl border-2 border-amber-500/30 shrink-0 relative group">
                <img
                  src={series.posterUrl}
                  alt={titlePrimary}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-3">
                  <span className="font-mono text-[10px] text-amber-300 font-bold uppercase tracking-wider">
                    {series.status === 'Ongoing' ? (language === 'ar' ? 'مستمر' : 'ONGOING') : (language === 'ar' ? 'مكتمل' : 'ENDED')}
                  </span>
                </div>
              </div>

              {/* Series Information */}
              <div className="flex-1 space-y-4 max-w-3xl">
                {/* Meta badges */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold font-mono">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    <span>{series.rating.toFixed(1)} / 10</span>
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-slate-300 font-mono text-[11px]">
                    {series.startYear}
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-slate-300 font-mono text-[11px]">
                    {series.seasonsCount} {t('seasons')}
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-slate-300 text-[11px]">
                    {series.ageRating}
                  </span>
                </div>

                {/* Primary & Sub Titles */}
                <div>
                  <h1 className="text-3xl sm:text-4xl lg:text-5xl font-cinema-title font-black text-white tracking-wide leading-tight">
                    {titlePrimary}
                  </h1>
                  {titleSecondary && (
                    <p className="text-base sm:text-lg font-serif italic text-amber-400/90 mt-1">
                      {titleSecondary}
                    </p>
                  )}
                </div>

                {/* Genres */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {series.genres.map((genre) => (
                    <span
                      key={genre.id}
                      className="px-2.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs font-medium"
                    >
                      {language === 'ar' ? genre.name : genre.nameEn}
                    </span>
                  ))}
                </div>

                {/* Synopsis */}
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-2xl line-clamp-3 sm:line-clamp-none">
                  {overview}
                </p>

                {/* Main Action Buttons */}
                <div className="flex flex-wrap items-center gap-3 pt-3">
                  <button
                    onClick={() =>
                      onNavigate(
                        `/watch/tv/${series.id}/${selectedSeasonNumber}/1`
                      )
                    }
                    className="min-h-[46px] px-8 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm flex items-center gap-3 shadow-xl shadow-amber-500/30 transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-slate-950" />
                    <span>
                      {t('watchNow')} ({language === 'ar' ? 'الموسم 1 · الحلقة 1' : 'S1 · Ep1'})
                    </span>
                  </button>

                  <button
                    onClick={() => onToggleWatchlist(series)}
                    className={`min-h-[46px] px-5 rounded-xl border text-sm font-semibold flex items-center gap-2 transition-all active:scale-[0.98] cursor-pointer ${
                      isSaved
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                        : 'bg-white/[0.08] hover:bg-white/[0.14] text-white border-white/[0.15]'
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

                  <QuickRating contentId={series.id} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Seasons & Episodes Architecture */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-amber-500/15 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-400">
              <Disc className="w-5 h-5 animate-[spin_8s_linear_infinite]" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-cinema-title font-bold text-white">
                {language === 'ar' ? 'بكرات العرض والمواسم' : 'Seasons & Epics Reel'}
              </h2>
              <p className="text-xs text-slate-400">
                {language === 'ar'
                  ? 'اختر الموسم لعرض الحلقات المسجلة بجودة الماستر'
                  : 'Select a season reel to view master-quality episodes'}
              </p>
            </div>
          </div>

          {/* Season Selector Tabs */}
          <div dir={direction} className="touch-chip-scroll pb-1 sm:pb-0">
            {series.seasons.map((season) => {
              const isSelected = season.seasonNumber === selectedSeasonNumber;
              return (
                <button
                  key={season.id}
                  onClick={() => setSelectedSeasonNumber(season.seasonNumber)}
                  className={`min-h-[40px] px-4 py-1.5 rounded-xl font-medium text-xs whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-lg shadow-amber-500/20'
                      : 'bg-[#0f1118] text-slate-300 hover:text-white border border-amber-500/15 hover:border-amber-500/30'
                  }`}
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>
                    {language === 'ar'
                      ? `الموسم ${season.seasonNumber}`
                      : `Season ${season.seasonNumber}`}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    isSelected ? 'bg-slate-950/20 text-slate-950' : 'bg-white/10 text-slate-400'
                  }`}>
                    {season.episodes.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Season Header Info */}
        {activeSeason && (
          <div className="p-4 rounded-2xl bg-[#090b10] border border-amber-500/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-400">
            <div>
              <span className="font-bold text-white text-sm">
                {language === 'ar' ? activeSeason.name : activeSeason.nameEn}
              </span>
              {activeSeason.airDate && (
                <span className="mx-2 text-slate-600">· {activeSeason.airDate}</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-amber-400/90 font-mono text-[11px]">
              <span>{activeSeason.episodes.length} {language === 'ar' ? 'حلقات متاحة للعرض' : 'Episodes Available'}</span>
            </div>
          </div>
        )}

        {/* Episodes Grid with Celluloid Film Frame Style */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeSeason?.episodes.map((episode) => {
            const epTitle = episode.titleEn || episode.title;
            const epOverview = language === 'ar' ? episode.overview : episode.overviewEn;

            return (
              <div
                key={episode.id}
                onClick={() =>
                  onNavigate(
                    `/watch/tv/${series.id}/${selectedSeasonNumber}/${episode.episodeNumber}`
                  )
                }
                className="group relative rounded-2xl bg-[#0c0e15] border border-amber-500/15 hover:border-amber-500/50 overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-amber-500/10 cursor-pointer flex flex-col"
              >
                {/* Still Thumbnail with Play Overlay */}
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-900">
                  <img
                    src={episode.stillUrl}
                    alt={epTitle}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/40 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center opacity-0 group-hover:opacity-100 transform scale-75 group-hover:scale-100 transition-all shadow-xl">
                      <Play className="w-5 h-5 fill-slate-950 translate-x-0.5" />
                    </div>
                  </div>

                  {/* Top-Right Episode Number Badge */}
                  <div className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-md bg-black/80 backdrop-blur-md border border-amber-500/30 text-amber-300 font-mono text-xs font-bold">
                    EP {episode.episodeNumber}
                  </div>

                  {/* Duration Badge */}
                  <div className="absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded bg-black/80 backdrop-blur-md text-[11px] text-slate-300 flex items-center gap-1 font-mono">
                    <Clock className="w-3 h-3 text-amber-400" />
                    <span>{episode.duration} {t('minutes')}</span>
                  </div>
                </div>

                {/* Episode Details */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-2">
                  <div>
                    <h3 className="font-bold text-white text-sm group-hover:text-amber-300 transition-colors line-clamp-1">
                      {epTitle}
                    </h3>
                    <p className="text-xs text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                      {epOverview}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-slate-400">
                    <span className="font-mono">{episode.airDate}</span>
                    <span className="text-amber-400 font-semibold group-hover:underline">
                      {t('watchNow')} ←
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cast & Crew Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
        <h2 className="text-lg sm:text-xl font-cinema-title font-bold text-white flex items-center gap-2">
          <Clapperboard className="w-5 h-5 text-amber-400" />
          <span>{t('cast')}</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {series.cast.map((actor, idx) => (
            <div
              key={idx}
              className="p-3 rounded-xl bg-[#090b10] border border-amber-500/10 hover:border-amber-500/30 transition-all flex flex-col items-center text-center space-y-1.5"
            >
              <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/25 flex items-center justify-center font-bold text-amber-300 text-sm">
                {actor.name.charAt(0)}
              </div>
              <span className="font-medium text-xs text-white line-clamp-1">
                {language === 'ar' ? actor.name : actor.nameEn}
              </span>
              <span className="text-[10px] text-slate-400 line-clamp-1">
                {language === 'ar' ? actor.character : actor.characterEn}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Similar Series Section */}
      {similar.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionRow
            title={t('similarContent')}
            subtitle={
              language === 'ar'
                ? 'أعمال درامية ملحمية من نفس الطراز السينمائي'
                : 'Related epic anthologies from the royal vault'
            }
          >
            {similar.map((sim) => (
              <div key={sim.id} className="w-[180px] sm:w-[210px] shrink-0">
                <SeriesCard
                  series={sim}
                  onSelect={(id) => onNavigate(`/series/${id}`)}
                  onToggleWatchlist={() => onToggleWatchlist(sim)}
                  isSaved={watchlist.includes(sim.id)}
                />
              </div>
            ))}
          </SectionRow>
        </div>
      )}
      </div>
    </>
  );
};

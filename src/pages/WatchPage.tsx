import React, { useState, useEffect } from 'react';
import { Movie, Series, PlaybackSource, Episode } from '../types';
import { MovyzaApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { VideoPlayer } from '../components/player/VideoPlayer';
import { HeroSkeleton } from '../components/ui/Skeletons';
import { ErrorState } from '../components/ui/FeedbackStates';
import {
  ArrowLeft,
  ArrowRight,
  Share2,
  Info,
  Check,
  Disc,
  Radio,
  Tv,
  Film,
  Sparkles,
  Volume2,
  Sliders,
  ShieldAlert,
} from 'lucide-react';

interface WatchPageProps {
  contentId: string;
  seasonParam?: number;
  episodeParam?: number;
  onNavigate: (path: string) => void;
}

export const WatchPage: React.FC<WatchPageProps> = ({
  contentId,
  seasonParam,
  episodeParam,
  onNavigate,
}) => {
  const { language, t, direction } = useLanguage();
  const [content, setContent] = useState<Movie | Series | null>(null);
  const [sources, setSources] = useState<PlaybackSource[]>([]);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | undefined>(undefined);
  const [seasonNum, setSeasonNum] = useState<number>(seasonParam || 1);
  const [episodeNum, setEpisodeNum] = useState<number>(episodeParam || 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [theaterLighting, setTheaterLighting] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    // Try finding as Movie or Series
    Promise.allSettled([
      MovyzaApi.getMovieById(contentId),
      MovyzaApi.getSeriesById(contentId),
    ]).then(async ([movieRes, seriesRes]) => {
      if (!isMounted) return;

      if (movieRes.status === 'fulfilled') {
        const movie = movieRes.value.data.movie;
        setContent(movie);
        setSources(movie.sources);
        setLoading(false);
      } else if (seriesRes.status === 'fulfilled') {
        const series = seriesRes.value.data.series;
        setContent(series);

        const currentSeason =
          series.seasons.find((s) => s.seasonNumber === seasonNum) ||
          series.seasons[0];
        const episode =
          currentSeason?.episodes.find((ep) => ep.episodeNumber === episodeNum) ||
          currentSeason?.episodes[0];

        setCurrentEpisode(episode);
        setSources(episode?.sources || []);
        setLoading(false);
      } else {
        setError('تعذر العثور على المحتوى المطلوب في خوادم العرض');
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [contentId, seasonNum, episodeNum]);

  const handleSelectEpisode = (newSeason: number, newEpisode: number) => {
    setSeasonNum(newSeason);
    setEpisodeNum(newEpisode);
    onNavigate(`/watch/${contentId}?season=${newSeason}&episode=${newEpisode}`);
  };

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setToastMessage(t('linkCopied'));
      setTimeout(() => setToastMessage(null), 2500);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-4">
        <HeroSkeleton />
      </div>
    );
  }

  if (error || !content) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <ErrorState
          message={error || undefined}
          onRetry={() => onNavigate(`/watch/${contentId}`)}
          onGoHome={() => onNavigate('/')}
        />
      </div>
    );
  }

  const isMovie = content.type === 'movie';
  const displayTitle = language === 'ar' ? content.title : content.titleEn;
  const originalTitle = language === 'ar' ? content.titleEn : content.originalTitle;
  const overview = isMovie
    ? language === 'ar'
      ? (content as Movie).overview
      : (content as Movie).overviewEn
    : currentEpisode
    ? language === 'ar'
      ? currentEpisode.overview
      : currentEpisode.overviewEn
    : language === 'ar'
    ? (content as Series).overview
    : (content as Series).overviewEn;

  return (
    <div className={`min-h-screen transition-colors duration-700 pb-16 animate-in fade-in duration-300 ${
      theaterLighting ? 'bg-[#030406]' : 'bg-[#0a0c12]'
    }`}>
      {/* Toast Notice */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl text-xs flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Projection Stage Top Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-3 pb-2 flex items-center justify-between text-xs border-b border-amber-500/15 text-slate-400">
        <button
          onClick={() =>
            onNavigate(isMovie ? `/movies/${content.id}` : `/series/${content.id}`)
          }
          className="text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          {direction === 'rtl' ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
          <span>{language === 'ar' ? 'العودة لبطاقة العمل السينمائي' : 'Back to Showcase'}</span>
        </button>

        {/* Projection Booth Telemetry */}
        <div className="flex items-center gap-4 text-[11px] font-mono">
          <button
            onClick={() => setTheaterLighting(!theaterLighting)}
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full border transition-all cursor-pointer ${
              theaterLighting
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                : 'bg-white/5 border-white/10 text-slate-400'
            }`}
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>{language === 'ar' ? 'إضاءة المسرح المعتمة' : 'Theater Ambiance'}</span>
          </button>

          <div className="flex items-center gap-2 text-slate-500">
            <span className="text-amber-400/90 font-bold">4K 60FPS</span>
            <span>·</span>
            <span>PCM 24-BIT</span>
          </div>
        </div>
      </div>

      {/* Custom Cinema Video Player with Ambient Back-glow */}
      <div className="relative w-full max-w-7xl mx-auto sm:px-4 pt-3">
        {/* Ambient Projector Back-Glow */}
        {theaterLighting && (
          <div className="absolute -inset-1 bg-gradient-to-r from-amber-600/15 via-orange-500/10 to-amber-700/15 blur-2xl -z-10 rounded-3xl opacity-75" />
        )}

        <div className="rounded-2xl overflow-hidden border border-amber-500/25 shadow-2xl shadow-black bg-black">
          <VideoPlayer
            contentId={content.id}
            contentType={content.type}
            title={displayTitle}
            titleEn={content.titleEn}
            posterUrl={content.posterUrl}
            backdropUrl={content.backdropUrl}
            sources={sources}
            seasonNumber={seasonNum}
            episodeNumber={episodeNum}
            currentEpisode={currentEpisode}
            allSeasons={!isMovie ? (content as Series).seasons : undefined}
            onSelectEpisode={handleSelectEpisode}
            onNavigateBack={() =>
              onNavigate(isMovie ? `/movies/${content.id}` : `/series/${content.id}`)
            }
          />
        </div>
      </div>

      {/* Below-Player Editorial Soundstage Details */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-8">
        {/* Navigation & Header Info */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b border-amber-500/15 pb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-xs font-bold">
                {isMovie ? (language === 'ar' ? 'عرض سينمائي' : 'FEATURE FILM') : (language === 'ar' ? 'بث مسلسل' : 'EPISODE STREAM')}
              </span>
              <span className="text-slate-500 text-xs font-mono">ID: {content.id}</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-cinema-title font-bold text-white tracking-wide">
              {displayTitle}
            </h1>

            {/* Episode title if series */}
            {currentEpisode && (
              <p className="text-sm font-semibold text-amber-400 font-cinema-title">
                {t('season')} {seasonNum} · {t('episode')} {episodeNum}:{' '}
                {language === 'ar' ? currentEpisode.title : currentEpisode.titleEn}
              </p>
            )}

            <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
              <span className="text-slate-300">{originalTitle}</span>
              <span aria-hidden="true" className="text-amber-500/40">·</span>
              <span className="tabular-nums">
                {isMovie ? (content as Movie).year : (content as Series).startYear}
              </span>
              <span aria-hidden="true" className="text-amber-500/40">·</span>
              <span className="font-bold text-amber-400">
                ★ {content.rating.toFixed(1)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleShare}
              className="px-4 py-2.5 rounded-xl bg-[#0f1118] hover:bg-[#151822] text-slate-300 hover:text-white border border-amber-500/20 text-xs font-medium flex items-center gap-2 transition-all cursor-pointer shadow-lg"
            >
              <Share2 className="w-4 h-4 text-amber-400" />
              <span>{t('share')}</span>
            </button>
          </div>
        </div>

        {/* Synopsis & Episode Picker for series */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2 text-amber-300 text-sm font-cinema-title font-bold">
              <Info className="w-4 h-4 text-amber-400" />
              <span>{t('storyOverview')}</span>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl">
              {overview}
            </p>

            {/* Projectionist Master Notice */}
            <div className="p-4 rounded-2xl bg-[#08090f] border border-amber-500/15 flex items-start gap-3 text-xs text-slate-400">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold text-slate-200">
                  {language === 'ar' ? 'نظام البث الذكي الآلي (Smart Stream Failover)' : 'Automated Stream Failover'}
                </span>
                <p className="text-[11px] leading-relaxed">
                  {language === 'ar'
                    ? 'في حال واجهت أي تقطيع أو تأخير في الاستجابة، يقوم المشغل تلقائياً بالتحويل إلى خادم الحافة الأقرب. يمكنك أيضاً تبديل المصادر يدوياً من قائمة المشغل.'
                    : 'If buffering or latency occurs, Movyza automatically switches to the nearest edge cache CDN. You can also manually switch sources inside the player.'}
                </p>
              </div>
            </div>
          </div>

          {/* If Series: Fast Episode Selector */}
          {!isMovie && (content as Series).seasons && (
            <div className="p-5 rounded-2xl bg-[#090b10] border border-amber-500/20 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-amber-500/15 pb-3">
                <div className="flex items-center gap-2 font-cinema-title font-bold text-white text-xs">
                  <Film className="w-4 h-4 text-amber-400" />
                  <span>{t('seasonsAndEpisodes')}</span>
                </div>
                <span className="text-[10px] text-amber-400 font-mono">
                  {language === 'ar' ? `الموسم ${seasonNum}` : `Season ${seasonNum}`}
                </span>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {(content as Series).seasons
                  .find((s) => s.seasonNumber === seasonNum)
                  ?.episodes.map((ep) => {
                    const isCurrent = ep.episodeNumber === episodeNum;
                    return (
                      <button
                        key={ep.id}
                        onClick={() => handleSelectEpisode(seasonNum, ep.episodeNumber)}
                        className={`w-full text-start p-3 rounded-xl text-xs flex items-center justify-between transition-all cursor-pointer ${
                          isCurrent
                            ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/25'
                            : 'bg-[#10131d] text-slate-300 hover:text-white hover:bg-[#161a27] border border-amber-500/10'
                        }`}
                      >
                        <span className="truncate pr-2">
                          <span className="font-mono opacity-60 ml-1">#{ep.episodeNumber}</span>{' '}
                          {language === 'ar' ? ep.title : ep.titleEn}
                        </span>
                        <span className="text-[10px] opacity-75 shrink-0 font-mono">
                          {ep.duration} {t('minutes')}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

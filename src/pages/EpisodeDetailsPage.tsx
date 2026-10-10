import React, { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Clock3, Play, Star, Tv } from 'lucide-react';
import { ErrorState } from '../components/ui/FeedbackStates';
import { HeroSkeleton } from '../components/ui/Skeletons';
import { SeoHead, buildFreeContentTitle } from '../components/SEOHead';
import { useLanguage } from '../context/LanguageContext';
import { MovyzaApi } from '../services/api';
import { Episode, Season, Series } from '../types';

interface EpisodeDetailsPageProps {
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
  onNavigate: (path: string) => void;
}

export const EpisodeDetailsPage: React.FC<EpisodeDetailsPageProps> = ({
  seriesId,
  seasonNumber,
  episodeNumber,
  onNavigate,
}) => {
  const { language } = useLanguage();
  const [series, setSeries] = useState<Series | null>(null);
  const [season, setSeason] = useState<Season | null>(null);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      MovyzaApi.getSeriesById(seriesId),
      MovyzaApi.getSeriesSeasonByTmdbId(Number(seriesId), seasonNumber),
    ]).then(([seriesResult, seasonResult]) => {
      if (!active) return;
      const selectedEpisode = seasonResult.data.episodes.find(
        (item) => item.episodeNumber === episodeNumber,
      ) || null;
      setSeries(seriesResult.data.series);
      setSeason(seasonResult.data);
      setEpisode(selectedEpisode);
      if (!selectedEpisode) setError('Episode information is not available yet.');
      setLoading(false);
    }).catch((cause) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : 'Unable to load episode information.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [seriesId, seasonNumber, episodeNumber]);

  if (loading) return <HeroSkeleton />;

  if (error || !series || !season || !episode) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <ErrorState
          message={error || undefined}
          onRetry={() => onNavigate(`/episodes/${seriesId}/${seasonNumber}/${episodeNumber}`)}
          onGoHome={() => onNavigate('/')}
        />
      </div>
    );
  }

  const seriesTitle = series.title || series.titleEn || series.originalTitle;
  const episodeTitle = episode.title || episode.titleEn || `Episode ${episodeNumber}`;
  const pageTitle = `${seriesTitle} — ${episodeTitle} (S${seasonNumber} E${episodeNumber})`;
  const description = episode.overview || episode.overviewEn
    || `${episodeTitle}, Season ${seasonNumber}, Episode ${episodeNumber} of ${seriesTitle}. ${series.overview || series.overviewEn || ''}`.trim();
  const image = episode.stillUrl || series.backdropUrl || series.posterUrl;

  return (
    <>
      <SeoHead
        title={buildFreeContentTitle(language, pageTitle, 'episode')}
        description={description}
        keywords={[seriesTitle, episodeTitle, `Season ${seasonNumber}`, `Episode ${episodeNumber}`, 'free']}
        image={image}
        type="video.tv_show"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'TVEpisode',
          name: episodeTitle,
          description,
          image: image ? [image] : undefined,
          datePublished: episode.airDate || undefined,
          episodeNumber,
          partOfSeason: {
            '@type': 'TVSeason',
            seasonNumber,
            name: season.name || `Season ${seasonNumber}`,
          },
          partOfSeries: {
            '@type': 'TVSeries',
            name: seriesTitle,
            url: window.location.origin + `/${language}/series/${seriesId}`,
          },
          url: window.location.href,
          inLanguage: language,
        }}
      />
      <div className="min-h-[70vh] max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        <button
          onClick={() => onNavigate(`/series/${seriesId}`)}
          className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-amber-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {language === 'ar' ? 'العودة إلى معلومات المسلسل' : 'Back to series information'}
        </button>

        <article className="overflow-hidden rounded-3xl border border-amber-500/20 bg-[#0b0d13]">
          <div className="relative aspect-[16/7] min-h-48 bg-black">
            {image && (
              <img src={image} alt={episodeTitle} className="absolute inset-0 w-full h-full object-cover" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0b0d13] via-black/35 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-8">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <Tv className="w-4 h-4" />
                {language === 'ar' ? `الموسم ${seasonNumber} · الحلقة ${episodeNumber}` : `Season ${seasonNumber} · Episode ${episodeNumber}`}
              </div>
              <h1 className="mt-2 text-2xl sm:text-4xl font-bold text-white">{episodeTitle}</h1>
              <p className="mt-2 text-sm text-slate-300">{seriesTitle}</p>
            </div>
          </div>

          <div className="p-5 sm:p-8 space-y-5">
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
              {episode.airDate && (
                <span className="inline-flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-amber-400" /> {episode.airDate}
                </span>
              )}
              {episode.duration > 0 && (
                <span className="inline-flex items-center gap-2">
                  <Clock3 className="w-4 h-4 text-amber-400" /> {episode.duration} {language === 'ar' ? 'دقيقة' : 'min'}
                </span>
              )}
              {series.rating > 0 && (
                <span className="inline-flex items-center gap-2">
                  <Star className="w-4 h-4 fill-amber-400 text-amber-400" /> {series.rating.toFixed(1)}
                </span>
              )}
            </div>
            <p className="max-w-4xl text-sm sm:text-base leading-8 text-slate-300 whitespace-pre-line">
              {description}
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={() => onNavigate(`/watch/tv/${seriesId}/${seasonNumber}/${episodeNumber}`)}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition-transform active:scale-[0.98]"
              >
                <Play className="w-4 h-4 fill-slate-950" />
                {language === 'ar' ? 'شاهد الحلقة' : 'Watch episode'}
              </button>
              <button
                onClick={() => onNavigate(`/series/${seriesId}`)}
                className="min-h-12 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-white hover:bg-white/[0.08]"
              >
                {language === 'ar' ? 'كل مواسم وحلقات المسلسل' : 'All seasons and episodes'}
              </button>
            </div>
          </div>
        </article>
      </div>
    </>
  );
};

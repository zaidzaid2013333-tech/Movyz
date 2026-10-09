import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Clock3, ExternalLink, Film, Loader2, Play, Share2, Star, Tv, Users } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { MovyzaApi } from '../services/api';
import { Movie, Series, Episode, Season } from '../types';
import { MovieCard } from '../components/ui/MovieCard';
import { SeriesCard } from '../components/ui/SeriesCard';

const VIDSRC_BASE_URL = 'https://player.movyza.sbs';
import { HeroSkeleton } from '../components/ui/Skeletons';
import { ErrorState } from '../components/ui/FeedbackStates';

interface WatchPageProps {
  mediaType: 'movie' | 'series';
  contentId: string;
  seasonNumber?: number;
  episodeNumber?: number;
  onNavigate: (path: string) => void;
}

export const WatchPage: React.FC<WatchPageProps> = ({
  mediaType,
  contentId,
  seasonNumber,
  episodeNumber,
  onNavigate,
}) => {
  const { language, t, direction } = useLanguage();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [similarMovies, setSimilarMovies] = useState<Movie[]>([]);
  const [similarSeries, setSimilarSeries] = useState<Series[]>([]);
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeFailed, setIframeFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const isSeries = mediaType === 'series';
  const safeSeason = Math.max(1, Number(seasonNumber || 1));
  const safeEpisode = Math.max(1, Number(episodeNumber || 1));

  const subtitlePriority = useMemo(() => {
    // The explicit Movyz page language is authoritative for subtitle selection.
    // This prevents an incorrect CDN geolocation/browser language from forcing
    // French (or another language) on users who are viewing an Arabic page.
    const fallbackByLanguage: Record<string, string[]> = {
      en: ['en'],
    };
    return fallbackByLanguage[language] || [language, 'en'];
  }, [language]);

  const embedUrl = useMemo(() => {
    if (!contentId) return '';

    const params = new URLSearchParams();
    // VidSrc accepts up to three subtitle languages in priority order.
    params.set('ds_lang', subtitlePriority.join(','));
    // Custom VidSrc domains support direct autoplay when the browser permits it.
    params.set('autoplay', '1');

    if (isSeries) {
      return VIDSRC_BASE_URL + '/embed/tv/' + encodeURIComponent(contentId) + '/' + safeSeason + '/' + safeEpisode + '?' + params.toString();
    }
    return VIDSRC_BASE_URL + '/embed/movie/' + encodeURIComponent(contentId) + '?' + params.toString();
  }, [contentId, isSeries, safeSeason, safeEpisode, subtitlePriority]);

  const subtitleLabel = subtitlePriority[0] ? subtitlePriority[0].toUpperCase() + ' subtitles' : 'Subtitles';

  // Third-party iframe failures do not reliably fire onError. Bound the
  // loading state so users get a recovery action instead of an endless spinner.
  useEffect(() => {
    if (loading || iframeLoaded || iframeFailed || !embedUrl) return;
    const timeout = window.setTimeout(() => setIframeFailed(true), 20_000);
    return () => window.clearTimeout(timeout);
  }, [embedUrl, iframeFailed, iframeLoaded, loading]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    setIframeLoaded(false);
    setIframeFailed(false);

    const load = async () => {
      try {
        if (isSeries) {
          // Playback must not depend on a season/episode metadata request.
          // Load the series details first, then fetch the selected season as a
          // best-effort enhancement without blocking the player.
          const res = await MovyzaApi.getSeriesByTmdbId(Number(contentId));
          if (!mounted) return;
          setSeries(res.data.series);
          setActiveSeason(null);
          setMovie(null);
          setSimilarMovies([]);
          setSimilarSeries(res.data.similar || []);

          void MovyzaApi.getSeriesSeasonByTmdbId(Number(contentId), safeSeason)
            .then((seasonRes) => {
              if (mounted) setActiveSeason(seasonRes.data);
            })
            .catch(() => {
              // Season metadata is optional; the external player can still play.
            });
        } else {
          const res = await MovyzaApi.getMovieByTmdbId(Number(contentId));
          if (!mounted) return;
          setMovie(res.data.movie);
          setSimilarMovies(res.data.similar);
          setSeries(null);
          setSimilarSeries([]);
          setActiveSeason(null);
        }
      } catch (err: any) {
        if (mounted) setError(err?.message || (language === 'ar' ? 'تعذر تحميل بيانات العمل' : 'Unable to load title data'));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => { mounted = false; };
  }, [contentId, isSeries, safeSeason, safeEpisode, language]);



  const activeEpisode: Episode | null =
    activeSeason?.episodes.find((episode) => episode.episodeNumber === safeEpisode) || null;

  const title = movie ? (movie.title || movie.titleEn || movie.originalTitle) : (series?.title || series?.titleEn || series?.originalTitle || '');
  const backdrop = movie?.backdropUrl || series?.backdropUrl || '';
  const poster = movie?.posterUrl || series?.posterUrl || '';
  const overview = movie
    ? (language === 'ar' ? movie.overview : movie.overviewEn)
    : (language === 'ar' ? series?.overview || '' : series?.overviewEn || '');

  const subtitleHint = (() => {
    const hints: Record<string, string> = {
      ar: 'يمكنك تغيير شكل الترجمة من إعدادات المشغل بما يناسب ذوقك.',
      en: 'You can customize the subtitle style from the player settings to suit your taste.',
      fr: 'Vous pouvez personnaliser l’apparence des sous-titres depuis les réglages du lecteur.',
      de: 'Du kannst das Erscheinungsbild der Untertitel in den Player-Einstellungen anpassen.',
      es: 'Puedes personalizar el estilo de los subtítulos desde los ajustes del reproductor.',
      it: 'Puoi personalizzare lo stile dei sottotitoli dalle impostazioni del lettore.',
      pt: 'Você pode personalizar o estilo das legendas nas configurações do player.',
      ru: 'Вы можете настроить внешний вид субтитров в настройках плеера.',
      tr: 'Altyazı görünümünü oynatıcı ayarlarından zevkinize göre değiştirebilirsiniz.',
      hi: 'आप प्लेयर की सेटिंग्स से सबटाइटल का रूप अपनी पसंद के अनुसार बदल सकते हैं।',
      ja: 'プレーヤー設定から字幕の見た目を好みに合わせて変更できます。',
      ko: '플레이어 설정에서 자막 스타일을 원하는 대로 변경할 수 있습니다.',
    };
    return hints[language] || hints.en;
  })();

  const copyLink = async () => {
    try {
      await navigator.clipboard?.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070b]">
        <HeroSkeleton />
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="aspect-video rounded-3xl bg-white/[0.03] animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || (!movie && !series)) {
    return (
      <div className="min-h-screen bg-[#05070b] flex items-center justify-center p-5">
        <ErrorState
          message={error || (language === 'ar' ? 'العمل غير موجود' : 'Title not found')}
          onRetry={() => onNavigate(window.location.pathname)}
          onGoHome={() => onNavigate(isSeries ? '/series' : '/movies')}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05070b] text-white">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          {backdrop && (
            <img src={backdrop} alt="" aria-hidden="true" referrerPolicy="no-referrer"
              className="w-full h-full object-cover scale-110 blur-sm opacity-20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-[#05070b]/20 via-[#05070b]/80 to-[#05070b]" />
        </div>

        <div className="relative max-w-[1500px] mx-auto px-3 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-9">
          <div className="flex items-center justify-between gap-3 mb-5">
            <button
              onClick={() => onNavigate(isSeries ? '/series/' + contentId : '/movies/' + contentId)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-200 backdrop-blur-md hover:bg-white/[0.08]"
            >
              <ArrowLeft className="w-4 h-4" />
              {language === 'ar' ? 'العودة للتفاصيل' : 'Back to details'}
            </button>

            <button
              onClick={copyLink}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-xs font-semibold text-slate-200 backdrop-blur-md hover:bg-white/[0.08]"
            >
              <Share2 className="w-4 h-4" />
              {copied ? (language === 'ar' ? 'تم النسخ' : 'Copied') : (language === 'ar' ? 'مشاركة' : 'Share')}
            </button>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 lg:gap-7 items-start">
            <div>
              <div
                dir={direction}
                className="mb-3 rounded-xl border border-amber-400/15 bg-amber-400/[0.05] px-3.5 py-2.5 text-[11px] sm:text-xs leading-5 text-amber-100/80"
              >
                {subtitleHint}
              </div>

              <div className="relative aspect-video w-full overflow-hidden rounded-2xl sm:rounded-3xl bg-black border border-white/[0.09] shadow-2xl">
                {!iframeLoaded && !iframeFailed && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#030405]">
                    <div className="flex flex-col items-center gap-3 text-slate-300">
                      <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
                      <span className="text-xs sm:text-sm">{language === 'ar' ? 'جاري تحميل المشغل…' : 'Loading player…'}</span>
                    </div>
                  </div>
                )}

                {iframeFailed ? (
                  <div className="absolute inset-0 flex items-center justify-center p-6 text-center bg-[#030405]">
                    <div className="max-w-md space-y-4">
                      <Film className="mx-auto w-10 h-10 text-rose-300" />
                      <h2 className="text-lg font-bold">{language === 'ar' ? 'تعذر تحميل المشغل' : 'Player failed to load'}</h2>
                      <p className="text-xs sm:text-sm text-slate-400 leading-6">
                        {language === 'ar' ? 'يمكنك فتح المشغل مباشرة في نافذة جديدة.' : 'You can open the player directly in a new tab.'}
                      </p>
                      <a href={embedUrl} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs sm:text-sm">
                        <ExternalLink className="w-4 h-4" />
                        {language === 'ar' ? 'فتح المشغل' : 'Open player'}
                      </a>
                    </div>
                  </div>
                ) : (
                  <iframe
                    key={embedUrl}
                    src={embedUrl}
                    title={isSeries ? 'VidSrc TV ' + contentId : 'VidSrc Movie ' + contentId}
                    className="w-full h-full border-0 bg-black"
                    allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                    allowFullScreen
                    referrerPolicy="no-referrer"
                    onLoad={() => setIframeLoaded(true)}
                    onError={() => setIframeFailed(true)}
                  />
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] px-2.5 py-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    VidSrc
                  </span>
                  <span className="rounded-full bg-emerald-500/[0.08] border border-emerald-400/15 px-2.5 py-1.5 text-emerald-200">
                    {language === 'ar' ? ('ترجمة ' + subtitlePriority[0].toUpperCase() + ' · VidSrc') : (subtitleLabel + ' · VidSrc')}
                  </span>
                  <span className="rounded-full bg-white/[0.04] border border-white/[0.06] px-2.5 py-1.5">
                    {language === 'ar' ? 'مشغل خارجي' : 'External player'}
                  </span>
                </div>
                <a href={embedUrl} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-400 hover:text-white">
                  <ExternalLink className="w-3.5 h-3.5" />
                  {language === 'ar' ? 'فتح خارج الموقع' : 'Open externally'}
                </a>
              </div>
            </div>

            <aside className="rounded-3xl border border-white/[0.08] bg-[#090c12]/90 backdrop-blur-xl p-5 sm:p-6">
              <div className="flex gap-4">
                <img src={poster} alt={title} referrerPolicy="no-referrer"
                  className="w-24 sm:w-28 aspect-[2/3] object-cover rounded-2xl border border-white/10 shadow-xl shrink-0" />
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 px-2 py-1 text-[11px] font-bold">
                    <Star className="w-3 h-3 fill-current" />
                    {(movie?.rating ?? series?.rating ?? 0).toFixed(1)}
                  </span>
                  <h1 className="mt-2 text-xl sm:text-2xl font-cinema-title font-black leading-tight">{title}</h1>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] px-2.5 py-2 text-slate-300">
                  <CalendarDays className="w-3.5 h-3.5 text-amber-300" />
                  {movie?.year || series?.startYear}
                </span>
                {movie && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] px-2.5 py-2 text-slate-300">
                    <Clock3 className="w-3.5 h-3.5 text-amber-300" />
                    {movie.runtime} {t('minutes')}
                  </span>
                )}
                {series && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] px-2.5 py-2 text-slate-300">
                    <Tv className="w-3.5 h-3.5 text-amber-300" />
                    {series.seasonsCount} {t('seasons')}
                  </span>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {(movie?.genres || series?.genres || []).slice(0, 5).map((genre) => (
                  <span key={genre.id} className="rounded-full bg-amber-500/[0.07] border border-amber-500/15 px-2.5 py-1 text-[10px] font-semibold text-amber-200">
                    {language === 'ar' ? genre.name : genre.nameEn}
                  </span>
                ))}
              </div>

              {isSeries && activeEpisode && (
                <div className="mt-5 rounded-2xl border border-amber-500/15 bg-amber-500/[0.05] p-4">
                  <div className="text-[11px] font-bold text-amber-300">S{safeSeason} · E{safeEpisode}</div>
                  <h2 className="mt-1 text-sm font-bold text-white">{activeEpisode.title || activeEpisode.titleEn}</h2>
                  <p className="mt-2 text-[11px] text-slate-400 leading-5 line-clamp-4">
                    {language === 'ar' ? activeEpisode.overview : activeEpisode.overviewEn}
                  </p>
                </div>
              )}

              <div className="mt-5 flex items-center gap-2 text-[11px] text-slate-500">
                <Users className="w-4 h-4" />
                <span>
                  {movie?.director
                    ? (language === 'ar' ? 'المخرج: ' + movie.director : 'Director: ' + movie.directorEn)
                    : series?.creator
                      ? (language === 'ar' ? 'المنشئ: ' + series.creator : 'Creator: ' + series.creatorEn)
                      : ''}
                </span>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {isSeries && series && activeSeason && (
        <section className="max-w-[1500px] mx-auto px-3 sm:px-6 lg:px-8 pb-2">
          <div className="rounded-3xl border border-white/[0.07] bg-[#090c12] overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-amber-300/70 font-bold">
                  {language === 'ar' ? 'الحلقات' : 'Episodes'}
                </div>
                <h2 className="mt-1 text-base sm:text-lg font-bold">
                  {language === 'ar' ? 'الموسم ' + activeSeason.seasonNumber : (activeSeason.nameEn || 'Season ' + activeSeason.seasonNumber)}
                </h2>
              </div>
              <div className="flex gap-1.5 overflow-x-auto touch-scroll-x max-w-full">
                {series.seasons.map((season) => (
                  <button
                    key={season.seasonNumber}
                    onClick={() => onNavigate('/watch/tv/' + contentId + '/' + season.seasonNumber + '/1')}
                    className={
                      'px-3 py-2 rounded-xl text-[11px] font-bold border shrink-0 ' +
                      (season.seasonNumber === safeSeason
                        ? 'bg-amber-400 text-slate-950 border-amber-300'
                        : 'bg-white/[0.03] text-slate-300 border-white/[0.07] hover:bg-white/[0.07]')
                    }
                  >
                    {season.seasonNumber}
                  </button>
                ))}
              </div>
            </div>

            <div dir={direction} className="p-3 sm:p-4 overflow-x-auto touch-scroll-x">
              <div className="flex gap-2 min-w-max">
                {activeSeason.episodes.map((episode) => {
                  const selected = episode.episodeNumber === safeEpisode;
                  return (
                    <button
                      key={episode.episodeNumber}
                      onClick={() => onNavigate('/watch/tv/' + contentId + '/' + activeSeason.seasonNumber + '/' + episode.episodeNumber)}
                      className={
                        'group w-64 sm:w-72 text-start rounded-2xl overflow-hidden border transition-all ' +
                        (selected ? 'border-amber-400/50 bg-amber-500/[0.08]' : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05]')
                      }
                    >
                      <div className="relative aspect-video overflow-hidden bg-black">
                        <img src={episode.stillUrl || series.backdropUrl} alt={episode.title || episode.titleEn}
                          referrerPolicy="no-referrer" loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                        <div className="absolute bottom-2 inset-x-2 flex items-center justify-between">
                          <span className="px-2 py-1 rounded-lg bg-black/60 backdrop-blur text-[10px] font-bold">
                            E{episode.episodeNumber}
                          </span>
                          {selected && <span className="px-2 py-1 rounded-lg bg-amber-400 text-slate-950 text-[10px] font-black">{language === 'ar' ? 'تشاهد الآن' : 'PLAYING'}</span>}
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center shrink-0">
                            <Play className="w-3 h-3 fill-slate-950" />
                          </div>
                          <h3 className="text-xs font-bold text-white truncate">{episode.titleEn || episode.title || 'Episode ' + episode.episodeNumber}</h3>
                        </div>
                        <p className="mt-2 text-[10px] text-slate-500">
                          {(episode.airDate || '') + (episode.duration ? ' · ' + episode.duration + ' ' + t('minutes') : '')}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="max-w-[1500px] mx-auto px-3 sm:px-6 lg:px-8 py-5">
        <div className="grid lg:grid-cols-[1.35fr_1fr] gap-5">
          <article className="rounded-3xl border border-white/[0.07] bg-[#090c12] p-5 sm:p-7">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-400/10 border border-amber-400/15 flex items-center justify-center">
                <Film className="w-4 h-4 text-amber-300" />
              </div>
              <h2 className="text-base sm:text-lg font-bold">{language === 'ar' ? 'عن العمل' : 'About this title'}</h2>
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              {overview || (language === 'ar' ? 'لا يوجد وصف متاح لهذا العمل.' : 'No synopsis is available for this title.')}
            </p>
          </article>

          <article className="rounded-3xl border border-white/[0.07] bg-[#090c12] p-5 sm:p-7">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-400/10 border border-amber-400/15 flex items-center justify-center">
                <Users className="w-4 h-4 text-amber-300" />
              </div>
              <h2 className="text-base sm:text-lg font-bold">{language === 'ar' ? 'طاقم العمل' : 'Cast'}</h2>
            </div>
            <div dir={direction} className="mt-4 flex gap-3 overflow-x-auto touch-scroll-x pb-1">
              {(movie?.cast || series?.cast || []).slice(0, 10).map((actor) => (
                <div key={actor.id} className="w-20 shrink-0 text-center">
                  <img src={actor.avatarUrl} alt={actor.nameEn || actor.name} referrerPolicy="no-referrer" loading="lazy"
                    className="w-16 h-16 rounded-2xl mx-auto object-cover border border-white/10" />
                  <p className="mt-2 text-[10px] font-semibold text-slate-200 line-clamp-2">{language === 'ar' ? actor.name : actor.nameEn}</p>
                  <p className="mt-1 text-[9px] text-amber-300/70 line-clamp-1">{language === 'ar' ? actor.character : actor.characterEn}</p>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      {(similarMovies.length > 0 || similarSeries.length > 0) && (
        <section className="max-w-[1500px] mx-auto px-3 sm:px-6 lg:px-8 pb-24">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-xl bg-amber-400/10 border border-amber-400/15 flex items-center justify-center">
              <Star className="w-4 h-4 text-amber-300" />
            </div>
            <h2 className="text-base sm:text-lg font-bold">{language === 'ar' ? 'قد يعجبك أيضاً' : 'You may also like'}</h2>
          </div>
          <div dir={direction} className="flex gap-3 sm:gap-4 overflow-x-auto touch-scroll-x pb-2">
            {similarMovies.map((item) => (
              <div key={item.id} className="w-36 sm:w-44 md:w-48 shrink-0">
                <MovieCard movie={item} onSelect={(id) => onNavigate('/movies/' + id)} />
              </div>
            ))}
            {similarSeries.map((item) => (
              <div key={item.id} className="w-36 sm:w-44 md:w-48 shrink-0">
                <SeriesCard series={item} onSelect={(id) => onNavigate('/series/' + id)} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

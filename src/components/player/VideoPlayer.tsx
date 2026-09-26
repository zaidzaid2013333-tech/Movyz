import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Episode, Season, WatchProgress, ContentType } from '../../types';
import { MovyzaApi } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';

interface VideoPlayerProps {
  contentId: string;
  contentType: ContentType;
  title: string;
  titleEn: string;
  posterUrl: string;
  backdropUrl: string;
  tmdbId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  currentEpisode?: Episode;
  allSeasons?: Season[];
  onSelectEpisode?: (seasonNum: number, episodeNum: number) => void;
  onNavigateBack: () => void;
}

const VIDRIFT_ORIGIN = 'https://embed.vidrift.net';

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  contentId,
  contentType,
  title,
  titleEn,
  posterUrl,
  backdropUrl,
  tmdbId,
  seasonNumber,
  currentEpisode,
  episodeNumber,
  allSeasons,
  onSelectEpisode,
}) => {
  const { language } = useLanguage();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resumeRef = useRef<WatchProgress | null>(null);
  const [sourcePanel, setSourcePanel] = useState<{ panel: string; options: Array<{ option: string; value: string; label: string; group?: string }> } | null>(null);

  const isMovie = contentType === 'movie';
  const safeTmdbId = Number(tmdbId || 0);

  const embedUrl = useMemo(() => {
    if (!safeTmdbId) return '';
    const path = isMovie
      ? `/embed/movie/${safeTmdbId}`
      : `/embed/tv/${safeTmdbId}/${Number(seasonNumber || 1)}/${Number(episodeNumber || 1)}`;
    const params = new URLSearchParams({
      title: isMovie ? title : `${title} · S${seasonNumber} E${episodeNumber}`,
      brand: 'Movyza',
      mobileSheets: 'true',
    });
    return `${VIDRIFT_ORIGIN}${path}?${params.toString()}`;
  }, [episodeNumber, isMovie, safeTmdbId, seasonNumber, title]);

  useEffect(() => {
    let active = true;
    MovyzaApi.getWatchProgress(contentId, isMovie ? undefined : currentEpisode?.id).then((res) => {
      if (active) resumeRef.current = res.data;
    }).catch(() => {});
    return () => { active = false; };
  }, [contentId, isMovie, episodeNumber, seasonNumber]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== VIDRIFT_ORIGIN || !event.data) return;
      const data = event.data;

      if (data.type === 'vidrift:mobile-panel' && Array.isArray(data.options)) {
        const options = data.options.filter((item: any) => item && typeof item.option === 'string' && typeof item.value === 'string');
        setSourcePanel({ panel: String(data.panel || 'source'), options });
        return;
      }

      if (data.type === 'vidrift:progress') {
        const position = Math.floor(Number(data.currentTime || 0));
        const duration = Math.floor(Number(data.duration || 0));
        if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;

        const progress: WatchProgress = {
          contentId,
          contentType,
          title,
          titleEn,
          posterUrl,
          backdropUrl,
          seasonNumber,
          episodeNumber,
          episodeId: contentType === 'series' ? currentEpisode?.id : undefined,
          positionSeconds: position,
          durationSeconds: duration,
          percentage: Math.floor((position / duration) * 100),
          lastWatchedAt: new Date().toISOString(),
          completed: position / duration > 0.92,
        };
        MovyzaApi.saveWatchProgress(progress).catch(() => {});
      }

      if (data.type === 'vidrift:ended') {
        const duration = Math.floor(Number(data.duration || 0));
        if (duration > 0) {
          MovyzaApi.saveWatchProgress({
            contentId,
            contentType,
            title,
            titleEn,
            posterUrl,
            backdropUrl,
            seasonNumber,
            episodeNumber,
            episodeId: contentType === 'series' ? currentEpisode?.id : undefined,
            positionSeconds: duration,
            durationSeconds: duration,
            percentage: 100,
            lastWatchedAt: new Date().toISOString(),
            completed: true,
          }).catch(() => {});
        }
      }

      if (data.type === 'vidrift:nextup-play' && onSelectEpisode && contentType === 'series') {
        const finishedSeason = Number(data.season || seasonNumber || 1);
        const finishedEpisode = Number(data.episode || episodeNumber || 0);
        const nextSeason = allSeasons?.find((item) => item.seasonNumber === finishedSeason);
        const hasNextInSeason = nextSeason?.episodes.some((episode) => episode.episodeNumber === finishedEpisode + 1);
        if (hasNextInSeason) {
          onSelectEpisode(finishedSeason, finishedEpisode + 1);
          return;
        }
        const followingSeason = allSeasons
          ?.filter((item) => item.seasonNumber > finishedSeason)
          .sort((a, b) => a.seasonNumber - b.seasonNumber)[0];
        if (followingSeason?.episodes.length) {
          onSelectEpisode(followingSeason.seasonNumber, followingSeason.episodes[0].episodeNumber);
        }
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [
    backdropUrl,
    contentId,
    contentType,
    episodeNumber,
    currentEpisode?.id,
    onSelectEpisode,
    posterUrl,
    currentEpisode?.id,
    currentEpisode?.id,
    seasonNumber,
    title,
    titleEn,
  ]);

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;

    const sendResumeAndNextUp = () => {
      const resume = resumeRef.current;
      if (resume && resume.positionSeconds > 10 && !resume.completed) {
        frame.contentWindow?.postMessage({
          type: 'vidrift:resume',
          currentTime: resume.positionSeconds,
        }, VIDRIFT_ORIGIN);
      }

      if (contentType === 'series' && seasonNumber && episodeNumber && allSeasons) {
        const season = allSeasons.find((item) => item.seasonNumber === seasonNumber);
        const hasNext = season?.episodes.some((episode) => episode.episodeNumber === episodeNumber + 1);
        const next = hasNext
          ? { season: seasonNumber, episode: episodeNumber + 1 }
          : null;
        frame.contentWindow?.postMessage({
          type: 'vidrift:nextup-info',
          next,
        }, VIDRIFT_ORIGIN);
      }
    };

    frame.addEventListener('load', sendResumeAndNextUp);
    const timer = window.setTimeout(sendResumeAndNextUp, 600);
    return () => {
      frame.removeEventListener('load', sendResumeAndNextUp);
      window.clearTimeout(timer);
    };
  }, [allSeasons, contentType, episodeNumber, seasonNumber, resumeRef.current, embedUrl]);

  if (!embedUrl) {
    return (
      <div className="aspect-video w-full flex items-center justify-center bg-black text-slate-400 text-sm">
        {language === 'ar' ? 'معرّف TMDB غير متاح لهذا العنوان.' : 'TMDB id is unavailable for this title.'}
      </div>
    );
  }

  return (
    <div className="relative w-full bg-black overflow-visible">
      <div className="relative w-full aspect-video overflow-hidden">
        <iframe
          ref={iframeRef}
          src={embedUrl}
          title={isMovie ? title : titleEn || title}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 w-full h-full border-0 bg-black"
        />
        <div className="pointer-events-none absolute top-3 start-3 z-10 flex items-center gap-2">
          <span className="rounded-full bg-black/70 backdrop-blur px-3 py-1 text-[10px] font-semibold text-white border border-white/10">VidRift</span>
          <span className="rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[10px] text-slate-300 border border-white/10">
            {language === 'ar' ? 'مشغل خارجي' : 'External player'}
          </span>
        </div>
        <div className="pointer-events-none absolute bottom-3 end-3 z-10 flex items-center gap-2 rounded-full bg-black/60 backdrop-blur px-3 py-1 text-[10px] text-emerald-300 border border-white/10">
          <CheckCircle2 className="w-3 h-3" />
          <span>TMDB → VidRift</span>
        </div>
      </div>
      {sourcePanel && (
        <section className="w-full border-t border-white/10 bg-[#0b0d13] p-3 sm:p-4" aria-label={language === 'ar' ? 'اختيار مصدر التشغيل' : 'Playback source selection'}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white">{language === 'ar' ? 'اختيار السيرفر' : 'Choose a server'}</h3>
              <p className="text-[11px] text-slate-400">{language === 'ar' ? 'اختر المصدر من هنا بدل القائمة داخل المشغل.' : 'Choose a source here instead of inside the player.'}</p>
            </div>
            <button type="button" onClick={() => setSourcePanel(null)} className="shrink-0 rounded-lg px-3 py-1.5 text-xs text-slate-300 bg-white/5 hover:bg-white/10">
              {language === 'ar' ? 'إغلاق' : 'Close'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {sourcePanel.options.map((item, index) => (
              <button
                key={`${item.option}-${item.value}-${index}`}
                type="button"
                onClick={() => {
                  iframeRef.current?.contentWindow?.postMessage({
                    type: 'vidrift:mobile-option',
                    option: item.option,
                    value: item.value,
                  }, VIDRIFT_ORIGIN);
                  setSourcePanel(null);
                }}
                className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/20"
              >
                {item.label || item.value}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

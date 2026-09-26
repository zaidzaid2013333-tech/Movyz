import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Settings2, Subtitles } from 'lucide-react';
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

type VidRiftOption = {
  option: string;
  value: string;
  label: string;
  group?: string;
};

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
  const [panels, setPanels] = useState<Record<string, VidRiftOption[]>>({});

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
  }, [contentId, isMovie, episodeNumber, seasonNumber, currentEpisode?.id]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== VIDRIFT_ORIGIN || !event.data) return;
      const data = event.data;

      if (data.type === 'vidrift:mobile-panel' && Array.isArray(data.options)) {
        const options = data.options.filter((item: any) =>
          item && typeof item.option === 'string' && typeof item.value === 'string'
        );
        const panel = String(data.panel || 'source');
        setPanels((current) => ({ ...current, [panel]: options }));
        return;
      }

      // Keep playback progress/resume handling independent from the external controls.
      if (data.type === 'vidrift:progress') {
        const position = Math.floor(Number(data.currentTime || 0));
        const duration = Math.floor(Number(data.duration || 0));
        if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;

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
          positionSeconds: position,
          durationSeconds: duration,
          percentage: Math.floor((position / duration) * 100),
          lastWatchedAt: new Date().toISOString(),
          completed: position / duration > 0.92,
        }).catch(() => {});
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
    seasonNumber,
    title,
    titleEn,
    allSeasons,
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
        frame.contentWindow?.postMessage({
          type: 'vidrift:nextup-info',
          next: hasNext ? { season: seasonNumber, episode: episodeNumber + 1 } : null,
        }, VIDRIFT_ORIGIN);
      }
    };

    frame.addEventListener('load', sendResumeAndNextUp);
    const timer = window.setTimeout(sendResumeAndNextUp, 600);
    return () => {
      frame.removeEventListener('load', sendResumeAndNextUp);
      window.clearTimeout(timer);
    };
  }, [allSeasons, contentType, episodeNumber, seasonNumber, embedUrl]);

  const sendOption = (item: VidRiftOption) => {
    iframeRef.current?.contentWindow?.postMessage({
      type: 'vidrift:mobile-option',
      option: item.option,
      value: item.value,
    }, VIDRIFT_ORIGIN);
  };

  const subtitleOptions = (panels.subtitles || []).filter((item) => {
    const text = `${item.label} ${item.value}`.toLowerCase();
    return /arabic|العربية|العربي|ar[-_]?\w*/i.test(text);
  });

  const qualityOptions = (panels.quality || panels.qualities || []).filter((item) => /1080p|720p|480p|360p|auto/i.test(`${item.label} ${item.value}`));
  const sourceOptions = panels.source || [];

  if (!embedUrl) {
    return (
      <div className="aspect-video w-full flex items-center justify-center bg-black text-slate-400 text-sm">
        {language === 'ar' ? 'معرّف TMDB غير متاح لهذا العنوان.' : 'TMDB id is unavailable for this title.'}
      </div>
    );
  }

  return (
    <div className="relative w-full bg-black overflow-visible" dir="rtl">
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
          <span className="rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[10px] text-slate-300 border border-white/10">مشغل خارجي</span>
        </div>
        <div className="pointer-events-none absolute bottom-3 end-3 z-10 flex items-center gap-2 rounded-full bg-black/60 backdrop-blur px-3 py-1 text-[10px] text-emerald-300 border border-white/10">
          <CheckCircle2 className="w-3 h-3" />
          <span>TMDB ← VidRift</span>
        </div>
      </div>

      <section className="w-full border-t border-white/10 bg-[#0b0d13] p-3 sm:p-4" aria-label="إعدادات التشغيل">
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="w-4 h-4 text-amber-300" />
          <div>
            <h3 className="text-sm font-bold text-white">إعدادات المشاهدة</h3>
            <p className="text-[11px] text-slate-400">التحكم في السيرفر والترجمة والجودة من هنا، خارج المشغل.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-white">
              <span>🎬</span> السيرفرات
            </div>
            {sourceOptions.length ? (
              <div className="flex flex-wrap gap-2">
                {sourceOptions.map((item, index) => (
                  <button key={`source-${item.value}-${index}`} onClick={() => sendOption(item)} className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-400/20">
                    {item.label || item.value}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">ستظهر السيرفرات هنا عند توفرها.</p>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-white">
              <Subtitles className="w-4 h-4" /> الترجمة
            </div>
            {subtitleOptions.length ? (
              <div className="flex flex-wrap gap-2">
                {subtitleOptions.map((item, index) => (
                  <button key={`sub-${item.value}-${index}`} onClick={() => sendOption(item)} className="rounded-xl border border-sky-400/25 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-400/20">
                    {item.label || 'العربية'}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">إذا كانت العربية متاحة من VidRift ستظهر هنا تلقائيًا.</p>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-white">
              <span>⚙️</span> الجودة
            </div>
            {qualityOptions.length ? (
              <div className="flex flex-wrap gap-2">
                {qualityOptions.map((item, index) => (
                  <button key={`quality-${item.value}-${index}`} onClick={() => setQuality(item.label || item.value)} className="rounded-xl border border-violet-400/25 bg-violet-400/10 px-3 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-400/20">
                    {item.label || item.value}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">ستظهر الجودات التي يرسلها VidRift هنا.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MediaPlayer,
  MediaProvider,
  Track,
  isVideoProvider,
  type MediaPlayerInstance,
} from '@vidstack/react';
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
} from '@vidstack/react/player/layouts/default';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
import { CheckCircle2, Loader2, Settings2, Subtitles } from 'lucide-react';
import { Episode, Season, ContentType } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { MovyzaApi } from '../../services/api';

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

type StreamType = 'hls' | 'mp4' | 'dash' | 'webm' | 'web';

type SubtitleTrack = {
  url: string;
  type: 'vtt' | 'srt';
  language: string;
  label: string;
  labelEn: string;
  default?: boolean;
};

const DIRECT_WATCH_API_BASE = 'https://movyz-moviebox.sameranede.workers.dev';
// AbdoBest remains the single playback source; direct streams are preferred and source pages are the final fallback.

type PlaybackSource = {
  id: string;
  url: string;
  type: StreamType;
  quality: string;
  language: string;
  label: string;
  labelEn?: string;
  provider: string;
  providerKey?: string;
  providerReference?: string;
  subtitleTracks?: SubtitleTrack[];
};

async function fetchAbdoBestFallbackSources(args: {
  tmdbId: number;
  contentType: 'movie' | 'series';
  title: string;
  titleEn: string;
  season?: number;
  episode?: number;
}): Promise<PlaybackSource[]> {
  const isMovie = args.contentType === 'movie';
  const payload = isMovie
    ? {
        tmdb_id: args.tmdbId,
        title: args.titleEn || args.title,
        title_en: args.titleEn,
        title_ar: args.title,
        titles: [args.titleEn, args.title].filter(Boolean),
      }
    : {
        tmdb_id: args.tmdbId,
        title: args.titleEn || args.title,
        title_en: args.titleEn,
        title_ar: args.title,
        titles: [args.titleEn, args.title].filter(Boolean),
        season: args.season,
        episode: args.episode,
      };

  const response = await fetch(
    DIRECT_WATCH_API_BASE + (isMovie ? '/watch/movie' : '/watch/episode'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error || `AbdoBest fallback failed (${response.status})`);
  }

  const stream = body?.stream || {};
  const rawSources = Array.isArray(stream.sources) && stream.sources.length
    ? stream.sources
    : stream.url
      ? [{
          url: stream.url,
          type: stream.type,
          quality: stream.quality,
        }]
      : [];

  return rawSources
    .filter((source: any) => typeof source?.url === 'string' && /^https?:\/\//i.test(source.url))
    .map((source: any, index: number) => ({
      id: source.id || `abdobest-fallback-${source.type || 'source'}-${index}`,
      url: source.url,
      type: (source.type || (String(source.url).toLowerCase().includes('.m3u8') ? 'hls' : 'mp4')) as StreamType,
      quality: source.quality || 'auto',
      language: source.language || 'und',
      label: source.label || `AbdoBest · ${source.quality || 'auto'}`,
      provider: 'AbdoBest',
      providerKey: 'abdobest',
      providerReference: source.providerReference,
      subtitleTracks: Array.isArray(source.subtitleTracks) ? source.subtitleTracks : [],
    }));
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  contentId,
  title,
  titleEn,
  posterUrl,
  backdropUrl,
  tmdbId,
  contentType,
  seasonNumber,
  episodeNumber,
  currentEpisode,
}) => {
  const { language } = useLanguage();
  const playerRef = useRef<MediaPlayerInstance | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const failedSourceIdsRef = useRef<Set<string>>(new Set());
  const lastSavedAtRef = useRef(0);
  const progressLoadedRef = useRef(false);
  const subtitleAutoShownRef = useRef(false);

  const [sources, setSources] = useState<PlaybackSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [streamUrl, setStreamUrl] = useState('');
  const [streamType, setStreamType] = useState<StreamType>('hls');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reportMessage, setReportMessage] = useState('');

  const isMovie = contentType === 'movie';
  const safeTmdbId = Number(tmdbId || 0);

  const currentSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId),
    [selectedSourceId, sources],
  );

  const subtitleTracks = currentSource?.subtitleTracks || [];
  const subtitleEnabled = subtitleTracks.length > 0;

  const showPreferredSubtitleTrack = () => {
    const tracks = playerRef.current?.textTracks;
    if (!tracks || tracks.length === 0) return;

    const availableTracks = [];
    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];
      if (track) availableTracks.push(track);
    }

    const preferredTrack =
      availableTracks.find((track) =>
        String(track.language).toLowerCase().startsWith('ar'),
      ) ||
      availableTracks.find(
        (track) => track.kind === 'subtitles' || track.kind === 'captions',
      );

    if (!preferredTrack) return;

    for (const track of availableTracks) {
      if (track.kind === 'subtitles' || track.kind === 'captions') {
        track.mode = track === preferredTrack ? 'showing' : 'disabled';
      }
    }

    subtitleAutoShownRef.current = true;
  };

  const currentLabel = useMemo(() => {
    const source = sources.find((item) => item.id === selectedSourceId);
    return source ? [source.provider, source.quality, source.type.toUpperCase()].filter(Boolean).join(' · ') : '';
  }, [selectedSourceId, sources]);

  const saveProgress = async (video: HTMLVideoElement, force = false) => {
    const duration = Number.isFinite(video.duration) ? Math.floor(video.duration) : 0;
    const position = Math.floor(video.currentTime || 0);
    if (duration <= 0 || position < 0) return;

    const now = Date.now();
    if (!force && now - lastSavedAtRef.current < 8000) return;
    lastSavedAtRef.current = now;

    try {
      await MovyzaApi.saveWatchProgress({
        contentId,
        contentType,
        title,
        titleEn,
        posterUrl,
        backdropUrl,
        episodeId: currentEpisode?.id,
        seasonNumber,
        episodeNumber,
        positionSeconds: position,
        durationSeconds: duration,
        percentage: Math.min(100, Math.floor((position / duration) * 100)),
        lastWatchedAt: new Date().toISOString(),
        completed: position >= Math.max(0, duration - 10),
      });
    } catch {
      // Watch progress is best-effort.
    }
  };

  const restoreProgress = async () => {
    const video = videoRef.current;
    if (!video || progressLoadedRef.current) return;

    progressLoadedRef.current = true;

    try {
      const result = await MovyzaApi.getWatchProgress(contentId, currentEpisode?.id);
      const progress = result.data;

      if (
        progress &&
        progress.positionSeconds > 5 &&
        Number.isFinite(video.duration) &&
        progress.positionSeconds < video.duration - 5
      ) {
        video.currentTime = progress.positionSeconds;
      }
    } catch {
      // Guests and expired sessions start from the beginning.
    }
  };

  const selectSource = (source: PlaybackSource) => {
    failedSourceIdsRef.current.delete(source.id);
    setSelectedSourceId(source.id);
    setError('');
    setLoading(true);
    setStreamType(source.type);
    setStreamUrl(source.url);
  };

  const moveToNextSource = () => {
    const current = selectedSourceId;
    if (current) failedSourceIdsRef.current.add(current);

    const next = sources.find(
      (source) => !failedSourceIdsRef.current.has(source.id),
    );

    if (next) {
      selectSource(next);
      return;
    }

    setLoading(false);
    setError(
      language === 'ar'
        ? 'تعذر تشغيل جميع مصادر الفيديو.'
        : 'All playback sources failed.',
    );
  };

  const handleReportSource = async () => {
    if (!selectedSourceId) return;

    try {
      await MovyzaApi.reportIssue({
        contentId: isMovie ? contentId : (currentEpisode?.id || contentId),
        contentType: isMovie ? 'movie' : 'episode',
        contentTitle: isMovie ? title : (currentEpisode?.title || title),
        sourceId: selectedSourceId,
        issueType: 'broken_source',
        description: language === 'ar'
          ? 'المصدر الحالي لا يعمل.'
          : 'The selected playback source is not working.',
      });

      setReportMessage(language === 'ar' ? 'تم إرسال البلاغ.' : 'Report sent.');
    } catch {
      setReportMessage(
        language === 'ar'
          ? 'سجّل الدخول أولًا لإرسال البلاغ.'
          : 'Sign in to send a report.',
      );
    }

    window.setTimeout(() => setReportMessage(''), 3000);
  };

  useEffect(() => {
    let cancelled = false;

    const loadSources = async () => {
      if (!safeTmdbId) {
        setLoading(false);
        setError(
          language === 'ar'
            ? 'معرّف TMDB غير متاح لهذا العنوان.'
            : 'TMDB id is unavailable for this title.',
        );
        return;
      }

      setLoading(true);
      setError('');
      setSources([]);
      setSelectedSourceId('');
      setStreamUrl('');
      setStreamType('hls');
      failedSourceIdsRef.current.clear();
      progressLoadedRef.current = false;

      try {
        let response;
        let lastLoadError;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            response = await MovyzaApi.getWatchSources(
              safeTmdbId,
              isMovie ? 'movie' : 'series',
              seasonNumber,
              episodeNumber,
            );
            break;
          } catch (requestError) {
            lastLoadError = requestError;
            if (attempt === 0) {
              await new Promise((resolve) => window.setTimeout(resolve, 900));
            }
          }
        }

        if (!response) {
          try {
            const fallbackSources = await fetchAbdoBestFallbackSources({
              tmdbId: safeTmdbId,
              contentType: isMovie ? 'movie' : 'series',
              title,
              titleEn,
              season: seasonNumber,
              episode: episodeNumber,
            });
            if (!fallbackSources.length) throw new Error('AbdoBest returned no playback sources');
            response = { data: fallbackSources } as any;
          } catch (fallbackError) {
            console.warn('[movyza-player] AbdoBest direct fallback failed', fallbackError);
            throw lastLoadError || fallbackError || new Error('No playback sources returned');
          }
        }

        const normalized: PlaybackSource[] = (response.data || [])
          .filter(
            (source: any) =>
              Boolean(source.url) &&
              ['hls', 'mp4', 'dash', 'webm', 'web'].includes(source.type),
          )
          .map((source: any, index: number) => ({
            id:
              source.id ||
              `${source.provider || 'source'}-${source.type}-${index}`,
            url: source.url,
            type: source.type,
            quality: source.quality || 'auto',
            language: source.language || 'und',
            label: source.label || source.provider || 'Source',
            provider: source.provider || 'Provider',
            providerKey: source.providerKey,
            providerReference: source.providerReference,
            subtitleTracks: Array.isArray(source.subtitleTracks)
              ? source.subtitleTracks
                  .filter((track: any) => Boolean(track?.url))
                  .map((track: any) => ({
                  url: track.url,
                  type: track.type === 'srt' ? 'srt' : 'vtt',
                  language: track.language || 'und',
                  label: track.label || track.labelEn || 'Subtitles',
                  labelEn: track.labelEn || track.label || 'Subtitles',
                  default: track.default === true,
                }))
              : [],
          }));

        if (!normalized.length) {
          throw new Error('No playable stream returned');
        }

        const initial =
          normalized.find((source) => source.type === 'hls') ||
          normalized.find((source) => source.type === 'dash') ||
          normalized.find((source) => source.type === 'mp4') ||
          normalized.find((source) => source.type === 'webm') ||
          normalized.find((source) => source.type === 'web') ||
          normalized[0];

        if (!cancelled) {
          setSources(normalized);
          setSelectedSourceId(initial.id);
          setStreamType(initial.type);
          setStreamUrl(initial.url);
          setLoading(true);
        }
      } catch (loadError) {
        if (cancelled) return;

        console.warn('[movyza-player] source list unavailable', loadError);
        setSources([]);
        setSelectedSourceId('');
        setStreamUrl('');
        setLoading(false);
        setError(
          language === 'ar'
            ? 'تعذر العثور على مصدر فيديو مباشر صالح حاليًا.'
            : 'No valid direct video source is available right now.',
        );
      }
    };

    void loadSources();

    return () => {
      cancelled = true;
    };
  }, [
    contentId,
    currentEpisode?.id,
    isMovie,
    language,
    safeTmdbId,
    seasonNumber,
    episodeNumber,
  ]);

  useEffect(() => {
    progressLoadedRef.current = false;
    subtitleAutoShownRef.current = false;
  }, [streamUrl, selectedSourceId]);

  const playerSource =
    streamUrl && streamType !== 'web'
      ? streamType === 'hls'
        ? { src: streamUrl, type: 'application/x-mpegurl' as const }
        : streamType === 'dash'
          ? { src: streamUrl, type: 'application/dash+xml' as const }
          : streamType === 'webm'
            ? { src: streamUrl, type: 'video/webm' as const }
            : { src: streamUrl, type: 'video/mp4' as const }
      : undefined;

  if (!safeTmdbId) {
    return (
      <div className="aspect-video w-full flex items-center justify-center bg-black text-slate-400 text-sm">
        {language === 'ar'
          ? 'معرّف TMDB غير متاح لهذا العنوان.'
          : 'TMDB id is unavailable for this title.'}
      </div>
    );
  }

  return (
    <div className="movyza-player-root relative w-full bg-black" dir="rtl">
      <style>{`
        .movyza-player .vds-captions {
          --media-cue-font-size: clamp(
            24px,
            calc(var(--media-height) / 100 * 7),
            60px
          );
          --media-cue-line-height: 1.22;
          --media-cue-color: #fff;
          --media-cue-bg-color: rgba(0, 0, 0, 0.72);
        }

        .movyza-player .vds-captions [data-part="cue"] {
          font-family: Arial, "Noto Sans Arabic", "Noto Sans", sans-serif;
          font-weight: 800;
          text-shadow:
            0 2px 4px rgba(0, 0, 0, .98),
            0 0 3px rgba(0, 0, 0, 1);
        }
      `}</style>
      <div className="movyza-player-shell relative aspect-video w-full overflow-hidden bg-black">
        {streamType === 'web' && streamUrl ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#05070b] p-6">
            <div className="max-w-md text-center">
              <div className="mb-3 text-sm font-bold text-white">
                {language === 'ar' ? 'تعذر استخراج الفيديو المباشر' : 'Direct video extraction unavailable'}
              </div>
              <p className="text-xs leading-6 text-slate-400">
                {language === 'ar'
                  ? 'المصدر موجود لدى AbdoBest، لكن صفحة المصدر تمنع التضمين داخل المشغل. لن نعرض صفحة مكسورة داخل Movyza.'
                  : 'AbdoBest returned a source page, but that page blocks iframe embedding. Movyza will not display a broken embedded page.'}
              </p>
              <a
                href={streamUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-400/20"
              >
                {language === 'ar' ? 'فتح المصدر عبر AbdoBest' : 'Open AbdoBest source'}
              </a>
            </div>
          </div>
        ) : playerSource ? (
          <MediaPlayer
            ref={playerRef}
            key={`movyza-player-${selectedSourceId}-${subtitleTracks.map((track) => `${track.language}:${track.url}`).join('|')}`}
            className="movyza-player absolute inset-0 h-full w-full"
            load="eager"
            title={isMovie ? title : titleEn || title}
            src={playerSource}
            playsInline
            crossOrigin="anonymous"
            onProviderSetup={(provider) => {
              if (isVideoProvider(provider)) {
                videoRef.current = provider.video;
              }
            }}
            onTextTracksChange={(tracks) => {
              const preferredTrack =
                tracks.find(
                  (track) =>
                    (track.kind === 'subtitles' || track.kind === 'captions') &&
                    String(track.language).toLowerCase().startsWith('ar'),
                ) ||
                tracks.find(
                  (track) => track.kind === 'subtitles' || track.kind === 'captions',
                );

              if (preferredTrack) {
                tracks.forEach((track) => {
                  if (track.kind === 'subtitles' || track.kind === 'captions') {
                    track.mode = track === preferredTrack ? 'showing' : 'disabled';
                  }
                });
                subtitleAutoShownRef.current = true;
              } else {
                showPreferredSubtitleTrack();
              }
            }}
            onCanPlay={() => {
              setLoading(false);
              setError('');
              showPreferredSubtitleTrack();
              void restoreProgress();
            }}
            onLoadedMetadata={() => {
              showPreferredSubtitleTrack();
              void restoreProgress();
            }}
            onTimeUpdate={() => {
              const video = videoRef.current;
              if (video) void saveProgress(video);
            }}
            onPause={() => {
              const video = videoRef.current;
              if (video) void saveProgress(video, true);
            }}
            onEnded={() => {
              const video = videoRef.current;
              if (video) void saveProgress(video, true);
            }}
            onError={(playbackError) => {
              console.warn('[movyza-player] source error', playbackError);
              setStreamUrl('');
              setError('');
              setLoading(true);
              moveToNextSource();
            }}
            onWaiting={() => setLoading(true)}
            onPlaying={() => {
              setLoading(false);
              setError('');
              showPreferredSubtitleTrack();
            }}
          >
            <MediaProvider>
              {subtitleTracks.map((track) => (
                <Track
                  key={`${selectedSourceId}-${track.language}-${track.url}`}
                  id={`subtitle-${selectedSourceId}-${track.language}`}
                  src={track.url}
                  kind="subtitles"
                  label={track.label}
                  lang={track.language}
                  language={track.language}
                  type={track.type}
                  default={
                    track.default === true ||
                    track.url ===
                      (subtitleTracks.find((item) =>
                        String(item.language).toLowerCase().startsWith('ar'),
                      )?.url || subtitleTracks[0]?.url)
                  }
                />
              ))}
            </MediaProvider>
            <DefaultVideoLayout
              colorScheme="dark"
              icons={defaultLayoutIcons}
              playbackRates={[0.5, 0.75, 1, 1.25, 1.5, 2]}
              seekStep={10}
              translations={{
                Play: language === 'ar' ? 'تشغيل' : 'Play',
                Pause: language === 'ar' ? 'إيقاف مؤقت' : 'Pause',
                Mute: language === 'ar' ? 'كتم' : 'Mute',
                Unmute: language === 'ar' ? 'إلغاء الكتم' : 'Unmute',
                Fullscreen: language === 'ar' ? 'ملء الشاشة' : 'Fullscreen',
                Settings: language === 'ar' ? 'الإعدادات' : 'Settings',
              }}
            />
          </MediaPlayer>
        ) : (
          <div className="absolute inset-0 bg-black" />
        )}

        {(loading || error) && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 pointer-events-none">
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              {loading && !error && (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-amber-300" />
                  <span className="text-xs text-slate-300">
                    {language === 'ar' ? 'جاري تشغيل المصدر…' : 'Loading source…'}
                  </span>
                </>
              )}
              {error && (
                <span className="text-sm text-red-300">{error}</span>
              )}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute start-3 top-3 z-40 flex items-center gap-2">
          <span className="movyza-player-badge rounded-full px-3 py-1 text-[10px] font-semibold text-white backdrop-blur border">
{`MOVYZA · ${streamType.toUpperCase()}`}
          </span>
          <span className="rounded-full border border-white/10 bg-black/65 px-2.5 py-1 text-[10px] text-slate-300 backdrop-blur">
            {language === 'ar' ? 'مشغل Movyza' : 'Movyza Player'}
          </span>
        </div>

        <div className="pointer-events-none absolute bottom-3 end-3 z-40 flex items-center gap-2 rounded-full border border-white/10 bg-black/65 px-3 py-1 text-[10px] text-emerald-300 backdrop-blur">
          <CheckCircle2 className="h-3 w-3" />
          <span>
            {currentLabel || 'Movyza → direct stream'}
          </span>
        </div>
      </div>

      <section className="w-full border-t border-white/10 bg-[#0b0d13] p-3 sm:p-4" aria-label="إعدادات التشغيل">
        <div className="mb-3 flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-amber-300" />
          <div>
            <h3 className="text-sm font-bold text-white">
              {language === 'ar' ? 'مشغل Movyza' : 'Movyza Player'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {language === 'ar'
                ? 'يتم تشغيل الفيديو المباشر داخل مشغل Movyza، وعند تعذر استخراج الرابط الخام نعرض صفحة المصدر عبر AbdoBest.' 
                : 'Movyza plays direct video streams in the native player and falls back to the AbdoBest source page when raw extraction is unavailable.'}
            </p>
          </div>
        </div>

        {sources.length > 0 && (
          <div className="mb-3 rounded-2xl border border-amber-400/20 bg-white/[0.03] p-3">
            <label className="mb-2 block text-xs font-bold text-white">
              {language === 'ar' ? 'مصدر التشغيل' : 'Playback source'}
            </label>

            <select
              value={selectedSourceId}
              onChange={(event) => {
                const next = sources.find((source) => source.id === event.target.value);
                if (next) selectSource(next);
              }}
              className="w-full rounded-xl border border-white/10 bg-[#10131d] px-3 py-2 text-xs text-white outline-none"
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {[source.label, source.quality, source.type.toUpperCase(), source.language !== 'und' ? source.language : '']
                    .filter(Boolean)
                    .join(' · ')}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void handleReportSource()}
              className="mt-2 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-400/15"
            >
              {language === 'ar' ? 'الإبلاغ عن المصدر' : 'Report source'}
            </button>

            {reportMessage && (
              <div className="mt-2 text-[11px] text-slate-300">{reportMessage}</div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-white">
              <span>⚡</span>
              {language === 'ar' ? 'تشغيل موحّد' : 'Universal playback'}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              {language === 'ar'
                ? 'HLS وMP4 وDASH وWEBM تعمل مباشرة، مع وضع صفحة مصدر احتياطي عند الحاجة.'
                : 'HLS, MP4, DASH, and WEBM play directly, with an AbdoBest source-page fallback when needed.'}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-white">
              <Subtitles className="h-4 w-4" />
              {language === 'ar' ? 'الترجمة' : 'Subtitles'}
            </div>
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2">
              <div className="text-xs font-semibold text-emerald-100">
                {subtitleEnabled
                  ? (language === 'ar' ? 'العربية مفعّلة تلقائيًا' : 'Arabic subtitles enabled')
                  : (language === 'ar' ? 'تُعرض عند توفر مسار ترجمة' : 'Shown when a subtitle track is available')}
              </div>
              <div className="mt-1 text-[10px] text-emerald-100/65">
                {subtitleEnabled
                  ? (language === 'ar'
                    ? 'مسار ترجمة مرتبط بمصدر التشغيل نفسه ويُعرض داخل المشغل من زر CC.'
                    : 'A subtitle track attached to the selected playback source and available from CC.')
                  : (language === 'ar'
                    ? 'لا يوجد مسار ترجمة موثوق مرتبط بهذا المصدر.'
                    : 'No trusted subtitle track is attached to this source.')}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

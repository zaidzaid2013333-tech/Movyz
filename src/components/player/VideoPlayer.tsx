import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { MovyzaApi } from '../../services/api';

interface VideoPlayerProps {
  contentId: string;
  contentType: 'movie' | 'series';
  title: string;
  titleEn: string;
  posterUrl: string;
  backdropUrl: string;
  tmdbId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  currentEpisode?: {
    id?: string;
    title?: string;
    titleEn?: string;
  };
  allSeasons?: unknown[];
  onSelectEpisode?: (seasonNum: number, episodeNum: number) => void;
  onNavigateBack: () => void;
}

type PlaybackSource = {
  id?: string;
  url?: string;
  type?: string;
  quality?: string;
  language?: string;
  label?: string;
  labelEn?: string;
  provider?: string;
  providerKey?: string;
  iframeUrl?: string;
};

const MAX_VISIBLE_SOURCES = 4;
const IFRAME_LOAD_TIMEOUT_MS = 30_000;

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  contentType,
  title,
  titleEn,
  tmdbId,
  seasonNumber,
  episodeNumber,
  currentEpisode,
}) => {
  const { language } = useLanguage();
  const [sources, setSources] = useState<PlaybackSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [iframeUrl, setIframeUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  const isMovie = contentType === 'movie';
  const displayTitle = isMovie
    ? (titleEn || title)
    : (currentEpisode?.titleEn || currentEpisode?.title || titleEn || title);

  useEffect(() => {
    let cancelled = false;

    const loadAkwamSources = async () => {
      if (!Number.isFinite(Number(tmdbId)) || Number(tmdbId) <= 0) {
        setLoading(false);
        setError(language === 'ar' ? 'معرّف TMDB غير متاح.' : 'TMDB id is unavailable.');
        return;
      }

      setLoading(true);
      setError('');
      setIframeUrl('');
      setSources([]);
      setSelectedSourceId('');

      try {
        const response = await MovyzaApi.getWatchSources(
          Number(tmdbId),
          isMovie ? 'movie' : 'series',
          seasonNumber,
          episodeNumber,
        );

        const rawSources = Array.isArray(response?.data)
          ? (response.data as PlaybackSource[])
          : [];

        const resolvedSources = rawSources
          .map((source, index) => {
            const explicitIframe = String(source.iframeUrl || '').trim();
            const akwamWebUrl =
              String(source.providerKey || '').toLowerCase() === 'akwam-iframe' &&
              /^https:\/\//i.test(String(source.url || '').trim())
                ? String(source.url).trim()
                : '';

            const resolvedIframe = explicitIframe || akwamWebUrl;
            return {
              ...source,
              id: String(source.id || `akwam-iframe-${index + 1}`),
              iframeUrl: resolvedIframe,
            };
          })
          .filter((source) => /^https:\/\//i.test(String(source.iframeUrl || '')))
          .slice(0, MAX_VISIBLE_SOURCES);

        if (!resolvedSources.length) {
          throw new Error('Watch API returned no usable iframe sources.');
        }

        if (!cancelled) {
          const firstSource = resolvedSources[0];
          setSources(resolvedSources);
          setSelectedSourceId(String(firstSource.id));
          setIframeUrl(String(firstSource.iframeUrl));
          setLoading(true);
        }
      } catch (loadError) {
        if (cancelled) return;

        console.error('[movyza-iframe-player] Akwam sources unavailable', loadError);
        setLoading(false);
        setError(
          language === 'ar'
            ? 'تعذر الحصول على مصدر تشغيل Akwam حاليًا.'
            : 'Unable to get a playable Akwam source right now.',
        );
      }
    };

    void loadAkwamSources();

    return () => {
      cancelled = true;
    };
  }, [episodeNumber, isMovie, language, retryNonce, seasonNumber, tmdbId]);

  useEffect(() => {
    if (!iframeUrl) return;

    const timeoutId = window.setTimeout(() => {
      setLoading((isStillLoading) => {
        if (!isStillLoading) return false;
        setError(
          language === 'ar'
            ? 'مصدر Akwam لم يستجب ضمن الوقت المتوقع.'
            : 'The selected Akwam source did not respond in time.',
        );
        return false;
      });
    }, IFRAME_LOAD_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [iframeUrl, language]);

  const handleSourceSelect = (source: PlaybackSource) => {
    const nextUrl = String(source.iframeUrl || '').trim();
    if (!nextUrl) return;

    setError('');
    setSelectedSourceId(String(source.id));
    setIframeUrl(nextUrl);
    setLoading(true);
  };

  if (error) {
    return (
      <div className="relative w-full bg-black">
        <div className="flex min-h-48 items-center justify-center px-6 py-10 text-center">
          <div className="max-w-lg">
            <p className="text-sm text-slate-300">{error}</p>
            <button
              type="button"
              className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15"
              onClick={() => setRetryNonce((value) => value + 1)}
            >
              {language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-black">
      {sources.length > 0 && (
        <div className="border-b border-white/10 bg-[#080a0f] px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-400">
              {language === 'ar' ? 'سيرفر التشغيل' : 'Playback server'}
            </span>
            <div className="flex flex-wrap gap-2">
              {sources.map((source, index) => {
                const active = String(source.id) === selectedSourceId;
                const label = language === 'ar'
                  ? (source.label || source.provider || `سيرفر ${index + 1}`)
                  : (source.labelEn || source.provider || `Server ${index + 1}`);
                const quality =
                  source.quality && source.quality.toLowerCase() !== 'auto'
                    ? ` · ${source.quality}`
                    : '';

                return (
                  <button
                    key={String(source.id)}
                    type="button"
                    onClick={() => handleSourceSelect(source)}
                    className={
                      active
                        ? 'rounded-lg border border-amber-400/60 bg-amber-400/15 px-3 py-1.5 text-[11px] font-bold text-amber-300'
                        : 'rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white'
                    }
                  >
                    {label}{quality}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {iframeUrl ? (
          <>
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black text-sm text-slate-300">
                {language === 'ar' ? 'جارٍ تحميل Akwam…' : 'Loading Akwam…'}
              </div>
            )}

            <iframe
              key={iframeUrl}
              src={iframeUrl}
              title={displayTitle}
              className="absolute inset-0 h-full w-full border-0 bg-black"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              referrerPolicy="no-referrer"
              onLoad={() => setLoading(false)}
            />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            {language === 'ar' ? 'جارٍ الحصول على رابط Akwam…' : 'Getting Akwam link…'}
          </div>
        )}
      </div>
    </div>
  );
};

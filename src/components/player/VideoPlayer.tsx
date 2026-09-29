import React, { useEffect, useMemo, useState } from 'react';
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
  onNavigateBack?: () => void;
}

type PlaybackSource = {
  id?: string;
  type?: string;
  provider?: string;
  providerKey?: string;
  iframeUrl?: string;
};

const MAX_VISIBLE_SOURCES = 4;
const getConnectionHintOrigin = (value: string) => {
  try {
    return value ? new URL(value).origin : '';
  } catch {
    return '';
  }
};

const isAkwamWatchUrl = (value: string) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowedHost =
      host === 'akwam.ss' ||
      host.endsWith('.akwam.ss') ||
      host === 'akwam.it' ||
      host.endsWith('.akwam.it') ||
      host === 'ak.sv' ||
      host.endsWith('.ak.sv') ||
      host === 'akwam.ee' ||
      host.endsWith('.akwam.ee');
    return allowedHost && /\/watch\/\d+(?:[/?#]|$)/i.test(url.pathname);
  } catch {
    return false;
  }
};

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  const isMovie = contentType === 'movie';
  const displayTitle = isMovie
    ? (titleEn || title)
    : (currentEpisode?.titleEn || currentEpisode?.title || titleEn || title);

  const activeSource = useMemo(
    () => sources.find((source) => String(source.id) === selectedSourceId) || sources[0] || null,
    [selectedSourceId, sources],
  );

  useEffect(() => {
    let cancelled = false;

    const loadWatchSources = async () => {
      if (!Number.isFinite(Number(tmdbId)) || Number(tmdbId) <= 0) {
        setLoading(false);
        setError(language === 'ar' ? 'معرّف TMDB غير متاح.' : 'TMDB id is unavailable.');
        return;
      }

      setLoading(true);
      setError('');
      setSources([]);
      setSelectedSourceId('');

      try {
        const response = await MovyzaApi.getWatchSources(
          Number(tmdbId),
          isMovie ? 'movie' : 'series',
          seasonNumber,
          episodeNumber,
        );

        const seen = new Set<string>();
        const resolvedSources: PlaybackSource[] = [];

        const rawSources = Array.isArray(response?.data) ? (response.data as PlaybackSource[]) : [];
        for (const [index, source] of rawSources.entries()) {
          const iframeUrl = String(source?.iframeUrl || '').trim();
          const candidate: PlaybackSource = {
            ...source,
            id: String(source?.id || `akwam-iframe-${index + 1}`),
            type: String(source?.type || '').trim().toLowerCase(),
            providerKey: String(source?.providerKey || '').trim().toLowerCase(),
            iframeUrl,
          };

          if (
            candidate.type !== 'web' ||
            candidate.providerKey !== 'akwam-iframe' ||
            !isAkwamWatchUrl(iframeUrl) ||
            seen.has(iframeUrl)
          ) continue;

          seen.add(iframeUrl);
          resolvedSources.push(candidate);
          if (resolvedSources.length >= MAX_VISIBLE_SOURCES) break;
        }

        if (!resolvedSources.length) throw new Error('Watch API returned no Akwam iframe player.');

        if (!cancelled) {
          setSources(resolvedSources);
          setSelectedSourceId(String(resolvedSources[0].id));
          setLoading(true);
        }
      } catch (loadError) {
        if (cancelled) return;
        console.error('[movyza-player] Akwam iframe unavailable', loadError);
        setLoading(false);
        setError(
          language === 'ar'
            ? 'تعذر الحصول على مشغل Akwam حاليًا.'
            : 'Unable to load the Akwam player right now.',
        );
      }
    };

    void loadWatchSources();
    return () => { cancelled = true; };
  }, [episodeNumber, isMovie, language, retryNonce, seasonNumber, tmdbId]);

  const activeIframe = String(activeSource?.iframeUrl || '').trim();

  useEffect(() => {
    if (!activeIframe) return;
    // The remote iframe owns its own loading lifecycle. Do not keep a full-page
    // Movyz overlay waiting on a third-party document load event.
    setLoading(false);
    setError('');
  }, [activeIframe]);

  if (error && !sources.length) {
    return (
      <div className="relative w-full bg-black">
        <div className="flex min-h-48 items-center justify-center px-6 py-10 text-center">
          <div className="max-w-lg">
            <p className="text-sm text-slate-300">{error}</p>
            <button type="button" className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15" onClick={() => setRetryNonce((value) => value + 1)}>
              {language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-black">
      {activeIframe && getConnectionHintOrigin(activeIframe) && (
        <>
          <link rel="dns-prefetch" href={getConnectionHintOrigin(activeIframe)} />
          <link rel="preconnect" href={getConnectionHintOrigin(activeIframe)} />
        </>
      )}

      {sources.length > 1 && (
        <div className="border-b border-white/10 bg-[#080a0f] px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-400">
              {language === 'ar' ? 'سيرفر التشغيل' : 'Playback server'}
            </span>
            <div className="flex flex-wrap gap-2">
              {sources.map((source, index) => {
                const active = String(source.id) === String(activeSource?.id);
                const label = source.provider || (language === 'ar' ? `سيرفر ${index + 1}` : `Server ${index + 1}`);
                return (
                  <button
                    key={String(source.id)}
                    type="button"
                    onClick={() => {
                      setError('');
                      setSelectedSourceId(String(source.id));
                    }}
                    className={active
                      ? 'rounded-lg border border-amber-400/60 bg-amber-400/15 px-3 py-1.5 text-[11px] font-bold text-amber-300'
                      : 'rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white'}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="relative aspect-video w-full overflow-hidden bg-black" aria-busy={loading}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black text-sm text-slate-300">
            {language === 'ar' ? 'جارٍ تحميل مشغل Akwam…' : 'Loading Akwam player…'}
          </div>
        )}

        {activeIframe && (
          <iframe
            key={activeIframe}
            src={activeIframe}
            title={displayTitle}
            className="absolute inset-0 h-full w-full border-0 bg-black"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            loading="eager"
            referrerPolicy="no-referrer"
            sandbox="allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-presentation allow-same-origin allow-scripts allow-top-navigation-by-user-activation"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(language === 'ar' ? 'تعذر تحميل مشغل Akwam.' : 'The Akwam player could not be loaded.');
            }}
          />
        )}
      </div>

      {error && sources.length > 0 && (
        <div className="border-t border-white/10 bg-[#080a0f] px-4 py-3 text-center text-xs text-slate-300">
          <p>{error}</p>
          <button type="button" className="mt-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15" onClick={() => setRetryNonce((value) => value + 1)}>
            {language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}
    </div>
  );
};

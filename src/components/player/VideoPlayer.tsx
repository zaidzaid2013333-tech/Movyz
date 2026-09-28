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
  provider?: string;
  providerKey?: string;
  iframeUrl?: string;
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
  const [iframeUrl, setIframeUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  const isMovie = contentType === 'movie';
  const displayTitle = isMovie ? (titleEn || title) : (currentEpisode?.title || titleEn || title);

  useEffect(() => {
    let cancelled = false;

    const loadAkwamIframe = async () => {
      if (!Number.isFinite(Number(tmdbId)) || Number(tmdbId) <= 0) {
        setLoading(false);
        setError(language === 'ar' ? 'معرّف TMDB غير متاح.' : 'TMDB id is unavailable.');
        return;
      }

      setLoading(true);
      setError('');
      setIframeUrl('');

      try {
        const response = await MovyzaApi.getWatchSources(
          Number(tmdbId),
          isMovie ? 'movie' : 'series',
          seasonNumber,
          episodeNumber,
        );

        const sources = Array.isArray(response?.data)
          ? (response.data as PlaybackSource[])
          : [];

        const akwam =
          sources.find((source) => typeof source.iframeUrl === 'string' && source.iframeUrl.trim()) ||
          sources.find(
            (source) =>
              String(source.providerKey || '').toLowerCase() === 'akwam-iframe' &&
              typeof source.url === 'string' &&
              source.url.startsWith('https://'),
          );

        const url = String(akwam?.iframeUrl || '').trim();

        if (!url) {
          throw new Error('Akwam iframe URL was not returned by the Watch API.');
        }

        if (!cancelled) {
          setIframeUrl(url);
          setLoading(true);
        }
      } catch (loadError) {
        if (cancelled) return;

        console.error('[movyza-iframe-player] Akwam iframe unavailable', loadError);
        setLoading(false);
        setError(
          language === 'ar'
            ? 'تعذر الحصول على رابط Akwam لهذه الحلقة حاليًا.'
            : 'Unable to get the Akwam iframe for this title right now.',
        );
      }
    };

    void loadAkwamIframe();

    return () => {
      cancelled = true;
    };
  }, [episodeNumber, isMovie, language, retryNonce, seasonNumber, tmdbId]);

  useEffect(() => {
    if (!iframeUrl) return;

    const timer = window.setTimeout(() => {
      setLoading(false);
      setError(
        language === 'ar'
          ? 'لم يستجب مشغل Akwam خلال المهلة المحددة. أعد المحاولة.'
          : 'The Akwam player did not respond within the timeout. Please retry.',
      );
    }, 35_000);

    return () => window.clearTimeout(timer);
  }, [iframeUrl, language]);

  if (error) {
    return (
      <div className="relative aspect-video w-full bg-black flex items-center justify-center px-6 text-center">
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
    );
  }

  return (
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
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(
                language === 'ar'
                  ? 'تعذر تحميل صفحة تشغيل Akwam.'
                  : 'Unable to load the Akwam playback page.',
              );
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
          {language === 'ar' ? 'جارٍ الحصول على رابط Akwam…' : 'Getting Akwam link…'}
        </div>
      )}
    </div>
  );
};

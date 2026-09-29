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
  currentEpisode?: { id?: string; title?: string; titleEn?: string };
  allSeasons?: unknown[];
  onSelectEpisode?: (seasonNum: number, episodeNum: number) => void;
  onNavigateBack?: () => void;
}

const isAkwamPlayerUrl = (value: string) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowedHost =
      host === 'akwam.ss' || host.endsWith('.akwam.ss') ||
      host === 'akwam.it' || host.endsWith('.akwam.it') || host === 'go.akwam.it' ||
      host === 'ak.sv' || host.endsWith('.ak.sv') || host === 'go.ak.sv' ||
      host === 'akwam.ee' || host.endsWith('.akwam.ee') ||
      host === 'akwam.com.co' || host.endsWith('.akwam.com.co') || host === 'go.akwam.com.co' ||
      host === 'akwam.net' || host.endsWith('.akwam.net') ||
      host === 'downet.net' || host.endsWith('.downet.net');
    if (!allowedHost) return false;
    if (/\/(?:movie|movies|series|episode|episodes|download|link|search|login|register|watch)(?:\/|[?#]|$)/i.test(url.pathname)) return false;
    return /\/(?:player|embed)(?:\/|[?#]|$)/i.test(url.pathname);
  } catch { return false; }
};

const normalizeAkwamPlayerUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (!isAkwamPlayerUrl(value)) return '';
    if (/\/watch\//i.test(url.pathname)) return '';
    return url.toString();
  } catch {
    return '';
  }
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  contentType, title, titleEn, tmdbId, seasonNumber, episodeNumber, currentEpisode,
}) => {
  const { language } = useLanguage();
  const [iframeUrl, setIframeUrl] = useState('');
  const [error, setError] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  const displayTitle = contentType === 'movie'
    ? (titleEn || title)
    : (currentEpisode?.titleEn || currentEpisode?.title || titleEn || title);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIframeUrl('');
      setError('');

      if (!Number.isFinite(Number(tmdbId)) || Number(tmdbId) <= 0) {
        setError(language === 'ar' ? 'معرّف TMDB غير متاح.' : 'TMDB id is unavailable.');
        return;
      }

      try {
        const response = await MovyzaApi.getWatchSources(Number(tmdbId), contentType, seasonNumber, episodeNumber);
        const source = Array.isArray(response?.data)
          ? response.data.find((item: any) =>
              String(item?.providerKey || '').toLowerCase() === 'akwam-iframe' &&
              String(item?.type || '').toLowerCase() === 'web' &&
              isAkwamPlayerUrl(String(item?.url || '').trim()))
          : null;
        const resolved = normalizeAkwamPlayerUrl(String(source?.url || '').trim());

        if (!resolved) throw new Error('No dedicated Akwam watch-player route was returned.');
        if (!cancelled) setIframeUrl(resolved);
      } catch (loadError) {
        if (cancelled) return;
        console.error('[movyza-player] Akwam iframe unavailable', loadError);
        setError(language === 'ar'
          ? 'تعذر الحصول على مشغل Akwam حاليًا.'
          : 'Unable to load the Akwam player right now.');
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [contentType, episodeNumber, language, retryNonce, seasonNumber, tmdbId]);

  if (error) {
    return (
      <div className="flex min-h-52 w-full items-center justify-center bg-black px-6 py-10 text-center">
        <div>
          <p className="text-sm text-slate-300">{error}</p>
          <button type="button" className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15"
            onClick={() => setRetryNonce((value) => value + 1)}>
            {language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-black">
      {iframeUrl ? (
        <iframe
          key={iframeUrl}
          src={iframeUrl}
          title={displayTitle}
          className="absolute inset-0 h-full w-full border-0 bg-black"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          loading="eager"
          referrerPolicy="strict-origin-when-cross-origin"
          onError={() => setError(language === 'ar'
            ? 'تعذر تحميل مشغل Akwam.'
            : 'The Akwam player could not be loaded.')}
        />
      ) : null}
    </div>
  );
};

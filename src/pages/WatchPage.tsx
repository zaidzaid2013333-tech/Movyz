import React from 'react';

interface WatchPageProps {
  mediaType: 'movie' | 'series';
  tmdbId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  onNavigate: (path: string) => void;
}

const buildVidCoreUrl = (
  mediaType: 'movie' | 'series',
  tmdbId: number,
  seasonNumber?: number,
  episodeNumber?: number,
) => {
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return '';

  const path = mediaType === 'movie'
    ? `/movie/${encodeURIComponent(String(tmdbId))}`
    : seasonNumber != null && episodeNumber != null
      ? `/tv/${encodeURIComponent(String(tmdbId))}/${encodeURIComponent(String(seasonNumber))}/${encodeURIComponent(String(episodeNumber))}`
      : '';

  if (!path) return '';

  const url = new URL(path, 'https://vidcore.io');
  url.searchParams.set('autoPlay', 'true');
  url.searchParams.set('fullscreenButton', 'true');
  url.searchParams.set('chromecast', 'true');
  return url.toString();
};

export const WatchPage: React.FC<WatchPageProps> = ({
  mediaType,
  tmdbId,
  seasonNumber,
  episodeNumber,
}) => {
  const iframeUrl = buildVidCoreUrl(mediaType, tmdbId, seasonNumber, episodeNumber);

  if (!iframeUrl) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-slate-300 text-sm px-6 text-center">
        رابط المشاهدة غير صالح.
      </div>
    );
  }

  return (
    <main className="min-h-screen w-full bg-black">
      <iframe
        src={iframeUrl}
        title={mediaType === 'movie' ? `VidCore movie ${tmdbId}` : `VidCore series ${tmdbId} S${seasonNumber}E${episodeNumber}`}
        className="block h-screen w-full border-0 bg-black"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        loading="eager"
        scrolling="no"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </main>
  );
};

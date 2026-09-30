import React, { useMemo, useState } from 'react';

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

const VIDCORE_HOST = 'vidcore.io';

function buildVidCoreIframeUrl(
  contentType: 'movie' | 'series',
  tmdbId: number,
  seasonNumber?: number,
  episodeNumber?: number,
) {
  if (!Number.isFinite(Number(tmdbId)) || Number(tmdbId) <= 0) return '';

  const mediaPath = contentType === 'movie'
    ? `/movie/${encodeURIComponent(String(tmdbId))}`
    : seasonNumber != null && episodeNumber != null
      ? `/tv/${encodeURIComponent(String(tmdbId))}/${encodeURIComponent(String(seasonNumber))}/${encodeURIComponent(String(episodeNumber))}`
      : '';

  if (!mediaPath) return '';

  const url = new URL(mediaPath, `https://${VIDCORE_HOST}`);
  url.searchParams.set('autoPlay', 'true');
  url.searchParams.set('fullscreenButton', 'true');
  url.searchParams.set('chromecast', 'true');
  return url.toString();
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  contentType,
  title,
  titleEn,
  tmdbId,
  seasonNumber,
  episodeNumber,
  currentEpisode,
}) => {
  const { iframeUrl, invalid } = useMemo(() => {
    const url = buildVidCoreIframeUrl(contentType, Number(tmdbId), seasonNumber, episodeNumber);
    return { iframeUrl: url, invalid: !url };
  }, [contentType, episodeNumber, seasonNumber, tmdbId]);

  const [iframeError, setIframeError] = useState(false);

  const displayTitle = contentType === 'movie'
    ? (titleEn || title)
    : (currentEpisode?.titleEn || currentEpisode?.title || titleEn || title);

  if (invalid) {
    return (
      <div className="flex aspect-video w-full items-center justify-center bg-black px-6 py-10 text-center text-sm text-slate-300">
        {contentType === 'series'
          ? 'Season and episode are required for playback.'
          : 'TMDB id is unavailable for this title.'}
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-black" aria-label={displayTitle}>
      <iframe
        src={iframeUrl}
        title={displayTitle}
        className="absolute inset-0 h-full w-full border-0 bg-black"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        loading="eager"
        scrolling="no"
        data-player-engine="vidcore-iframe-direct"
        onError={() => setIframeError(true)}
      />

      {iframeError ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/80 px-4 py-3 text-center text-xs text-slate-300">
          تعذر تحميل إطار VidCore.
        </div>
      ) : null}
    </div>
  );
};

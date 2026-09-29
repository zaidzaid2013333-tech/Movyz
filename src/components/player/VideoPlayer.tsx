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

const RESOLVER_PLAYER_HOST = 'movyz-akwam-resolver.sameranede.workers.dev';

const isAkwamPlayerUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;

    const host = url.hostname.toLowerCase();
    if (host === RESOLVER_PLAYER_HOST && /^\/player\/?$/i.test(url.pathname)) {
      return true;
    }

    // Never embed an Akwam content page directly; that would show the
    // complete site instead of the player.
    const akwamHosts = [
      'akwam.ss',
      'akwam.it',
      'go.akwam.it',
      'ak.sv',
      'go.ak.sv',
      'akwam.ee',
      'akwam.com.co',
      'go.akwam.com.co',
      'akwam.net',
      'downet.net',
    ];
    const allowedHost = akwamHosts.some(
      (base) => host === base || host.endsWith('.' + base),
    );
    if (!allowedHost) return false;

    if (/\/(?:movie|movies|series|episode|episodes|download|link|search|login|register)(?:\/|[?#]|$)/i.test(url.pathname)) {
      return false;
    }

    return /\/(?:player|embed)(?:\/|[?#]|$)/i.test(url.pathname);
  } catch {
    return false;
  }
};

const normalizeAkwamPlayerUrl = (value: string) => {
  const trimmed = value.trim();
  return isAkwamPlayerUrl(trimmed) ? new URL(trimmed).toString() : '';
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

  const displayTitle = contentType === 'movie'
    ? (titleEn || title)
    : (currentEpisode?.titleEn || currentEpisode?.title || titleEn || title);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');

      if (!Number.isFinite(Number(tmdbId)) || Number(tmdbId) <= 0) {
        setLoading(false);
        setError(language === 'ar' ? 'معرّف TMDB غير متاح.' : 'TMDB id is unavailable.');
        return;
      }

      try {
        const response = await MovyzaApi.getWatchSources(
          Number(tmdbId),
          contentType,
          seasonNumber,
          episodeNumber,
        );

        const rawData: any = response?.data;
        const candidates = Array.isArray(rawData)
          ? rawData
          : [
              rawData,
              rawData?.source,
              rawData?.stream,
              ...(Array.isArray(rawData?.sources) ? rawData.sources : []),
            ].filter(Boolean);

        const source = candidates.find((item: any) => {
          const candidateUrl = String(
            item?.iframeUrl ||
            item?.iframe_url ||
            item?.playerUrl ||
            item?.player_url ||
            item?.url ||
            '',
          ).trim();
          const providerKey = String(item?.providerKey || item?.provider_key || '').toLowerCase();
          const provider = String(item?.provider || item?.label || item?.labelEn || '').toLowerCase();
          const type = String(item?.type || '').toLowerCase();

          return (
            (providerKey === 'akwam-iframe' ||
              providerKey === 'akwam' ||
              provider === 'akwam' ||
              provider.includes('akwam')) &&
            (!type || type === 'web') &&
            isAkwamPlayerUrl(candidateUrl)
          );
        });

        const resolved = normalizeAkwamPlayerUrl(
          String(
            (source as any)?.iframeUrl ||
            (source as any)?.iframe_url ||
            (source as any)?.playerUrl ||
            (source as any)?.player_url ||
            (source as any)?.url ||
            '',
          ).trim(),
        );
        if (!resolved) throw new Error('No dedicated Akwam iframe player was returned.');

        if (cancelled) return;

        // Change the iframe src once per source. Do not blank the iframe first
        // and do not use a React key that forces a second DOM reload.
        setIframeUrl((current) => current === resolved ? current : resolved);
        setLoading(false);
      } catch (caughtError) {
        console.error('[Movyz][AkwamPlayer]', caughtError);
        if (cancelled) return;
        setLoading(false);
        setError(language === 'ar'
          ? 'تعذر الحصول على مشغل Akwam حاليًا.'
          : 'Unable to load the Akwam player right now.');
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [contentType, episodeNumber, retryNonce, seasonNumber, tmdbId]);

  if (!iframeUrl && error) {
    return (
      <div className="flex min-h-52 w-full items-center justify-center bg-black px-6 py-10 text-center">
        <div>
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
    <div
      className="relative aspect-video w-full overflow-hidden bg-black"
      aria-label={displayTitle}
    >
      {iframeUrl ? (
        <iframe
          src={iframeUrl}
          title={displayTitle}
          className="absolute inset-0 h-full w-full border-0 bg-black"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          loading="eager"
          scrolling="no"
          referrerPolicy="no-referrer"
          data-player-engine="akwam-native-iframe"
          onError={() => setError(language === 'ar'
            ? 'تعذر تحميل مشغل Akwam.'
            : 'The Akwam player could not be loaded.')}
        />
      ) : null}

      {loading && !error ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-slate-300">
          {language === 'ar' ? 'جارٍ تحميل المشغل…' : 'Loading player…'}
        </div>
      ) : null}

      {error && iframeUrl ? (
        <div className="absolute inset-x-0 bottom-0 bg-black/75 px-4 py-3 text-center text-xs text-slate-300">
          <span>{error}</span>
          <button
            type="button"
            className="ml-3 underline underline-offset-2"
            onClick={() => setRetryNonce((value) => value + 1)}
          >
            {language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      ) : null}
    </div>
  );
};

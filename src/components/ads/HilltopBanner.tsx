import { useEffect, useRef, useState } from 'react';

const HILLTOP_SRC = 'https://untimely-hello.com/bwX.VpsddcGSl/0IY/WQcs/KePmk9ZuSZEUJlHk/PdTMc/0cOsTjgZx/Naj/kKt/NizbQl5/O-D/E/3/MGwQ';

type HilltopBannerProps = {
  className?: string;
  slotKey?: string;
  allowImmediatePair?: boolean;
};

export function HilltopBanner({
  className = '',
  slotKey = 'default',
  allowImmediatePair = false,
}: HilltopBannerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hasAd, setHasAd] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const currentPath = window.location.pathname;
    const storageKey = 'movyza_hilltop_state_v2';
    const now = Date.now();

    let lastPath = '';
    let lastShownAt = 0;

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { lastPath?: string; lastShownAt?: number };
        lastPath = typeof parsed.lastPath === 'string' ? parsed.lastPath : '';
        lastShownAt = Number.isFinite(parsed.lastShownAt) ? Number(parsed.lastShownAt) : 0;
      }
    } catch {}

    // Only suppress immediate duplicate mounts of the exact same slot.
    // Navigation to a new page is allowed to load Hilltop immediately.
    const sameSlotCooldown = !allowImmediatePair && lastPath === currentPath + ':' + slotKey && now - lastShownAt < 45_000;
    if (sameSlotCooldown) return;

    const script = document.createElement('script');
    script.async = true;
    script.referrerPolicy = 'no-referrer-when-downgrade';
    script.src = HILLTOP_SRC;
    (script as HTMLScriptElement & { settings?: Record<string, unknown> }).settings = {};

    container.replaceChildren(script);

    const observer = new MutationObserver(() => {
      const renderedNodes = Array.from(container.children).some((child) => child !== script);
      if (renderedNodes) setHasAd(true);
    });

    observer.observe(container, { childList: true, subtree: true });

    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          lastPath: currentPath + ':' + slotKey,
          lastShownAt: now,
        }),
      );
    } catch {}

    return () => {
      observer.disconnect();
      if (container.contains(script)) script.remove();
    };
  }, [slotKey, allowImmediatePair]);

  return (
    <div
      ref={containerRef}
      className={`w-full flex justify-center overflow-hidden transition-[min-height] duration-150 ${hasAd ? 'min-h-[100px] sm:min-h-[250px]' : 'min-h-0'} ${className}`}
      aria-label="Advertisement"
    />
  );
}

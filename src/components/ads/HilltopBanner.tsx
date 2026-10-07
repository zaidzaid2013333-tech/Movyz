import { useEffect, useRef, useState } from 'react';

const HILLTOP_SCRIPT = String.raw`(function(kgdnb){
var d = document,
    s = d.createElement('script'),
    l = d.currentScript || d.scripts[d.scripts.length - 1];
s.settings = kgdnb || {};
s.src = "\/\/untimely-hello.com\/bwX.VpsddcGSl\/0IY\/WQcs\/KePmk9ZuSZEUJlHk\/PdTMc\/0cOsTjgZx\/Naj\/kKt\/NizbQl5\/O-D\/E\/3\/MGwQ";
s.async = true;
s.referrerPolicy = 'no-referrer-when-downgrade';
l.parentNode.insertBefore(s, l);
})({})`;

const STORAGE_KEY = 'movyza_hilltop_ad_state_v1';
const COOLDOWN_MS = 75_000;
const WINDOW_MS = 30 * 60 * 1000;
const SAME_PATH_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_IMPRESSIONS = 4;

type AdState = {
  timestamps: number[];
  lastShownAt: number;
  lastPath: string;
  lastPathShownAt: number;
};

type HilltopBannerProps = {
  className?: string;
  slotKey?: string;
};

let memoryState: AdState = {
  timestamps: [],
  lastShownAt: 0,
  lastPath: '',
  lastPathShownAt: 0,
};

function readState(): AdState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return memoryState;
    const parsed = JSON.parse(raw) as Partial<AdState>;
    return {
      timestamps: Array.isArray(parsed.timestamps) ? parsed.timestamps.filter((value) => Number.isFinite(value)) : [],
      lastShownAt: Number.isFinite(parsed.lastShownAt) ? Number(parsed.lastShownAt) : 0,
      lastPath: typeof parsed.lastPath === 'string' ? parsed.lastPath : '',
      lastPathShownAt: Number.isFinite(parsed.lastPathShownAt) ? Number(parsed.lastPathShownAt) : 0,
    };
  } catch {
    return memoryState;
  }
}

function saveState(state: AdState) {
  memoryState = state;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Keep the in-memory limiter when storage is unavailable.
  }
}

export function HilltopBanner({ className = '', slotKey = 'unknown' }: HilltopBannerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(() => {
      if (cancelled || document.visibilityState === 'hidden') return;

      const now = Date.now();
      const state = readState();
      const recent = state.timestamps.filter((timestamp) => now - timestamp < WINDOW_MS);

      const blockedByCooldown =
        state.lastShownAt > 0 && now - state.lastShownAt < COOLDOWN_MS;

      const blockedOnSamePath =
        state.lastPath === slotKey &&
        state.lastPathShownAt > 0 &&
        now - state.lastPathShownAt < SAME_PATH_COOLDOWN_MS;

      if (blockedByCooldown || blockedOnSamePath || recent.length >= MAX_IMPRESSIONS) {
        return;
      }

      saveState({
        timestamps: [...recent, now],
        lastShownAt: now,
        lastPath: slotKey,
        lastPathShownAt: now,
      });

      if (!cancelled) setApproved(true);
    }, 900);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slotKey]);

  useEffect(() => {
    if (!approved) return;

    const container = containerRef.current;
    if (!container) return;

    container.replaceChildren();

    const bootstrap = document.createElement('script');
    bootstrap.type = 'text/javascript';
    bootstrap.text = HILLTOP_SCRIPT;
    container.appendChild(bootstrap);

    return () => {
      container.replaceChildren();
    };
  }, [approved]);

  if (!approved) return null;

  return (
    <div
      ref={containerRef}
      className={`w-full max-w-[300px] min-h-[250px] mx-auto flex items-center justify-center overflow-hidden ${className}`}
      aria-label="Advertisement"
    />
  );
}

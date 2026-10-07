import { useEffect, useRef } from 'react';

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

type HilltopBannerProps = {
  className?: string;
};

export function HilltopBanner({ className = '' }: HilltopBannerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
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
  }, []);

  return (
    <div
      ref={containerRef}
      className={`w-full min-h-[250px] flex items-center justify-center overflow-hidden ${className}`}
      aria-label="Advertisement"
    />
  );
}

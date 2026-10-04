import React, { useRef } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface SectionRowProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}

export const SectionRow: React.FC<SectionRowProps> = ({
  title,
  subtitle,
  actionLabel,
  onAction,
  children,
}) => {
  const { direction } = useLanguage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const items = React.Children.toArray(children).filter(Boolean);

  if (items.length === 0) return null;

  const handleScroll = (distance: number) => {
    if (!scrollRef.current) return;
    const rtlFactor = direction === 'rtl' ? -1 : 1;
    scrollRef.current.scrollBy({
      left: distance * rtlFactor,
      behavior: 'smooth',
    });
  };

  return (
    <section className="movyza-section w-full space-y-4 py-2 sm:py-3">
      <div className="flex items-end justify-between gap-3 px-4 sm:px-6 max-w-7xl mx-auto">
        <div className="min-w-0">
          <h2 className="movyza-section-heading text-[17px] sm:text-lg lg:text-xl font-bold font-cinema-title text-white tracking-tight">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="text-xs font-semibold text-amber-400 hover:text-amber-300 transition-all cursor-pointer py-2.5 px-3 rounded-xl hover:bg-white/[0.04] border border-transparent hover:border-amber-400/10"
            >
              {actionLabel}
            </button>
          )}

          <div className="hidden sm:flex items-center gap-1">
            <button
              onClick={() => handleScroll(-420)}
              className="w-8 h-8 rounded-full bg-white/[0.035] hover:bg-white/[0.08] text-slate-400 hover:text-white border border-white/[0.07] flex items-center justify-center transition-all cursor-pointer active:scale-90"
              aria-label="Scroll backward"
            >
              {direction === 'rtl' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <button
              onClick={() => handleScroll(420)}
              className="w-8 h-8 rounded-full bg-white/[0.035] hover:bg-white/[0.08] text-slate-400 hover:text-white border border-white/[0.07] flex items-center justify-center transition-all cursor-pointer active:scale-90"
              aria-label="Scroll forward"
            >
              {direction === 'rtl' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-[#040507] to-transparent z-10 hidden sm:block" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#040507] to-transparent z-10 hidden sm:block" />
        <div
          ref={scrollRef}
          className="touch-scroll-x flex items-stretch gap-3 sm:gap-4 px-4 sm:px-6 pb-2 max-w-7xl mx-auto"
          style={{ scrollPaddingInline: '1rem' }}
        >
          {items}
        </div>
      </div>
    </section>
  );
};
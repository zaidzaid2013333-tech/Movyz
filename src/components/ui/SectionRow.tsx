import React, { useRef } from 'react';
import { ChevronRight, ChevronLeft, Clapperboard, Sparkles } from 'lucide-react';
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

  const handleScroll = (distance: number) => {
    if (!scrollRef.current) return;
    const factor = direction === 'rtl' ? -1 : 1;
    scrollRef.current.scrollBy({
      left: distance * factor,
      behavior: 'smooth',
    });
  };

  return (
    <section className="w-full space-y-3.5 py-1">
      {/* Clean, Simple Header */}
      <div className="flex items-end justify-between px-3 sm:px-6 max-w-7xl mx-auto">
        <div>
          <h2 className="text-base sm:text-lg lg:text-xl font-bold font-cinema-title text-white tracking-tight">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors cursor-pointer py-1 px-2.5 rounded-lg hover:bg-amber-500/10"
            >
              {actionLabel}
            </button>
          )}

          <div className="hidden sm:flex items-center gap-1.5">
            <button
              onClick={() => handleScroll(-380)}
              className="w-8 h-8 rounded-xl bg-[#0e1017] hover:bg-white/[0.1] text-slate-300 hover:text-white border border-amber-500/15 flex items-center justify-center transition-colors cursor-pointer shadow-sm"
              aria-label="Scroll backward"
            >
              {direction === 'rtl' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <button
              onClick={() => handleScroll(380)}
              className="w-8 h-8 rounded-xl bg-[#0e1017] hover:bg-white/[0.1] text-slate-300 hover:text-white border border-amber-500/15 flex items-center justify-center transition-colors cursor-pointer shadow-sm"
              aria-label="Scroll forward"
            >
              {direction === 'rtl' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Fluid Carousel */}
      <div
        ref={scrollRef}
        className="touch-scroll-x no-scrollbar flex items-stretch gap-3 sm:gap-4 px-3 sm:px-6 max-w-7xl mx-auto pb-2"
        style={{ scrollPadding: '1rem' }}
      >
        {children}
      </div>
    </section>
  );
};

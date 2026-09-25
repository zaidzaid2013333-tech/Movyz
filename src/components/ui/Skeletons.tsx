import React from 'react';

export const HeroSkeleton: React.FC = () => {
  return (
    <div className="relative w-full h-[60vh] min-h-[440px] max-h-[700px] bg-slate-900 skeleton-shimmer overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-t from-[#08090d] via-[#08090d]/60 to-transparent" />
      <div className="relative h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col justify-end pb-12 sm:pb-16 space-y-4">
        <div className="w-32 h-4 rounded bg-white/[0.08]" />
        <div className="w-80 sm:w-96 h-10 rounded bg-white/[0.1]" />
        <div className="w-56 h-3 rounded bg-white/[0.06]" />
        <div className="w-full max-w-lg h-12 rounded bg-white/[0.06]" />
        <div className="flex gap-3 pt-2">
          <div className="w-32 h-11 rounded-xl bg-white/[0.12]" />
          <div className="w-28 h-11 rounded-xl bg-white/[0.08]" />
        </div>
      </div>
    </div>
  );
};

export const CardSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col space-y-2 w-full animate-pulse">
      <div className="aspect-[2/3] w-full rounded-xl bg-white/[0.05] skeleton-shimmer border border-white/[0.05]" />
      <div className="w-3/4 h-3.5 rounded bg-white/[0.07]" />
      <div className="w-1/2 h-3 rounded bg-white/[0.04]" />
    </div>
  );
};

export const CardGridSkeleton: React.FC<{ count?: number }> = ({ count = 12 }) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4 lg:gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
};

export const EpisodeSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col sm:flex-row gap-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.05] animate-pulse">
      <div className="aspect-video sm:w-48 rounded-lg bg-white/[0.07] skeleton-shimmer shrink-0" />
      <div className="flex-1 space-y-2 py-1">
        <div className="w-48 h-4 rounded bg-white/[0.08]" />
        <div className="w-full h-8 rounded bg-white/[0.04]" />
        <div className="w-24 h-3 rounded bg-white/[0.05]" />
      </div>
    </div>
  );
};

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-14 rounded-xl bg-white/[0.03] skeleton-shimmer border border-white/[0.05]"
        />
      ))}
    </div>
  );
};

import React from 'react';
import { AlertCircle, Film, RefreshCw, ArrowLeft, ArrowRight, SearchX } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: 'film' | 'search' | 'watchlist' | 'history';
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
  icon = 'film',
}) => {
  return (
    <div className="flex flex-col items-center justify-center text-center p-8 sm:p-12 my-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] max-w-md mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-amber-400 mb-4 shadow-inner">
        {icon === 'search' ? (
          <SearchX className="w-8 h-8 stroke-[1.5]" />
        ) : (
          <Film className="w-8 h-8 stroke-[1.5]" />
        )}
      </div>
      <h3 className="text-base sm:text-lg font-bold text-white mb-2">{title}</h3>
      <p className="text-xs sm:text-sm text-slate-400 leading-relaxed mb-6">{description}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="min-h-[44px] px-6 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm transition-all shadow-lg shadow-amber-500/20 active:scale-98 cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  onGoHome?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  message,
  onRetry,
  onGoHome,
}) => {
  const { t, direction } = useLanguage();

  return (
    <div className="flex flex-col items-center justify-center text-center p-8 sm:p-12 my-8 rounded-2xl bg-rose-500/[0.03] border border-rose-500/20 max-w-lg mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4">
        <AlertCircle className="w-7 h-7" />
      </div>
      <h3 className="text-base sm:text-lg font-bold text-white mb-2">
        {t('errorLoadingData')}
      </h3>
      {message && <p className="text-xs text-rose-300/80 mb-6 font-mono">{message}</p>}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {onRetry && (
          <button
            onClick={onRetry}
            className="min-h-[44px] px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{t('retry')}</span>
          </button>
        )}
        {onGoHome && (
          <button
            onClick={onGoHome}
            className="min-h-[44px] px-5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/[0.1] font-semibold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer"
          >
            {direction === 'rtl' ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
            <span>{t('goHome')}</span>
          </button>
        )}
      </div>
    </div>
  );
};

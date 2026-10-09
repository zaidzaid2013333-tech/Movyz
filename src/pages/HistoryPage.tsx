import React, { useState, useEffect } from 'react';
import { WatchProgress } from '../types';
import { MovyzaApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { EmptyState } from '../components/ui/FeedbackStates';
import { Play, RotateCcw, Clock, Film, Trash2 } from 'lucide-react';

interface HistoryPageProps {
  onNavigate: (path: string) => void;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ onNavigate }) => {
  const { language, t } = useLanguage();
  const [history, setHistory] = useState<WatchProgress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    MovyzaApi.getWatchHistory().then((res) => {
      setHistory(res.data);
      setLoading(false);
    });
  }, []);

  const handleClearHistory = async () => {
    try {
      await MovyzaApi.clearWatchHistory();
      setHistory([]);
    } catch {
      // Keep server-backed history intact when deletion fails.
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-in fade-in duration-300">
      {/* Bespoke Header */}
      <div className="relative rounded-3xl p-6 sm:p-8 bg-[#080a10] border border-amber-500/20 overflow-hidden shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-xs">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>{language === 'ar' ? 'سجل السيلولويد المستمر' : 'Continuous Reel Log'}</span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-cinema-title font-bold text-white tracking-wide">
              {t('history')}
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-xl">
              {language === 'ar'
                ? 'سجل المشاهدات وتقدم التشغيل التلقائي لمواصلة أعمالك المفضلة من نفس النقطة الزمنية.'
                : 'Playback log and automated resume timestamps across your screens.'}
            </p>
          </div>

          {history.length > 0 && (
            <button
              onClick={handleClearHistory}
              className="text-xs font-semibold text-rose-400 hover:text-rose-300 py-2 px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 flex items-center gap-2 transition-all cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{language === 'ar' ? 'تفريغ سجل المشاهدة' : 'Clear Playback Log'}</span>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-[#090b10] border border-amber-500/10 animate-pulse" />
          ))}
        </div>
      ) : history.length === 0 ? (
        <EmptyState
          title={t('emptyHistoryTitle')}
          description={t('emptyHistoryDesc')}
          actionLabel={language === 'ar' ? 'تصفح الأفلام' : 'Explore Movies'}
          onAction={() => onNavigate('/movies')}
          icon="history"
        />
      ) : (
        <div className="space-y-3">
          {history.map((item) => {
            const isFinished = item.percentage >= 90;
            const watchUrl =
              item.contentType === 'movie'
                ? `/watch/movie/${item.contentId}`
                : `/watch/tv/${item.contentId}/${item.seasonNumber || 1}/${item.episodeNumber || 1}`;

            return (
              <div
                key={`${item.contentId}-${item.seasonNumber || 0}-${item.episodeNumber || 0}`}
                onClick={() => onNavigate(watchUrl)}
                className="group p-4 rounded-2xl bg-[#090b10] border border-amber-500/15 hover:border-amber-500/50 hover:bg-[#0e111a] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer shadow-lg"
              >
                <div className="flex items-center gap-4">
                  <div className="relative w-28 sm:w-36 aspect-[16/9] rounded-xl overflow-hidden bg-slate-900 shrink-0 border border-amber-500/20">
                    <img
                      src={item.backdropUrl}
                      alt={item.title || item.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="w-8 h-8 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center opacity-0 group-hover:opacity-100 transform scale-75 group-hover:scale-100 transition-all shadow-md">
                        <Play className="w-4 h-4 fill-slate-950 translate-x-0.5" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        {item.contentType === 'movie' ? (language === 'ar' ? 'فيلم' : 'MOVIE') : (language === 'ar' ? 'حلقة مسلسل' : 'SERIES')}
                      </span>
                      {item.episodeNumber && (
                        <span className="text-[11px] font-mono text-slate-400">
                          {t('season')} {item.seasonNumber} · {t('episode')} {item.episodeNumber}
                        </span>
                      )}
                    </div>
                    <h3 className="font-cinema-title font-bold text-white text-sm sm:text-base group-hover:text-amber-300 transition-colors">
                      {item.title || item.title}
                    </h3>
                    <p className="text-xs text-slate-400 font-mono">
                      {Math.floor(item.positionSeconds / 60)} / {Math.floor(item.durationSeconds / 60)} {t('minutes')}
                    </p>
                  </div>
                </div>

                <div className="flex sm:flex-col sm:items-end justify-between sm:justify-center gap-2 shrink-0">
                  <div className="w-32 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-amber-400 h-full rounded-full"
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-amber-400 font-mono">
                    {item.percentage}% {isFinished ? (language === 'ar' ? 'مكتمل' : 'Watched') : (language === 'ar' ? 'متبقي' : 'Left')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

import React from 'react';
import { ArrowLeft, Film } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface WatchPageProps {
  mediaType: 'movie' | 'series';
  contentId: string;
  seasonNumber?: number;
  episodeNumber?: number;
  onNavigate: (path: string) => void;
}

export const WatchPage: React.FC<WatchPageProps> = ({ mediaType, contentId, seasonNumber, episodeNumber, onNavigate }) => {
  const { language } = useLanguage();
  const title = mediaType === 'movie'
    ? (language === 'ar' ? 'صفحة المشاهدة غير مفعّلة حالياً' : 'Playback is currently disabled')
    : (language === 'ar' ? 'مشاهدة الحلقات غير مفعّلة حالياً' : 'Episode playback is currently disabled');

  return (
    <div className="min-h-screen bg-[#07090e] flex items-center justify-center p-6">
      <div className="max-w-lg w-full text-center space-y-6">
        <div className="mx-auto w-20 h-20 rounded-3xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <Film className="w-9 h-9 text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">{title}</h1>
          <p className="mt-3 text-sm leading-7 text-slate-400">
            {language === 'ar'
              ? 'تمت إعادة بناء Movyza ليكون كاتالوجاً خفيفاً يعتمد على TMDB مع Supabase للحسابات والبيانات الشخصية. طبقات الـresolver والمصادر والمشغلات القديمة أزيلت بالكامل.'
              : 'Movyza is now a lightweight TMDB catalog with Supabase for accounts and personal data. The old resolver, provider and playback layers were removed.'}
          </p>
          {(seasonNumber || episodeNumber) && (
            <p className="mt-2 text-xs text-slate-500">S{seasonNumber} · E{episodeNumber} · {contentId}</p>
          )}
        </div>
        <button
          onClick={() => onNavigate(mediaType === 'movie' ? '/movies/' + contentId : '/series/' + contentId)}
          className="mx-auto inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          {language === 'ar' ? 'العودة للتفاصيل' : 'Back to details'}
        </button>
      </div>
    </div>
  );
};
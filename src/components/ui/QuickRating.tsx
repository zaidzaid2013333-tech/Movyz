import React, { useState, useEffect } from 'react';
import { Star, ThumbsUp } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface QuickRatingProps {
  contentId: string;
  initialRating?: number;
  className?: string;
}

export const QuickRating: React.FC<QuickRatingProps> = ({
  contentId,
  initialRating,
  className = '',
}) => {
  const { language } = useLanguage();
  const [userRating, setUserRating] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(`movyza_rating_${contentId}`);
      return saved ? Number(saved) : 0;
    } catch {
      return 0;
    }
  });

  const [hoverRating, setHoverRating] = useState<number>(0);
  const [ratedToast, setRatedToast] = useState(false);

  const handleRate = (rating: number) => {
    setUserRating(rating);
    try {
      localStorage.setItem(`movyza_rating_${contentId}`, String(rating));
      setRatedToast(true);
      setTimeout(() => setRatedToast(false), 2000);
    } catch {}
  };

  return (
    <div className={`inline-flex items-center gap-2 p-2 rounded-xl bg-white/[0.03] border border-white/10 ${className}`}>
      <span className="text-[11px] font-semibold text-slate-400">
        {language === 'ar' ? 'تقييمك:' : 'Your Rating:'}
      </span>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = (hoverRating || userRating) >= star;
          return (
            <button
              key={star}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              onClick={() => handleRate(star)}
              className="p-0.5 text-slate-500 hover:text-amber-400 transition-colors cursor-pointer"
              title={`${star} / 5`}
            >
              <Star
                className={`w-4 h-4 transition-all ${
                  filled ? 'fill-amber-400 text-amber-400 scale-110' : 'text-slate-500'
                }`}
              />
            </button>
          );
        })}
      </div>
      {userRating > 0 && (
        <span className="text-[11px] font-mono font-bold text-amber-400">
          {userRating}/5
        </span>
      )}
      {ratedToast && (
        <span className="text-[10px] text-emerald-400 animate-in fade-in">
          {language === 'ar' ? 'تم الحفظ!' : 'Saved!'}
        </span>
      )}
    </div>
  );
};

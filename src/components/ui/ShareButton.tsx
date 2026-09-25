import React, { useState } from 'react';
import { Share2, Check } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface ShareButtonProps {
  title: string;
  url?: string;
  className?: string;
  onToast?: (msg: string) => void;
}

export const ShareButton: React.FC<ShareButtonProps> = ({
  title,
  url,
  className = '',
  onToast,
}) => {
  const { language, t } = useLanguage();
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const targetUrl = url || window.location.href;
    const shareData = {
      title: `${title} | MOVYZA`,
      text: language === 'ar' ? `شاهد "${title}" الآن بجودة 4K على منصة موفيزا:` : `Watch "${title}" on MOVYZA:`,
      url: targetUrl,
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        // User cancelled or fallback to clipboard
      }
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(targetUrl);
      setCopied(true);
      if (onToast) {
        onToast(language === 'ar' ? 'تم نسخ الرابط بنجاح!' : 'Link copied to clipboard!');
      }
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleShare}
      className={`px-3.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 hover:text-white border border-white/10 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${className}`}
      title={language === 'ar' ? 'مشاركة' : 'Share'}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
          <span className="text-emerald-400">{language === 'ar' ? 'تم النسخ' : 'Copied'}</span>
        </>
      ) : (
        <>
          <Share2 className="w-3.5 h-3.5 text-amber-400" />
          <span>{t('share')}</span>
        </>
      )}
    </button>
  );
};

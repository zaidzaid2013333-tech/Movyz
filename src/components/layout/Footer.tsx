import React from 'react';
import { useLanguage } from '../../context/LanguageContext';

interface FooterProps {
  onNavigate: (path: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  const { t, language } = useLanguage();

  return (
    <footer className="movyza-footer w-full border-t border-white/[0.06] bg-[#06070a] text-slate-400 text-xs py-10 px-4 sm:px-6 lg:px-8 mt-16 mb-16 md:mb-0">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-start">
          <div className="flex items-center gap-2">
            <img src="/pwa-icon.svg" alt="" aria-hidden="true" className="movyza-footer-brand-icon" width={28} height={28} />
            <span className="font-bold text-white tracking-wider font-sans uppercase text-sm">
              MOVYZA
            </span>
          </div>
          <span className="hidden sm:inline text-slate-600">·</span>
          <p className="text-slate-400 text-xs">
            {language === 'ar'
              ? 'منصة سينمائية عربية رائدة — صممت لتوفير تجربة مشاهدة أصيلة وفائقة الأداء.'
              : 'Prestige Arabic-first cinema and television platform. Engineered for seamless cinematic streaming.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-6 text-slate-400">
          <button
            onClick={() => onNavigate('/movies')}
            className="hover:text-white transition-colors cursor-pointer"
          >
            {t('movies')}
          </button>
          <button
            onClick={() => onNavigate('/series')}
            className="hover:text-white transition-colors cursor-pointer"
          >
            {t('series')}
          </button>
          <button
            onClick={() => onNavigate('/discover')}
            className="hover:text-white transition-colors cursor-pointer"
          >
            {t('discover')}
          </button>
          <button
            onClick={() => onNavigate('/watchlist')}
            className="hover:text-white transition-colors cursor-pointer"
          >
            {t('watchlist')}
          </button>
          <button
            onClick={() => onNavigate('/legal')}
            className="hover:text-white transition-colors cursor-pointer"
          >
            {language === 'ar' ? 'DMCA والسياسات' : 'DMCA & Policy'}
          </button>
        </div>

        <div className="text-slate-400 text-[11px] tabular-nums">
          © {new Date().getFullYear()} MOVYZA. All rights reserved.
        </div>
      </div>
    </footer>
  );
};

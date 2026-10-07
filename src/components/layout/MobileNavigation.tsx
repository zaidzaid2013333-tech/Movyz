import React from 'react';
import { Home, Film, Tv, User, Search } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface MobileNavigationProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const MobileNavigation: React.FC<MobileNavigationProps> = ({ currentPath, onNavigate }) => {
  const { t, language } = useLanguage();

  const tabs = [
    { id: 'home', label: t('home'), path: '/', icon: Home },
    { id: 'movies', label: t('movies'), path: '/movies', icon: Film },
    { id: 'search', label: language === 'ar' ? 'بحث' : 'Search', path: '/search', icon: Search },
    { id: 'series', label: t('series'), path: '/series', icon: Tv },
    { id: 'profile', label: t('profile'), path: '/profile', icon: User },
  ];

  return (
    <nav className="movyza-mobile-bottom md:hidden fixed bottom-2 inset-x-2 z-40" aria-label="Mobile Navigation">
      <div
        className="max-w-md mx-auto rounded-[22px] bg-[#090c12]/92 backdrop-blur-2xl border border-white/[0.08] shadow-[0_18px_50px_rgba(0,0,0,0.55)] px-1.5 pt-1.5 grid grid-cols-5 items-center"
        style={{ paddingBottom: 'calc(6px + env(safe-area-inset-bottom))' }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.path === '/' ? currentPath === '/' : currentPath.startsWith(tab.path);

          return (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.path)}
              className="min-h-[50px] min-w-[44px] flex flex-col items-center justify-center relative rounded-2xl focus:outline-none transition-all active:scale-90 cursor-pointer"
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className={
                'w-10 h-7 rounded-xl flex items-center justify-center transition-all ' +
                (isActive ? 'bg-amber-400/12' : '')
              }>
                <Icon className={isActive ? 'w-5 h-5 text-amber-300 stroke-[2.5]' : 'w-5 h-5 text-slate-500'} />
              </div>
              <span className={isActive ? 'text-[10px] font-bold font-cinema-title text-amber-300' : 'text-[10px] font-normal font-cinema-title text-slate-500'}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
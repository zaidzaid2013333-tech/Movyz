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
    <nav className="movyza-mobile-bottom md:hidden fixed bottom-2 inset-x-2 z-40" aria-label={language === 'ar' ? 'التنقل الرئيسي' : 'Main navigation'}>
      <div
        className="max-w-md mx-auto rounded-full bg-[#090c12]/92 backdrop-blur-2xl border border-white/[0.08] shadow-[0_18px_50px_rgba(0,0,0,0.55)] px-1.5 py-1.5 flex items-center justify-between gap-1"
        style={{ paddingBottom: 'calc(6px + env(safe-area-inset-bottom))' }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.path === '/'
            ? currentPath === '/'
            : currentPath === tab.path || currentPath.startsWith(tab.path + '/');

          return (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.path)}
              className={
                'movyza-mobile-tab min-w-0 min-h-[48px] rounded-full inline-flex items-center justify-center gap-2 px-3 focus:outline-none cursor-pointer active:scale-[0.96] ' +
                (isActive ? 'is-active flex-1' : 'flex-none w-[46px] sm:w-[50px]')
              }
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              title={tab.label}
            >
              <Icon
                className={isActive ? 'w-5 h-5 shrink-0 text-amber-300 stroke-[2.5]' : 'w-5 h-5 shrink-0 text-slate-500'}
                aria-hidden="true"
              />
              <span className={
                'movyza-mobile-tab-label text-[11px] font-bold font-cinema-title ' +
                (isActive ? 'text-amber-300' : 'text-slate-500')
              }>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

import React from 'react';
import { Home, Film, Tv, Search, User, Compass } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface MobileNavigationProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const MobileNavigation: React.FC<MobileNavigationProps> = ({ currentPath, onNavigate }) => {
  const { t } = useLanguage();

  const tabs = [
    { id: 'home', label: t('home'), path: '/', icon: Home },
    { id: 'movies', label: t('movies'), path: '/movies', icon: Film },
    { id: 'series', label: t('series'), path: '/series', icon: Tv },
    { id: 'discover', label: t('discover'), path: '/discover', icon: Compass },
    { id: 'profile', label: t('profile'), path: '/profile', icon: User },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-3 inset-x-3 z-40"
      aria-label="Mobile Navigation"
    >
      <div className="max-w-md mx-auto h-16 rounded-2xl bg-[#090b10]/95 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black grid grid-cols-5 items-center px-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive =
            tab.path === '/' ? currentPath === '/' : currentPath.startsWith(tab.path);

          return (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.path)}
              className="min-h-[48px] min-w-[44px] flex flex-col items-center justify-center relative py-1 focus:outline-none transition-transform active:scale-90 cursor-pointer"
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="relative">
                <Icon
                  className={`w-5 h-5 transition-colors ${
                    isActive ? 'text-amber-400 stroke-[2.5]' : 'text-slate-400'
                  }`}
                />
                {isActive && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-amber-400 rounded-full shadow-sm shadow-amber-400/80" />
                )}
              </div>
              <span
                className={`text-[10px] font-cinema-title mt-0.5 transition-colors ${
                  isActive ? 'text-amber-300 font-bold' : 'text-slate-400 font-normal'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

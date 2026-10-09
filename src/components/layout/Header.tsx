import React, { useState } from 'react';
import { Search, Bookmark, User, Globe, Shield, LogOut, Menu, X, Play, Dices } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { LANGUAGE_LIST } from '../../lib/i18n';

interface HeaderProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  watchlistCount?: number;
}

export const Header: React.FC<HeaderProps> = ({ currentPath, onNavigate, watchlistCount = 0 }) => {
  const { t, language, setLanguage } = useLanguage();
  const { user, isAdmin, logout } = useAuth();
  const { openSurprise } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);

  const navLinks = [
    { label: t('home'), path: '/' },
    { label: t('movies'), path: '/movies' },
    { label: t('series'), path: '/series' },
    { label: t('discover'), path: '/discover' },
    { label: language === 'ar' ? 'أفضل 1000' : 'Top 1000', path: '/catalog' },
  ];

  const handleNav = (path: string) => {
    onNavigate(path);
    setMobileMenuOpen(false);
    setProfileDropdownOpen(false);
  };

  return (
    <header className="movyza-header sticky top-0 z-50 w-full bg-[#05070a]/82 backdrop-blur-2xl border-b border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 lg:gap-8 min-w-0">
          <button
            onClick={() => handleNav('/')}
            className="movyza-header-brand flex items-center gap-2 group text-start cursor-pointer shrink-0"
            aria-label="Movyza Home"
          >
            <img
              src="/pwa-icon.svg"
              alt=""
              aria-hidden="true"
              className="movyza-brand-icon"
              width={39}
              height={39}
            />
            <span className="text-lg sm:text-xl font-bold tracking-[0.16em] text-white font-cinzel leading-none uppercase">
              MOVYZA
            </span>
          </button>

          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive = link.path === '/'
                ? currentPath === '/'
                : currentPath === link.path || currentPath.startsWith(link.path + '/');
              return (
                <button
                  key={link.path}
                  onClick={() => handleNav(link.path)}
                  className={
                    'movyza-nav-link text-xs font-semibold px-3 py-2 rounded-xl transition-all cursor-pointer ' +
                    (isActive
                      ? 'is-active text-white bg-white/[0.06]'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.035]')
                  }
                  aria-current={isActive ? 'page' : undefined}
                >
                  {link.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          <button
            onClick={openSurprise}
            className="hidden sm:flex p-2.5 rounded-xl text-slate-400 hover:text-amber-300 hover:bg-white/[0.05] transition-all cursor-pointer"
            title={language === 'ar' ? 'اختر لي عملاً' : 'Surprise Me'}
            aria-label="Surprise Me"
          >
            <Dices className="w-4 h-4" />
          </button>

          <button
            onClick={() => handleNav('/search')}
            className={
              'p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all cursor-pointer ' +
              (currentPath === '/search' ? 'text-amber-300 bg-white/[0.05]' : '')
            }
            title={t('search')}
            aria-label={t('search')}
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            onClick={() => handleNav('/watchlist')}
            className={
              'hidden sm:flex p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all relative cursor-pointer ' +
              (currentPath === '/watchlist' ? 'text-amber-300 bg-white/[0.05]' : '')
            }
            title={t('watchlist')}
            aria-label={t('watchlist')}
          >
            <Bookmark className="w-4 h-4" />
            {watchlistCount > 0 && (
              <span className="absolute top-1 right-1 min-w-4 h-4 px-1 bg-amber-400 text-slate-950 font-bold text-[9px] rounded-full flex items-center justify-center tabular-nums">
                {watchlistCount}
              </span>
            )}
          </button>

          <div className="relative hidden sm:block">
            <button
              onClick={() => setLanguageMenuOpen((open) => !open)}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all cursor-pointer"
              title="Language"
              aria-expanded={languageMenuOpen}
              aria-label="Language"
            >
              <Globe className="w-3.5 h-3.5 text-amber-300" />
              <span className="font-mono text-[11px] font-bold">{LANGUAGE_LIST.find((item) => item.code === language)?.nativeName || language.toUpperCase()}</span>
            </button>
            {languageMenuOpen && (
              <div className="absolute top-full mt-2 right-0 w-56 max-h-80 overflow-y-auto rounded-2xl bg-[#0b0e14]/98 border border-white/10 shadow-2xl p-2 z-50 backdrop-blur-2xl">
                {LANGUAGE_LIST.map((item) => (
                  <button
                    key={item.code}
                    onClick={() => {
                      setLanguage(item.code);
                      setLanguageMenuOpen(false);
                    }}
                    className={'w-full px-3 py-2.5 rounded-xl text-left text-xs font-semibold transition-colors ' + (
                      language === item.code
                        ? 'bg-amber-400 text-slate-950'
                        : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                    )}
                  >
                    {item.nativeName}
                    <span className="ml-2 text-[10px] opacity-60">{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {user ? (
            <div className="relative shrink-0">
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="w-9 h-9 rounded-full overflow-hidden border border-white/10 hover:border-amber-400/60 transition-all cursor-pointer block p-0"
                aria-label="User Menu"
              >
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </button>

              {profileDropdownOpen && (
                <div className="absolute top-full mt-2 rtl:left-0 ltr:right-0 w-52 bg-[#0b0e14]/95 border border-white/10 rounded-2xl shadow-2xl p-2 z-50 text-xs backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-2 border-b border-white/[0.06]">
                    <p className="font-bold text-white truncate">{user.name}</p>
                    <p className="text-[11px] text-slate-500 truncate font-mono">{user.email}</p>
                  </div>
                  <button onClick={() => handleNav('/profile')} className="w-full text-start px-3 py-2.5 rounded-xl text-slate-200 hover:bg-white/[0.06] flex items-center gap-2 cursor-pointer">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t('profile')}</span>
                  </button>
                  <button onClick={() => handleNav('/history')} className="w-full text-start px-3 py-2.5 rounded-xl text-slate-200 hover:bg-white/[0.06] flex items-center gap-2 cursor-pointer">
                    <Play className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t('history')}</span>
                  </button>
                  {isAdmin && (
                    <button onClick={() => handleNav('/admin')} className="w-full text-start px-3 py-2.5 rounded-xl text-amber-300 hover:bg-white/[0.06] flex items-center gap-2 cursor-pointer font-semibold">
                      <Shield className="w-3.5 h-3.5" />
                      <span>{t('adminDashboard')}</span>
                    </button>
                  )}
                  <div className="border-t border-white/[0.06] my-1" />
                  <button onClick={logout} className="w-full text-start px-3 py-2.5 rounded-xl text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer">
                    <LogOut className="w-3.5 h-3.5" />
                    <span>{t('logout')}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => handleNav('/login')}
              className="hidden sm:block px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs transition-all cursor-pointer whitespace-nowrap"
            >
              {t('login')}
            </button>
          )}

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/[0.05] transition-all cursor-pointer"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden border-t border-white/[0.06] bg-[#05070a]/95 px-3 py-3 backdrop-blur-2xl animate-in slide-in-from-top-2 duration-150">
          <div className="grid grid-cols-2 gap-1.5">
            {navLinks.map((link) => (
              <button
                key={link.path}
                onClick={() => handleNav(link.path)}
                className={
                  'w-full text-start px-3 py-3 rounded-xl text-xs font-semibold transition-all ' +
                  (currentPath === link.path
                    ? 'text-white bg-white/[0.07]'
                    : 'text-slate-300 hover:text-white hover:bg-white/[0.045]')
                }
              >
                {link.label}
              </button>
            ))}
            <div className="col-span-2 rounded-xl bg-white/[0.03] p-2">
              <div className="px-1 pb-2 text-[11px] font-bold text-slate-500">Language</div>
              <div className="grid grid-cols-2 gap-1.5">
                {LANGUAGE_LIST.map((item) => (
                  <button
                    key={item.code}
                    onClick={() => {
                      setLanguage(item.code);
                      setMobileMenuOpen(false);
                    }}
                    className={'px-3 py-2.5 rounded-xl text-xs font-semibold text-left ' + (
                      language === item.code
                        ? 'bg-amber-400 text-slate-950'
                        : 'text-slate-300 bg-white/[0.02] hover:bg-white/[0.06]'
                    )}
                  >
                    <Globe className="inline-block w-3.5 h-3.5 mr-1.5 text-amber-300" />
                    {item.nativeName}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => handleNav('/watchlist')}
              className="px-3 py-3 rounded-xl text-xs font-semibold text-slate-300 bg-white/[0.03] flex items-center gap-2"
            >
              <Bookmark className="w-4 h-4 text-amber-300" />
              <span>{t('watchlist')}</span>
            </button>
            {!user && (
              <button onClick={() => handleNav('/login')} className="col-span-2 px-3 py-3 rounded-xl bg-amber-400 text-slate-950 font-bold text-xs">
                {t('login')}
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
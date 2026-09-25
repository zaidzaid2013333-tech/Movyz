import React, { useState } from 'react';
import { Search, Bookmark, User, Globe, Shield, LogOut, Menu, X, Play, Film, Dices } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

interface HeaderProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  watchlistCount?: number;
}

export const Header: React.FC<HeaderProps> = ({ currentPath, onNavigate, watchlistCount = 0 }) => {
  const { t, language, toggleLanguage } = useLanguage();
  const { user, isAdmin, logout } = useAuth();
  const { openSurprise } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  const navLinks = [
    { label: t('home'), path: '/' },
    { label: t('movies'), path: '/movies' },
    { label: t('series'), path: '/series' },
    { label: t('discover'), path: '/discover' },
  ];

  const handleNav = (path: string) => {
    onNavigate(path);
    setMobileMenuOpen(false);
    setProfileDropdownOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 w-full bg-[#07090e]/95 backdrop-blur-md border-b border-white/[0.08] transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo & Navigation */}
        <div className="flex items-center gap-6 lg:gap-8">
          <button
            onClick={() => handleNav('/')}
            className="flex items-center gap-2 group text-start cursor-pointer focus:outline-none"
            aria-label="Movyza Home"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 to-amber-400 flex items-center justify-center shadow-md shadow-amber-500/20 group-hover:scale-105 transition-transform">
              <Film className="w-4 h-4 text-slate-950 stroke-[2.5]" />
            </div>
            <span className="text-xl font-bold tracking-wider text-white font-cinzel leading-none uppercase">
              MOVYZA
            </span>
          </button>

          {/* Primary Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive = currentPath === link.path;
              return (
                <button
                  key={link.path}
                  onClick={() => handleNav(link.path)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                    isActive
                      ? 'text-amber-400 font-bold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {link.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Actions Cluster */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Surprise Me Random Title */}
          <button
            onClick={openSurprise}
            className="p-2 rounded-xl text-slate-300 hover:text-amber-400 hover:bg-white/[0.06] transition-colors cursor-pointer"
            title={language === 'ar' ? 'اختر لي فيلماً عشوائياً' : 'Surprise Me'}
            aria-label="Surprise Me"
          >
            <Dices className="w-4 h-4" />
          </button>

          {/* Search Trigger */}
          <button
            onClick={() => handleNav('/search')}
            className={`p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer ${
              currentPath === '/search' ? 'text-amber-400 bg-white/[0.06]' : ''
            }`}
            title={t('search')}
            aria-label={t('search')}
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Watchlist Quick Button */}
          <button
            onClick={() => handleNav('/watchlist')}
            className={`p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors relative cursor-pointer ${
              currentPath === '/watchlist' ? 'text-amber-400 bg-white/[0.06]' : ''
            }`}
            title={t('watchlist')}
            aria-label={t('watchlist')}
          >
            <Bookmark className="w-4 h-4" />
            {watchlistCount > 0 && (
              <span className="absolute 0 top-1 right-1 w-4 h-4 bg-amber-500 text-slate-950 font-bold text-[10px] rounded-full flex items-center justify-center tabular-nums shadow-sm">
                {watchlistCount}
              </span>
            )}
          </button>

          {/* Language Switcher */}
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            title={language === 'ar' ? 'Switch to English' : 'التحويل للعربية'}
          >
            <Globe className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-mono text-[11px] font-bold">{language === 'ar' ? 'EN' : 'عربي'}</span>
          </button>

          {/* User Profile / Auth */}
          {user ? (
            <div className="relative shrink-0 flex items-center">
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="w-8 h-8 min-w-[32px] min-h-[32px] max-w-[32px] max-h-[32px] aspect-square rounded-full overflow-hidden shrink-0 border border-white/20 hover:border-amber-400 focus:outline-none transition-all cursor-pointer block p-0"
                aria-label="User Menu"
              >
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover block aspect-square rounded-full"
                />
              </button>

              {profileDropdownOpen && (
                <div
                  className="absolute top-full mt-2 rtl:left-0 ltr:right-0 w-52 bg-[#0c0e14] border border-white/10 rounded-2xl shadow-2xl py-2 z-50 text-xs animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl"
                  onClick={() => setProfileDropdownOpen(false)}
                >
                  <div className="px-4 py-2 border-b border-white/[0.06]">
                    <p className="font-bold text-white truncate">{user.name}</p>
                    <p className="text-[11px] text-slate-400 truncate font-mono">{user.email}</p>
                  </div>
                  <button
                    onClick={() => handleNav('/profile')}
                    className="w-full text-start px-4 py-2 text-slate-200 hover:bg-white/[0.06] flex items-center gap-2 cursor-pointer"
                  >
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t('profile')}</span>
                  </button>
                  <button
                    onClick={() => handleNav('/history')}
                    className="w-full text-start px-4 py-2 text-slate-200 hover:bg-white/[0.06] flex items-center gap-2 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t('history')}</span>
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => handleNav('/admin')}
                      className="w-full text-start px-4 py-2 text-amber-400 hover:bg-white/[0.06] flex items-center gap-2 cursor-pointer font-semibold"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      <span>{t('adminDashboard')}</span>
                    </button>
                  )}
                  <div className="border-t border-white/[0.06] my-1" />
                  <button
                    onClick={logout}
                    className="w-full text-start px-4 py-2 text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>{t('logout')}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => handleNav('/login')}
              className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors cursor-pointer"
            >
              {t('login')}
            </button>
          )}

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-white/[0.08] bg-[#07090e] px-4 py-3 space-y-1 animate-in slide-in-from-top-2 duration-150">
          {navLinks.map((link) => (
            <button
              key={link.path}
              onClick={() => handleNav(link.path)}
              className={`w-full text-start px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                currentPath === link.path
                  ? 'text-amber-400 font-bold bg-white/[0.04]'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {link.label}
            </button>
          ))}
          {isAdmin && (
            <button
              onClick={() => handleNav('/admin')}
              className="w-full text-start px-3 py-2 rounded-lg text-xs font-semibold text-amber-400 hover:bg-white/[0.04] flex items-center gap-2"
            >
              <Shield className="w-4 h-4" />
              <span>{t('adminDashboard')}</span>
            </button>
          )}
        </div>
      )}
    </header>
  );
};

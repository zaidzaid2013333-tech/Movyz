import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { User, Shield, Globe, Bookmark, Clock, LogOut, Check, Moon, Smartphone, Download } from 'lucide-react';

interface ProfilePageProps {
  onNavigate: (path: string) => void;
  watchlistCount: number;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ onNavigate, watchlistCount }) => {
  const { user, isAdmin, logout } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const { theme, toggleTheme, canInstallPwa, installPwa } = useTheme();

  if (!user) {
    return (
      <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-[#0d101a] border border-white/10 flex items-center justify-center mx-auto text-amber-400">
          <User className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-cinema-title font-bold text-white">{t('welcomeBack')}</h2>
        <p className="text-xs text-slate-400">
          {language === 'ar'
            ? 'سجل دخولك للوصول إلى قائمتك وسجل المشاهدة عبر كافة أجهزتك.'
            : 'Sign in to access your saved watchlist and playback history.'}
        </p>
        <button
          onClick={() => onNavigate('/login')}
          className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-amber-500/20 cursor-pointer"
        >
          {t('login')}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6 animate-in fade-in duration-300">
      {/* User Profile Card */}
      <div className="rounded-2xl p-6 sm:p-8 bg-[#090b10] border border-white/10 shadow-xl">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <img
            src={user.avatarUrl}
            alt={user.name}
            referrerPolicy="no-referrer"
            className="w-20 h-20 aspect-square rounded-full object-cover border border-white/10 shadow-lg shrink-0"
          />

          <div className="flex-1 text-center sm:text-start space-y-2">
            <div>
              <h1 className="text-xl sm:text-2xl font-cinema-title font-bold text-white tracking-wide">
                {user.name}
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 font-mono">{user.email}</p>
            </div>

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 pt-3 text-xs">
              <button
                onClick={() => onNavigate('/watchlist')}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-slate-300 hover:text-white transition-all cursor-pointer"
              >
                <Bookmark className="w-4 h-4 text-amber-400" />
                <span>{t('watchlist')} ({watchlistCount})</span>
              </button>
              <button
                onClick={() => onNavigate('/history')}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-slate-300 hover:text-white transition-all cursor-pointer"
              >
                <Clock className="w-4 h-4 text-amber-400" />
                <span>{t('history')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Admin Quick Access: ONLY visible if the user is actually an Admin or Owner */}
      {isAdmin && (
        <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold text-white font-cinema-title">
                {language === 'ar' ? 'لوحة الإدارة' : 'Admin Control Panel'}
              </h3>
              <p className="text-xs text-slate-400">
                {language === 'ar' ? 'إدارة الأفلام والمسلسلات وسيرفرات البث' : 'Manage media catalog and stream servers'}
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('/admin')}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-all cursor-pointer"
          >
            {language === 'ar' ? 'فتح اللوحة' : 'Open Dashboard'}
          </button>
        </div>
      )}

      {/* Language Preferences */}
      <div className="space-y-3 p-6 rounded-2xl bg-[#090b10] border border-white/10">
        <h2 className="text-sm sm:text-base font-cinema-title font-bold text-white flex items-center gap-2">
          <Globe className="w-4 h-4 text-amber-400" />
          <span>{t('appLanguage')}</span>
        </h2>

        <div className="grid grid-cols-2 gap-3 max-w-xs pt-1">
          <button
            onClick={() => setLanguage('ar')}
            className={`p-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer flex items-center justify-between ${
              language === 'ar'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                : 'bg-white/[0.03] text-slate-300 border-white/10 hover:border-white/20'
            }`}
          >
            <span>{t('arabic')}</span>
            {language === 'ar' && <Check className="w-4 h-4 stroke-[3]" />}
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`p-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer flex items-center justify-between ${
              language === 'en'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                : 'bg-white/[0.03] text-slate-300 border-white/10 hover:border-white/20'
            }`}
          >
            <span>{t('english')}</span>
            {language === 'en' && <Check className="w-4 h-4 stroke-[3]" />}
          </button>
        </div>
      </div>

      {/* Display & Battery Mode (OLED Pure Black) */}
      <div className="space-y-3 p-6 rounded-2xl bg-[#090b10] border border-white/10">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h2 className="text-sm sm:text-base font-cinema-title font-bold text-white flex items-center gap-2">
              <Moon className="w-4 h-4 text-amber-400" />
              <span>{language === 'ar' ? 'نمط شاشات OLED الداكن جداً' : 'OLED Pure Black Mode'}</span>
            </h2>
            <p className="text-xs text-slate-400">
              {language === 'ar'
                ? 'خلفية سوداء نقية 100% لإراحة العين وتوفير طاقة بطارية الهاتف.'
                : '100% pitch black canvas to reduce eye strain and maximize battery life.'}
            </p>
          </div>

          <button
            onClick={toggleTheme}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              theme === 'oled'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'bg-white/[0.05] text-slate-300 hover:text-white border border-white/10'
            }`}
          >
            {theme === 'oled' ? (language === 'ar' ? 'مفعّل' : 'Active') : (language === 'ar' ? 'تفعيل' : 'Enable')}
          </button>
        </div>
      </div>

      {/* PWA Phone Installation */}
      <div className="space-y-3 p-6 rounded-2xl bg-[#090b10] border border-white/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white font-cinema-title">
                {language === 'ar' ? 'تثبيت المنصة كتطبيق على الهاتف' : 'Install Movyza as Mobile App'}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {language === 'ar'
                  ? 'ثبّت موفيزا على شاشتك الرئيسية للوصول السريع وبملء الشاشة بدون شريط المتصفح.'
                  : 'Add to home screen for faster full-screen streaming experience.'}
              </p>
            </div>
          </div>

          <button
            onClick={installPwa}
            className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-amber-500/20 shrink-0 self-start sm:self-auto"
          >
            <Download className="w-4 h-4" />
            <span>{language === 'ar' ? 'تثبيت التطبيق الآن' : 'Install App'}</span>
          </button>
        </div>
      </div>

      {/* Logout Action */}
      <div className="flex justify-end pt-2">
        <button
          onClick={logout}
          className="px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 text-xs font-medium flex items-center gap-2 transition-all cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>{t('logout')}</span>
        </button>
      </div>
    </div>
  );
};

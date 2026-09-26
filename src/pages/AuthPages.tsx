import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Play, Lock, Mail, User, CheckCircle2, AlertCircle } from 'lucide-react';

interface AuthPageProps {
  mode: 'login' | 'register' | 'forgot';
  onNavigate: (path: string) => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ mode, onNavigate }) => {
  const { login, register, requestPasswordReset } = useAuth();
  const { language, t } = useLanguage();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!email || !email.includes('@')) {
      setError('يرجى إدخال بريد إلكتروني صالح');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
        onNavigate('/');
      } else if (mode === 'register') {
        if (!name.trim()) {
          setError('يرجى كتابة الاسم');
          setLoading(false);
          return;
        }
        await register(name, email, password);
        onNavigate('/');
      } else if (mode === 'forgot') {
        await new Promise((resolve) => setTimeout(resolve, 400));
        setSuccessMessage('تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.');
      }
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء معالجة الطلب');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[75vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6 p-8 rounded-3xl bg-white/[0.02] border border-white/[0.08] shadow-2xl backdrop-blur-md">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mx-auto shadow-lg shadow-amber-500/20 mb-3">
            <Play className="w-6 h-6 text-slate-950 fill-slate-950 translate-x-0.5" />
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">
            {mode === 'login'
              ? t('welcomeBack')
              : mode === 'register'
              ? 'إنشاء حساب جديد في موفيزا'
              : 'استعادة كلمة المرور'}
          </h2>
          <p className="text-xs text-slate-400">
            {mode === 'login'
              ? 'استمتع بأفضل تجربة سينمائية عربية عالية الأداء'
              : mode === 'register'
              ? 'انضم إلى مجتمع المشاهدة الحصري واحفظ أعمالك المفضلة'
              : 'أدخل بريدك الإلكتروني لاستلام رابط تعيين كلمة المرور'}
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center gap-2 text-rose-300 text-xs animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center gap-2 text-emerald-300 text-xs animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                {t('fullName')}
              </label>
              <div className="relative flex items-center">
                <User className="absolute rtl:right-3.5 ltr:left-3.5 w-4 h-4 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="سامر أحمد"
                  className="w-full h-11 rtl:pr-10 rtl:pl-4 ltr:pl-10 ltr:pr-4 rounded-xl bg-white/[0.04] border border-white/[0.1] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              {t('emailAddress')}
            </label>
            <div className="relative flex items-center">
              <Mail className="absolute rtl:right-3.5 ltr:left-3.5 w-4 h-4 text-slate-500 pointer-events-none" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@movyza.tv"
                className="w-full h-11 rtl:pr-10 rtl:pl-4 ltr:pl-10 ltr:pr-4 rounded-xl bg-white/[0.04] border border-white/[0.1] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors font-mono"
              />
            </div>
          </div>

          {mode !== 'forgot' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">
                  {t('password')}
                </label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => onNavigate('/forgot-password')}
                    className="text-[11px] text-amber-400 hover:text-amber-300 cursor-pointer"
                  >
                    نسيت كلمة المرور؟
                  </button>
                )}
              </div>
              <div className="relative flex items-center">
                <Lock className="absolute rtl:right-3.5 ltr:left-3.5 w-4 h-4 text-slate-500 pointer-events-none" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-11 rtl:pr-10 rtl:pl-4 ltr:pl-10 ltr:pr-4 rounded-xl bg-white/[0.04] border border-white/[0.1] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <div className="w-5 h-5 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
            ) : mode === 'login' ? (
              t('login')
            ) : mode === 'register' ? (
              t('register')
            ) : (
              'إرسال الرابط'
            )}
          </button>
        </form>

        {/* Footer links */}
        <div className="pt-2 text-center text-xs text-slate-400 border-t border-white/[0.06]">
          {mode === 'login' ? (
            <p>
              ليس لديك حساب؟{' '}
              <button
                onClick={() => onNavigate('/register')}
                className="font-bold text-amber-400 hover:text-amber-300 cursor-pointer"
              >
                {t('register')}
              </button>
            </p>
          ) : (
            <p>
              لديك حساب بالفعل؟{' '}
              <button
                onClick={() => onNavigate('/login')}
                className="font-bold text-amber-400 hover:text-amber-300 cursor-pointer"
              >
                {t('login')}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

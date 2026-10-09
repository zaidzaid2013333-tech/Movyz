import React, { useEffect, useState } from 'react';
import {
  AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound,
  LoaderCircle, Mail, ShieldCheck, Sparkles, UserRound,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset' | 'callback';
type FlowStep = 'form' | 'verify-signup' | 'verify-recovery' | 'done';

interface AuthPageProps {
  mode: AuthMode;
  onNavigate: (path: string) => void;
}

const COOLDOWN_SECONDS = 60;

const friendlyAuthError = (error: unknown) => {
  const item = error as { message?: string; code?: string; status?: number; statusCode?: string };
  const raw = `${item?.code || ''} ${item?.statusCode || ''} ${item?.message || error || ''}`.toLowerCase();

  if (raw.includes('email_not_confirmed') || raw.includes('email not confirmed')) {
    return 'بريدك الإلكتروني لم يُؤكَّد بعد. أدخل رمز التأكيد الذي وصلك أو أعد إرساله.';
  }
  if (raw.includes('over_email_send_rate_limit') || raw.includes('email rate limit') || raw.includes('too many emails') || raw.includes('429')) {
    return 'تم بلوغ حد إرسال الرسائل مؤقتًا. انتظر قليلًا قبل إعادة المحاولة؛ إعداد SMTP مخصص يمنح Movyza إرسالًا موثوقًا.';
  }
  if (raw.includes('invalid_credentials') || raw.includes('invalid login credentials')) {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  }
  if (raw.includes('weak_password') || raw.includes('password should be') || raw.includes('password is too short')) {
    return 'استخدم كلمة مرور لا تقل عن 8 أحرف.';
  }
  if (raw.includes('token has expired') || raw.includes('otp_expired') || raw.includes('invalid token') || raw.includes('invalid otp')) {
    return 'انتهت صلاحية الرمز أو أنه غير صحيح. اطلب رسالة جديدة وأدخل الرمز الأحدث.';
  }
  if (raw.includes('email_address_invalid') || raw.includes('invalid email')) {
    return 'تحقق من كتابة البريد الإلكتروني بصورة صحيحة.';
  }
  if (raw.includes('user_already_exists') || raw.includes('user already registered') || raw.includes('email_exists')) {
    return 'تعذّر إنشاء الحساب بهذا البريد. جرّب تسجيل الدخول أو استعادة كلمة المرور.';
  }
  if (raw.includes('fetch') || raw.includes('network') || raw.includes('failed to fetch')) {
    return 'تعذر الاتصال بخدمة الحسابات. تحقق من الإنترنت ثم أعد المحاولة.';
  }
  return item?.message && !/\b(status|request|http|postgres|supabase)\b/i.test(item.message)
    ? item.message
    : 'حدث خطأ أثناء معالجة الطلب. حاول مرة أخرى بعد قليل.';
};

export const AuthPage: React.FC<AuthPageProps> = ({ mode, onNavigate }) => {
  const {
    user, loading: authLoading, login, register, verifySignupCode,
    resendSignupCode, requestPasswordReset, resetPasswordWithCode, updatePassword,
  } = useAuth();
  const { t } = useLanguage();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [token, setToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [step, setStep] = useState<FlowStep>('form');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown > 0]);

  useEffect(() => {
    if (mode === 'callback' && !authLoading) {
      if (user) {
        onNavigate('/');
      } else {
        setError('لم نتمكن من تأكيد الرابط. ربما انتهت صلاحيته؛ اطلب رسالة تأكيد جديدة.');
      }
    }
    if (mode === 'reset' && !authLoading && !user) {
      setError('افتح رابط استعادة كلمة المرور من الرسالة التي وصلتك، أو ارجع إلى صفحة الاستعادة لطلب رسالة جديدة.');
    }
  }, [mode, authLoading, user, onNavigate]);

  const normalizedEmail = email.trim().toLowerCase();

  const startCooldown = (seconds = COOLDOWN_SECONDS) => setCooldown(seconds);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('أدخل بريدًا إلكترونيًا صالحًا.');
      return;
    }

    if (step === 'verify-signup') {
      if (!/^\d{6}$/.test(token.trim())) {
        setError('أدخل رمز التأكيد المكوّن من 6 أرقام.');
        return;
      }
      setBusy(true);
      try {
        await verifySignupCode(normalizedEmail, token);
        onNavigate('/');
      } catch (err) {
        setError(friendlyAuthError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (step === 'verify-recovery') {
      if (!/^\d{6}$/.test(token.trim())) {
        setError('أدخل رمز الاستعادة المكوّن من 6 أرقام.');
        return;
      }
      if (password.length < 8) {
        setError('اختر كلمة مرور من 8 أحرف على الأقل.');
        return;
      }
      if (password !== passwordConfirm) {
        setError('كلمتا المرور غير متطابقتين.');
        return;
      }
      setBusy(true);
      try {
        await resetPasswordWithCode(normalizedEmail, token, password);
        setStep('done');
        setPassword('');
        setPasswordConfirm('');
        setSuccessMessage('تم تحديث كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول بكلمتك الجديدة.');
      } catch (err) {
        setError(friendlyAuthError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        await login(normalizedEmail, password);
        onNavigate('/');
      } else if (mode === 'register') {
        if (!name.trim()) throw new Error('يرجى كتابة اسمك.');
        if (password.length < 8) throw new Error('اختر كلمة مرور من 8 أحرف على الأقل.');
        if (password !== passwordConfirm) throw new Error('كلمتا المرور غير متطابقتين.');
        const signedIn = await register(name, normalizedEmail, password);
        if (signedIn) {
          onNavigate('/');
        } else {
          setStep('verify-signup');
          setToken('');
          startCooldown();
          setSuccessMessage('بدأ إنشاء حسابك. افحص بريدك الإلكتروني؛ يمكنك إدخال رمز التأكيد المكوّن من 6 أرقام أو فتح رابط التأكيد الموجود في الرسالة.');
        }
      } else if (mode === 'forgot') {
        // Always use a generic confirmation so the UI does not disclose whether
        // an account exists for a given email address.
        await requestPasswordReset(normalizedEmail);
        setStep('verify-recovery');
        setToken('');
        startCooldown();
        setSuccessMessage('إذا كان هذا البريد مرتبطًا بحساب، فستصلك رسالة استعادة. أدخل الرمز المكوّن من 6 أرقام ثم اختر كلمة مرور جديدة.');
      } else if (mode === 'reset') {
        if (password.length < 8) throw new Error('اختر كلمة مرور من 8 أحرف على الأقل.');
        if (password !== passwordConfirm) throw new Error('كلمتا المرور غير متطابقتين.');
        await updatePassword(password);
        setStep('done');
        setPassword('');
        setPasswordConfirm('');
        setSuccessMessage('تم تحديث كلمة المرور بأمان. يمكنك الآن تسجيل الدخول.');
      }
    } catch (err) {
      const mapped = friendlyAuthError(err);
      setError(mapped);
      if (mode === 'login' && mapped.includes('لم يُؤكَّد')) {
        setStep('verify-signup');
        setCooldown(0);
      }
      if (/حد إرسال الرسائل|إرسال الرسائل مؤقتًا/.test(mapped)) {
        startCooldown(300);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || busy) return;
    setError(null);
    setSuccessMessage(null);
    setBusy(true);
    try {
      if (step === 'verify-signup') {
        await resendSignupCode(normalizedEmail);
        setSuccessMessage('تم طلب رسالة تأكيد جديدة. استخدم أحدث رمز وصلك فقط.');
      } else {
        await requestPasswordReset(normalizedEmail);
        setSuccessMessage('إذا كان البريد مرتبطًا بحساب، فستصلك رسالة استعادة جديدة.');
      }
      startCooldown();
    } catch (err) {
      const mapped = friendlyAuthError(err);
      setError(mapped);
      startCooldown(/حد إرسال الرسائل|إرسال الرسائل مؤقتًا/.test(mapped) ? 300 : COOLDOWN_SECONDS);
    } finally {
      setBusy(false);
    }
  };

  const isVerification = step === 'verify-signup' || step === 'verify-recovery';
  const isSignup = step === 'verify-signup';
  const isResetLink = mode === 'reset';
  const title = mode === 'callback'
    ? 'تأكيد حساب Movyza'
    : step === 'done'
    ? 'تمت العملية بنجاح'
    : isVerification
    ? (isSignup ? 'تأكيد بريدك الإلكتروني' : 'استعادة حسابك')
    : mode === 'login'
    ? t('welcomeBack')
    : mode === 'register'
    ? 'أنشئ حساب Movyza'
    : isResetLink
    ? 'تعيين كلمة مرور جديدة'
    : 'نسيت كلمة المرور؟';

  const subtitle = mode === 'callback'
    ? 'نتحقق من رابط الأمان ونجهز حسابك.'
    : step === 'done'
    ? 'حسابك جاهز للمتابعة.'
    : isVerification
    ? `أدخل الرمز الذي أرسلناه إلى ${normalizedEmail || 'بريدك الإلكتروني'}.`
    : mode === 'login'
    ? 'مرحبًا بعودتك إلى تجربتك السينمائية.'
    : mode === 'register'
    ? 'احفظ قائمتك وواصل المشاهدة من حيث توقفت.'
    : isResetLink
    ? 'اختر كلمة مرور قوية لا تستخدمها في مواقع أخرى.'
    : 'سنساعدك على استعادة الوصول إلى حسابك بأمان.';

  if (mode === 'callback') {
    return (
      <div className="min-h-[65vh] grid place-items-center px-4 py-12">
        <div className="movyza-glass w-full max-w-md rounded-3xl p-8 text-center space-y-4">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-600 text-[#040507] shadow-xl shadow-amber-500/15">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-black text-white">{title}</h1>
          <p className="text-sm text-slate-400">{error || subtitle}</p>
          {authLoading && <LoaderCircle className="mx-auto h-5 w-5 animate-spin text-amber-300" />}
          {error && <button onClick={() => onNavigate('/login')} className="font-bold text-amber-300">العودة لتسجيل الدخول</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[75vh] overflow-hidden px-4 py-10 sm:py-14">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(ellipse_at_top,rgba(242,184,75,0.13),transparent_68%)]" />
      <div className="relative mx-auto w-full max-w-[460px] movyza-enter">
        <div className="mb-5 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.24em] text-amber-300/80">
          <Sparkles className="h-3.5 w-3.5" />
          <span>YOUR CINEMA, YOUR MOVYZA</span>
        </div>

        <div className="movyza-glass overflow-hidden rounded-[30px] shadow-[0_24px_80px_rgba(0,0,0,0.4)]">
          <div className="h-1 w-full bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
          <div className="p-6 sm:p-9">
            <div className="mb-7 text-center">
              <div className="mx-auto mb-4 grid h-[66px] w-[66px] place-items-center rounded-[21px] border border-amber-300/25 bg-gradient-to-br from-amber-200 via-amber-400 to-amber-700 text-[#070707] shadow-[0_10px_36px_rgba(242,184,75,0.2)]">
                <span className="font-cinzel text-[38px] font-black leading-none">M</span>
              </div>
              <h1 className="text-2xl font-black tracking-tight text-white sm:text-[28px]">{title}</h1>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-400">{subtitle}</p>
            </div>

            {error && (
              <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-2xl border border-rose-400/20 bg-rose-400/[0.07] p-3.5 text-sm leading-6 text-rose-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {successMessage && (
              <div role="status" className="mb-4 flex items-start gap-2.5 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] p-3.5 text-sm leading-6 text-emerald-100">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            {step === 'done' ? (
              <div className="space-y-4">
                <button onClick={() => onNavigate('/login')} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-400 font-bold text-[#080808] shadow-lg shadow-amber-500/10 transition hover:bg-amber-300">
                  الذهاب إلى تسجيل الدخول <ArrowLeft className="h-4 w-4" />
                </button>
                <button onClick={() => onNavigate('/')} className="w-full py-2 text-sm text-slate-400 transition hover:text-white">العودة إلى Movyza</button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'register' && step === 'form' && (
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300">الاسم الظاهر</span>
                    <span className="relative block">
                      <UserRound className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={70} required placeholder="كيف نناديك؟" className="h-12 w-full rounded-xl border border-white/[0.09] bg-black/30 pr-10 pl-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-amber-400/55 focus:ring-2 focus:ring-amber-400/10" />
                    </span>
                  </label>
                )}

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-300">البريد الإلكتروني</span>
                  <span className="relative block">
                    <Mail className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" type="email" required disabled={isVerification} placeholder="you@example.com" className="h-12 w-full rounded-xl border border-white/[0.09] bg-black/30 pr-10 pl-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-amber-400/55 focus:ring-2 focus:ring-amber-400/10 disabled:opacity-70" />
                  </span>
                </label>

                {isVerification && (
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300">{isSignup ? 'رمز تأكيد البريد' : 'رمز استعادة الحساب'}</span>
                    <span className="relative block">
                      <KeyRound className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <input value={token} onChange={(event) => setToken(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="••••••" className="h-14 w-full rounded-xl border border-amber-300/25 bg-black/35 pr-10 pl-4 text-center font-mono text-xl tracking-[0.55em] text-amber-200 outline-none transition placeholder:text-slate-700 focus:border-amber-400/70 focus:ring-2 focus:ring-amber-400/10" />
                    </span>
                  </label>
                )}

                {(mode === 'login' && step === 'form' || mode === 'register' && step === 'form' || isResetLink || step === 'verify-recovery') && (
                  <label className="block space-y-1.5">
                    <span className="flex items-center justify-between text-xs font-semibold text-slate-300">
                      <span>{isResetLink || step === 'verify-recovery' ? 'كلمة المرور الجديدة' : 'كلمة المرور'}</span>
                      {mode === 'login' && step === 'form' && (
                        <button type="button" onClick={() => onNavigate('/forgot-password')} className="text-amber-300 transition hover:text-amber-200">نسيت كلمة المرور؟</button>
                      )}
                    </span>
                    <span className="relative block">
                      <KeyRound className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type={showPassword ? 'text' : 'password'} required minLength={8} placeholder="8 أحرف على الأقل" className="h-12 w-full rounded-xl border border-white/[0.09] bg-black/30 pr-10 pl-12 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-amber-400/55 focus:ring-2 focus:ring-amber-400/10" />
                      <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} className="absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-500 transition hover:bg-white/5 hover:text-white">
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </span>
                  </label>
                )}

                {(mode === 'register' && step === 'form' || isResetLink || step === 'verify-recovery') && (
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300">تأكيد كلمة المرور</span>
                    <input value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} autoComplete="new-password" type={showPassword ? 'text' : 'password'} required minLength={8} placeholder="أعد كتابة كلمة المرور" className="h-12 w-full rounded-xl border border-white/[0.09] bg-black/30 px-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-amber-400/55 focus:ring-2 focus:ring-amber-400/10" />
                  </label>
                )}

                <button type="submit" disabled={busy || (isVerification && token.length !== 6)} className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 font-extrabold text-[#080808] shadow-[0_10px_30px_rgba(242,184,75,0.12)] transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55">
                  {busy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  {busy ? 'جارٍ التحقق...' : isVerification ? (isSignup ? 'تأكيد الحساب' : 'تغيير كلمة المرور') : mode === 'login' ? t('login') : mode === 'register' ? 'إنشاء حساب آمن' : isResetLink ? 'حفظ كلمة المرور الجديدة' : 'إرسال رمز الاستعادة'}
                </button>
              </form>
            )}

            {(step === 'verify-signup' || step === 'verify-recovery') && (
              <div className="mt-4 text-center">
                <button type="button" onClick={() => void handleResend()} disabled={busy || cooldown > 0} className="text-xs font-bold text-amber-300 transition hover:text-amber-200 disabled:cursor-not-allowed disabled:text-slate-600">
                  {cooldown > 0 ? `إعادة الإرسال بعد ${cooldown} ثانية` : isSignup ? 'إعادة إرسال رمز التأكيد' : 'إعادة إرسال رسالة الاستعادة'}
                </button>
                <p className="mt-2 text-[11px] leading-5 text-slate-500">لا تشارك الرمز مع أي شخص. إذا لم تصلك رسالة، افحص مجلد الرسائل غير المرغوب فيها.</p>
              </div>
            )}

            <div className="mt-6 border-t border-white/[0.07] pt-4 text-center text-sm text-slate-400">
              {mode === 'login' && step === 'form' ? (
                <p>ليس لديك حساب؟ <button onClick={() => onNavigate('/register')} className="font-bold text-amber-300 hover:text-amber-200">انضم إلى Movyza</button></p>
              ) : mode === 'register' && step === 'form' ? (
                <p>لديك حساب بالفعل؟ <button onClick={() => onNavigate('/login')} className="font-bold text-amber-300 hover:text-amber-200">تسجيل الدخول</button></p>
              ) : (
                <button onClick={() => onNavigate('/login')} className="inline-flex items-center gap-2 font-bold text-amber-300 hover:text-amber-200"><ArrowLeft className="h-4 w-4" /> العودة إلى تسجيل الدخول</button>
              )}
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-[11px] leading-5 text-slate-600">بمتابعتك، أنت تحافظ على أمان حسابك بعدم مشاركة كلمة المرور أو رمز التحقق.</p>
      </div>
    </div>
  );
};

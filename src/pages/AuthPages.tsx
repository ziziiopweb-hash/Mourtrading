import React, { useState } from 'react';
import { SignIn, SignUp } from '@clerk/react';
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, Mail, ShieldCheck, User } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { ConfigNotice } from '../components/ConfigNotice.tsx';
import { getPublicSupabaseConfigState, supabase } from '../lib/supabase.ts';

export const CLERK_DARK_APPEARANCE = {
  variables: {
    colorPrimary: '#D4AF37',
    colorTextOnPrimaryBackground: '#070A0F',
    colorBackground: '#0D131F',
    colorInputBackground: '#070A0F',
    colorInputText: '#F8FAFC',
    colorText: '#F8FAFC',
    colorTextSecondary: '#94A3B8',
    colorDanger: '#EF4444',
    colorSuccess: '#10B981',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'w-full shadow-none border border-white/10 bg-[#0D131F] rounded-2xl',
    card: 'bg-[#0D131F] text-[#F8FAFC] p-5 sm:p-6',
    headerTitle: 'text-[#F8FAFC] font-bold',
    headerSubtitle: 'text-slate-400',
    socialButtonsBlockButton:
      'bg-[#070A0F] border border-white/12 text-[#F8FAFC] hover:border-[#D4AF37]/50',
    formFieldLabel: 'text-slate-300 text-xs font-medium',
    formFieldInput:
      'bg-[#070A0F] border border-white/12 text-[#F8FAFC] focus:border-[#D4AF37] min-h-[44px]',
    formButtonPrimary:
      'bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] font-bold min-h-[44px]',
    footerActionLink: 'text-[#E5C158] hover:text-[#D4AF37]',
    identityPreviewText: 'text-[#F8FAFC]',
    identityPreviewEditButton: 'text-[#E5C158]',
    otpCodeFieldInput:
      'bg-[#070A0F] border border-white/15 text-[#E5C158] font-mono',
    dividerLine: 'bg-white/10',
    dividerText: 'text-slate-500',
  },
};

function formatSupabaseAuthError(err: unknown, isAr: boolean): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();
  if (lower.includes('invalid api key') || lower.includes('401')) {
    const cfg = getPublicSupabaseConfigState();
    return isAr
      ? `مفتاح Supabase العام لا يطابق رابط المشروع الحالي (${cfg.url}). تأكد من ضبط متغير VITE_SUPABASE_URL على رابط المشروع الصحيح الخاص بالمفتاح.`
      : `The Supabase publishable key does not match the current project URL (${cfg.url}). Set VITE_SUPABASE_URL to the matching Supabase project URL.`;
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return isAr
      ? 'تم إرسال عدة محاولات متتالية. يرجى الانتظار دقيقة ثم المحاولة مرة أخرى.'
      : 'Too many OTP requests. Please wait a minute before trying again.';
  }
  if (lower.includes('token has expired') || lower.includes('invalid')) {
    return isAr
      ? 'رمز التحقق غير صحيح أو منتهي الصلاحية. تحقق من الرمز المكون من 6 أرقام أو اطلب رمزاً جديداً.'
      : 'Verification code is invalid or expired. Check the 6-digit code or request a new one.';
  }
  return raw || (isAr ? 'تعذر إتمام العملية، يرجى المحاولة مجدداً.' : 'Unable to complete authentication.');
}

export function AuthRequestPage({ mode }: { mode: 'login' | 'register' }) {
  const {
    language,
    t,
    navigate,
    user,
    clerkActive,
    clerkError,
    readiness,
    completeSupabaseLogin,
  } = useApp();
  const isAr = language === 'ar';

  const [authMethod, setAuthMethod] = useState<'otp' | 'clerk'>(() =>
    clerkActive ? 'clerk' : 'otp',
  );
  const [userPickedTab, setUserPickedTab] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (clerkActive && !clerkError && !userPickedTab && !otpSent && !email && !fullName) {
      setAuthMethod('clerk');
    }
  }, [clerkActive, clerkError, userPickedTab, otpSent, email, fullName]);

  const clerkConfigured = readiness ? readiness.clerk.configured : clerkActive;
  const clerkReady = clerkActive && clerkConfigured && !clerkError;
  const missingClerkVars = readiness?.clerk.missingVars || [];

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length < 2) {
      setErrorMsg(isAr ? 'يرجى إدخال اسمك الكامل (حرفين على الأقل).' : 'Please enter your full name.');
      return;
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMsg(isAr ? 'يرجى إدخال بريد إلكتروني صحيح.' : 'Please enter a valid email address.');
      return;
    }

    setSendingOtp(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser: true,
          data: { full_name: cleanName },
        },
      });
      if (error) {
        setErrorMsg(formatSupabaseAuthError(error, isAr));
        return;
      }

      setOtpSent(true);
      setOtpCode('');
      setInfoMsg(
        isAr
          ? `تم إرسال رمز التحقق المكون من 6 أرقام إلى ${cleanEmail}`
          : `A 6-digit verification code was sent to ${cleanEmail}`,
      );
    } catch (err) {
      setErrorMsg(formatSupabaseAuthError(err, isAr));
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = fullName.trim() || cleanEmail.split('@')[0];
    const cleanToken = otpCode.replace(/\D/g, '').trim();

    if (cleanToken.length !== 6) {
      setErrorMsg(
        isAr
          ? 'يرجى إدخال رمز التحقق المكون من 6 أرقام.'
          : 'Please enter the 6-digit verification code.',
      );
      return;
    }

    setVerifyingOtp(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanToken,
        type: 'email',
      });

      if (error) {
        setErrorMsg(formatSupabaseAuthError(error, isAr));
        return;
      }

      const verifiedUser = data?.user || data?.session?.user;
      if (!verifiedUser) {
        setErrorMsg(
          isAr
            ? 'تعذر استرجاع بيانات المستخدم بعد التحقق. يرجى المحاولة مرة أخرى.'
            : 'Verified session did not return a user record.',
        );
        return;
      }

      // Persist user profile into Supabase `profiles` table (non-blocking if RLS/schema is not yet applied)
      try {
        await supabase.from('profiles').upsert(
          {
            id: verifiedUser.id,
            email: verifiedUser.email || cleanEmail,
            full_name: cleanName,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        );
      } catch {
        // Local profile cache below preserves user identity even if remote profiles table isn't provisioned
      }

      completeSupabaseLogin(verifiedUser, cleanName);
      navigate('/dashboard');
    } catch (err) {
      setErrorMsg(formatSupabaseAuthError(err, isAr));
    } finally {
      setVerifyingOtp(false);
    }
  };

  if (user) {
    return (
      <div className="max-w-md mx-auto py-10">
        <div className="bg-[#0D131F] border border-[#10B981]/30 rounded-2xl p-6 text-center space-y-4">
          <CheckCircle2 className="w-8 h-8 text-[#10B981] mx-auto" />
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-[#F8FAFC]">
              {isAr ? 'تم تسجيل الدخول بنجاح' : 'Session Active'}
            </h1>
            {user.displayName && (
              <p className="text-sm text-[#E5C158] font-medium">{user.displayName}</p>
            )}
            <p className="text-xs text-slate-400 font-mono-num" dir="ltr">
              {user.email}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={() => navigate('/dashboard')}
              className="px-5 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] text-xs font-bold cursor-pointer"
            >
              {t.nav.dashboard}
            </button>
            <button
              onClick={() => navigate('/profile')}
              className="px-4 py-2.5 rounded-xl border border-white/15 text-xs text-slate-200 cursor-pointer"
            >
              {t.nav.profile}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-6 sm:py-8 space-y-5">
      {/* Method Switcher keeping both Clerk and Supabase Email OTP available */}
      <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#0D131F] border border-white/10">
        <button
          type="button"
          onClick={() => {
            setUserPickedTab(true);
            setAuthMethod('clerk');
          }}
          className={`min-h-[40px] px-3 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
            authMethod === 'clerk'
              ? 'bg-[#D4AF37] text-[#070A0F]'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          {isAr ? 'تسجيل الدخول عبر Clerk' : 'Sign in with Clerk'}
        </button>
        <button
          type="button"
          onClick={() => {
            setUserPickedTab(true);
            setAuthMethod('otp');
          }}
          className={`min-h-[40px] px-3 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
            authMethod === 'otp'
              ? 'bg-[#D4AF37] text-[#070A0F]'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          {isAr ? 'الدخول برمز البريد (OTP)' : 'Email OTP Login'}
        </button>
      </div>

      {authMethod === 'otp' ? (
        <div className="bg-[#0D131F] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs text-[#D4AF37] font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>
                {isAr
                  ? 'دخول آمن برمز التحقق البريدي (6 أرقام)'
                  : 'Secure 6-Digit Email OTP Sign-In'}
              </span>
            </div>
            <h1 className="text-xl font-bold text-[#F8FAFC]">
              {mode === 'register' ? t.auth.registerTitle : t.auth.loginTitle}
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              {isAr
                ? 'أدخل اسمك وبريدك الإلكتروني لإرسال رمز تحقق من 6 أرقام وفتح جلستك مباشرة.'
                : 'Enter your full name and email address to receive a 6-digit verification code.'}
            </p>
          </div>

          {errorMsg && (
            <div className="rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/35 px-4 py-3 text-xs text-[#FCA5A5] leading-relaxed">
              {errorMsg}
            </div>
          )}

          {infoMsg && (
            <div className="rounded-xl bg-[#10B981]/10 border border-[#10B981]/35 px-4 py-3 text-xs text-[#6EE7B7] leading-relaxed">
              {infoMsg}
            </div>
          )}

          {!otpSent ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {isAr ? 'الاسم الكامل' : 'Full Name'}
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={isAr ? 'مثال: محمد العتيبي' : 'Your full name'}
                    className="w-full min-h-[44px] ps-10 pe-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC] placeholder:text-slate-600 focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {isAr ? 'البريد الإلكتروني' : 'Email Address'}
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none" />
                  <input
                    type="email"
                    required
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full min-h-[44px] ps-10 pe-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC] font-mono-num placeholder:text-slate-600 focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={sendingOtp}
                className="w-full min-h-[46px] rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-60 text-[#070A0F] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <span>
                  {sendingOtp
                    ? isAr
                      ? 'جاري إرسال رمز التحقق...'
                      : 'Sending Code...'
                    : isAr
                      ? 'إرسال رمز التحقق'
                      : 'Send Verification Code'}
                </span>
                {isAr ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="rounded-xl bg-[#070A0F] border border-white/10 px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#F8FAFC] truncate">{fullName}</div>
                  <div className="text-xs text-slate-400 font-mono-num truncate" dir="ltr">
                    {email.trim().toLowerCase()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOtpSent(false);
                    setOtpCode('');
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                  className="text-xs text-[#E5C158] hover:underline shrink-0 cursor-pointer"
                >
                  {isAr ? 'تعديل' : 'Edit'}
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {isAr ? 'رمز التحقق (6 أرقام)' : '6-Digit Verification Code'}
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-[#D4AF37] absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none" />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    dir="ltr"
                    required
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full min-h-[48px] ps-10 pe-4 rounded-xl bg-[#070A0F] border border-[#D4AF37]/40 text-center text-lg tracking-[0.4em] font-mono-num font-bold text-[#E5C158] placeholder:text-slate-700 focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={verifyingOtp || otpCode.length !== 6}
                className="w-full min-h-[46px] rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-60 text-[#070A0F] text-sm font-bold cursor-pointer transition-colors"
              >
                {verifyingOtp
                  ? isAr
                    ? 'جاري تأكيد الدخول...'
                    : 'Verifying...'
                  : isAr
                    ? 'تأكيد الدخول'
                    : 'Confirm Login'}
              </button>

              <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                <button
                  type="button"
                  disabled={sendingOtp}
                  onClick={(e) => void handleSendOtp(e as unknown as React.FormEvent)}
                  className="hover:text-[#E5C158] cursor-pointer disabled:opacity-50"
                >
                  {isAr ? 'إعادة إرسال الرمز' : 'Resend Code'}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/markets')}
                  className="hover:text-slate-200 cursor-pointer"
                >
                  {t.landing.ctaPrimary}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {!clerkReady && (
            <ConfigNotice
              title={
                isAr
                  ? 'يتطلب استكمال مفاتيح Clerk للمصادقة'
                  : 'Clerk Authentication Setup Required'
              }
              message={
                clerkError ||
                (isAr
                  ? 'لتفعيل التسجيل والدخول عبر Clerk، أضف المتغيرات التالية:'
                  : 'To enable Clerk sign-in and registration, configure these environment variables:')
              }
              missingVars={missingClerkVars}
            />
          )}

          <div className="bg-[#0D131F]/60 border border-white/10 rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="space-y-2 text-center sm:text-start">
              <div className="inline-flex items-center gap-2 text-xs text-[#D4AF37] font-semibold">
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {isAr
                    ? 'مصادقة Clerk بالتحقق البريدي والجلسات الآمنة'
                    : 'Clerk Email Auth · Verification · Passwordless Support'}
                </span>
              </div>
              <h1 className="text-xl font-bold text-[#F8FAFC]">
                {mode === 'register' ? t.auth.registerTitle : t.auth.loginTitle}
              </h1>
            </div>

            {clerkActive ? (
              <div className="flex justify-center" dir="ltr">
                {mode === 'register' ? (
                  <SignUp
                    routing="hash"
                    signInUrl="/login"
                    fallbackRedirectUrl="/dashboard"
                    appearance={CLERK_DARK_APPEARANCE}
                  />
                ) : (
                  <SignIn
                    routing="hash"
                    signUpUrl="/register"
                    fallbackRedirectUrl="/dashboard"
                    appearance={CLERK_DARK_APPEARANCE}
                  />
                )}
              </div>
            ) : (
              <div className="bg-[#070A0F] border border-white/10 rounded-xl p-6 text-center space-y-3">
                <p className="text-xs text-slate-300 leading-relaxed">
                  {isAr
                    ? 'واجهة Clerk غير نشطة حالياً لأن مفتاح VITE_CLERK_PUBLISHABLE_KEY غير مضبوط. يمكنك استخدام الدخول بالبريد ورمز التحقق من التبويب الأول.'
                    : 'Clerk UI requires VITE_CLERK_PUBLISHABLE_KEY. You can sign in right away using the Email OTP tab.'}
                </p>
                <button
                  onClick={() => setAuthMethod('otp')}
                  className="px-4 py-2 rounded-xl bg-[#D4AF37] text-[#070A0F] text-xs font-bold cursor-pointer"
                >
                  {isAr ? 'استخدام الدخول برمز التحقق (OTP)' : 'Use Email OTP Login'}
                </button>
              </div>
            )}

            <div className="pt-3 border-t border-white/8 text-center text-xs text-slate-400">
              {mode === 'login' ? (
                <button onClick={() => navigate('/register')} className="hover:text-[#E5C158] cursor-pointer">
                  {isAr ? 'ليس لديك حساب؟ أنشئ حساباً جديداً عبر Clerk' : 'New to MourTrading? Create an account'}
                </button>
              ) : (
                <button onClick={() => navigate('/login')} className="hover:text-[#E5C158] cursor-pointer">
                  {isAr ? 'لديك حساب بالفعل؟ تسجيل الدخول' : 'Already have an account? Sign In'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function VerifyOtpPage() {
  return <AuthRequestPage mode="login" />;
}

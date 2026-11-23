import React, { useEffect, useState } from 'react';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiFetch } from '../lib/api.ts';
import { ConfigNotice } from '../components/ConfigNotice.tsx';

export function AuthRequestPage({ mode }: { mode: 'login' | 'register' }) {
  const { language, t, navigate, setPendingOtpEmail, readiness } = useApp();
  const isAr = language === 'ar';

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingVars, setMissingVars] = useState<string[] | undefined>(undefined);

  const authReady = readiness ? readiness.supabase.configured && readiness.supabase.schemaReady : true;

  const missingConfigList = readiness?.supabase.missingVars || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMissingVars(undefined);
    setLoading(true);
    try {
      await apiFetch('/api/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), language }),
      });
      setPendingOtpEmail(email.trim().toLowerCase());
      navigate('/verify-otp');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setMissingVars(err.missingVars);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to request OTP');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto py-8 space-y-6">
      {!authReady && (
        <ConfigNotice
          title={isAr ? 'خدمة المصادقة و Supabase غير مكتملة الإعداد' : 'Supabase Auth & Database Setup Required'}
          message={
            readiness?.supabase.error ||
            (isAr
              ? 'إرسال رموز OTP الحقيقية وإنشاء الجلسات يتطلب تهيئة VITE_SUPABASE_URL و VITE_SUPABASE_PUBLISHABLE_KEY وتشغيل ملف supabase/schema.sql.'
              : 'Real Email OTP delivery and session issuance require VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, and running supabase/schema.sql.')
          }
          missingVars={missingConfigList}
        />
      )}

      <div className="bg-[#0D131F] border border-white/10 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-[#D4AF37] font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>{isAr ? 'مصادقة بدون كلمة مرور' : 'Passwordless OTP Authentication'}</span>
          </div>
          <h1 className="text-xl font-bold text-[#F8FAFC]">
            {mode === 'register' ? t.auth.registerTitle : t.auth.loginTitle}
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">{t.auth.adminNotice}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300" htmlFor="auth-email">
              {t.auth.emailLabel}
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute top-1/2 -translate-y-1/2 start-3.5" />
              <input
                id="auth-email"
                type="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.auth.emailPlaceholder}
                className="w-full min-h-[44px] ps-10 pe-4 rounded-xl bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC] placeholder:text-slate-600 focus:outline-none focus:border-[#D4AF37]"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444] space-y-1.5">
              <div>{error}</div>
              {missingVars && missingVars.length > 0 && (
                <div className="font-mono-num text-[11px] text-slate-300" dir="ltr">
                  Missing: {missingVars.join(', ')}
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[46px] rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-50 text-[#070A0F] font-bold text-sm transition-colors cursor-pointer"
          >
            {loading ? t.common.loading : t.auth.sendOtp}
          </button>
        </form>

        <div className="pt-4 border-t border-white/8 text-center text-xs text-slate-400">
          {mode === 'login' ? (
            <button onClick={() => navigate('/register')} className="hover:text-[#E5C158] cursor-pointer">
              {isAr ? 'ليس لديك حساب؟ أنشئ حساباً بالتحقق البريدي' : 'New to MourTrading? Register via Email OTP'}
            </button>
          ) : (
            <button onClick={() => navigate('/login')} className="hover:text-[#E5C158] cursor-pointer">
              {isAr ? 'لديك حساب بالفعل؟ تسجيل الدخول' : 'Already registered? Sign In'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function VerifyOtpPage() {
  const {
    language,
    t,
    navigate,
    pendingOtpEmail,
    setPendingOtpEmail,
    completeSupabaseSession,
  } = useApp();
  const isAr = language === 'ar';

  const [email, setEmail] = useState(pendingOtpEmail);
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(60);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        isAdmin: boolean;
        redirectTo: string;
        session: { access_token: string; refresh_token: string } | null;
      }>('/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
      });

      await completeSupabaseSession(res.session);
      navigate(res.redirectTo || (res.isAdmin ? '/admin' : '/dashboard'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || !email) return;
    setError(null);
    setInfo(null);
    setResending(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), language }),
      });
      setPendingOtpEmail(email.trim().toLowerCase());
      setCountdown(60);
      setInfo(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="max-w-md mx-auto py-8">
      <div className="bg-[#0D131F] border border-white/10 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-[#D4AF37] font-semibold">
            <KeyRound className="w-4 h-4" />
            <span>{isAr ? 'التحقق الأمني' : 'Security Verification'}</span>
          </div>
          <h1 className="text-xl font-bold text-[#F8FAFC]">{t.auth.verifyTitle}</h1>
          <p className="text-xs text-slate-400 leading-relaxed">{t.auth.otpHint}</p>
        </div>

        <form onSubmit={handleVerify} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">{t.auth.emailLabel}</label>
            <input
              type="email"
              required
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full min-h-[44px] px-4 rounded-xl bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#D4AF37]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">
              {isAr ? 'رمز التحقق (6 أرقام)' : '6-Digit Code'}
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full min-h-[48px] px-4 rounded-xl bg-[#070A0F] border border-white/12 text-center font-mono-num text-xl tracking-[0.4em] text-[#E5C158] focus:outline-none focus:border-[#D4AF37]"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444]">
              {error}
            </div>
          )}

          {info && (
            <div className="p-3 rounded-lg bg-[#10B981]/10 border border-[#10B981]/30 text-xs text-[#10B981]">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full min-h-[46px] rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-50 text-[#070A0F] font-bold text-sm transition-colors cursor-pointer"
          >
            {loading ? t.common.loading : t.auth.verifyOtp}
          </button>
        </form>

        <div className="flex items-center justify-between pt-3 border-t border-white/8 text-xs">
          <button
            type="button"
            disabled={countdown > 0 || resending}
            onClick={handleResend}
            className="text-[#D4AF37] disabled:text-slate-500 cursor-pointer disabled:cursor-not-allowed"
          >
            {countdown > 0
              ? `${t.auth.resendOtp} (${countdown}s)`
              : resending
                ? t.common.loading
                : t.auth.resendOtp}
          </button>
          <button onClick={() => navigate('/login')} className="text-slate-400 hover:text-slate-200 cursor-pointer">
            {isAr ? 'تغيير البريد' : 'Change email'}
          </button>
        </div>
      </div>
    </div>
  );
}

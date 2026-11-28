import React from 'react';
import { SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { ConfigNotice } from '../components/ConfigNotice.tsx';

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

export function AuthRequestPage({ mode }: { mode: 'login' | 'register' }) {
  const { language, t, navigate, user, clerkActive, clerkError } = useApp();
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const { openSignIn, openSignUp } = useClerk();
  const isAr = language === 'ar';

  if (isSignedIn || user) {
    const activeName =
      clerkUser?.fullName ||
      clerkUser?.firstName ||
      user?.displayName ||
      '';
    const activeEmail =
      clerkUser?.primaryEmailAddress?.emailAddress ||
      user?.email ||
      '';

    return (
      <div className="max-w-md mx-auto py-10">
        <div className="bg-[#0D131F] border border-[#10B981]/30 rounded-2xl p-6 text-center space-y-4">
          {clerkUser?.imageUrl ? (
            <img
              src={clerkUser.imageUrl}
              alt={activeName || 'Profile'}
              className="w-14 h-14 rounded-full mx-auto border border-[#D4AF37]/45 object-cover"
            />
          ) : (
            <CheckCircle2 className="w-8 h-8 text-[#10B981] mx-auto" />
          )}
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-[#F8FAFC]">
              {isAr ? 'تم تسجيل الدخول بنجاح' : 'Session Active'}
            </h1>
            {activeName && (
              <p className="text-sm text-[#E5C158] font-medium">{activeName}</p>
            )}
            {activeEmail && (
              <p className="text-xs text-slate-400 font-mono-num" dir="ltr">
                {activeEmail}
              </p>
            )}
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
      {clerkError && (
        <ConfigNotice
          title={
            isAr
              ? 'تعذر تحميل واجهة Clerk'
              : 'Clerk Authentication Unavailable'
          }
          message={clerkError}
          missingVars={[]}
        />
      )}

      <div className="bg-[#0D131F]/70 border border-white/10 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="space-y-2 text-center sm:text-start">
          <div className="inline-flex items-center gap-2 text-xs text-[#D4AF37] font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>
              {isAr
                ? 'تسجيل الدخول وإنشاء الحساب السريع عبر Clerk'
                : 'Clerk Email Auth & Verification'}
            </span>
          </div>
          <h1 className="text-xl font-bold text-[#F8FAFC]">
            {mode === 'register' ? t.auth.registerTitle : t.auth.loginTitle}
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            {isAr
              ? 'سجّل الدخول ببريدك الإلكتروني ورمز التحقق من Clerk لفتح حسابك ومتابعة الأسواق والمحفظة.'
              : 'Sign in quickly with your email and Clerk verification code to manage your profile and portfolio.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#070A0F] border border-white/10">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              mode === 'login'
                ? 'bg-[#D4AF37] text-[#070A0F]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {t.nav.login}
          </button>
          <button
            type="button"
            onClick={() => navigate('/register')}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              mode === 'register'
                ? 'bg-[#D4AF37] text-[#070A0F]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {t.nav.register}
          </button>
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
              {!isLoaded
                ? t.common.loading
                : isAr
                  ? 'يمكنك فتح نافذة Clerk مباشرة للمتابعة.'
                  : 'Open Clerk dialog to sign in or create an account.'}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => openSignIn({ fallbackRedirectUrl: '/dashboard' })}
                className="px-4 py-2 rounded-xl bg-[#D4AF37] text-[#070A0F] text-xs font-bold cursor-pointer"
              >
                {t.nav.login}
              </button>
              <button
                type="button"
                onClick={() => openSignUp({ fallbackRedirectUrl: '/dashboard' })}
                className="px-4 py-2 rounded-xl border border-white/15 text-xs text-slate-200 cursor-pointer"
              >
                {t.nav.register}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function VerifyOtpPage() {
  return <AuthRequestPage mode="login" />;
}

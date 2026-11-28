import React from 'react';
import { SignIn, SignUp, UserButton, useClerk, useUser } from '@clerk/react';
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
  const { language, t, navigate, clerkError } = useApp();
  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();
  const isAr = language === 'ar';

  const handleOpenSignIn = () => {
    try {
      clerk.openSignIn({ fallbackRedirectUrl: '/dashboard' });
    } catch (err) {
      console.error('[Clerk openSignIn error]', err);
    }
  };

  const handleOpenSignUp = () => {
    try {
      clerk.openSignUp({ fallbackRedirectUrl: '/dashboard' });
    } catch (err) {
      console.error('[Clerk openSignUp error]', err);
    }
  };

  if (isSignedIn && user) {
    const activeName = user.fullName || user.firstName || '';
    const activeEmail = user.primaryEmailAddress?.emailAddress || '';

    return (
      <div className="max-w-md mx-auto py-10">
        <div className="bg-[#0D131F] border border-[#10B981]/30 rounded-2xl p-6 text-center space-y-4">
          {user.imageUrl ? (
            <img
              src={user.imageUrl}
              alt={activeName || 'User'}
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
          <div className="flex items-center justify-center gap-3">
            <UserButton />
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
          title={isAr ? 'تعذر تحميل واجهة Clerk' : 'Clerk Authentication Error'}
          message={clerkError}
          missingVars={[]}
        />
      )}

      <div className="bg-[#0D131F]/70 border border-white/10 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs text-[#D4AF37] font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>{isAr ? 'تسجيل الدخول عبر Clerk' : 'Clerk Authentication'}</span>
            </div>
            <h1 className="text-xl font-bold text-[#F8FAFC]">
              {mode === 'register' ? t.auth.registerTitle : t.auth.loginTitle}
            </h1>
          </div>

          <button
            type="button"
            onClick={mode === 'register' ? handleOpenSignUp : handleOpenSignIn}
            className="px-3.5 py-2 rounded-xl border border-[#D4AF37]/40 text-xs font-semibold text-[#E5C158] hover:bg-[#D4AF37]/10 cursor-pointer"
          >
            {mode === 'register'
              ? isAr
                ? 'فتح نافذة التسجيل'
                : 'Open Sign Up Modal'
              : isAr
                ? 'فتح نافذة الدخول'
                : 'Open Sign In Modal'}
          </button>
        </div>

        <div className="flex justify-center" dir="ltr">
          {!isLoaded ? (
            <div className="py-8 text-xs text-slate-400">{t.common.loading}</div>
          ) : mode === 'register' ? (
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
      </div>
    </div>
  );
}

export function VerifyOtpPage() {
  return <AuthRequestPage mode="login" />;
}

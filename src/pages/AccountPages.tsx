import React, { useEffect, useState } from 'react';
import { SignIn, UserProfile, useClerk, useUser } from '@clerk/react';
import {
  Bell,
  Briefcase,
  Calculator,
  CheckCircle2,
  CreditCard,
  LogOut,
  Star,
  User,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { formatTimestamp } from '../lib/formatters.ts';
import { CLERK_DARK_APPEARANCE } from './AuthPages.tsx';
import { PWAProfileInstallCard } from '../components/PWAInstallPrompt.tsx';
import type { Language, Timeframe } from '../types/trading.ts';

function ClerkAdminConsoleButton() {
  const { user: clerkUser, isLoaded } = useUser();
  const { language, navigate } = useApp();
  if (!isLoaded || clerkUser?.publicMetadata?.role !== 'admin') {
    return null;
  }
  return (
    <button
      onClick={() => navigate('/admin')}
      className="w-full p-4 rounded-xl bg-[#D4AF37]/12 border border-[#D4AF37]/35 text-sm font-bold text-[#E5C158] cursor-pointer"
    >
      {language === 'ar' ? 'الانتقال إلى لوحة تحكم الإدارة' : 'Open Administrator Console'}
    </button>
  );
}

export function ProfilePage() {
  const { language, setLanguage, t, navigate, user, clerkActive, logout, refreshSession } = useApp();
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const { openSignIn, openSignUp, signOut } = useClerk();
  const isAr = language === 'ar';

  const unsafeMeta = (clerkUser?.unsafeMetadata || {}) as Record<string, unknown>;
  const primaryEmail =
    clerkUser?.primaryEmailAddress?.emailAddress || user?.email || '';
  const resolvedFullName =
    clerkUser?.fullName ||
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') ||
    (typeof unsafeMeta.displayName === 'string' ? unsafeMeta.displayName : '') ||
    user?.displayName ||
    '';

  const [firstName, setFirstName] = useState(clerkUser?.firstName || '');
  const [lastName, setLastName] = useState(clerkUser?.lastName || '');
  const [displayName, setDisplayName] = useState(resolvedFullName);
  const [defaultTimeframe, setDefaultTimeframe] = useState<Timeframe>(
    (unsafeMeta.defaultTimeframe as Timeframe) || '1h',
  );
  const [riskProfile, setRiskProfile] = useState<string>(
    typeof unsafeMeta.riskProfile === 'string' ? unsafeMeta.riskProfile : 'balanced',
  );
  const [prefLang, setPrefLang] = useState<Language>(
    unsafeMeta.language === 'en' || unsafeMeta.language === 'ar'
      ? unsafeMeta.language
      : language,
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!clerkUser) return;
    const meta = (clerkUser.unsafeMetadata || {}) as Record<string, unknown>;
    setFirstName(clerkUser.firstName || '');
    setLastName(clerkUser.lastName || '');
    setDisplayName(
      (typeof meta.displayName === 'string' && meta.displayName) ||
        clerkUser.fullName ||
        clerkUser.firstName ||
        '',
    );
    if (typeof meta.defaultTimeframe === 'string') {
      setDefaultTimeframe(meta.defaultTimeframe as Timeframe);
    }
    if (typeof meta.riskProfile === 'string') {
      setRiskProfile(meta.riskProfile);
    }
    if (meta.language === 'ar' || meta.language === 'en') {
      setPrefLang(meta.language);
    }
  }, [clerkUser]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      // ignore
    }
    await logout();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clerkUser) return;

    setSaving(true);
    setMsg(null);
    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();
    const cleanDisplay =
      displayName.trim() ||
      [cleanFirst, cleanLast].filter(Boolean).join(' ') ||
      primaryEmail.split('@')[0];

    try {
      // Update Clerk standard name fields when changed (ignore gracefully if disabled in Clerk instance)
      if (cleanFirst || cleanLast) {
        try {
          await clerkUser.update({
            ...(cleanFirst ? { firstName: cleanFirst } : {}),
            ...(cleanLast ? { lastName: cleanLast } : {}),
          });
        } catch {
          // Proceed with unsafeMetadata update if first/last name attribute isn't enabled on instance
        }
      }

      await clerkUser.updateMetadata({
        unsafeMetadata: {
          displayName: cleanDisplay,
          defaultTimeframe,
          riskProfile,
          language: prefLang,
        },
      });

      if (prefLang !== language) {
        setLanguage(prefLang);
      }

      // Sync with backend if running full-stack Express server (optional on static hosts)
      await apiFetch('/api/auth/profile', {
        method: 'POST',
        body: JSON.stringify({ displayName: cleanDisplay }),
      }).catch(() => {});

      await refreshSession();
      setMsg({
        type: 'ok',
        text: isAr
          ? 'تم حفظ بياناتك وتفضيلاتك في حساب Clerk بنجاح.'
          : 'Your profile and preferences have been saved to Clerk.',
      });
    } catch (err) {
      setMsg({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : isAr
              ? 'تعذر حفظ التعديلات. يرجى المحاولة مرة أخرى.'
              : 'Failed to update profile.',
      });
    } finally {
      setSaving(false);
    }
  };

  const isAuthenticated = Boolean(isSignedIn && clerkUser);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
          <User className="w-6 h-6 text-[#D4AF37]" />
          <span>{t.nav.profile}</span>
        </h1>
        {isAuthenticated && (
          <button
            onClick={handleSignOut}
            className="min-h-[40px] px-4 rounded-xl border border-white/12 bg-[#0D131F] text-xs text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t.nav.logout}</span>
          </button>
        )}
      </div>

      {!isLoaded ? (
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-6 text-sm text-slate-400">
          {t.common.loading}
        </div>
      ) : !(isSignedIn && clerkUser) ? (
        <div className="space-y-5">
          <div className="bg-[#0D131F] border border-white/10 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-[#F8FAFC]">
                {isAr ? 'سجّل الدخول لإدارة حسابك' : 'Sign in to manage your account'}
              </h2>
              <p className="text-xs text-slate-400">
                {isAr
                  ? 'سجّل الدخول أو أنشئ حساباً عبر Clerk لعرض ملفك الشخصي وحفظ تفضيلات التداول.'
                  : 'Sign in or create an account with Clerk to view your profile and save preferences.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                onClick={() => openSignIn({ fallbackRedirectUrl: '/profile' })}
                className="px-4 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] text-xs font-bold cursor-pointer"
              >
                {t.nav.login}
              </button>
              <button
                type="button"
                onClick={() => openSignUp({ fallbackRedirectUrl: '/profile' })}
                className="px-4 py-2.5 rounded-xl border border-white/15 hover:border-[#D4AF37]/50 text-xs text-slate-200 cursor-pointer"
              >
                {t.nav.register}
              </button>
            </div>
          </div>

          {clerkActive && (
            <div className="flex justify-center" dir="ltr">
              <SignIn
                routing="hash"
                signUpUrl="/register"
                fallbackRedirectUrl="/profile"
                appearance={CLERK_DARK_APPEARANCE}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Clerk User Summary Card */}
          <div className="bg-[#0D131F] border border-white/10 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              {clerkUser?.imageUrl ? (
                <img
                  src={clerkUser.imageUrl}
                  alt={resolvedFullName || 'User'}
                  className="w-14 h-14 rounded-full border-2 border-[#D4AF37]/50 object-cover shrink-0"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37] font-bold text-lg shrink-0">
                  {(resolvedFullName || primaryEmail || 'M').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 space-y-1">
                <div className="text-base font-bold text-[#F8FAFC] truncate">
                  {resolvedFullName || (isAr ? 'مستخدم MouriTrading' : 'MouriTrading User')}
                </div>
                <div className="text-xs font-mono-num text-slate-400 truncate" dir="ltr">
                  {primaryEmail}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono-num text-slate-400">
                  <span>
                    Plan:{' '}
                    <strong className="text-[#E5C158] uppercase">
                      {user?.plan || 'free'}
                    </strong>
                  </span>
                  {user?.lastLoginAt && (
                    <>
                      <span>·</span>
                      <span>{formatTimestamp(user.lastLoginAt, language)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="min-h-[40px] px-4 rounded-xl bg-[#EF4444]/12 border border-[#EF4444]/30 hover:bg-[#EF4444]/20 text-xs font-bold text-[#FCA5A5] flex items-center gap-2 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t.nav.logout}</span>
            </button>
          </div>

          {/* Editable Clerk Profile & Preferences Form */}
          <form onSubmit={handleSave} className="bg-[#0D131F] border border-white/10 rounded-2xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-[#F8FAFC]">
              {isAr ? 'تعديل البيانات وتفضيلات الحساب' : 'Edit Profile & Trading Preferences'}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {t.auth.emailLabel}
                </label>
                <input
                  type="text"
                  disabled
                  dir="ltr"
                  value={primaryEmail}
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070A0F] border border-white/8 text-sm font-mono-num text-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {isAr ? 'الاسم الظاهر' : 'Display Name'}
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={isAr ? 'أدخل اسمك الظاهر' : 'Your display name'}
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#D4AF37]"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {isAr ? 'الاسم الأول' : 'First Name'}
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder={isAr ? 'الاسم الأول' : 'First name'}
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#D4AF37]"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {isAr ? 'اسم العائلة' : 'Last Name'}
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder={isAr ? 'اسم العائلة' : 'Last name'}
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#D4AF37]"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {isAr ? 'الإطار الزمني المفضل' : 'Preferred Chart Timeframe'}
                </label>
                <select
                  value={defaultTimeframe}
                  onChange={(e) => setDefaultTimeframe(e.target.value as Timeframe)}
                  dir="ltr"
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm font-mono-num text-[#F8FAFC] focus:outline-none focus:border-[#D4AF37]"
                >
                  {(['15m', '1h', '4h', '1d'] as const).map((tf) => (
                    <option key={tf} value={tf}>
                      {tf.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {isAr ? 'أسلوب التداول المفضل' : 'Trading Risk Profile'}
                </label>
                <select
                  value={riskProfile}
                  onChange={(e) => setRiskProfile(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#D4AF37]"
                >
                  <option value="conservative">{isAr ? 'محافظ (منخفض المخاطر)' : 'Conservative'}</option>
                  <option value="balanced">{isAr ? 'متوازن' : 'Balanced'}</option>
                  <option value="active">{isAr ? 'نشط (تداول فوري سريع)' : 'Active Spot'}</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="min-h-[42px] px-5 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-60 text-[#070A0F] text-xs font-bold cursor-pointer"
              >
                {saving ? t.common.loading : t.common.save}
              </button>
              {msg && (
                <span
                  className={`inline-flex items-center gap-1.5 text-xs ${
                    msg.type === 'ok' ? 'text-[#10B981]' : 'text-[#EF4444]'
                  }`}
                >
                  {msg.type === 'ok' && <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>{msg.text}</span>
                </span>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Quick Tools Navigation Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { path: '/portfolio', label: t.nav.portfolio, icon: Briefcase },
          { path: '/calculator', label: t.nav.calculator, icon: Calculator },
          { path: '/watchlist', label: t.nav.watchlist, icon: Star },
          { path: '/alerts', label: t.nav.alerts, icon: Bell },
          { path: '/pricing', label: t.nav.pricing, icon: CreditCard },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="p-4 rounded-xl bg-[#0D131F] border border-white/10 hover:border-[#D4AF37]/40 text-start flex items-center gap-3 cursor-pointer"
            >
              <Icon className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <span className="text-xs font-semibold text-slate-200">{item.label}</span>
            </button>
          );
        })}
      </div>

      <PWAProfileInstallCard />

      {isAuthenticated && clerkActive && <ClerkAdminConsoleButton />}

      {isAuthenticated && clerkActive && (
        <div className="bg-[#0D131F] border border-white/10 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-[#F8FAFC]">
              {isAr ? 'إدارة الحساب عبر Clerk' : 'Clerk Account & Active Sessions'}
            </h2>
            <p className="text-xs text-slate-400">
              {isAr
                ? 'يمكنك تحديث البريد الإلكتروني، الصورة الشخصية، ومراجعة الجلسات النشطة مباشرة من هنا.'
                : 'Manage verified emails, profile image, and active Clerk sessions directly below.'}
            </p>
          </div>
          <div className="overflow-x-auto" dir="ltr">
            <UserProfile routing="hash" appearance={CLERK_DARK_APPEARANCE} />
          </div>
        </div>
      )}
    </div>
  );
}

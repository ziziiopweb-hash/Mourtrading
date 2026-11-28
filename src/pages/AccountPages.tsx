import React, { useEffect, useState } from 'react';
import { UserProfile, useUser } from '@clerk/react';
import {
  Bell,
  Briefcase,
  Calculator,
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
  const { language, t, navigate, user, clerkActive, logout, refreshSession } = useApp();
  const isAr = language === 'ar';

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (user?.displayName) {
      setDisplayName(user.displayName);
    }
  }, [user?.displayName]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await apiFetch('/api/auth/profile', {
        method: 'POST',
        body: JSON.stringify({ displayName }),
      });
      await refreshSession();
      setMsg(isAr ? 'تم تحديث الملف الشخصي وحفظه بنجاح.' : 'Profile updated and saved.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
          <User className="w-6 h-6 text-[#D4AF37]" />
          <span>{t.nav.profile}</span>
        </h1>
        {user && (
          <button
            onClick={logout}
            className="min-h-[40px] px-4 rounded-xl border border-white/12 bg-[#0D131F] text-xs text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t.nav.logout}</span>
          </button>
        )}
      </div>

      {!user ? (
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-sm text-slate-300">{t.common.signInRequired}</p>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/login')}
              className="px-4 py-2 rounded-xl bg-[#D4AF37] text-[#070A0F] text-xs font-bold cursor-pointer"
            >
              {t.nav.login}
            </button>
            <button
              onClick={() => navigate('/register')}
              className="px-4 py-2 rounded-xl border border-white/15 text-xs text-slate-200 cursor-pointer"
            >
              {t.nav.register}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSave} className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t.auth.emailLabel}</label>
              <input
                type="text"
                disabled
                dir="ltr"
                value={user.email}
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
                className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs font-mono-num text-slate-400">
            <span>Plan: <strong className="text-[#E5C158] uppercase">{user.plan}</strong></span>
            <span>·</span>
            <span>Last Login: {formatTimestamp(user.lastLoginAt, language)}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-[#D4AF37] text-[#070A0F] text-xs font-bold cursor-pointer"
            >
              {saving ? t.common.loading : t.common.save}
            </button>
            {msg && <span className="text-xs text-[#10B981]">{msg}</span>}
          </div>
        </form>
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

      {user && clerkActive && <ClerkAdminConsoleButton />}

      {user && clerkActive && user.clerkUserId && !user.clerkUserId.startsWith('sb:') && (
        <div className="bg-[#0D131F] border border-white/10 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-[#F8FAFC]">
              {isAr ? 'إدارة الحساب والأمان عبر Clerk' : 'Clerk Account, Email Verification & Active Sessions'}
            </h2>
            <p className="text-xs text-slate-400">
              {isAr
                ? 'يمكنك تحديث البريد الإلكتروني، مراجعة الجلسات النشطة، وإدارة إعدادات المصادقة مباشرة من هنا.'
                : 'Manage verified emails, passwordless/password credentials, and active Clerk sessions directly below.'}
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

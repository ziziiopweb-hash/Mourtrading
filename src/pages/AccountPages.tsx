import React from 'react';
import { SignIn, UserButton, UserProfile, useClerk, useUser } from '@clerk/react';
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
import { CLERK_DARK_APPEARANCE } from './AuthPages.tsx';
import { PWAProfileInstallCard } from '../components/PWAInstallPrompt.tsx';

function ClerkAdminConsoleButton() {
  const { user, isLoaded } = useUser();
  const { language, navigate } = useApp();

  if (!isLoaded || user?.publicMetadata?.role !== 'admin') {
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
  const { language, t, navigate, logout } = useApp();
  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();
  const isAr = language === 'ar';

  const handleOpenSignIn = () => {
    try {
      clerk.openSignIn({ fallbackRedirectUrl: '/profile' });
    } catch (err) {
      console.error('[Clerk openSignIn error]', err);
    }
  };

  const handleSignOut = async () => {
    try {
      await clerk.signOut();
      await logout();
    } catch (err) {
      console.error('[Clerk signOut error]', err);
    }
  };

  const displayName = user?.fullName || user?.firstName || '';
  const email = user?.primaryEmailAddress?.emailAddress || '';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
          <User className="w-6 h-6 text-[#D4AF37]" />
          <span>{t.nav.profile}</span>
        </h1>
        {isSignedIn && user && (
          <div className="flex items-center gap-3">
            <UserButton />
            <button
              type="button"
              onClick={handleSignOut}
              className="min-h-[40px] px-4 rounded-xl border border-white/12 bg-[#0D131F] text-xs text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>{t.nav.logout}</span>
            </button>
          </div>
        )}
      </div>

      {!isLoaded ? (
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-6 text-sm text-slate-400">
          {t.common.loading}
        </div>
      ) : !(isSignedIn && user) ? (
        <div className="space-y-5">
          <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-slate-300">{t.common.signInRequired}</p>
            <button
              type="button"
              onClick={handleOpenSignIn}
              className="px-4 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] text-xs font-bold cursor-pointer"
            >
              {t.nav.login}
            </button>
          </div>

          <div className="flex justify-center" dir="ltr">
            <SignIn
              routing="hash"
              signUpUrl="/register"
              fallbackRedirectUrl="/profile"
              appearance={CLERK_DARK_APPEARANCE}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Official Clerk User Info Card */}
          <div className="bg-[#0D131F] border border-white/10 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              {user.imageUrl ? (
                <img
                  src={user.imageUrl}
                  alt={displayName || email || 'User'}
                  className="w-14 h-14 rounded-full border-2 border-[#D4AF37]/50 object-cover shrink-0"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37] font-bold text-lg shrink-0">
                  {(displayName || email || 'M').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 space-y-1">
                <div className="text-base font-bold text-[#F8FAFC] truncate">
                  {displayName || (isAr ? 'مستخدم MouriTrading' : 'MouriTrading User')}
                </div>
                {email && (
                  <div className="text-xs font-mono-num text-slate-400 truncate" dir="ltr">
                    {email}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <UserButton />
              <button
                type="button"
                onClick={handleSignOut}
                className="min-h-[40px] px-4 rounded-xl bg-[#EF4444]/12 border border-[#EF4444]/30 hover:bg-[#EF4444]/20 text-xs font-bold text-[#FCA5A5] flex items-center gap-2 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t.nav.logout}</span>
              </button>
            </div>
          </div>

          <ClerkAdminConsoleButton />

          <div className="bg-[#0D131F] border border-white/10 rounded-2xl p-4 sm:p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-[#F8FAFC]">
                {isAr ? 'إدارة الحساب عبر Clerk' : 'Clerk Account & Active Sessions'}
              </h2>
              <p className="text-xs text-slate-400">
                {isAr
                  ? 'يمكنك تعديل بياناتك، الصورة الشخصية، وإدارة الجلسات مباشرة عبر مكون Clerk الرسمي.'
                  : 'Manage your profile details, avatar, and active Clerk sessions below.'}
              </p>
            </div>
            <div className="overflow-x-auto" dir="ltr">
              <UserProfile routing="hash" appearance={CLERK_DARK_APPEARANCE} />
            </div>
          </div>
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
    </div>
  );
}

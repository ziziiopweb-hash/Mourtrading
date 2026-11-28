import React, { useState } from 'react';
import {
  Activity,
  Bell,
  Bot,
  Briefcase,
  Calculator,
  CandlestickChart,
  CreditCard,
  Globe,
  Home,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  ScanLine,
  Signal,
  Star,
  User,
  X,
} from 'lucide-react';
import { Show, UserButton } from '@clerk/react';
import { useApp } from '../contexts/AppContext.tsx';
import { MourLogo } from './Logo.tsx';
import { OfflineIndicator, PWAInstallBanner } from './PWAInstallPrompt.tsx';

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const {
    language,
    setLanguage,
    t,
    route,
    navigate,
    user,
    clerkActive,
    logout,
    wsConnected,
    unreadCount,
    announcement,
  } = useApp();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const currentPath = route.split('?')[0];
  const isAr = language === 'ar';

  interface NavItem {
    path: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }

  const navGroups: Array<{ items: NavItem[] }> = [
    {
      items: [
        { path: '/', label: t.nav.home, icon: Home },
        { path: '/dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
        { path: '/markets', label: t.nav.markets, icon: Activity },
        { path: '/charts', label: t.nav.charts, icon: CandlestickChart },
        { path: '/ai', label: t.nav.ai, icon: Bot },
        { path: '/ai/vision', label: t.nav.vision, icon: ScanLine },
        { path: '/signals', label: t.nav.signals, icon: Signal },
      ],
    },
    {
      items: [
        { path: '/watchlist', label: t.nav.watchlist, icon: Star },
        { path: '/portfolio', label: t.nav.portfolio, icon: Briefcase },
        { path: '/calculator', label: t.nav.calculator, icon: Calculator },
        { path: '/alerts', label: t.nav.alerts, icon: LineChart },
        { path: '/notifications', label: t.nav.notifications, icon: Bell, badge: unreadCount },
        { path: '/pricing', label: t.nav.pricing, icon: CreditCard },
      ],
    },
    {
      items: [
        { path: '/profile', label: t.nav.profile, icon: User },
      ],
    },
  ];

  const mobileTabs = [
    { path: user ? '/dashboard' : '/', label: t.nav.home, icon: Home },
    { path: '/markets', label: t.nav.markets, icon: Activity },
    { path: '/ai', label: t.nav.ai, icon: Bot },
    { path: '/signals', label: t.nav.signals, icon: Signal },
    { path: '/profile', label: t.nav.profile, icon: User },
  ];

  const go = (path: string) => {
    setMobileMenuOpen(false);
    navigate(path);
  };

  return (
    <div className="min-h-screen bg-[#070A0F] text-[#F1F5F9] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-[#0A0F18] border-e border-white/8 sticky top-0 h-screen">
        <div className="px-5 h-16 flex items-center justify-between border-b border-white/8">
          <button onClick={() => go('/')} className="cursor-pointer focus:outline-none">
            <MourLogo />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {navGroups.map((group, gi) => (
            <div key={gi} className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = currentPath === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => go(item.path)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-[#D4AF37]/12 text-[#E5C158] border border-[#D4AF37]/25'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {typeof item.badge === 'number' && item.badge > 0 && (
                      <span className="font-mono-num text-xs font-semibold text-[#E5C158]">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
              {gi < navGroups.length - 1 && <div className="border-t border-white/6 my-2" />}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-white/8 text-xs text-slate-500 flex items-center justify-between gap-2">
          <button onClick={() => go('/privacy')} className="hover:text-slate-300 cursor-pointer">
            {t.nav.privacy}
          </button>
          <span aria-hidden="true">·</span>
          <button onClick={() => go('/terms')} className="hover:text-slate-300 cursor-pointer">
            {t.nav.terms}
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">
        {/* Top Bar (Clean 3-Zone Contract) */}
        <header className="sticky top-0 z-30 h-14 lg:h-16 bg-[#070A0F]/90 backdrop-blur-md border-b border-white/8 px-4 lg:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-300 hover:bg-white/5 cursor-pointer"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="lg:hidden">
              <button onClick={() => go('/')} className="cursor-pointer">
                <MourLogo />
              </button>
            </div>
            <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400">
              <span
                className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-[#10B981]' : 'bg-[#D4AF37]'}`}
                aria-hidden="true"
              />
              <span>{wsConnected ? t.status.liveWs : t.status.reconnecting}</span>
              <span aria-hidden="true">·</span>
              <span>{t.status.binanceSource}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
              className="min-h-[38px] px-3 py-1.5 rounded-lg border border-white/10 bg-[#0D131F] text-xs font-medium text-slate-200 hover:border-[#D4AF37]/40 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>{language === 'ar' ? 'EN' : 'العربية'}</span>
            </button>

            {user ? (
              <>
                <button
                  onClick={() => go('/notifications')}
                  className="relative min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-white/10 bg-[#0D131F] text-slate-300 hover:text-[#E5C158] cursor-pointer"
                  aria-label={t.nav.notifications}
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -end-1 px-1 min-w-[16px] h-4 rounded-full bg-[#D4AF37] text-[#070A0F] text-[10px] font-mono-num font-bold flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </button>
                {clerkActive && (
                  <Show when="signed-in">
                    <div className="flex items-center">
                      <UserButton
                        appearance={{
                          elements: {
                            avatarBox: 'w-9 h-9 border border-[#D4AF37]/40',
                          },
                        }}
                      />
                    </div>
                  </Show>
                )}
                <button
                  onClick={logout}
                  className="inline-flex min-h-[38px] px-2.5 sm:px-3 py-1.5 rounded-lg border border-white/10 bg-[#0D131F] text-xs font-medium text-slate-300 hover:text-white items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{t.nav.logout}</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => go('/login')}
                className="min-h-[38px] px-4 py-1.5 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                {t.nav.login}
              </button>
            )}
          </div>
        </header>

        {/* Smart Dismissible PWA Install Banner */}
        <PWAInstallBanner />

        {/* Optional Announcement */}
        {announcement && (
          <div className="bg-[#0D131F] border-b border-[#D4AF37]/25 px-4 lg:px-6 py-2 text-xs text-[#E5C158] text-center">
            {announcement}
          </div>
        )}

        {/* Page Viewport */}
        <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 lg:px-8 py-6">
          {children}
        </main>
        <OfflineIndicator />
      </div>

      {/* Mobile Drawer for Extra Pages */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-10 w-72 max-w-[85vw] bg-[#0A0F18] border-e border-white/10 h-full flex flex-col">
            <div className="px-4 h-14 flex items-center justify-between border-b border-white/8">
              <MourLogo />
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {navGroups.flatMap((g) => g.items).map((item) => {
                const Icon = item.icon;
                const active = currentPath === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => go(item.path)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium ${
                      active ? 'bg-[#D4AF37]/15 text-[#E5C158]' : 'text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}

              <div className="pt-3 mt-2 border-t border-white/10 space-y-1">
                {user && (
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      void logout();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-[#FCA5A5] hover:bg-white/5 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 shrink-0" />
                    <span>{t.nav.logout}</span>
                  </button>
                )}
                <button
                  onClick={() => go('/privacy')}
                  className="w-full text-start px-3 py-2.5 text-xs text-slate-400"
                >
                  {t.nav.privacy}
                </button>
                <button
                  onClick={() => go('/terms')}
                  className="w-full text-start px-3 py-2.5 text-xs text-slate-400"
                >
                  {t.nav.terms}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Fixed Bottom Navigation (Home, Markets, AI Analysis, Signals, Profile) */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0A0F18]/95 backdrop-blur-md border-t border-white/10 grid grid-cols-5 h-[58px]"
        aria-label="Mobile Navigation"
      >
        {mobileTabs.map((tab) => {
          const Icon = tab.icon;
          const active = currentPath === tab.path;
          return (
            <button
              key={tab.path}
              onClick={() => go(tab.path)}
              className={`flex flex-col items-center justify-center gap-0.5 px-1 transition-colors cursor-pointer ${
                active ? 'text-[#E5C158]' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium truncate max-w-full">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

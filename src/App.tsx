import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './contexts/AppContext.tsx';
import { LayoutShell } from './components/LayoutShell.tsx';
import { LandingPage } from './pages/LandingPage.tsx';
import { AuthRequestPage, VerifyOtpPage } from './pages/AuthPages.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { MarketsPage } from './pages/MarketsPage.tsx';
import { CoinDetailsPage } from './pages/CoinDetailsPage.tsx';
import { AdvancedChartsPage } from './pages/AdvancedChartsPage.tsx';
import { MourAiPage } from './pages/MourAiPage.tsx';
import { ChartVisionPage } from './pages/ChartVisionPage.tsx';
import { SignalsPage } from './pages/SignalsPage.tsx';
import { WatchlistPage } from './pages/WatchlistPage.tsx';
import { PortfolioPage } from './pages/PortfolioPage.tsx';
import { RiskCalculatorPage } from './pages/RiskCalculatorPage.tsx';
import { AlertsPage } from './pages/AlertsPage.tsx';
import { NotificationsPage } from './pages/NotificationsPage.tsx';
import { PricingPage } from './pages/PricingPage.tsx';
import { ProfilePage } from './pages/AccountPages.tsx';
import {
  AdminDashboardPage,
  AdminSettingsPage,
  AdminSignalsPage,
  AdminUsersPage,
} from './pages/AdminPages.tsx';
import { PrivacyPolicyPage, TermsPage } from './pages/LegalPages.tsx';

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '', stack: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error?.message || 'Unexpected rendering error',
      stack: error?.stack || '',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[MourTrading ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#070A0F] text-[#F1F5F9] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#0D131F] border border-[#EF4444]/50 rounded-2xl p-6 space-y-4">
            <div className="text-xs font-semibold text-[#D4AF37]">MourTrading · Runtime Guard</div>
            <h2 className="text-lg font-bold text-[#EF4444]">
              حدث خطأ أثناء تشغيل الواجهة · Application Render Error
            </h2>
            <p className="text-sm text-slate-200 break-words" dir="ltr">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre
                className="text-[11px] font-mono text-slate-400 bg-[#070A0F] border border-white/10 rounded-lg p-3 max-h-48 overflow-auto whitespace-pre-wrap break-all"
                dir="ltr"
              >
                {this.state.stack}
              </pre>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] text-xs font-bold cursor-pointer"
              >
                إعادة التحميل · Reload MourTrading
              </button>
              <button
                onClick={() => this.setState({ hasError: false, message: '', stack: '' })}
                className="px-4 py-2 rounded-lg border border-white/15 text-slate-200 text-xs cursor-pointer"
              >
                إعادة المحاولة · Retry
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function GlobalRuntimeErrorBanner() {
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const msg = event.error?.message || event.message;
      if (msg && !msg.includes('ResizeObserver')) {
        setRuntimeError(msg);
      }
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
      if (msg && !msg.toLowerCase().includes('websocket')) {
        setRuntimeError(msg);
      }
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  if (!runtimeError) return null;

  return (
    <div
      className="bg-[#EF4444]/15 border-b border-[#EF4444]/40 px-4 py-2.5 text-xs text-[#FCA5A5] flex items-center justify-between gap-4"
      dir="ltr"
    >
      <div className="truncate">
        <strong className="text-[#EF4444]">Runtime Error: </strong>
        <span>{runtimeError}</span>
      </div>
      <button
        onClick={() => setRuntimeError(null)}
        className="px-2.5 py-1 rounded bg-white/10 text-slate-200 shrink-0 cursor-pointer"
      >
        Dismiss
      </button>
    </div>
  );
}

function SilentAdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, authLoading, navigate } = useApp();

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate('/');
    }
  }, [authLoading, isAdmin, navigate]);

  if (authLoading || !isAdmin) {
    return null;
  }

  return <>{children}</>;
}

function RouterView() {
  const { route } = useApp();
  const path = route.split('?')[0];

  if (path === '/') return <LandingPage />;
  if (path === '/register') return <AuthRequestPage mode="register" />;
  if (path === '/login') return <AuthRequestPage mode="login" />;
  if (path === '/verify-otp') return <VerifyOtpPage />;
  if (path === '/dashboard') return <DashboardPage />;
  if (path === '/markets') return <MarketsPage />;
  if (path.startsWith('/coin/')) {
    const symbol = decodeURIComponent(path.slice('/coin/'.length)) || 'BTCUSDT';
    return <CoinDetailsPage symbol={symbol} />;
  }
  if (path === '/charts') return <AdvancedChartsPage />;
  if (path === '/ai') return <MourAiPage />;
  if (path === '/ai/vision') return <ChartVisionPage />;
  if (path === '/signals') return <SignalsPage />;
  if (path === '/watchlist') return <WatchlistPage />;
  if (path === '/portfolio') return <PortfolioPage />;
  if (path === '/calculator') return <RiskCalculatorPage />;
  if (path === '/alerts') return <AlertsPage />;
  if (path === '/notifications') return <NotificationsPage />;
  if (path === '/pricing') return <PricingPage />;
  if (path === '/profile') return <ProfilePage />;
  if (path === '/admin') {
    return (
      <SilentAdminRoute>
        <AdminDashboardPage />
      </SilentAdminRoute>
    );
  }
  if (path === '/admin/users') {
    return (
      <SilentAdminRoute>
        <AdminUsersPage />
      </SilentAdminRoute>
    );
  }
  if (path === '/admin/signals') {
    return (
      <SilentAdminRoute>
        <AdminSignalsPage />
      </SilentAdminRoute>
    );
  }
  if (path === '/admin/settings') {
    return (
      <SilentAdminRoute>
        <AdminSettingsPage />
      </SilentAdminRoute>
    );
  }
  if (path === '/privacy') return <PrivacyPolicyPage />;
  if (path === '/terms') return <TermsPage />;

  return <LandingPage />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <GlobalRuntimeErrorBanner />
      <AppProvider>
        <LayoutShell>
          <RouterView />
        </LayoutShell>
      </AppProvider>
    </ErrorBoundary>
  );
}

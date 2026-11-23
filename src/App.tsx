import React from 'react';
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
import { ProfilePage, SecurityPage } from './pages/AccountPages.tsx';
import {
  AdminDashboardPage,
  AdminSettingsPage,
  AdminSignalsPage,
  AdminUsersPage,
} from './pages/AdminPages.tsx';
import { PrivacyPolicyPage, TermsPage } from './pages/LegalPages.tsx';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#070A0F] text-[#F1F5F9] flex items-center justify-center p-6">
          <div className="max-w-md bg-[#0D131F] border border-[#EF4444]/40 rounded-xl p-6 space-y-3">
            <h2 className="text-base font-bold text-[#EF4444]">Application Error</h2>
            <p className="text-xs text-slate-300">{this.state.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-[#D4AF37] text-[#070A0F] text-xs font-bold cursor-pointer"
            >
              Reload MourTrading
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
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
  if (path === '/security') return <SecurityPage />;
  if (path === '/admin') return <AdminDashboardPage />;
  if (path === '/admin/users') return <AdminUsersPage />;
  if (path === '/admin/signals') return <AdminSignalsPage />;
  if (path === '/admin/settings') return <AdminSettingsPage />;
  if (path === '/privacy') return <PrivacyPolicyPage />;
  if (path === '/terms') return <TermsPage />;

  return <LandingPage />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <LayoutShell>
          <RouterView />
        </LayoutShell>
      </AppProvider>
    </ErrorBoundary>
  );
}

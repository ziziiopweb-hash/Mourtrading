import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ClerkFailed, ClerkProvider, useAuth, useClerk, useUser } from '@clerk/react';
import { apiFetch, registerIdTokenGetter } from '../lib/api.ts';
import {
  BINANCE_PUBLIC_WS_URLS,
  fetchDirectBinanceTickers,
  formatMarketFeedError,
} from '../lib/binancePublic.ts';
import { getT } from '../i18n/translations.ts';
import type {
  AppNotification,
  Language,
  MarketTicker,
  ServiceReadiness,
  UserProfile,
} from '../types/trading.ts';

const DEFAULT_CLERK_PUBLISHABLE_KEY =
  'pk_test_dGFsZW50ZWQtcGhvZW5peC03NTU5LmNsZXJrLmFjY291bnRzLmRldiQ';

interface AppContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: ReturnType<typeof getT>;
  route: string;
  navigate: (path: string) => void;
  user: UserProfile | null;
  isAdmin: boolean;
  authLoading: boolean;
  clerkActive: boolean;
  clerkError: string | null;
  readiness: ServiceReadiness | null;
  announcement: string;
  refreshSession: () => Promise<void>;
  openClerkSignIn: () => void;
  openClerkSignUp: () => void;
  logout: () => Promise<void>;
  tickers: MarketTicker[];
  tickerMap: Map<string, MarketTicker>;
  wsConnected: boolean;
  lastTickAt: number | null;
  marketLoading: boolean;
  marketError: string | null;
  refreshMarkets: () => Promise<void>;
  watchlist: string[];
  toggleWatchlist: (symbol: string) => Promise<void>;
  notifications: AppNotification[];
  unreadCount: number;
  refreshNotifications: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

interface ClerkBridgeProps {
  clerkActive: boolean;
  clerkLoaded: boolean;
  clerkSignedIn: boolean;
  clerkUserId: string | null;
  clerkEmail: string | null;
  clerkDisplayName: string | null;
  clerkAdmin: boolean;
  clerkError: string | null;
  clerkSignOut: (() => Promise<void>) | null;
  clerkOpenSignIn: (() => void) | null;
  clerkOpenSignUp: (() => void) | null;
  onClerkPublishableKey: (key: string) => void;
  children: React.ReactNode;
}

function isValidClerkPublishableKey(key: string): boolean {
  return /^pk_(test|live)_[A-Za-z0-9+/=_-]+$/.test(key.trim());
}

function AppStateCore({
  clerkActive,
  clerkLoaded,
  clerkSignedIn,
  clerkUserId,
  clerkEmail,
  clerkDisplayName,
  clerkAdmin,
  clerkError,
  clerkSignOut,
  clerkOpenSignIn,
  clerkOpenSignUp,
  onClerkPublishableKey,
  children,
}: ClerkBridgeProps) {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('mour_lang') : null;
      return saved === 'en' ? 'en' : 'ar';
    } catch {
      return 'ar';
    }
  });

  const [route, setRoute] = useState<string>(() => {
    if (typeof window === 'undefined') return '/';
    return window.location.pathname + window.location.search;
  });

  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [readiness, setReadiness] = useState<ServiceReadiness | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const [tickers, setTickers] = useState<MarketTicker[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState<string | null>(null);

  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('mour_guest_watchlist');
      return saved ? (JSON.parse(saved) as string[]) : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
    } catch {
      return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
    }
  });

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const routeRef = useRef(route);
  routeRef.current = route;

  // Sync HTML dir/lang with Arabic RTL default
  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = language === 'ar' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('mour_lang', language);
    } catch {
      // Ignore sandboxed storage restriction
    }
  }, [language]);

  const setLanguage = useCallback(
    (lang: Language) => {
      setLanguageState(lang);
      if (user) {
        apiFetch('/api/user/preferences', {
          method: 'PUT',
          body: JSON.stringify({ language: lang }),
        }).catch(() => {});
      }
    },
    [user],
  );

  // SPA navigation
  const navigate = useCallback((path: string) => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname + window.location.search !== path) {
      window.history.pushState({}, '', path);
    }
    setRoute(path);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(window.location.pathname + window.location.search);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const refreshNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      return;
    }
    try {
      const res = await apiFetch<{ notifications: AppNotification[] }>('/api/user/notifications');
      setNotifications(res.notifications || []);
    } catch {
      // Ignore if unauthenticated
    }
  }, [user]);

  const refreshSession = useCallback(async () => {
    setAuthLoading(true);
    try {
      const healthRes = await apiFetch<{
        readiness: ServiceReadiness;
        clerkConfig: { publishableKey: string } | null;
      }>('/api/health').catch(() => null);

      if (healthRes) {
        setReadiness(healthRes.readiness);
        if (healthRes.clerkConfig?.publishableKey) {
          onClerkPublishableKey(healthRes.clerkConfig.publishableKey);
        }
      }

      const [meRes, plansRes] = await Promise.all([
        clerkSignedIn
          ? apiFetch<{ authenticated: boolean; user: UserProfile | null; preferences?: { language?: Language } }>('/api/auth/me').catch(() => null)
          : Promise.resolve(null),
        apiFetch<{ config: { announcement?: string } }>('/api/user/plans').catch(() => ({ config: { announcement: '' } })),
      ]);

      setAnnouncement(plansRes.config?.announcement || '');

      if (clerkSignedIn && clerkUserId) {
        const now = new Date().toISOString();
        const fallbackEmail = (clerkEmail || meRes?.user?.email || '').trim().toLowerCase();
        const resolvedName =
          clerkDisplayName ||
          meRes?.user?.displayName ||
          (fallbackEmail ? fallbackEmail.split('@')[0] : 'Trader');

        setUser({
          uid: meRes?.user?.uid || clerkUserId,
          clerkUserId,
          email: fallbackEmail,
          displayName: resolvedName,
          role: clerkAdmin ? 'admin' : 'user',
          plan: meRes?.user?.plan || 'free',
          status: meRes?.user?.status || 'active',
          createdAt: meRes?.user?.createdAt || now,
          updatedAt: now,
          lastLoginAt: meRes?.user?.lastLoginAt || now,
        });

        if (meRes?.preferences?.language === 'en' || meRes?.preferences?.language === 'ar') {
          setLanguageState(meRes.preferences.language);
        }

        const currentPath = routeRef.current.split('?')[0];
        if (currentPath === '/login' || currentPath === '/register' || currentPath === '/verify-otp') {
          navigate('/dashboard');
        }

        try {
          const wl = await apiFetch<{ symbols: string[] }>('/api/user/watchlist');
          if (Array.isArray(wl.symbols) && wl.symbols.length > 0) setWatchlist(wl.symbols);
        } catch {
          // ignore if backend unavailable
        }
      } else {
        setUser(null);
      }
    } catch {
      if (!clerkSignedIn) {
        setUser(null);
      }
    } finally {
      setAuthLoading(false);
    }
  }, [clerkAdmin, clerkDisplayName, clerkEmail, clerkSignedIn, clerkUserId, navigate, onClerkPublishableKey]);

  // Initial health & Clerk session hydration
  useEffect(() => {
    refreshSession();
  }, [clerkLoaded, clerkSignedIn, clerkUserId, clerkDisplayName, clerkAdmin, refreshSession]);

  useEffect(() => {
    if (user) {
      refreshNotifications();
      const timer = setInterval(refreshNotifications, 20_000);
      return () => clearInterval(timer);
    }
  }, [user, refreshNotifications]);

  const openClerkSignIn = useCallback(() => {
    if (clerkOpenSignIn) {
      clerkOpenSignIn();
    } else {
      navigate('/login');
    }
  }, [clerkOpenSignIn, navigate]);

  const openClerkSignUp = useCallback(() => {
    if (clerkOpenSignUp) {
      clerkOpenSignUp();
    } else {
      navigate('/register');
    }
  }, [clerkOpenSignUp, navigate]);

  const logout = useCallback(async () => {
    if (clerkSignOut) {
      await clerkSignOut().catch(() => {});
    }
    setUser(null);
    setNotifications([]);
    navigate('/');
  }, [clerkSignOut, navigate]);

  const refreshMarkets = useCallback(async () => {
    try {
      setMarketError(null);
      const res = await fetchDirectBinanceTickers(250);
      setTickers(res.tickers);
      setLastTickAt(res.fetchedAt || Date.now());
    } catch (err) {
      setMarketError(formatMarketFeedError(err, language));
    } finally {
      setMarketLoading(false);
    }
  }, [language]);

  useEffect(() => {
    refreshMarkets();
  }, [refreshMarkets]);

  // Direct Binance Public WebSocket stream with multi-endpoint & REST polling fallback
  useEffect(() => {
    let ws: WebSocket | null = null;
    let attempt = 0;
    let urlIdx = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const wsUrl = BINANCE_PUBLIC_WS_URLS[urlIdx % BINANCE_PUBLIC_WS_URLS.length];
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        setWsConnected(false);
        return;
      }

      ws.onopen = () => {
        attempt = 0;
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as Array<{
            s: string;
            c: string;
            o: string;
            h: string;
            l: string;
            v: string;
            q: string;
            E: number;
          }>;
          if (!Array.isArray(parsed)) return;

          const now = Date.now();
          setWsConnected(true);
          setLastTickAt(now);

          const patchMap = new Map<
            string,
            { price: number; open: number; high: number; low: number; vol: number; qVol: number; ts: number }
          >();
          for (const item of parsed) {
            if (!item?.s || !item.s.endsWith('USDT')) continue;
            const price = Number(item.c);
            if (!Number.isFinite(price) || price <= 0) continue;
            patchMap.set(item.s, {
              price,
              open: Number(item.o),
              high: Number(item.h),
              low: Number(item.l),
              vol: Number(item.v),
              qVol: Number(item.q),
              ts: item.E || now,
            });
          }

          if (patchMap.size === 0) return;

          setTickers((prev) =>
            prev.map((tk) => {
              const p = patchMap.get(tk.symbol);
              if (!p) return tk;
              const priceChange = p.open > 0 ? p.price - p.open : tk.priceChange;
              const priceChangePercent =
                p.open > 0 ? Number((((p.price - p.open) / p.open) * 100).toFixed(2)) : tk.priceChangePercent;
              return {
                ...tk,
                lastPrice: p.price,
                priceChange,
                priceChangePercent,
                highPrice: p.high || tk.highPrice,
                lowPrice: p.low || tk.lowPrice,
                volume: p.vol || tk.volume,
                quoteVolume: p.qVol || tk.quoteVolume,
                updatedAt: p.ts,
              };
            }),
          );
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!disposed) {
          urlIdx++;
          const waitMs = Math.min(1000 * Math.pow(2, attempt), 25_000);
          attempt++;
          reconnectTimer = setTimeout(connect, waitMs);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();
    fallbackPollTimer = setInterval(() => {
      if (!disposed) {
        void fetchDirectBinanceTickers(250)
          .then((res) => {
            if (disposed) return;
            setTickers(res.tickers);
            setLastTickAt(res.fetchedAt || Date.now());
          })
          .catch(() => {});
      }
    }, 30_000);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (fallbackPollTimer) clearInterval(fallbackPollTimer);
      ws?.close();
    };
  }, []);

  const toggleWatchlist = useCallback(
    async (symbol: string) => {
      const upper = symbol.toUpperCase();
      const next = watchlist.includes(upper)
        ? watchlist.filter((s) => s !== upper)
        : [upper, ...watchlist].slice(0, 50);
      setWatchlist(next);
      try {
        localStorage.setItem('mour_guest_watchlist', JSON.stringify(next));
      } catch {
        // Ignore sandboxed storage restriction
      }
      if (user) {
        await apiFetch('/api/user/watchlist', {
          method: 'PUT',
          body: JSON.stringify({ symbols: next }),
        }).catch(() => {});
      }
    },
    [watchlist, user],
  );

  const tickerMap = useMemo(() => {
    const map = new Map<string, MarketTicker>();
    for (const t of tickers) map.set(t.symbol, t);
    return map;
  }, [tickers]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const t = useMemo(() => getT(language), [language]);

  return (
    <AppContext.Provider
      value={{
        language,
        setLanguage,
        t,
        route,
        navigate,
        user,
        isAdmin: Boolean(clerkActive && clerkAdmin),
        authLoading,
        clerkActive,
        clerkError,
        readiness,
        announcement,
        refreshSession,
        openClerkSignIn,
        openClerkSignUp,
        logout,
        tickers,
        tickerMap,
        wsConnected,
        lastTickAt,
        marketLoading,
        marketError,
        refreshMarkets,
        watchlist,
        toggleWatchlist,
        notifications,
        unreadCount,
        refreshNotifications,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

function ClerkRuntimeBridge({
  clerkError,
  onClerkPublishableKey,
  children,
}: {
  clerkError: string | null;
  onClerkPublishableKey: (key: string) => void;
  children: React.ReactNode;
}) {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useAuth();
  const { isLoaded: clerkUserLoaded, user: clerkUser } = useUser();
  const clerk = useClerk();
  const isClerkAdmin = Boolean(clerkUser?.publicMetadata?.role === 'admin');
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  registerIdTokenGetter(async () => {
    try {
      const clerkToken = await getTokenRef.current();
      return clerkToken || null;
    } catch {
      return null;
    }
  });

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const handleOpenSignIn = useCallback(() => {
    clerk.openSignIn({ fallbackRedirectUrl: '/dashboard' });
  }, [clerk]);

  const handleOpenSignUp = useCallback(() => {
    clerk.openSignUp({ fallbackRedirectUrl: '/dashboard' });
  }, [clerk]);

  const unsafeMeta = (clerkUser?.unsafeMetadata || {}) as Record<string, unknown>;
  const resolvedDisplayName =
    (typeof unsafeMeta.displayName === 'string' && unsafeMeta.displayName.trim()) ||
    clerkUser?.fullName ||
    clerkUser?.firstName ||
    clerkUser?.username ||
    null;

  return (
    <AppStateCore
      clerkActive={!clerkError}
      clerkLoaded={isLoaded && clerkUserLoaded}
      clerkSignedIn={Boolean(isSignedIn)}
      clerkUserId={userId || null}
      clerkEmail={clerkUser?.primaryEmailAddress?.emailAddress || null}
      clerkDisplayName={resolvedDisplayName}
      clerkAdmin={isClerkAdmin}
      clerkError={clerkError}
      clerkSignOut={handleSignOut}
      clerkOpenSignIn={handleOpenSignIn}
      clerkOpenSignUp={handleOpenSignUp}
      onClerkPublishableKey={onClerkPublishableKey}
    >
      {children}
    </AppStateCore>
  );
}

class ClerkSafeBoundary extends React.Component<
  {
    fallback: (errorMsg: string) => React.ReactNode;
    children: React.ReactNode;
  },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { fallback: (errorMsg: string) => React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error.message || 'Clerk initialization failed' };
  }

  componentDidCatch(error: Error) {
    console.error('[ClerkSafeBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback(this.state.errorMsg);
    }
    return this.props.children;
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [clerkPublishableKey, setClerkPublishableKey] = useState<string>(() => {
    const envKey = (import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY || '').trim();
    return envKey || DEFAULT_CLERK_PUBLISHABLE_KEY;
  });
  const [clerkLoadError, setClerkLoadError] = useState<string | null>(null);

  const handleClerkKey = useCallback(
    (key: string) => {
      const trimmed = key.trim();
      if (trimmed && trimmed !== clerkPublishableKey) {
        setClerkPublishableKey(trimmed);
      }
    },
    [clerkPublishableKey],
  );

  const validKey = clerkPublishableKey && isValidClerkPublishableKey(clerkPublishableKey);
  const keyFormatError =
    clerkPublishableKey && !validKey
      ? 'Invalid Clerk Publishable Key format (expected pk_test_... or pk_live_...).'
      : null;

  if (validKey) {
    return (
      <ClerkSafeBoundary
        fallback={(errMsg) => (
          <AppStateCore
            clerkActive={false}
            clerkLoaded={true}
            clerkSignedIn={false}
            clerkUserId={null}
            clerkEmail={null}
            clerkDisplayName={null}
            clerkAdmin={false}
            clerkError={errMsg}
            clerkSignOut={null}
            clerkOpenSignIn={null}
            clerkOpenSignUp={null}
            onClerkPublishableKey={handleClerkKey}
          >
            {children}
          </AppStateCore>
        )}
      >
        <ClerkProvider
          publishableKey={clerkPublishableKey}
          afterSignOutUrl="/"
          signInUrl="/login"
          signUpUrl="/register"
          signInFallbackRedirectUrl="/dashboard"
          signUpFallbackRedirectUrl="/dashboard"
        >
          <ClerkFailed>
            <ClerkFailureNotifier onFail={setClerkLoadError} />
          </ClerkFailed>
          <ClerkRuntimeBridge
            clerkError={clerkLoadError}
            onClerkPublishableKey={handleClerkKey}
          >
            {children}
          </ClerkRuntimeBridge>
        </ClerkProvider>
      </ClerkSafeBoundary>
    );
  }

  registerIdTokenGetter(async () => null);

  return (
    <AppStateCore
      clerkActive={false}
      clerkLoaded={true}
      clerkSignedIn={false}
      clerkUserId={null}
      clerkEmail={null}
      clerkDisplayName={null}
      clerkAdmin={false}
      clerkError={keyFormatError}
      clerkSignOut={null}
      clerkOpenSignIn={null}
      clerkOpenSignUp={null}
      onClerkPublishableKey={handleClerkKey}
    >
      {children}
    </AppStateCore>
  );
}

function ClerkFailureNotifier({ onFail }: { onFail: (msg: string) => void }) {
  useEffect(() => {
    onFail('Clerk JS could not load in this browser context. Check domain settings or network access.');
  }, [onFail]);
  return null;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

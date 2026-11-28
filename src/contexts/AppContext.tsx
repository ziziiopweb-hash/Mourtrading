import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ClerkFailed, ClerkProvider, useAuth, useUser } from '@clerk/react';
import { apiFetch, registerIdTokenGetter } from '../lib/api.ts';
import {
  BINANCE_PUBLIC_WS_URLS,
  fetchDirectBinanceTickers,
  formatMarketFeedError,
} from '../lib/binancePublic.ts';
import { configurePublicSupabaseClient, supabase } from '../lib/supabase.ts';
import { getT } from '../i18n/translations.ts';
import type {
  AppNotification,
  Language,
  MarketTicker,
  ServiceReadiness,
  UserProfile,
} from '../types/trading.ts';

const LOCAL_SUPABASE_PROFILE_KEY = 'mour_supabase_profile';

interface CachedSupabaseProfile {
  uid: string;
  email: string;
  displayName: string;
}

function readCachedSupabaseProfile(): CachedSupabaseProfile | null {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(LOCAL_SUPABASE_PROFILE_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedSupabaseProfile>;
    if (typeof parsed.uid === 'string' && typeof parsed.email === 'string') {
      return {
        uid: parsed.uid,
        email: parsed.email,
        displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '',
      };
    }
  } catch {
    // Ignore sandboxed storage restriction
  }
  return null;
}

function writeCachedSupabaseProfile(profile: CachedSupabaseProfile | null) {
  try {
    if (typeof window === 'undefined') return;
    if (!profile) {
      localStorage.removeItem(LOCAL_SUPABASE_PROFILE_KEY);
    } else {
      localStorage.setItem(LOCAL_SUPABASE_PROFILE_KEY, JSON.stringify(profile));
    }
  } catch {
    // Ignore sandboxed storage restriction
  }
}

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
  completeSupabaseLogin: (sbUser: { id: string; email?: string | null }, fullName: string) => void;
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
        supabaseConfig?: { url: string; publishableKey: string } | null;
      }>('/api/health').catch(() => null);

      if (healthRes) {
        setReadiness(healthRes.readiness);
        if (healthRes.clerkConfig?.publishableKey) {
          onClerkPublishableKey(healthRes.clerkConfig.publishableKey);
        }
        if (healthRes.supabaseConfig) {
          configurePublicSupabaseClient(healthRes.supabaseConfig);
        }
      }

      const [meRes, plansRes, sbSessionRes] = await Promise.all([
        apiFetch<{ authenticated: boolean; user: UserProfile | null; preferences?: { language?: Language } }>('/api/auth/me').catch(() => null),
        apiFetch<{ config: { announcement?: string } }>('/api/user/plans').catch(() => ({ config: { announcement: '' } })),
        supabase.auth.getSession().catch(() => ({ data: { session: null } })),
      ]);

      setAnnouncement(plansRes.config?.announcement || '');

      const sbSession = sbSessionRes.data?.session || null;
      const cachedProfile = readCachedSupabaseProfile();

      if (meRes?.authenticated && meRes.user) {
        const resolvedName =
          meRes.user.displayName ||
          (cachedProfile && (cachedProfile.uid === meRes.user.uid || cachedProfile.email === meRes.user.email)
            ? cachedProfile.displayName
            : '');
        const resolvedUser: UserProfile = {
          ...meRes.user,
          ...(resolvedName ? { displayName: resolvedName } : {}),
          role: clerkAdmin ? 'admin' : 'user',
        };
        setUser(resolvedUser);

        if (meRes.preferences?.language === 'en' || meRes.preferences?.language === 'ar') {
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
          // ignore
        }
      } else if (clerkSignedIn && clerkUserId) {
        const now = new Date().toISOString();
        const fallbackEmail = (clerkEmail || '').trim().toLowerCase();
        setUser({
          uid: clerkUserId,
          clerkUserId,
          email: fallbackEmail,
          displayName: clerkDisplayName || (fallbackEmail ? fallbackEmail.split('@')[0] : 'Trader'),
          role: clerkAdmin ? 'admin' : 'user',
          plan: 'free',
          status: 'active',
          createdAt: now,
          updatedAt: now,
          lastLoginAt: now,
        });
        const currentPath = routeRef.current.split('?')[0];
        if (currentPath === '/login' || currentPath === '/register' || currentPath === '/verify-otp') {
          navigate('/dashboard');
        }
      } else if (sbSession?.user) {
        let profileName =
          (typeof sbSession.user.user_metadata?.full_name === 'string' && sbSession.user.user_metadata.full_name) ||
          (cachedProfile && cachedProfile.uid === sbSession.user.id ? cachedProfile.displayName : '') ||
          '';

        try {
          const { data: profileRow } = await supabase
            .from('profiles')
            .select('full_name, email')
            .eq('id', sbSession.user.id)
            .maybeSingle();
          if (profileRow && typeof profileRow.full_name === 'string' && profileRow.full_name.trim()) {
            profileName = profileRow.full_name.trim();
          }
        } catch {
          // Table/RLS might not be provisioned yet; local profile fallback remains intact
        }

        const sbEmail = (sbSession.user.email || cachedProfile?.email || '').trim().toLowerCase();
        if (sbEmail) {
          writeCachedSupabaseProfile({
            uid: sbSession.user.id,
            email: sbEmail,
            displayName: profileName,
          });
        }

        const now = new Date().toISOString();
        setUser({
          uid: sbSession.user.id,
          clerkUserId: `sb:${sbSession.user.id}`,
          email: sbEmail,
          displayName: profileName || sbEmail.split('@')[0],
          role: clerkAdmin ? 'admin' : 'user',
          plan: 'free',
          status: 'active',
          createdAt: sbSession.user.created_at || now,
          updatedAt: now,
          lastLoginAt: now,
        });

        const currentPath = routeRef.current.split('?')[0];
        if (currentPath === '/login' || currentPath === '/register' || currentPath === '/verify-otp') {
          navigate('/dashboard');
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, [clerkAdmin, clerkDisplayName, clerkEmail, clerkSignedIn, clerkUserId, navigate, onClerkPublishableKey]);

  const completeSupabaseLogin = useCallback(
    (sbUser: { id: string; email?: string | null }, fullName: string) => {
      const cleanEmail = (sbUser.email || '').trim().toLowerCase();
      const cleanName = fullName.trim() || cleanEmail.split('@')[0];
      writeCachedSupabaseProfile({
        uid: sbUser.id,
        email: cleanEmail,
        displayName: cleanName,
      });

      const now = new Date().toISOString();
      setUser({
        uid: sbUser.id,
        clerkUserId: `sb:${sbUser.id}`,
        email: cleanEmail,
        displayName: cleanName,
        role: clerkAdmin ? 'admin' : 'user',
        plan: 'free',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      });

      void refreshSession();
    },
    [clerkAdmin, refreshSession],
  );

  // Initial health & session fetch runs immediately without waiting on Clerk JS download (never blocks rendering)
  useEffect(() => {
    refreshSession();
  }, [clerkLoaded, clerkSignedIn, clerkUserId, clerkAdmin, refreshSession]);

  // Keep Supabase Auth session synced across tabs, token refreshes, and reloads
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        void refreshSession();
      } else if (event === 'SIGNED_OUT') {
        writeCachedSupabaseProfile(null);
        if (!clerkSignedIn) {
          setUser(null);
          setNotifications([]);
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [clerkSignedIn, refreshSession]);

  useEffect(() => {
    if (user) {
      refreshNotifications();
      const timer = setInterval(refreshNotifications, 20_000);
      return () => clearInterval(timer);
    }
  }, [user, refreshNotifications]);

  const logout = useCallback(async () => {
    if (clerkSignOut) {
      await clerkSignOut().catch(() => {});
    }
    await supabase.auth.signOut().catch(() => {});
    writeCachedSupabaseProfile(null);
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
        completeSupabaseLogin,
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
  const isClerkAdmin = Boolean(clerkUser?.publicMetadata?.role === 'admin');
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  registerIdTokenGetter(async () => {
    try {
      const clerkToken = await getTokenRef.current();
      if (clerkToken) return clerkToken;
    } catch {
      // Fallback to Supabase Auth session token
    }
    try {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token || null;
    } catch {
      return null;
    }
  });

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, [signOut]);

  return (
    <AppStateCore
      clerkActive={!clerkError}
      clerkLoaded={isLoaded && clerkUserLoaded}
      clerkSignedIn={Boolean(isSignedIn)}
      clerkUserId={userId || null}
      clerkEmail={clerkUser?.primaryEmailAddress?.emailAddress || null}
      clerkDisplayName={clerkUser?.fullName || clerkUser?.username || null}
      clerkAdmin={isClerkAdmin}
      clerkError={clerkError}
      clerkSignOut={handleSignOut}
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
    return envKey;
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
      ? 'Invalid VITE_CLERK_PUBLISHABLE_KEY format (expected pk_test_... or pk_live_...).'
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

  registerIdTokenGetter(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token || null;
    } catch {
      return null;
    }
  });

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

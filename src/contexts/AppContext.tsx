import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, registerIdTokenGetter } from '../lib/api.ts';
import {
  getSupabaseAccessToken,
  getSupabaseClient,
  initSupabaseClient,
  type SupabasePublicConfig,
} from '../lib/supabase.ts';
import { getT } from '../i18n/translations.ts';
import type {
  AppNotification,
  Language,
  MarketTicker,
  ServiceReadiness,
  UserProfile,
} from '../types/trading.ts';

interface AppContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: ReturnType<typeof getT>;
  route: string;
  navigate: (path: string) => void;
  user: UserProfile | null;
  authLoading: boolean;
  readiness: ServiceReadiness | null;
  announcement: string;
  refreshSession: () => Promise<void>;
  completeSupabaseSession: (session?: { access_token: string; refresh_token: string } | null) => Promise<void>;
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
  pendingOtpEmail: string;
  setPendingOtpEmail: (email: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('mour_lang') : null;
    return saved === 'en' ? 'en' : 'ar';
  });

  const [route, setRoute] = useState<string>(() => {
    if (typeof window === 'undefined') return '/';
    return window.location.pathname + window.location.search;
  });

  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [readiness, setReadiness] = useState<ServiceReadiness | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [pendingOtpEmail, setPendingOtpEmail] = useState('');

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
  const authSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  // Sync HTML dir/lang with Arabic RTL default
  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = language === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('mour_lang', language);
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

  const setupSupabaseClient = useCallback((cfg: SupabasePublicConfig | null) => {
    const client = initSupabaseClient(cfg);
    registerIdTokenGetter(getSupabaseAccessToken);

    if (client && !authSubscriptionRef.current) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === 'TOKEN_REFRESHED' && session?.access_token) {
          apiFetch('/api/auth/session', {
            method: 'POST',
            body: JSON.stringify({ accessToken: session.access_token }),
          }).catch(() => {});
        }
      });
      authSubscriptionRef.current = data.subscription;
    }
  }, []);

  useEffect(() => {
    return () => {
      authSubscriptionRef.current?.unsubscribe();
      authSubscriptionRef.current = null;
    };
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
        supabaseConfig: SupabasePublicConfig | null;
      }>('/api/health');

      setReadiness(healthRes.readiness);
      setupSupabaseClient(healthRes.supabaseConfig);

      const [meRes, plansRes] = await Promise.all([
        apiFetch<{ authenticated: boolean; user: UserProfile | null; preferences?: { language?: Language } }>('/api/auth/me'),
        apiFetch<{ config: { announcement?: string } }>('/api/user/plans').catch(() => ({ config: { announcement: '' } })),
      ]);

      setAnnouncement(plansRes.config?.announcement || '');

      if (meRes.authenticated && meRes.user) {
        setUser(meRes.user);
        if (meRes.preferences?.language === 'en' || meRes.preferences?.language === 'ar') {
          setLanguageState(meRes.preferences.language);
        }
        try {
          const wl = await apiFetch<{ symbols: string[] }>('/api/user/watchlist');
          if (Array.isArray(wl.symbols) && wl.symbols.length > 0) setWatchlist(wl.symbols);
        } catch {
          // ignore
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, [setupSupabaseClient]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (user) {
      refreshNotifications();
      const timer = setInterval(refreshNotifications, 20_000);
      return () => clearInterval(timer);
    }
  }, [user, refreshNotifications]);

  const completeSupabaseSession = useCallback(
    async (session?: { access_token: string; refresh_token: string } | null) => {
      const client = getSupabaseClient();
      if (client && session?.access_token && session?.refresh_token) {
        try {
          await client.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          });
        } catch {
          // HttpOnly session cookie is already set
        }
      }
      await refreshSession();
    },
    [refreshSession],
  );

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    const client = getSupabaseClient();
    if (client) {
      await client.auth.signOut().catch(() => {});
    }
    setUser(null);
    setNotifications([]);
    navigate('/');
  }, [navigate]);

  const refreshMarkets = useCallback(async () => {
    try {
      setMarketError(null);
      const res = await apiFetch<{
        tickers: MarketTicker[];
        status: { wsConnected: boolean; lastTickAt: number | null };
      }>('/api/market/tickers?quote=USDT&sort=volume&limit=250');
      setTickers(res.tickers);
      setLastTickAt(res.status.lastTickAt || Date.now());
    } catch (err) {
      setMarketError(err instanceof Error ? err.message : 'Unable to load Binance Spot market data');
    } finally {
      setMarketLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMarkets();
  }, [refreshMarkets]);

  // Real-time WebSocket stream with automatic exponential backoff reconnect
  useEffect(() => {
    let ws: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws/market`);

      ws.onopen = () => {
        attempt = 0;
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            type: string;
            ts?: number;
            status?: { wsConnected: boolean };
            data?: Array<{ symbol: string; price: number; high24h: number; low24h: number }>;
          };

          if (msg.type === 'status' && msg.status) {
            setWsConnected(msg.status.wsConnected);
          } else if (msg.type === 'tickers' && Array.isArray(msg.data)) {
            setWsConnected(true);
            setLastTickAt(msg.ts || Date.now());
            const patchMap = new Map(msg.data.map((u) => [u.symbol, u]));
            setTickers((prev) =>
              prev.map((t) => {
                const patch = patchMap.get(t.symbol);
                if (!patch) return t;
                return {
                  ...t,
                  lastPrice: patch.price,
                  highPrice: patch.high24h || t.highPrice,
                  lowPrice: patch.low24h || t.lowPrice,
                  updatedAt: msg.ts || Date.now(),
                };
              }),
            );
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!disposed) {
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
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
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
      localStorage.setItem('mour_guest_watchlist', JSON.stringify(next));
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
        authLoading,
        readiness,
        announcement,
        refreshSession,
        completeSupabaseSession,
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
        pendingOtpEmail,
        setPendingOtpEmail,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

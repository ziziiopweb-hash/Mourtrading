import fs from 'node:fs';
import path from 'node:path';
import type {
  AiAnalysisReport,
  SignalDirection,
  SignalSource,
  SignalStatus,
  SignalTradeType,
  Timeframe,
} from '../../src/types/trading.ts';

export interface LocalUserProfileRow {
  id: string;
  clerk_user_id?: string | null;
  email: string;
  display_name?: string | null;
  role: 'user' | 'admin';
  plan: 'free' | 'pro';
  status: 'active' | 'suspended';
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalUserPrefsRow {
  user_id: string;
  language: 'ar' | 'en';
  default_quote_asset: 'USDT';
  default_timeframe: string;
  email_alerts_enabled: boolean;
  signal_notifications_enabled: boolean;
  price_alerts_enabled: boolean;
  updated_at: string;
}

export interface LocalPortfolioRow {
  user_id: string;
  usdt_balance: number;
  holdings: Array<{
    symbol: string;
    pair: string;
    quantity: number;
    avgBuyPrice: number;
    updatedAt: string;
  }>;
  updated_at: string;
}

export interface LocalTransactionRow {
  id: string;
  user_id: string;
  asset: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price_usdt: number;
  note: string;
  executed_at: string;
}

export interface LocalPriceAlertRow {
  id: string;
  user_id: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW' | 'ENTRY_ZONE' | 'TP_TARGET' | 'SL_TARGET';
  target_price: number;
  target_price_upper: number | null;
  email_notify: boolean;
  status: 'ACTIVE' | 'TRIGGERED' | 'DISABLED';
  triggered_at?: string | null;
  created_at: string;
}

export interface LocalNotificationRow {
  id: string;
  user_id: string;
  type: 'PRICE_ALERT' | 'SIGNAL_EVENT' | 'ANNOUNCEMENT' | 'SYSTEM';
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface LocalAnalysisRow {
  id: string;
  user_id: string;
  symbol: string;
  coin_name: string;
  timeframe: string;
  analysis_type: 'market' | 'vision';
  verdict: 'BUY' | 'WAIT' | 'AVOID';
  verified_price: number;
  confidence_score: number;
  report: AiAnalysisReport;
  created_at: string;
}

export interface LocalSignalRow {
  id: string;
  symbol: string;
  source: SignalSource;
  trade_type?: SignalTradeType;
  direction?: SignalDirection;
  timeframe: string;
  status: SignalStatus;
  entry_low: number;
  entry_high: number;
  tp1: number;
  tp2: number;
  tp3: number;
  stop_loss: number;
  risk_reward_ratio: number;
  entry_reference_price?: number | null;
  actual_result_percent?: number | null;
  close_price?: number | null;
  closed_at?: string | null;
  ambiguity_note?: string | null;
  explanation: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LocalAutoSignalsConfigRow {
  enabled: boolean;
  timeframe: Timeframe;
  cooldown_minutes: number;
  max_active_signals: number;
  min_quote_volume_usdt: number;
  last_scan_at: string | null;
  last_scan_summary?: string;
  updated_at: string;
}

export interface LocalSignalEventRow {
  id: string;
  signal_id: string;
  symbol: string;
  event_type: string;
  trigger_price: number;
  result_percent: number;
  note?: string | null;
  occurred_at: string;
}

export interface LocalAppConfigRow {
  id: 'global';
  free_daily_ai_limit: number;
  pro_daily_ai_limit: number;
  pro_monthly_price_usd: number;
  pro_annual_price_usd: number;
  pro_duration_days: number;
  free_features: string[];
  pro_features: string[];
  announcement: string;
  updated_at: string;
}

export interface LocalAuditLogRow {
  id: string;
  admin_uid: string;
  action: string;
  target_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface LocalAuthFailureRow {
  email: string;
  reason: string;
  ip: string;
  created_at: string;
}

interface LocalDatabaseSnapshot {
  user_profiles: LocalUserProfileRow[];
  user_preferences: LocalUserPrefsRow[];
  favorites: Array<{ user_id: string; symbol: string; created_at: string }>;
  portfolios: LocalPortfolioRow[];
  portfolio_transactions: LocalTransactionRow[];
  price_alerts: LocalPriceAlertRow[];
  notifications: LocalNotificationRow[];
  analyses: LocalAnalysisRow[];
  signals: LocalSignalRow[];
  signal_events: LocalSignalEventRow[];
  app_config: LocalAppConfigRow;
  auto_signals_config: LocalAutoSignalsConfigRow;
  admin_audit_logs: LocalAuditLogRow[];
  auth_failure_logs: LocalAuthFailureRow[];
}

const DATA_DIR = path.resolve(process.cwd(), '.mourtrading-data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

export function createDefaultAppConfigRow(): LocalAppConfigRow {
  return {
    id: 'global',
    free_daily_ai_limit: 3,
    pro_daily_ai_limit: 50,
    pro_monthly_price_usd: 5,
    pro_annual_price_usd: 50,
    pro_duration_days: 30,
    free_features: [
      '3 AI Analyses / 24h',
      'Live Binance Spot Market Data',
      'Standard Technical Charts & Indicators',
      'Watchlist & Manual Portfolio Tracking',
    ],
    pro_features: [
      '50 AI Analyses / 24h',
      'Multi-Timeframe AI & Vision Deep Reports',
      'Priority Spot Signals & Alerts',
      'Extended Watchlists & Portfolio Analytics',
    ],
    announcement: '',
    updated_at: new Date().toISOString(),
  };
}

export function createDefaultAutoSignalsConfigRow(): LocalAutoSignalsConfigRow {
  return {
    enabled: false,
    timeframe: '1h',
    cooldown_minutes: 120,
    max_active_signals: 6,
    min_quote_volume_usdt: 10_000_000,
    last_scan_at: null,
    last_scan_summary: '',
    updated_at: new Date().toISOString(),
  };
}

function createEmptySnapshot(): LocalDatabaseSnapshot {
  return {
    user_profiles: [],
    user_preferences: [],
    favorites: [],
    portfolios: [],
    portfolio_transactions: [],
    price_alerts: [],
    notifications: [],
    analyses: [],
    signals: [],
    signal_events: [],
    app_config: createDefaultAppConfigRow(),
    auto_signals_config: createDefaultAutoSignalsConfigRow(),
    admin_audit_logs: [],
    auth_failure_logs: [],
  };
}

class LocalStore {
  private state: LocalDatabaseSnapshot;
  private diskWritable = true;

  constructor() {
    this.state = this.loadFromDisk();
  }

  private loadFromDisk(): LocalDatabaseSnapshot {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, 'utf8');
        const parsed = JSON.parse(raw) as Partial<LocalDatabaseSnapshot>;
        const base = createEmptySnapshot();
        return {
          user_profiles: Array.isArray(parsed.user_profiles) ? parsed.user_profiles : base.user_profiles,
          user_preferences: Array.isArray(parsed.user_preferences) ? parsed.user_preferences : base.user_preferences,
          favorites: Array.isArray(parsed.favorites) ? parsed.favorites : base.favorites,
          portfolios: Array.isArray(parsed.portfolios) ? parsed.portfolios : base.portfolios,
          portfolio_transactions: Array.isArray(parsed.portfolio_transactions)
            ? parsed.portfolio_transactions
            : base.portfolio_transactions,
          price_alerts: Array.isArray(parsed.price_alerts) ? parsed.price_alerts : base.price_alerts,
          notifications: Array.isArray(parsed.notifications) ? parsed.notifications : base.notifications,
          analyses: Array.isArray(parsed.analyses) ? parsed.analyses : base.analyses,
          signals: Array.isArray(parsed.signals) ? parsed.signals : base.signals,
          signal_events: Array.isArray(parsed.signal_events) ? parsed.signal_events : base.signal_events,
          app_config: parsed.app_config?.id === 'global' ? parsed.app_config : base.app_config,
          auto_signals_config: parsed.auto_signals_config
            ? { ...base.auto_signals_config, ...parsed.auto_signals_config }
            : base.auto_signals_config,
          admin_audit_logs: Array.isArray(parsed.admin_audit_logs) ? parsed.admin_audit_logs : base.admin_audit_logs,
          auth_failure_logs: Array.isArray(parsed.auth_failure_logs) ? parsed.auth_failure_logs : base.auth_failure_logs,
        };
      }
    } catch {
      // Fall back to fresh in-memory state if local store file cannot be read
    }
    return createEmptySnapshot();
  }

  public save(): void {
    if (!this.diskWritable) return;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmpPath = `${STORE_PATH}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tmpPath, STORE_PATH);
    } catch {
      // Continue seamlessly in-memory if filesystem is read-only
      this.diskWritable = false;
    }
  }

  public get data(): LocalDatabaseSnapshot {
    return this.state;
  }
}

export const localStore = new LocalStore();

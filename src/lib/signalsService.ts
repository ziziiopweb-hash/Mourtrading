import { ApiError, apiFetch } from './api.ts';
import { detectAutoSignalOpportunity, roundSignalPrice } from './autoSignalScanner.ts';
import { fetchDirectBinanceKlines } from './binancePublic.ts';
import {
  computeSignalResultPercent,
  evaluateSignalAgainstPrice,
  isSignalMonitoringTerminal,
} from './signalEvaluator.ts';
import { supabase } from './supabase.ts';
import type {
  AutoSignalsConfig,
  MarketTicker,
  SignalDirection,
  SignalEvent,
  SignalSource,
  SignalStatus,
  SignalTradeType,
  Timeframe,
  TradingSignal,
} from '../types/trading.ts';

const LS_SIGNALS_KEY = 'mourtrading_signals_v1';
const LS_EVENTS_KEY = 'mourtrading_signal_events_v1';
const LS_AUTO_CFG_KEY = 'mourtrading_auto_signals_cfg_v1';
const LS_MONITOR_ENABLED_KEY = 'mourtrading_price_monitor_enabled_v1';

export type SignalWithLive = TradingSignal & { livePrice?: number | null };

export interface CreateSignalPayload {
  symbol: string;
  tradeType: SignalTradeType;
  direction: SignalDirection;
  timeframe: Timeframe;
  entryLow: number;
  entryHigh?: number;
  tp1: number;
  tp2?: number;
  tp3?: number;
  stopLoss: number;
  explanation?: string;
  source?: SignalSource;
}

export interface UpdateSignalPayload {
  symbol?: string;
  tradeType?: SignalTradeType;
  direction?: SignalDirection;
  timeframe?: Timeframe;
  entryLow?: number;
  entryHigh?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  stopLoss?: number;
  explanation?: string;
  status?: SignalStatus;
}

function isEndpointUnavailableError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return (
      err.status === 404 ||
      err.status === 502 ||
      err.status === 503 ||
      err.message.includes('Service endpoint unavailable') ||
      err.message.includes('API endpoint not found')
    );
  }
  if (err instanceof Error) {
    return (
      err.message.includes('Failed to fetch') ||
      err.message.includes('NetworkError') ||
      err.message.includes('Service endpoint unavailable')
    );
  }
  return false;
}

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota or sandboxed storage errors
  }
}

export function getPriceMonitoringEnabled(): boolean {
  try {
    const raw = localStorage.getItem(LS_MONITOR_ENABLED_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

export function setPriceMonitoringEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LS_MONITOR_ENABLED_KEY, String(enabled));
  } catch {
    // Ignore storage error
  }
}

function defaultAutoConfig(): AutoSignalsConfig {
  return {
    enabled: false,
    timeframe: '1h',
    cooldownMinutes: 120,
    maxActiveSignals: 6,
    minQuoteVolumeUsdt: 10_000_000,
    lastScanAt: null,
    lastScanSummary: '',
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeSymbolInput(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return '';
  if (
    cleaned.endsWith('USDT') ||
    cleaned.endsWith('USDC') ||
    cleaned.endsWith('FDUSD') ||
    cleaned.endsWith('BTC') ||
    cleaned.endsWith('ETH')
  ) {
    return cleaned;
  }
  return `${cleaned}USDT`;
}

function normalizeCreatePayload(input: CreateSignalPayload) {
  const symbol = normalizeSymbolInput(input.symbol);
  if (!symbol || symbol.length < 4) {
    throw new Error('يرجى إدخال رمز زوج صالح مثل BTCUSDT');
  }

  const rawLow = Number(input.entryLow);
  const rawHigh = Number(input.entryHigh || input.entryLow);
  const entryLow = Math.min(rawLow, rawHigh);
  const entryHigh = Math.max(rawLow, rawHigh);
  const stopLoss = Number(input.stopLoss);
  const tp1 = Number(input.tp1);
  const refEntry = (entryLow + entryHigh) / 2;
  const direction: SignalDirection =
    input.direction === 'SHORT' || stopLoss > entryHigh ? 'SHORT' : 'LONG';

  if (!Number.isFinite(entryLow) || entryLow <= 0 || !Number.isFinite(stopLoss) || stopLoss <= 0 || !Number.isFinite(tp1) || tp1 <= 0) {
    throw new Error('يرجى إدخال أسعار صالحة للدخول والهدف ووقف الخسارة');
  }

  let tp2: number;
  let tp3: number;

  if (direction === 'SHORT') {
    const risk = Math.max(stopLoss - refEntry, refEntry * 0.01);
    tp2 = input.tp2 && Number(input.tp2) > 0 ? Number(input.tp2) : roundSignalPrice(Math.max(tp1 - risk * 0.9, tp1 * 0.985));
    tp3 = input.tp3 && Number(input.tp3) > 0 ? Number(input.tp3) : roundSignalPrice(Math.max(tp2 - risk * 1.1, tp2 * 0.98));

    if (stopLoss <= entryHigh || tp1 >= entryLow || tp2 >= tp1 || tp3 >= tp2 || tp3 <= 0) {
      throw new Error(
        'في صفقات البيع (SHORT): يجب أن يكون وقف الخسارة أعلى من الدخول، والأهداف أقل من الدخول بالترتيب (TP3 < TP2 < TP1).',
      );
    }
  } else {
    const risk = Math.max(refEntry - stopLoss, refEntry * 0.01);
    tp2 = input.tp2 && Number(input.tp2) > 0 ? Number(input.tp2) : roundSignalPrice(tp1 + risk * 0.9);
    tp3 = input.tp3 && Number(input.tp3) > 0 ? Number(input.tp3) : roundSignalPrice(tp2 + risk * 1.1);

    if (stopLoss >= entryLow || tp1 <= entryHigh || tp2 <= tp1 || tp3 <= tp2) {
      throw new Error(
        'في صفقات الشراء (Spot/LONG): يجب أن يكون وقف الخسارة أقل من الدخول، والأهداف أعلى من الدخول بالترتيب (TP1 < TP2 < TP3).',
      );
    }
  }

  const risk = direction === 'SHORT' ? stopLoss - refEntry : refEntry - stopLoss;
  const reward = direction === 'SHORT' ? refEntry - tp2 : tp2 - refEntry;
  const riskRewardRatio = risk > 0 ? Number((Math.abs(reward) / risk).toFixed(2)) : 1;

  return {
    symbol,
    tradeType: input.tradeType || 'SPOT_BUY',
    direction,
    timeframe: input.timeframe || '4h',
    entryLow,
    entryHigh,
    tp1,
    tp2,
    tp3,
    stopLoss,
    riskRewardRatio,
    refEntry,
    explanation:
      (input.explanation || '').trim() ||
      `صفقة ${direction === 'SHORT' ? 'بيع (Short)' : 'شراء فوري (Spot)'} على ${symbol}`,
    source: input.source || ('ADMIN' as const),
  };
}

function mapSupabasePublicRow(sig: Record<string, unknown>): SignalWithLive {
  const entryLow = Number(sig.entry_low);
  const entryHigh = Number(sig.entry_high);
  const stopLoss = Number(sig.stop_loss);
  const rawSrc = String(sig.source || 'ADMIN').toUpperCase();
  const source: SignalSource = rawSrc === 'AUTO' ? 'AUTO' : rawSrc === 'AI' ? 'AI' : 'ADMIN';
  const direction: SignalDirection = stopLoss > entryHigh ? 'SHORT' : 'LONG';

  return {
    id: String(sig.id),
    symbol: String(sig.symbol || ''),
    source,
    tradeType: 'SPOT_BUY',
    direction,
    timeframe: (String(sig.timeframe || '4h') as Timeframe),
    status: String(sig.status || 'ACTIVE') as SignalStatus,
    entryLow,
    entryHigh,
    tp1: Number(sig.tp1),
    tp2: Number(sig.tp2),
    tp3: Number(sig.tp3),
    stopLoss,
    riskRewardRatio: Number(sig.risk_reward_ratio || 1),
    entryReferencePrice:
      sig.entry_reference_price !== null && sig.entry_reference_price !== undefined
        ? Number(sig.entry_reference_price)
        : undefined,
    actualResultPercent:
      sig.actual_result_percent !== null && sig.actual_result_percent !== undefined
        ? Number(sig.actual_result_percent)
        : undefined,
    ambiguityNote: sig.ambiguity_note ? String(sig.ambiguity_note) : undefined,
    explanation: String(sig.explanation || ''),
    createdBy: String(sig.created_by || ''),
    createdAt: String(sig.created_at || new Date().toISOString()),
    updatedAt: String(sig.updated_at || new Date().toISOString()),
  };
}

export async function fetchAllSignals(): Promise<{
  signals: SignalWithLive[];
  events: SignalEvent[];
  autoSignalsEnabled: boolean;
  lastEvaluatedAt: string | null;
  backendAvailable: boolean;
}> {
  try {
    const res = await apiFetch<{
      signals: SignalWithLive[];
      events: SignalEvent[];
      autoSignalsEnabled?: boolean;
      lastEvaluatedAt?: string | null;
    }>('/api/signals?status=ALL&source=ALL');

    const signals = res.signals || [];
    const events = res.events || [];
    writeLocalJson(LS_SIGNALS_KEY, signals);
    writeLocalJson(LS_EVENTS_KEY, events);
    return {
      signals,
      events,
      autoSignalsEnabled: Boolean(res.autoSignalsEnabled),
      lastEvaluatedAt: res.lastEvaluatedAt || null,
      backendAvailable: true,
    };
  } catch (err) {
    if (!isEndpointUnavailableError(err)) {
      throw err;
    }
  }

  // Fallback when /api/* backend is unavailable (e.g. Vercel static deploy)
  const localSignals = readLocalJson<SignalWithLive[]>(LS_SIGNALS_KEY, []);
  const localEvents = readLocalJson<SignalEvent[]>(LS_EVENTS_KEY, []);
  const localCfg = readLocalJson<AutoSignalsConfig>(LS_AUTO_CFG_KEY, defaultAutoConfig());

  try {
    const { data } = await supabase
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (Array.isArray(data) && data.length > 0) {
      const mergedMap = new Map<string, SignalWithLive>();
      for (const s of localSignals) mergedMap.set(s.id, s);
      for (const row of data) {
        const mapped = mapSupabasePublicRow(row as Record<string, unknown>);
        if (!mergedMap.has(mapped.id)) mergedMap.set(mapped.id, mapped);
      }
      const merged = Array.from(mergedMap.values()).sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
      writeLocalJson(LS_SIGNALS_KEY, merged);
      return {
        signals: merged,
        events: localEvents,
        autoSignalsEnabled: localCfg.enabled,
        lastEvaluatedAt: null,
        backendAvailable: false,
      };
    }
  } catch {
    // Ignore public supabase fallback error
  }

  return {
    signals: localSignals,
    events: localEvents,
    autoSignalsEnabled: localCfg.enabled,
    lastEvaluatedAt: null,
    backendAvailable: false,
  };
}

export async function publishManualSignal(
  payload: CreateSignalPayload,
  livePrice: number | null,
  adminUid = 'admin',
): Promise<SignalWithLive> {
  const norm = normalizeCreatePayload(payload);

  try {
    const res = await apiFetch<{ signal: SignalWithLive }>('/api/admin/signals', {
      method: 'POST',
      body: JSON.stringify({
        symbol: norm.symbol,
        tradeType: norm.tradeType,
        direction: norm.direction,
        timeframe: norm.timeframe,
        entryLow: norm.entryLow,
        entryHigh: norm.entryHigh,
        tp1: norm.tp1,
        tp2: norm.tp2,
        tp3: norm.tp3,
        stopLoss: norm.stopLoss,
        explanation: norm.explanation,
        source: norm.source,
      }),
    });
    return res.signal;
  } catch (err) {
    if (!isEndpointUnavailableError(err)) {
      throw err;
    }
  }

  const nowIso = new Date().toISOString();
  const id = `sig_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const created: SignalWithLive = {
    id,
    symbol: norm.symbol,
    source: norm.source,
    tradeType: norm.tradeType,
    direction: norm.direction,
    timeframe: norm.timeframe,
    status: 'ACTIVE',
    entryLow: norm.entryLow,
    entryHigh: norm.entryHigh,
    tp1: norm.tp1,
    tp2: norm.tp2,
    tp3: norm.tp3,
    stopLoss: norm.stopLoss,
    riskRewardRatio: norm.riskRewardRatio,
    entryReferencePrice: norm.refEntry,
    explanation: norm.explanation,
    createdBy: adminUid,
    createdAt: nowIso,
    updatedAt: nowIso,
    livePrice: livePrice ?? norm.refEntry,
  };

  const current = readLocalJson<SignalWithLive[]>(LS_SIGNALS_KEY, []);
  current.unshift(created);
  writeLocalJson(LS_SIGNALS_KEY, current);

  const events = readLocalJson<SignalEvent[]>(LS_EVENTS_KEY, []);
  events.unshift({
    id: `${id}_CREATED`,
    signalId: id,
    symbol: norm.symbol,
    eventType: 'CREATED',
    triggerPrice: livePrice ?? norm.refEntry,
    resultPercent: 0,
    occurredAt: nowIso,
  });
  writeLocalJson(LS_EVENTS_KEY, events.slice(0, 50));

  return created;
}

export async function updateSignalById(
  signalId: string,
  patch: UpdateSignalPayload,
): Promise<SignalWithLive | null> {
  try {
    const res = await apiFetch<{ signal: SignalWithLive }>(`/api/admin/signals/${encodeURIComponent(signalId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return res.signal;
  } catch (err) {
    if (!isEndpointUnavailableError(err)) {
      throw err;
    }
  }

  const current = readLocalJson<SignalWithLive[]>(LS_SIGNALS_KEY, []);
  const idx = current.findIndex((s) => s.id === signalId);
  if (idx === -1) return null;

  const existing = current[idx];
  const entryLow = patch.entryLow ?? existing.entryLow;
  const entryHigh = patch.entryHigh ?? existing.entryHigh;
  const stopLoss = patch.stopLoss ?? existing.stopLoss;
  const tp1 = patch.tp1 ?? existing.tp1;
  const tp2 = patch.tp2 ?? existing.tp2;
  const tp3 = patch.tp3 ?? existing.tp3;
  const direction: SignalDirection =
    patch.direction ?? (stopLoss > entryHigh ? 'SHORT' : 'LONG');
  const refEntry = (entryLow + entryHigh) / 2;
  const risk = direction === 'SHORT' ? stopLoss - refEntry : refEntry - stopLoss;
  const reward = direction === 'SHORT' ? refEntry - tp2 : tp2 - refEntry;
  const nextStatus = patch.status ?? existing.status;

  const updated: SignalWithLive = {
    ...existing,
    ...patch,
    symbol: patch.symbol ? normalizeSymbolInput(patch.symbol) : existing.symbol,
    entryLow: Math.min(entryLow, entryHigh),
    entryHigh: Math.max(entryLow, entryHigh),
    tp1,
    tp2,
    tp3,
    stopLoss,
    direction,
    entryReferencePrice: refEntry,
    riskRewardRatio: risk > 0 ? Number((Math.abs(reward) / risk).toFixed(2)) : existing.riskRewardRatio,
    status: nextStatus,
    ...(nextStatus === 'ACTIVE'
      ? { closedAt: undefined, closePrice: undefined, actualResultPercent: undefined }
      : {}),
    updatedAt: new Date().toISOString(),
  };

  current[idx] = updated;
  writeLocalJson(LS_SIGNALS_KEY, current);
  return updated;
}

export async function updateSignalStatusById(
  signalId: string,
  nextStatus: SignalStatus,
  livePrice?: number | null,
): Promise<SignalWithLive | null> {
  try {
    const res = await apiFetch<{ signal: SignalWithLive }>(
      `/api/admin/signals/${encodeURIComponent(signalId)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      },
    );
    return res.signal;
  } catch (err) {
    if (!isEndpointUnavailableError(err)) {
      throw err;
    }
  }

  const current = readLocalJson<SignalWithLive[]>(LS_SIGNALS_KEY, []);
  const idx = current.findIndex((s) => s.id === signalId);
  if (idx === -1) return null;

  const sig = current[idx];
  const nowIso = new Date().toISOString();
  const refEntry = sig.entryReferencePrice || (sig.entryLow + sig.entryHigh) / 2;
  const dir: SignalDirection =
    sig.direction === 'SHORT' || sig.stopLoss > sig.entryHigh ? 'SHORT' : 'LONG';

  const closePrice =
    livePrice && livePrice > 0
      ? livePrice
      : nextStatus === 'TP1_HIT'
        ? sig.tp1
        : nextStatus === 'TP2_HIT'
          ? sig.tp2
          : nextStatus === 'TP3_HIT'
            ? sig.tp3
            : nextStatus === 'STOP_LOSS_HIT'
              ? sig.stopLoss
              : refEntry;

  const resultPercent =
    nextStatus === 'ACTIVE' ? undefined : computeSignalResultPercent(dir, refEntry, closePrice);

  const updated: SignalWithLive = {
    ...sig,
    status: nextStatus,
    actualResultPercent: resultPercent,
    closePrice: nextStatus === 'ACTIVE' ? undefined : closePrice,
    closedAt: nextStatus === 'ACTIVE' ? undefined : nowIso,
    updatedAt: nowIso,
  };

  current[idx] = updated;
  writeLocalJson(LS_SIGNALS_KEY, current);

  if (nextStatus !== 'ACTIVE') {
    const events = readLocalJson<SignalEvent[]>(LS_EVENTS_KEY, []);
    const eventId = `${signalId}_${nextStatus}`;
    if (!events.some((e) => e.id === eventId)) {
      events.unshift({
        id: eventId,
        signalId,
        symbol: sig.symbol,
        eventType: nextStatus,
        triggerPrice: closePrice,
        resultPercent: resultPercent ?? 0,
        occurredAt: nowIso,
      });
      writeLocalJson(LS_EVENTS_KEY, events.slice(0, 50));
    }
  }

  return updated;
}

export async function deleteSignalById(signalId: string): Promise<void> {
  try {
    await apiFetch(`/api/admin/signals/${encodeURIComponent(signalId)}`, {
      method: 'DELETE',
    });
    return;
  } catch (err) {
    if (!isEndpointUnavailableError(err)) {
      throw err;
    }
  }

  const current = readLocalJson<SignalWithLive[]>(LS_SIGNALS_KEY, []);
  writeLocalJson(
    LS_SIGNALS_KEY,
    current.filter((s) => s.id !== signalId),
  );
  const events = readLocalJson<SignalEvent[]>(LS_EVENTS_KEY, []);
  writeLocalJson(
    LS_EVENTS_KEY,
    events.filter((e) => e.signalId !== signalId),
  );
}

export async function fetchAutoSignalsConfig(): Promise<AutoSignalsConfig> {
  try {
    const res = await apiFetch<{ config: AutoSignalsConfig }>('/api/admin/auto-signals');
    writeLocalJson(LS_AUTO_CFG_KEY, res.config);
    return res.config;
  } catch (err) {
    if (!isEndpointUnavailableError(err)) {
      throw err;
    }
  }
  return readLocalJson<AutoSignalsConfig>(LS_AUTO_CFG_KEY, defaultAutoConfig());
}

export async function saveAutoSignalsConfig(
  patch: Partial<Pick<AutoSignalsConfig, 'enabled' | 'timeframe' | 'cooldownMinutes' | 'maxActiveSignals' | 'minQuoteVolumeUsdt'>>,
): Promise<AutoSignalsConfig> {
  try {
    const res = await apiFetch<{ config: AutoSignalsConfig }>('/api/admin/auto-signals', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    writeLocalJson(LS_AUTO_CFG_KEY, res.config);
    return res.config;
  } catch (err) {
    if (!isEndpointUnavailableError(err)) {
      throw err;
    }
  }

  const current = readLocalJson<AutoSignalsConfig>(LS_AUTO_CFG_KEY, defaultAutoConfig());
  const next: AutoSignalsConfig = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeLocalJson(LS_AUTO_CFG_KEY, next);
  return next;
}

export async function runAutoSignalsScanNow(
  tickers: MarketTicker[],
): Promise<{
  created: SignalWithLive[];
  scannedCount: number;
  skippedCooldown: number;
  config: AutoSignalsConfig;
}> {
  try {
    const res = await apiFetch<{
      created: SignalWithLive[];
      scannedCount: number;
      skippedCooldown: number;
      config: AutoSignalsConfig;
    }>('/api/admin/auto-signals/scan', { method: 'POST' });
    writeLocalJson(LS_AUTO_CFG_KEY, res.config);
    return res;
  } catch (err) {
    if (!isEndpointUnavailableError(err)) {
      throw err;
    }
  }

  // Client-side live Binance klines scan fallback (for static hosting without Express backend)
  const cfg = readLocalJson<AutoSignalsConfig>(LS_AUTO_CFG_KEY, defaultAutoConfig());
  const currentSignals = readLocalJson<SignalWithLive[]>(LS_SIGNALS_KEY, []);
  const cutoffIso = new Date(Date.now() - cfg.cooldownMinutes * 60 * 1000).toISOString();

  const blocked = new Set<string>();
  let activeAutoCount = 0;
  for (const s of currentSignals) {
    if (s.source !== 'AUTO' && s.source !== 'AI') continue;
    if (!isSignalMonitoringTerminal(s.status)) {
      activeAutoCount++;
      blocked.add(s.symbol.toUpperCase());
    } else if (s.createdAt >= cutoffIso) {
      blocked.add(s.symbol.toUpperCase());
    }
  }

  const remainingSlots = Math.max(0, cfg.maxActiveSignals - activeAutoCount);
  if (remainingSlots <= 0) {
    const nextCfg: AutoSignalsConfig = {
      ...cfg,
      lastScanAt: new Date().toISOString(),
      lastScanSummary: `Max active auto signals reached (${activeAutoCount}/${cfg.maxActiveSignals}).`,
      updatedAt: new Date().toISOString(),
    };
    writeLocalJson(LS_AUTO_CFG_KEY, nextCfg);
    return { created: [], scannedCount: 0, skippedCooldown: 0, config: nextCfg };
  }

  const eligible = tickers.filter(
    (tk) =>
      tk.quoteVolume >= cfg.minQuoteVolumeUsdt &&
      tk.priceChangePercent > -15 &&
      tk.priceChangePercent < 22 &&
      !['USDCUSDT', 'FDUSDUSDT', 'TUSDUSDT', 'BUSDUSDT', 'USDPUSDT'].includes(tk.symbol),
  );

  let skippedCooldown = 0;
  const candidates: MarketTicker[] = [];
  for (const tk of eligible) {
    if (blocked.has(tk.symbol.toUpperCase())) {
      skippedCooldown++;
      continue;
    }
    candidates.push(tk);
    if (candidates.length >= 10) break;
  }

  const opps = [];
  for (const tk of candidates) {
    try {
      const candles = await fetchDirectBinanceKlines(tk.symbol, cfg.timeframe, 150);
      const found = detectAutoSignalOpportunity(tk.symbol, cfg.timeframe, candles, tk.quoteVolume);
      if (found) opps.push(found);
    } catch {
      // Ignore single pair transient error
    }
  }

  opps.sort((a, b) => b.score - a.score);
  const created: SignalWithLive[] = [];
  for (const opp of opps.slice(0, Math.min(remainingSlots, 2))) {
    const live = tickers.find((t) => t.symbol === opp.symbol)?.lastPrice ?? null;
    const saved = await publishManualSignal(
      {
        symbol: opp.symbol,
        tradeType: opp.tradeType,
        direction: 'LONG',
        timeframe: opp.timeframe,
        entryLow: opp.entryLow,
        entryHigh: opp.entryHigh,
        tp1: opp.tp1,
        tp2: opp.tp2,
        tp3: opp.tp3,
        stopLoss: opp.stopLoss,
        explanation: opp.explanation,
        source: 'AUTO',
      },
      live,
      'system_auto',
    );
    created.push(saved);
  }

  const nextCfg: AutoSignalsConfig = {
    ...cfg,
    lastScanAt: new Date().toISOString(),
    lastScanSummary: `Scanned ${candidates.length} Spot pairs · Published ${created.length} auto signal(s).`,
    updatedAt: new Date().toISOString(),
  };
  writeLocalJson(LS_AUTO_CFG_KEY, nextCfg);

  return {
    created,
    scannedCount: candidates.length,
    skippedCooldown,
    config: nextCfg,
  };
}

/**
 * Evaluates active signals against live Binance market prices.
 * - When Express backend is active: invokes server-verified POST /api/signals/evaluate.
 * - When running purely statically: evaluates live prices (fetching direct Binance price for missing symbols)
 *   and saves status/PnL/closedAt immediately into permanent localStorage.
 */
export async function evaluateActiveSignalsNow(
  currentSignals: SignalWithLive[],
  tickerMap: Map<string, MarketTicker>,
  backendAvailable: boolean,
): Promise<{
  signals: SignalWithLive[];
  events: SignalEvent[];
  changedIds: string[];
  checkedAt: string;
}> {
  const checkedAt = new Date().toISOString();

  if (backendAvailable) {
    try {
      const res = await apiFetch<{
        checkedAt: string;
        signals: SignalWithLive[];
        events: SignalEvent[];
      }>('/api/signals/evaluate', { method: 'POST' });

      const prevMap = new Map(currentSignals.map((s) => [s.id, s.status]));
      const changedIds = (res.signals || [])
        .filter((s) => prevMap.get(s.id) && prevMap.get(s.id) !== s.status)
        .map((s) => s.id);

      writeLocalJson(LS_SIGNALS_KEY, res.signals || []);
      writeLocalJson(LS_EVENTS_KEY, res.events || []);

      return {
        signals: res.signals || [],
        events: res.events || [],
        changedIds,
        checkedAt: res.checkedAt || checkedAt,
      };
    } catch (err) {
      if (!isEndpointUnavailableError(err)) {
        throw err;
      }
    }
  }

  const activeSignals = currentSignals.filter((s) => !isSignalMonitoringTerminal(s.status));
  if (activeSignals.length === 0) {
    return {
      signals: currentSignals,
      events: readLocalJson<SignalEvent[]>(LS_EVENTS_KEY, []),
      changedIds: [],
      checkedAt,
    };
  }

  const missingSymbols = Array.from(
    new Set(
      activeSignals
        .map((s) => s.symbol.toUpperCase())
        .filter((sym) => !tickerMap.get(sym)?.lastPrice),
    ),
  );

  const extraPrices = new Map<string, number>();
  await Promise.all(
    missingSymbols.slice(0, 10).map(async (sym) => {
      try {
        const res = await fetch(
          `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(sym)}`,
        );
        if (res.ok) {
          const data = (await res.json()) as { price?: string };
          const p = Number(data.price);
          if (Number.isFinite(p) && p > 0) extraPrices.set(sym, p);
        }
      } catch {
        // Ignore single pair fetch failure
      }
    }),
  );

  const events = readLocalJson<SignalEvent[]>(LS_EVENTS_KEY, []);
  const changedIds: string[] = [];
  const nextSignals = currentSignals.map((sig) => {
    if (isSignalMonitoringTerminal(sig.status)) return sig;
    const livePrice =
      tickerMap.get(sig.symbol.toUpperCase())?.lastPrice ??
      extraPrices.get(sig.symbol.toUpperCase()) ??
      sig.livePrice ??
      null;
    if (!livePrice || livePrice <= 0) return sig;

    const evalRes = evaluateSignalAgainstPrice(sig, livePrice);
    if (!evalRes) {
      return { ...sig, livePrice };
    }

    changedIds.push(sig.id);
    const eventId = `${sig.id}_${evalRes.nextStatus}`;
    if (!events.some((e) => e.id === eventId)) {
      events.unshift({
        id: eventId,
        signalId: sig.id,
        symbol: sig.symbol,
        eventType: evalRes.nextStatus,
        triggerPrice: evalRes.triggerPrice,
        resultPercent: evalRes.resultPercent,
        note: evalRes.ambiguityNote,
        occurredAt: checkedAt,
      });
    }

    return {
      ...sig,
      status: evalRes.nextStatus,
      actualResultPercent: evalRes.resultPercent,
      closePrice: evalRes.triggerPrice,
      closedAt: checkedAt,
      ambiguityNote: evalRes.ambiguityNote || sig.ambiguityNote,
      updatedAt: checkedAt,
      livePrice,
    };
  });

  if (changedIds.length > 0) {
    writeLocalJson(LS_SIGNALS_KEY, nextSignals);
    writeLocalJson(LS_EVENTS_KEY, events.slice(0, 50));
  }

  return {
    signals: nextSignals,
    events,
    changedIds,
    checkedAt,
  };
}

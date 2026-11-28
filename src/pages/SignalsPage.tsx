import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Signal,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import {
  AdminSignalRowActions,
  SignalEditModal,
  SignalsAdminManager,
} from '../components/SignalsAdminManager.tsx';
import { useApp } from '../contexts/AppContext.tsx';
import { formatPercent, formatPrice, formatTimestamp } from '../lib/formatters.ts';
import {
  computeSignalResultPercent,
  isSignalMonitoringTerminal,
  isSignalProfitTargetHit,
} from '../lib/signalEvaluator.ts';
import {
  evaluateActiveSignalsNow,
  fetchAllSignals,
  getPriceMonitoringEnabled,
  runAutoSignalsScanNow,
  setPriceMonitoringEnabled,
  type SignalWithLive,
} from '../lib/signalsService.ts';
import type { AutoSignalsConfig, SignalEvent, SignalStatus } from '../types/trading.ts';

type StatusQuickFilter = 'ALL' | 'ACTIVE' | 'TARGETS_HIT' | 'STOP_LOSS_HIT';
type SourceQuickFilter = 'ALL' | 'MANUAL' | 'AUTO';

export function SignalsPage() {
  const { isAdmin, language, t, navigate, tickers, tickerMap } = useApp();
  const { user: clerkUser } = useUser();
  const isAr = language === 'ar';
  const hasAdminMetadata = Boolean(isAdmin && clerkUser?.publicMetadata?.role === 'admin');

  const [signals, setSignals] = useState<SignalWithLive[]>([]);
  const [events, setEvents] = useState<SignalEvent[]>([]);
  const [backendAvailable, setBackendAvailable] = useState(true);
  const [autoSignalsEnabled, setAutoSignalsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const [monitoringEnabled, setMonitoringEnabled] = useState<boolean>(() =>
    getPriceMonitoringEnabled(),
  );
  const [checkingNow, setCheckingNow] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [monitorToast, setMonitorToast] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusQuickFilter>('ALL');
  const [sourceFilter, setSourceFilter] = useState<SourceQuickFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const [showAdminPanel, setShowAdminPanel] = useState(true);
  const [editingSignal, setEditingSignal] = useState<SignalWithLive | null>(null);

  const signalsRef = useRef<SignalWithLive[]>(signals);
  signalsRef.current = signals;
  const tickerMapRef = useRef(tickerMap);
  tickerMapRef.current = tickerMap;
  const lastEvalMsRef = useRef(0);

  const loadSignals = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetchAllSignals();
      setSignals(res.signals);
      setEvents(res.events);
      setBackendAvailable(res.backendAvailable);
      setAutoSignalsEnabled(res.autoSignalsEnabled);
      if (res.lastEvaluatedAt) {
        setLastCheckedAt(res.lastEvaluatedAt);
      }
    } catch (err) {
      console.error('[SignalsPage] Failed to load signals:', err);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSignals();
  }, [loadSignals]);

  const runLiveEvaluation = useCallback(
    async (force = false) => {
      const current = signalsRef.current;
      const watchList = current.filter((s) => !isSignalMonitoringTerminal(s.status));
      if (watchList.length === 0 && !force) return;

      const nowMs = Date.now();
      if (!force && nowMs - lastEvalMsRef.current < 4000) return;
      lastEvalMsRef.current = nowMs;

      if (force) setCheckingNow(true);
      try {
        const res = await evaluateActiveSignalsNow(
          current,
          tickerMapRef.current,
          backendAvailable,
        );
        setSignals(res.signals);
        setEvents(res.events);
        setLastCheckedAt(res.checkedAt);
        if (res.changedIds.length > 0) {
          setMonitorToast(
            isAr
              ? `تم تحديث حالة ${res.changedIds.length} صفقة تلقائياً بناءً على السعر الحي.`
              : `Auto-updated ${res.changedIds.length} signal(s) from live market price.`,
          );
        }
      } catch (err) {
        console.error('[SignalsPage] Price evaluation failed:', err);
      } finally {
        if (force) setCheckingNow(false);
      }
    },
    [backendAvailable, isAr],
  );

  // Automatic periodic price monitoring every 8s while enabled
  useEffect(() => {
    if (!monitoringEnabled || loading) return;
    const initialTimer = window.setTimeout(() => {
      runLiveEvaluation(false);
    }, 1200);
    const interval = window.setInterval(() => {
      runLiveEvaluation(false);
    }, 8000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [monitoringEnabled, loading, runLiveEvaluation]);

  // Immediate throttled evaluation whenever tickerMap refreshes while monitoring is ON
  useEffect(() => {
    if (!monitoringEnabled || loading || tickerMap.size === 0) return;
    const hasWatchable = signalsRef.current.some((s) => !isSignalMonitoringTerminal(s.status));
    if (hasWatchable) {
      runLiveEvaluation(false);
    }
  }, [tickerMap, monitoringEnabled, loading, runLiveEvaluation]);

  // Client-side Auto Signals interval fallback when Express backend is unavailable (e.g. static deploy)
  useEffect(() => {
    if (!hasAdminMetadata || !autoSignalsEnabled || backendAvailable) return;
    const timer = window.setInterval(async () => {
      if (tickers.length === 0) return;
      try {
        const res = await runAutoSignalsScanNow(tickers);
        if (res.created.length > 0) {
          loadSignals(true);
        }
      } catch (err) {
        console.error('[SignalsPage] Auto signal background scan error:', err);
      }
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [hasAdminMetadata, autoSignalsEnabled, backendAvailable, tickers, loadSignals]);

  const handleToggleMonitoring = () => {
    const next = !monitoringEnabled;
    setMonitoringEnabled(next);
    setPriceMonitoringEnabled(next);
    if (next) {
      runLiveEvaluation(true);
    }
  };

  // Summary counters
  const stats = useMemo(() => {
    let active = 0;
    let targetsHit = 0;
    let stoppedOut = 0;
    let monitoredCount = 0;

    for (const s of signals) {
      if (s.status === 'ACTIVE') active++;
      if (isSignalProfitTargetHit(s.status)) targetsHit++;
      if (s.status === 'STOP_LOSS_HIT') stoppedOut++;
      if (!isSignalMonitoringTerminal(s.status)) monitoredCount++;
    }
    return {
      total: signals.length,
      active,
      targetsHit,
      stoppedOut,
      monitoredCount,
    };
  }, [signals]);

  const filteredSignals = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    return signals.filter((sig) => {
      if (statusFilter === 'ACTIVE' && sig.status !== 'ACTIVE') return false;
      if (statusFilter === 'TARGETS_HIT' && !isSignalProfitTargetHit(sig.status)) return false;
      if (statusFilter === 'STOP_LOSS_HIT' && sig.status !== 'STOP_LOSS_HIT') return false;

      if (sourceFilter === 'MANUAL' && sig.source !== 'ADMIN') return false;
      if (sourceFilter === 'AUTO' && sig.source !== 'AUTO' && sig.source !== 'AI') return false;

      if (q && !sig.symbol.toUpperCase().includes(q)) return false;
      return true;
    });
  }, [signals, statusFilter, sourceFilter, searchQuery]);

  const getStatusMeta = (status: SignalStatus) => {
    switch (status) {
      case 'TP1_HIT':
        return {
          label: isAr ? 'محققة للهدف 1 (TP1)' : 'Target 1 Hit',
          badgeClass: 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/35',
          textClass: 'text-[#10B981]',
        };
      case 'TP2_HIT':
        return {
          label: isAr ? 'محققة للهدف 2 (TP2)' : 'Target 2 Hit',
          badgeClass: 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/35',
          textClass: 'text-[#10B981]',
        };
      case 'TP3_HIT':
        return {
          label: isAr ? 'محققة لجميع الأهداف (TP3)' : 'All Targets Hit',
          badgeClass: 'bg-[#10B981]/20 text-[#34D399] border-[#10B981]/45',
          textClass: 'text-[#10B981]',
        };
      case 'STOP_LOSS_HIT':
        return {
          label: isAr ? 'مغلقة بالخسارة (SL)' : 'Stopped Out (Loss)',
          badgeClass: 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/40',
          textClass: 'text-[#EF4444]',
        };
      case 'CANCELLED':
        return {
          label: isAr ? 'مغلقة يدوياً' : 'Closed',
          badgeClass: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
          textClass: 'text-slate-400',
        };
      default:
        return {
          label: isAr ? 'نشطة' : 'Active',
          badgeClass: 'bg-[#D4AF37]/15 text-[#E5C158] border-[#D4AF37]/40',
          textClass: 'text-[#E5C158]',
        };
    }
  };

  const getTradeTypeLabel = (tradeType?: string, direction?: string) => {
    if (direction === 'SHORT') return isAr ? 'بيع / Short' : 'Sell / Short';
    if (tradeType === 'SPOT_SCALP') return isAr ? 'شراء · مضاربة سريعة' : 'Spot Scalp';
    if (tradeType === 'SPOT_SWING') return isAr ? 'شراء · سوينج' : 'Spot Swing';
    return isAr ? 'شراء فوري (Spot)' : 'Spot Buy';
  };

  const handleSignalCreated = (created: SignalWithLive) => {
    setSignals((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
  };

  const handleAutoScanCompleted = (created: SignalWithLive[], cfg: AutoSignalsConfig) => {
    setAutoSignalsEnabled(cfg.enabled);
    if (created.length > 0) {
      loadSignals(true);
    }
  };

  const handleSignalUpdated = (updated: SignalWithLive) => {
    setSignals((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleSignalDeleted = (id: string) => {
    setSignals((prev) => prev.filter((s) => s.id !== id));
    setEvents((prev) => prev.filter((e) => e.signalId !== id));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
            <Signal className="w-6 h-6 text-[#D4AF37]" />
            <span>{t.nav.signals}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'إشارات التداول اليدوية والتلقائية مع مراقبة حية ذكية لأسعار الوقف والأهداف'
              : 'Manual & automated trade signals with smart live monitoring for Stop Loss and Profit Targets'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasAdminMetadata && (
            <button
              type="button"
              onClick={() => setShowAdminPanel((v) => !v)}
              className="min-h-[38px] px-3.5 py-2 rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/12 hover:bg-[#D4AF37]/20 text-xs font-bold text-[#E5C158] flex items-center gap-1.5 cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>
                {showAdminPanel
                  ? isAr
                    ? 'إخفاء لوحة الإدارة'
                    : 'Hide Admin Panel'
                  : isAr
                    ? 'إدارة ونشر الصفقات'
                    : 'Manage Signals'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Admin Only Creation + Auto Signals Controls */}
      {hasAdminMetadata && showAdminPanel && (
        <SignalsAdminManager
          onSignalCreated={handleSignalCreated}
          onAutoScanCompleted={handleAutoScanCompleted}
        />
      )}

      {/* Summary Counters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-400">{isAr ? 'إجمالي الصفقات' : 'Total Signals'}</div>
          <div className="text-2xl font-bold font-mono-num text-[#F8FAFC] mt-1">{stats.total}</div>
        </div>

        <div className="bg-[#0D131F] border border-[#D4AF37]/25 rounded-xl p-4">
          <div className="text-xs text-slate-400">{isAr ? 'الصفقات النشطة' : 'Active'}</div>
          <div className="text-2xl font-bold font-mono-num text-[#E5C158] mt-1">{stats.active}</div>
        </div>

        <div className="bg-[#0D131F] border border-[#10B981]/25 rounded-xl p-4">
          <div className="text-xs text-slate-400">{isAr ? 'محققة للأهداف' : 'Targets Hit'}</div>
          <div className="text-2xl font-bold font-mono-num text-[#10B981] mt-1">
            {stats.targetsHit}
          </div>
        </div>

        <div className="bg-[#0D131F] border border-[#EF4444]/25 rounded-xl p-4">
          <div className="text-xs text-slate-400">{isAr ? 'مغلقة بالخسارة' : 'Stopped Out'}</div>
          <div className="text-2xl font-bold font-mono-num text-[#EF4444] mt-1">
            {stats.stoppedOut}
          </div>
        </div>
      </div>

      {/* Smart Live Price Monitoring Status Bar */}
      <div className="bg-[#0D131F] border border-white/10 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-semibold ${
              monitoringEnabled
                ? 'bg-[#10B981]/12 border-[#10B981]/35 text-[#10B981]'
                : 'bg-slate-500/12 border-slate-500/30 text-slate-400'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${monitoringEnabled ? 'animate-pulse' : ''}`} />
            <span>
              {monitoringEnabled
                ? isAr
                  ? 'المراقبة التلقائية للأسعار نشطة'
                  : 'Live Price Monitoring Active'
                : isAr
                  ? 'المراقبة التلقائية متوقفة'
                  : 'Live Price Monitoring Paused'}
            </span>
          </span>

          <span className="text-slate-400 font-mono-num">
            {isAr ? `قيد المراقبة: ${stats.monitoredCount}` : `Watching: ${stats.monitoredCount}`}
          </span>

          {lastCheckedAt && (
            <span className="text-slate-400 font-mono-num inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>
                {isAr ? 'آخر فحص:' : 'Last check:'} {formatTimestamp(lastCheckedAt, language)}
              </span>
            </span>
          )}

          {autoSignalsEnabled && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[#E5C158] bg-[#D4AF37]/10 border border-[#D4AF37]/30 px-2 py-0.5 rounded-lg">
              <Bot className="w-3 h-3" />
              <span>{isAr ? 'النشر التلقائي مفعّل' : 'Auto Signals ON'}</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => runLiveEvaluation(true)}
            disabled={checkingNow}
            className="px-3 py-1.5 rounded-lg bg-[#070A0F] border border-white/12 hover:border-[#D4AF37]/40 text-xs text-slate-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#D4AF37] ${checkingNow ? 'animate-spin' : ''}`} />
            <span>{isAr ? 'فحص الأسعار الآن' : 'Check Now'}</span>
          </button>

          <button
            type="button"
            onClick={handleToggleMonitoring}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer border ${
              monitoringEnabled
                ? 'bg-[#EF4444]/10 border-[#EF4444]/35 text-[#EF4444] hover:bg-[#EF4444]/20'
                : 'bg-[#10B981]/15 border-[#10B981]/35 text-[#10B981] hover:bg-[#10B981]/25'
            }`}
          >
            {monitoringEnabled ? (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                <span>{isAr ? 'إيقاف المراقبة' : 'Pause Monitor'}</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                <span>{isAr ? 'تشغيل المراقبة' : 'Resume Monitor'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {monitorToast && (
        <div className="px-4 py-2.5 rounded-xl bg-[#D4AF37]/12 border border-[#D4AF37]/35 text-xs text-[#E5C158] flex items-center justify-between gap-2">
          <span>{monitorToast}</span>
          <button
            type="button"
            onClick={() => setMonitorToast(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filters & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0D131F] border border-white/10 rounded-xl">
            {(
              [
                { id: 'ALL', label: isAr ? 'الكل' : 'All' },
                { id: 'ACTIVE', label: isAr ? 'نشطة' : 'Active' },
                { id: 'TARGETS_HIT', label: isAr ? 'محققة للأهداف' : 'Targets Hit' },
                { id: 'STOP_LOSS_HIT', label: isAr ? 'مغلقة بالخسارة' : 'Stopped Out' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStatusFilter(item.id)}
                className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer transition-colors ${
                  statusFilter === item.id
                    ? 'bg-[#D4AF37] text-[#070A0F] font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#0D131F] border border-white/10 rounded-xl">
            {(
              [
                { id: 'ALL', label: isAr ? 'كل المصادر' : 'All Sources' },
                { id: 'MANUAL', label: isAr ? 'يدوية' : 'Manual' },
                { id: 'AUTO', label: isAr ? 'تلقائية' : 'Auto' },
              ] as const
            ).map((src) => (
              <button
                key={src.id}
                type="button"
                onClick={() => setSourceFilter(src.id)}
                className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer transition-colors ${
                  sourceFilter === src.id
                    ? 'bg-white/15 text-[#F8FAFC] font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {src.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-500 absolute start-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isAr ? 'ابحث باسم العملة (BTC...)' : 'Search coin (BTC...)'}
            className="w-full min-h-[38px] ps-9 pe-3 rounded-xl bg-[#0D131F] border border-white/10 text-xs text-[#F8FAFC] placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* Signals List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">{t.common.loading}</div>
      ) : filteredSignals.length === 0 ? (
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-10 text-center space-y-3">
          <Activity className="w-8 h-8 text-[#D4AF37] mx-auto" />
          <p className="text-sm text-slate-300">
            {isAr ? 'لا توجد إشارات مطابقة للتصفية الحالية.' : 'No signals match the selected filter.'}
          </p>
          <p className="text-xs text-slate-500">
            {isAr
              ? 'لا يتم عرض أي صفقات أو نسب نجاح وهمية. تنشر الإشارات هنا يدوياً من الإدارة أو تلقائياً من ماسح الفرص الحية.'
              : 'MourTrading never fabricates signals or historical win rates. Signals appear once published manually or by the live scanner.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {filteredSignals.map((sig) => {
            const livePrice = tickerMap.get(sig.symbol)?.lastPrice ?? sig.livePrice ?? null;
            const statusMeta = getStatusMeta(sig.status);
            const direction = sig.direction === 'SHORT' || sig.stopLoss > sig.entryHigh ? 'SHORT' : 'LONG';
            const refEntry = sig.entryReferencePrice || (sig.entryLow + sig.entryHigh) / 2;
            const livePnl =
              typeof sig.actualResultPercent === 'number'
                ? sig.actualResultPercent
                : livePrice && livePrice > 0
                  ? computeSignalResultPercent(direction, refEntry, livePrice)
                  : null;
            const isAuto = sig.source === 'AUTO' || sig.source === 'AI';
            const singleEntry = Math.abs(sig.entryHigh - sig.entryLow) < 1e-12;

            return (
              <div
                key={sig.id}
                className={`bg-[#0D131F] border rounded-2xl p-5 space-y-4 transition-colors ${
                  sig.status === 'STOP_LOSS_HIT'
                    ? 'border-[#EF4444]/35'
                    : isSignalProfitTargetHit(sig.status)
                      ? 'border-[#10B981]/35'
                      : 'border-white/10'
                }`}
              >
                {/* Card Header */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-semibold ${
                          isAuto
                            ? 'bg-sky-500/12 border-sky-400/30 text-sky-300'
                            : 'bg-[#D4AF37]/12 border-[#D4AF37]/30 text-[#E5C158]'
                        }`}
                      >
                        {isAuto ? <Bot className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                        <span>{isAuto ? (isAr ? 'تلقائية' : 'Auto') : isAr ? 'يدوية' : 'Manual'}</span>
                      </span>

                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-semibold ${
                          direction === 'SHORT'
                            ? 'bg-[#EF4444]/10 border-[#EF4444]/30 text-[#EF4444]'
                            : 'bg-[#10B981]/10 border-[#10B981]/30 text-[#10B981]'
                        }`}
                      >
                        {direction === 'SHORT' ? (
                          <TrendingDown className="w-3 h-3" />
                        ) : (
                          <TrendingUp className="w-3 h-3" />
                        )}
                        <span>{getTradeTypeLabel(sig.tradeType, direction)}</span>
                      </span>

                      <span className="font-mono-num uppercase text-slate-400 px-1.5 py-0.5 rounded bg-white/5">
                        {sig.timeframe}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 mt-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/coin/${sig.symbol}`)}
                        className="text-lg font-bold font-mono-num text-[#F8FAFC] hover:text-[#D4AF37] cursor-pointer"
                      >
                        {sig.symbol}
                      </button>
                      <span className="text-[11px] font-mono-num text-slate-500">
                        {formatTimestamp(sig.createdAt, language)}
                      </span>
                    </div>
                  </div>

                  <div className="text-end space-y-1">
                    <div
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold ${statusMeta.badgeClass}`}
                    >
                      {sig.status === 'STOP_LOSS_HIT' ? (
                        <XCircle className="w-3.5 h-3.5" />
                      ) : isSignalProfitTargetHit(sig.status) ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : null}
                      <span>{statusMeta.label}</span>
                    </div>

                    {livePnl !== null && (
                      <div
                        className={`text-xs font-mono-num font-bold ${
                          livePnl >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'
                        }`}
                      >
                        {formatPercent(livePnl)}{' '}
                        <span className="text-[10px] font-normal text-slate-400">
                          {typeof sig.actualResultPercent === 'number'
                            ? isAr
                              ? '(محقق)'
                              : '(Realized)'
                            : isAr
                              ? '(حي)'
                              : '(Live)'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Levels Grid */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 font-mono-num text-xs">
                  <div className="p-2 rounded-lg bg-[#070A0F] border border-white/6">
                    <div className="text-slate-500 text-[10px]">{isAr ? 'الدخول' : 'Entry'}</div>
                    <div className="text-slate-200 font-semibold mt-0.5">
                      {singleEntry
                        ? formatPrice(sig.entryLow)
                        : `${formatPrice(sig.entryLow)}–${formatPrice(sig.entryHigh)}`}
                    </div>
                  </div>

                  <div
                    className={`p-2 rounded-lg bg-[#070A0F] border ${
                      sig.status === 'TP1_HIT' || sig.status === 'TP2_HIT' || sig.status === 'TP3_HIT'
                        ? 'border-[#10B981]/50 bg-[#10B981]/8'
                        : 'border-white/6'
                    }`}
                  >
                    <div className="text-slate-500 text-[10px]">TP1</div>
                    <div className="text-[#10B981] font-semibold mt-0.5">{formatPrice(sig.tp1)}</div>
                  </div>

                  <div
                    className={`p-2 rounded-lg bg-[#070A0F] border ${
                      sig.status === 'TP2_HIT' || sig.status === 'TP3_HIT'
                        ? 'border-[#10B981]/50 bg-[#10B981]/8'
                        : 'border-white/6'
                    }`}
                  >
                    <div className="text-slate-500 text-[10px]">TP2</div>
                    <div className="text-[#10B981] font-semibold mt-0.5">{formatPrice(sig.tp2)}</div>
                  </div>

                  <div
                    className={`p-2 rounded-lg bg-[#070A0F] border ${
                      sig.status === 'TP3_HIT'
                        ? 'border-[#10B981]/50 bg-[#10B981]/8'
                        : 'border-white/6'
                    }`}
                  >
                    <div className="text-slate-500 text-[10px]">TP3</div>
                    <div className="text-[#10B981] font-semibold mt-0.5">{formatPrice(sig.tp3)}</div>
                  </div>

                  <div
                    className={`p-2 rounded-lg bg-[#070A0F] border ${
                      sig.status === 'STOP_LOSS_HIT'
                        ? 'border-[#EF4444]/55 bg-[#EF4444]/10'
                        : 'border-white/6'
                    }`}
                  >
                    <div className="text-slate-500 text-[10px]">{isAr ? 'وقف الخسارة' : 'SL'}</div>
                    <div className="text-[#EF4444] font-semibold mt-0.5">
                      {formatPrice(sig.stopLoss)}
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-[#070A0F] border border-white/6">
                    <div className="text-slate-500 text-[10px]">
                      {sig.closePrice && isSignalMonitoringTerminal(sig.status)
                        ? isAr
                          ? 'سعر الإغلاق'
                          : 'Close'
                        : isAr
                          ? 'السعر الحي'
                          : 'Live'}
                    </div>
                    <div className="text-[#E5C158] font-semibold mt-0.5">
                      {sig.closePrice && isSignalMonitoringTerminal(sig.status)
                        ? formatPrice(sig.closePrice)
                        : livePrice
                          ? formatPrice(livePrice)
                          : '—'}
                    </div>
                  </div>
                </div>

                {sig.explanation && (
                  <p className="text-xs text-slate-300 leading-relaxed">{sig.explanation}</p>
                )}

                {sig.ambiguityNote && (
                  <div className="p-2.5 rounded-lg bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[11px] text-[#E5C158] flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{sig.ambiguityNote}</span>
                  </div>
                )}

                <div className="text-[11px] font-mono-num text-slate-400 flex flex-wrap items-center justify-between gap-2 border-t border-white/6 pt-2">
                  <span>R:R 1 : {sig.riskRewardRatio}</span>
                  <span>
                    {sig.closedAt
                      ? `${isAr ? 'أُغلقت:' : 'Closed:'} ${formatTimestamp(sig.closedAt, language)}`
                      : `${isAr ? 'آخر تحديث:' : 'Updated:'} ${formatTimestamp(sig.updatedAt, language)}`}
                  </span>
                </div>

                {/* Admin Only Row Controls (Edit, Close TP, Close SL, Close, Delete) */}
                {hasAdminMetadata && (
                  <AdminSignalRowActions
                    signal={sig}
                    livePrice={livePrice}
                    onEdit={() => setEditingSignal(sig)}
                    onUpdated={handleSignalUpdated}
                    onDeleted={handleSignalDeleted}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Execution History Log */}
      {events.length > 0 && (
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-[#F8FAFC]">
            {isAr ? 'سجل أحداث وتنفيذ الإشارات' : 'Signal Execution History'}
          </h2>
          <div className="divide-y divide-white/6 text-xs font-mono-num">
            {events.slice(0, 15).map((ev) => {
              const evColor =
                ev.eventType === 'STOP_LOSS_HIT'
                  ? 'text-[#EF4444]'
                  : ev.eventType === 'TP1_HIT' || ev.eventType === 'TP2_HIT' || ev.eventType === 'TP3_HIT'
                    ? 'text-[#10B981]'
                    : ev.eventType === 'CANCELLED'
                      ? 'text-slate-400'
                      : 'text-[#E5C158]';
              return (
                <div key={ev.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-[#F8FAFC]">{ev.symbol}</span>
                  <span className={evColor}>{ev.eventType}</span>
                  <span className="text-slate-300">${formatPrice(ev.triggerPrice)}</span>
                  <span className={ev.resultPercent >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}>
                    {formatPercent(ev.resultPercent)}
                  </span>
                  <span className="text-slate-500">{formatTimestamp(ev.occurredAt, language)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Admin Edit Modal */}
      {hasAdminMetadata && (
        <SignalEditModal
          signal={editingSignal}
          onClose={() => setEditingSignal(null)}
          onSaved={handleSignalUpdated}
        />
      )}
    </div>
  );
}

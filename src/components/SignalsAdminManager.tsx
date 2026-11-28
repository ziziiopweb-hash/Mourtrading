import React, { useEffect, useMemo, useState } from 'react';
import { useUser } from '@clerk/react';
import {
  Bot,
  CheckCircle2,
  Edit3,
  PlusCircle,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { roundSignalPrice } from '../lib/autoSignalScanner.ts';
import { formatPrice, formatTimestamp } from '../lib/formatters.ts';
import {
  fetchAutoSignalsConfig,
  normalizeSymbolInput,
  publishManualSignal,
  runAutoSignalsScanNow,
  saveAutoSignalsConfig,
  updateSignalById,
  type SignalWithLive,
} from '../lib/signalsService.ts';
import type {
  AutoSignalsConfig,
  SignalDirection,
  SignalStatus,
  SignalTradeType,
  Timeframe,
} from '../types/trading.ts';

interface SignalsAdminManagerProps {
  onSignalCreated: (sig: SignalWithLive) => void;
  onAutoScanCompleted: (created: SignalWithLive[], config: AutoSignalsConfig) => void;
}

export function SignalsAdminManager({
  onSignalCreated,
  onAutoScanCompleted,
}: SignalsAdminManagerProps) {
  const { isAdmin, language, tickers, tickerMap, user } = useApp();
  const { user: clerkUser } = useUser();
  const isAr = language === 'ar';

  const hasAdminMetadata = Boolean(isAdmin && clerkUser?.publicMetadata?.role === 'admin');
  const [activeTab, setActiveTab] = useState<'MANUAL' | 'AUTO'>('MANUAL');

  // Manual trade form state
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [tradeType, setTradeType] = useState<SignalTradeType>('SPOT_BUY');
  const [direction, setDirection] = useState<SignalDirection>('LONG');
  const [timeframe, setTimeframe] = useState<Timeframe>('4h');
  const [entryLow, setEntryLow] = useState('');
  const [entryHigh, setEntryHigh] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [tp1, setTp1] = useState('');
  const [tp2, setTp2] = useState('');
  const [tp3, setTp3] = useState('');
  const [explanation, setExplanation] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Auto signals config state
  const [autoConfig, setAutoConfig] = useState<AutoSignalsConfig>({
    enabled: false,
    timeframe: '1h',
    cooldownMinutes: 120,
    maxActiveSignals: 6,
    minQuoteVolumeUsdt: 10_000_000,
    lastScanAt: null,
    lastScanSummary: '',
    updatedAt: new Date().toISOString(),
  });
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoScanning, setAutoScanning] = useState(false);
  const [autoMessage, setAutoMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!hasAdminMetadata) return;
    fetchAutoSignalsConfig()
      .then(setAutoConfig)
      .catch(() => {});
  }, [hasAdminMetadata]);

  const normalizedSym = normalizeSymbolInput(symbol);
  const liveTicker = tickerMap.get(normalizedSym);
  const currentMarketPrice = liveTicker?.lastPrice ?? null;

  const previewStats = useMemo(() => {
    const low = Number(entryLow);
    const high = Number(entryHigh || entryLow);
    const sl = Number(stopLoss);
    const t1 = Number(tp1);
    if (!Number.isFinite(low) || low <= 0 || !Number.isFinite(sl) || sl <= 0 || !Number.isFinite(t1) || t1 <= 0) {
      return null;
    }
    const mid = (low + high) / 2;
    const risk = direction === 'SHORT' ? sl - mid : mid - sl;
    const reward1 = direction === 'SHORT' ? mid - t1 : t1 - mid;
    if (risk <= 0 || reward1 <= 0) return null;
    const rr1 = Number((reward1 / risk).toFixed(2));
    const slPct = Number(((risk / mid) * 100).toFixed(2));
    const tp1Pct = Number(((reward1 / mid) * 100).toFixed(2));
    return { rr1, slPct, tp1Pct };
  }, [entryLow, entryHigh, stopLoss, tp1, direction]);

  if (!hasAdminMetadata) {
    return null;
  }

  const handleSuggestLevels = () => {
    if (!currentMarketPrice || currentMarketPrice <= 0) {
      setFormError(isAr ? 'السعر الحي غير متاح لهذا الزوج حالياً.' : 'Live price unavailable for this pair.');
      return;
    }
    setFormError(null);
    if (direction === 'SHORT') {
      const eLow = roundSignalPrice(currentMarketPrice * 0.998);
      const eHigh = roundSignalPrice(currentMarketPrice * 1.002);
      const sl = roundSignalPrice(currentMarketPrice * 1.028);
      const p1 = roundSignalPrice(currentMarketPrice * 0.972);
      const p2 = roundSignalPrice(currentMarketPrice * 0.945);
      const p3 = roundSignalPrice(currentMarketPrice * 0.915);
      setEntryLow(String(eLow));
      setEntryHigh(String(eHigh));
      setStopLoss(String(sl));
      setTp1(String(p1));
      setTp2(String(p2));
      setTp3(String(p3));
    } else {
      const eLow = roundSignalPrice(currentMarketPrice * 0.996);
      const eHigh = roundSignalPrice(currentMarketPrice * 1.002);
      const sl = roundSignalPrice(currentMarketPrice * 0.972);
      const p1 = roundSignalPrice(currentMarketPrice * 1.028);
      const p2 = roundSignalPrice(currentMarketPrice * 1.056);
      const p3 = roundSignalPrice(currentMarketPrice * 1.09);
      setEntryLow(String(eLow));
      setEntryHigh(String(eHigh));
      setStopLoss(String(sl));
      setTp1(String(p1));
      setTp2(String(p2));
      setTp3(String(p3));
    }
  };

  const handlePublishManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setPublishing(true);
    try {
      const created = await publishManualSignal(
        {
          symbol: normalizedSym,
          tradeType,
          direction,
          timeframe,
          entryLow: Number(entryLow),
          entryHigh: entryHigh ? Number(entryHigh) : undefined,
          stopLoss: Number(stopLoss),
          tp1: Number(tp1),
          tp2: tp2 ? Number(tp2) : undefined,
          tp3: tp3 ? Number(tp3) : undefined,
          explanation,
          source: 'ADMIN',
        },
        currentMarketPrice,
        user?.uid || 'admin',
      );
      onSignalCreated(created);
      setEntryLow('');
      setEntryHigh('');
      setStopLoss('');
      setTp1('');
      setTp2('');
      setTp3('');
      setExplanation('');
      setFormSuccess(
        isAr
          ? `تم نشر إشارة ${created.symbol} وحفظها بنجاح في خانة الإشارات.`
          : `${created.symbol} signal published and saved.`,
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to publish signal');
    } finally {
      setPublishing(false);
    }
  };

  const handleToggleAuto = async (nextEnabled: boolean) => {
    setAutoSaving(true);
    setAutoMessage(null);
    try {
      const updated = await saveAutoSignalsConfig({
        enabled: nextEnabled,
        timeframe: autoConfig.timeframe,
        cooldownMinutes: autoConfig.cooldownMinutes,
        maxActiveSignals: autoConfig.maxActiveSignals,
      });
      setAutoConfig(updated);
      setAutoMessage(
        nextEnabled
          ? isAr
            ? 'تم تفعيل نظام النشر التلقائي للفرص.'
            : 'Auto Signals engine enabled.'
          : isAr
            ? 'تم إيقاف النشر التلقائي للفرص.'
            : 'Auto Signals engine paused.',
      );
    } catch (err) {
      setAutoMessage(err instanceof Error ? err.message : 'Failed to update auto settings');
    } finally {
      setAutoSaving(false);
    }
  };

  const handleSaveAutoConfig = async () => {
    setAutoSaving(true);
    setAutoMessage(null);
    try {
      const updated = await saveAutoSignalsConfig({
        enabled: autoConfig.enabled,
        timeframe: autoConfig.timeframe,
        cooldownMinutes: autoConfig.cooldownMinutes,
        maxActiveSignals: autoConfig.maxActiveSignals,
        minQuoteVolumeUsdt: autoConfig.minQuoteVolumeUsdt,
      });
      setAutoConfig(updated);
      setAutoMessage(isAr ? 'تم حفظ إعدادات النشر التلقائي.' : 'Auto signal settings saved.');
    } catch (err) {
      setAutoMessage(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setAutoSaving(false);
    }
  };

  const handleScanNow = async () => {
    setAutoScanning(true);
    setAutoMessage(null);
    try {
      const res = await runAutoSignalsScanNow(tickers);
      setAutoConfig(res.config);
      onAutoScanCompleted(res.created, res.config);
      setAutoMessage(
        isAr
          ? `تم فحص ${res.scannedCount} عملة حية — تم نشر ${res.created.length} إشارة تلقائية جديدة (تخطي ${res.skippedCooldown} لعدم التكرار).`
          : `Scanned ${res.scannedCount} pairs — published ${res.created.length} auto signal(s) (${res.skippedCooldown} skipped on cooldown).`,
      );
    } catch (err) {
      setAutoMessage(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setAutoScanning(false);
    }
  };

  const quickCoins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT'];

  return (
    <div className="bg-[#0D131F] border border-[#D4AF37]/30 rounded-2xl p-5 space-y-4 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-3">
        <div>
          <h2 className="text-base font-bold text-[#F8FAFC] flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#D4AF37]" />
            <span>{isAr ? 'لوحة إدارة الصفقات (المسؤول)' : 'Admin Signals Control Center'}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {isAr
              ? 'إضافة صفقات يدوية أو تشغيل نظام النشر التلقائي للفرص الفنية وربطها مباشرة بخانة الإشارات'
              : 'Publish manual trades or configure live technical Auto Signals directly to the Signals feed'}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#070A0F] border border-white/10 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('MANUAL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
              activeTab === 'MANUAL'
                ? 'bg-[#D4AF37] text-[#070A0F]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>{isAr ? 'إضافة صفقة يدوية' : 'Manual Trade'}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('AUTO')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
              activeTab === 'AUTO'
                ? 'bg-[#D4AF37] text-[#070A0F]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>{isAr ? 'النشر التلقائي (Auto)' : 'Auto Signals'}</span>
            <span
              className={`w-2 h-2 rounded-full ${
                autoConfig.enabled ? 'bg-[#10B981]' : 'bg-slate-500'
              }`}
            />
          </button>
        </div>
      </div>

      {activeTab === 'MANUAL' ? (
        <form onSubmit={handlePublishManual} className="space-y-4">
          {/* Quick coin picks + live market price */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {quickCoins.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSymbol(c)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono-num border cursor-pointer ${
                    normalizedSym === c
                      ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-[#E5C158] font-bold'
                      : 'border-white/10 bg-[#070A0F] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {c.replace('USDT', '')}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs">
              {currentMarketPrice ? (
                <span className="font-mono-num text-[#E5C158]">
                  {isAr ? 'السعر الحي:' : 'Live:'} ${formatPrice(currentMarketPrice)}
                </span>
              ) : null}
              <button
                type="button"
                onClick={handleSuggestLevels}
                className="px-2.5 py-1 rounded-lg border border-[#D4AF37]/35 bg-[#D4AF37]/10 text-[#E5C158] text-[11px] font-semibold hover:bg-[#D4AF37]/20 cursor-pointer"
              >
                {isAr ? 'تعبئة مستويات مقترحة من السعر الحي' : 'Auto-fill from live price'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'العملة / الزوج *' : 'Pair / Symbol *'}
              </label>
              <input
                type="text"
                required
                dir="ltr"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="BTCUSDT"
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'اتجاه ونوع الصفقة' : 'Direction & Trade Type'}
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as SignalDirection)}
                  className="min-h-[40px] px-2 rounded-lg bg-[#070A0F] border border-white/12 text-xs text-[#F8FAFC]"
                >
                  <option value="LONG">{isAr ? 'شراء (Spot/Long)' : 'Buy / Long'}</option>
                  <option value="SHORT">{isAr ? 'بيع (Short)' : 'Sell / Short'}</option>
                </select>
                <select
                  value={tradeType}
                  onChange={(e) => setTradeType(e.target.value as SignalTradeType)}
                  className="min-h-[40px] px-2 rounded-lg bg-[#070A0F] border border-white/12 text-xs text-[#F8FAFC]"
                >
                  <option value="SPOT_BUY">{isAr ? 'فورية (Spot)' : 'Spot Buy'}</option>
                  <option value="SPOT_SCALP">{isAr ? 'مضاربة سريعة' : 'Scalp'}</option>
                  <option value="SPOT_SWING">{isAr ? 'سوينج' : 'Swing'}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'الإطار الزمني' : 'Timeframe'}
              </label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                dir="ltr"
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
              >
                {(['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const).map((tf) => (
                  <option key={tf} value={tf}>
                    {tf.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'وقف الخسارة (Stop Loss) *' : 'Stop Loss *'}
              </label>
              <input
                type="number"
                step="any"
                required
                dir="ltr"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder={isAr ? 'سعر وقف الخسارة' : 'Stop Loss price'}
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-[#EF4444]/35 text-xs font-mono-num text-[#F8FAFC]"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'سعر / بداية الدخول *' : 'Entry Price / Low *'}
              </label>
              <input
                type="number"
                step="any"
                required
                dir="ltr"
                value={entryLow}
                onChange={(e) => setEntryLow(e.target.value)}
                placeholder={isAr ? 'مثال: 94500' : 'Entry Low'}
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'نهاية منطقة الدخول (اختياري)' : 'Entry High (Optional)'}
              </label>
              <input
                type="number"
                step="any"
                dir="ltr"
                value={entryHigh}
                onChange={(e) => setEntryHigh(e.target.value)}
                placeholder={isAr ? 'يُترك فارغاً لسعر دخول واحد' : 'Blank for single price'}
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'الهدف الأول TP1 *' : 'Take Profit 1 *'}
              </label>
              <input
                type="number"
                step="any"
                required
                dir="ltr"
                value={tp1}
                onChange={(e) => setTp1(e.target.value)}
                placeholder="TP1"
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-[#10B981]/35 text-xs font-mono-num text-[#F8FAFC]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">TP2</label>
                <input
                  type="number"
                  step="any"
                  dir="ltr"
                  value={tp2}
                  onChange={(e) => setTp2(e.target.value)}
                  placeholder={isAr ? 'تلقائي' : 'Auto'}
                  className="w-full min-h-[40px] px-2.5 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">TP3</label>
                <input
                  type="number"
                  step="any"
                  dir="ltr"
                  value={tp3}
                  onChange={(e) => setTp3(e.target.value)}
                  placeholder={isAr ? 'تلقائي' : 'Auto'}
                  className="w-full min-h-[40px] px-2.5 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              {isAr ? 'ملاحظة قصيرة أو شرح فني (اختياري)' : 'Short Note / Technical Rationale (Optional)'}
            </label>
            <input
              type="text"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder={
                isAr
                  ? 'مثال: ارتداد من منطقة دعم قوية على فريم 4 ساعات مع تحسن الزخم...'
                  : 'e.g. Bounce from 4H support zone with rising volume...'
              }
              className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs text-[#F8FAFC]"
            />
          </div>

          {previewStats && (
            <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono-num px-3 py-2 rounded-lg bg-[#070A0F] border border-white/8 text-slate-300">
              <span>
                R:R (TP1) = <strong className="text-[#E5C158]">1 : {previewStats.rr1}</strong>
              </span>
              <span className="text-[#10B981]">TP1: +{previewStats.tp1Pct}%</span>
              <span className="text-[#EF4444]">SL: -{previewStats.slPct}%</span>
            </div>
          )}

          {formError && (
            <div className="text-xs text-[#EF4444] bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg px-3 py-2">
              {formError}
            </div>
          )}
          {formSuccess && (
            <div className="text-xs text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/30 rounded-lg px-3 py-2 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{formSuccess}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={publishing}
            className="min-h-[42px] px-6 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-50 text-[#070A0F] text-xs font-bold flex items-center gap-2 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>
              {publishing
                ? isAr
                  ? 'جاري النشر...'
                  : 'Publishing...'
                : isAr
                  ? 'نشر الإشارة الآن'
                  : 'Publish Signal Now'}
            </span>
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-[#070A0F] border border-white/10">
            <div>
              <div className="text-xs font-bold text-[#F8FAFC] flex items-center gap-2">
                <span>
                  {isAr ? 'حالة النشر التلقائي للفرص الفنية:' : 'Auto Signals Engine Status:'}
                </span>
                <span className={autoConfig.enabled ? 'text-[#10B981]' : 'text-slate-400'}>
                  {autoConfig.enabled
                    ? isAr
                      ? 'مفعّل (تلقائي)'
                      : 'ACTIVE'
                    : isAr
                      ? 'متوقف'
                      : 'PAUSED'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {isAr
                  ? 'يفحص أزواج Binance الحية والمؤشرات الفنية (دعم/مقاومة، RSI، EMA، MACD) وينشر الفرص المؤكدة مع منع تكرار نفس العملة.'
                  : 'Scans liquid Binance Spot pairs using live candles & indicators (Support bounce, EMA, RSI, MACD) with duplicate cooldown.'}
              </p>
            </div>

            <button
              type="button"
              disabled={autoSaving}
              onClick={() => handleToggleAuto(!autoConfig.enabled)}
              className={`min-h-[38px] px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                autoConfig.enabled
                  ? 'bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/40 hover:bg-[#EF4444]/25'
                  : 'bg-[#10B981] text-[#070A0F] hover:bg-[#34D399]'
              }`}
            >
              {autoConfig.enabled
                ? isAr
                  ? 'إيقاف النشر التلقائي'
                  : 'Pause Auto Signals'
                : isAr
                  ? 'تشغيل النشر التلقائي'
                  : 'Enable Auto Signals'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'الإطار الزمني للفحص' : 'Scan Timeframe'}
              </label>
              <select
                value={autoConfig.timeframe}
                onChange={(e) =>
                  setAutoConfig((c) => ({ ...c, timeframe: e.target.value as Timeframe }))
                }
                dir="ltr"
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
              >
                {(['15m', '1h', '4h', '1d'] as const).map((tf) => (
                  <option key={tf} value={tf}>
                    {tf.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'فترة منع التكرار للعملة (دقيقة)' : 'Per-Coin Cooldown (Minutes)'}
              </label>
              <select
                value={autoConfig.cooldownMinutes}
                onChange={(e) =>
                  setAutoConfig((c) => ({ ...c, cooldownMinutes: Number(e.target.value) }))
                }
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
              >
                <option value={60}>{isAr ? '60 دقيقة (ساعة)' : '60 mins'}</option>
                <option value={120}>{isAr ? '120 دقيقة (ساعتان)' : '120 mins'}</option>
                <option value={240}>{isAr ? '240 دقيقة (4 ساعات)' : '240 mins'}</option>
                <option value={480}>{isAr ? '480 دقيقة (8 ساعات)' : '480 mins'}</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'الحد الأقصى للإشارات التلقائية النشطة' : 'Max Active Auto Signals'}
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={autoConfig.maxActiveSignals}
                onChange={(e) =>
                  setAutoConfig((c) => ({
                    ...c,
                    maxActiveSignals: Math.max(1, Math.min(20, Number(e.target.value) || 6)),
                  }))
                }
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={autoSaving}
              onClick={handleSaveAutoConfig}
              className="min-h-[38px] px-4 py-2 rounded-xl border border-white/15 bg-[#070A0F] hover:border-[#D4AF37]/40 text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>{isAr ? 'حفظ الإعدادات' : 'Save Config'}</span>
            </button>

            <button
              type="button"
              disabled={autoScanning}
              onClick={handleScanNow}
              className="min-h-[38px] px-4 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-50 text-[#070A0F] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${autoScanning ? 'animate-spin' : ''}`} />
              <span>
                {autoScanning
                  ? isAr
                    ? 'جاري فحص السوق الحي...'
                    : 'Scanning live markets...'
                  : isAr
                    ? 'فحص الأسواق ونشر الفرص الآن'
                    : 'Scan Live Markets Now'}
              </span>
            </button>

            {autoConfig.lastScanAt && (
              <span className="text-[11px] text-slate-400 font-mono-num">
                {isAr ? 'آخر فحص:' : 'Last scan:'} {formatTimestamp(autoConfig.lastScanAt, language)}
              </span>
            )}
          </div>

          {(autoMessage || autoConfig.lastScanSummary) && (
            <div className="text-xs text-[#E5C158] bg-[#D4AF37]/10 border border-[#D4AF37]/25 rounded-lg px-3 py-2">
              {autoMessage || autoConfig.lastScanSummary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SignalEditModal({
  signal,
  onClose,
  onSaved,
}: {
  signal: SignalWithLive | null;
  onClose: () => void;
  onSaved: (updated: SignalWithLive) => void;
}) {
  const { isAdmin, language } = useApp();
  const { user: clerkUser } = useUser();
  const isAr = language === 'ar';
  const hasAdminMetadata = Boolean(isAdmin && clerkUser?.publicMetadata?.role === 'admin');

  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState<SignalDirection>('LONG');
  const [tradeType, setTradeType] = useState<SignalTradeType>('SPOT_BUY');
  const [timeframe, setTimeframe] = useState<Timeframe>('4h');
  const [status, setStatus] = useState<SignalStatus>('ACTIVE');
  const [entryLow, setEntryLow] = useState('');
  const [entryHigh, setEntryHigh] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [tp1, setTp1] = useState('');
  const [tp2, setTp2] = useState('');
  const [tp3, setTp3] = useState('');
  const [explanation, setExplanation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signal) return;
    setSymbol(signal.symbol);
    setDirection(signal.direction || (signal.stopLoss > signal.entryHigh ? 'SHORT' : 'LONG'));
    setTradeType(signal.tradeType || 'SPOT_BUY');
    setTimeframe(signal.timeframe);
    setStatus(signal.status);
    setEntryLow(String(signal.entryLow));
    setEntryHigh(String(signal.entryHigh));
    setStopLoss(String(signal.stopLoss));
    setTp1(String(signal.tp1));
    setTp2(String(signal.tp2));
    setTp3(String(signal.tp3));
    setExplanation(signal.explanation || '');
    setError(null);
  }, [signal]);

  if (!signal || !hasAdminMetadata) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSignalById(signal.id, {
        symbol: normalizeSymbolInput(symbol),
        direction,
        tradeType,
        timeframe,
        status,
        entryLow: Number(entryLow),
        entryHigh: Number(entryHigh || entryLow),
        stopLoss: Number(stopLoss),
        tp1: Number(tp1),
        tp2: Number(tp2),
        tp3: Number(tp3),
        explanation,
      });
      if (updated) onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#0D131F] border border-white/15 rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h3 className="text-base font-bold text-[#F8FAFC] flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-[#D4AF37]" />
            <span>
              {isAr ? `تعديل الإشارة · ${signal.symbol}` : `Edit Signal · ${signal.symbol}`}
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Symbol</label>
              <input
                type="text"
                required
                dir="ltr"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                className="w-full min-h-[38px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'الاتجاه' : 'Direction'}
              </label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as SignalDirection)}
                className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#070A0F] border border-white/12 text-xs text-[#F8FAFC]"
              >
                <option value="LONG">{isAr ? 'شراء (LONG)' : 'LONG'}</option>
                <option value="SHORT">{isAr ? 'بيع (SHORT)' : 'SHORT'}</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'الإطار' : 'Timeframe'}
              </label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                dir="ltr"
                className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
              >
                {(['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const).map((tf) => (
                  <option key={tf} value={tf}>
                    {tf.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'الحالة' : 'Status'}
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SignalStatus)}
                className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#070A0F] border border-white/12 text-xs text-[#F8FAFC]"
              >
                <option value="ACTIVE">{isAr ? 'نشطة' : 'ACTIVE'}</option>
                <option value="TP1_HIT">{isAr ? 'محققة للهدف 1' : 'TP1_HIT'}</option>
                <option value="TP2_HIT">{isAr ? 'محققة للهدف 2' : 'TP2_HIT'}</option>
                <option value="TP3_HIT">{isAr ? 'محققة للهدف 3 (مكتملة)' : 'TP3_HIT'}</option>
                <option value="STOP_LOSS_HIT">{isAr ? 'مغلقة بالخسارة' : 'STOP_LOSS_HIT'}</option>
                <option value="CANCELLED">{isAr ? 'مغلقة / ملغاة' : 'CANCELLED'}</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Entry Low</label>
              <input
                type="number"
                step="any"
                required
                dir="ltr"
                value={entryLow}
                onChange={(e) => setEntryLow(e.target.value)}
                className="w-full min-h-[38px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Entry High</label>
              <input
                type="number"
                step="any"
                required
                dir="ltr"
                value={entryHigh}
                onChange={(e) => setEntryHigh(e.target.value)}
                className="w-full min-h-[38px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Stop Loss</label>
              <input
                type="number"
                step="any"
                required
                dir="ltr"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                className="w-full min-h-[38px] px-3 rounded-lg bg-[#070A0F] border border-[#EF4444]/35 text-xs font-mono-num text-[#F8FAFC]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">TP1</label>
              <input
                type="number"
                step="any"
                required
                dir="ltr"
                value={tp1}
                onChange={(e) => setTp1(e.target.value)}
                className="w-full min-h-[38px] px-3 rounded-lg bg-[#070A0F] border border-[#10B981]/35 text-xs font-mono-num text-[#F8FAFC]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">TP2</label>
              <input
                type="number"
                step="any"
                required
                dir="ltr"
                value={tp2}
                onChange={(e) => setTp2(e.target.value)}
                className="w-full min-h-[38px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">TP3</label>
              <input
                type="number"
                step="any"
                required
                dir="ltr"
                value={tp3}
                onChange={(e) => setTp3(e.target.value)}
                className="w-full min-h-[38px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs font-mono-num text-[#F8FAFC]"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] text-slate-400 mb-1">
                {isAr ? 'نوع الصفقة' : 'Trade Type'}
              </label>
              <select
                value={tradeType}
                onChange={(e) => setTradeType(e.target.value as SignalTradeType)}
                className="w-full min-h-[38px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-xs text-[#F8FAFC]"
              >
                <option value="SPOT_BUY">{isAr ? 'فورية (Spot Buy)' : 'Spot Buy'}</option>
                <option value="SPOT_SCALP">{isAr ? 'مضاربة سريعة (Scalp)' : 'Scalp'}</option>
                <option value="SPOT_SWING">{isAr ? 'سوينج (Swing)' : 'Swing'}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              {isAr ? 'الملاحظة / الشرح' : 'Note / Explanation'}
            </label>
            <textarea
              rows={2}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              className="w-full p-2.5 rounded-lg bg-[#070A0F] border border-white/12 text-xs text-[#F8FAFC]"
            />
          </div>

          {error && <div className="text-xs text-[#EF4444]">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-white/12 text-xs text-slate-300 cursor-pointer"
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-50 text-[#070A0F] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? (isAr ? 'جاري الحفظ...' : 'Saving...') : isAr ? 'حفظ التعديلات' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AdminSignalRowActions({
  signal,
  livePrice,
  onEdit,
  onUpdated,
  onDeleted,
}: {
  signal: SignalWithLive;
  livePrice: number | null;
  onEdit: () => void;
  onUpdated: (sig: SignalWithLive) => void;
  onDeleted: (id: string) => void;
}) {
  const { isAdmin, language } = useApp();
  const { user: clerkUser } = useUser();
  const isAr = language === 'ar';
  const hasAdminMetadata = Boolean(isAdmin && clerkUser?.publicMetadata?.role === 'admin');

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!hasAdminMetadata) return null;

  const handleStatusChange = async (nextStatus: SignalStatus) => {
    setBusy(true);
    try {
      const { updateSignalStatusById } = await import('../lib/signalsService.ts');
      const updated = await updateSignalStatusById(signal.id, nextStatus, livePrice);
      if (updated) onUpdated(updated);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      const { deleteSignalById } = await import('../lib/signalsService.ts');
      await deleteSignalById(signal.id);
      onDeleted(signal.id);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const isClosed =
    signal.status === 'STOP_LOSS_HIT' ||
    signal.status === 'TP3_HIT' ||
    signal.status === 'CANCELLED';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-white/8">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className="px-2.5 py-1 rounded-lg bg-white/8 hover:bg-white/15 text-[11px] font-medium text-slate-200 flex items-center gap-1 cursor-pointer"
        >
          <Edit3 className="w-3 h-3 text-[#D4AF37]" />
          <span>{isAr ? 'تعديل' : 'Edit'}</span>
        </button>

        {!isClosed && (
          <>
            <button
              type="button"
              onClick={() => handleStatusChange('TP1_HIT')}
              disabled={busy || signal.status === 'TP1_HIT'}
              className="px-2.5 py-1 rounded-lg bg-[#10B981]/15 hover:bg-[#10B981]/25 disabled:opacity-40 text-[11px] font-medium text-[#10B981] cursor-pointer"
            >
              {isAr ? 'إغلاق بربح (TP)' : 'Close TP'}
            </button>
            <button
              type="button"
              onClick={() => handleStatusChange('STOP_LOSS_HIT')}
              disabled={busy}
              className="px-2.5 py-1 rounded-lg bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-[11px] font-medium text-[#EF4444] cursor-pointer"
            >
              {isAr ? 'إغلاق بخسارة (SL)' : 'Close SL'}
            </button>
            <button
              type="button"
              onClick={() => handleStatusChange('CANCELLED')}
              disabled={busy}
              className="px-2.5 py-1 rounded-lg bg-white/8 hover:bg-white/15 text-[11px] font-medium text-slate-300 cursor-pointer"
            >
              {isAr ? 'إغلاق' : 'Close'}
            </button>
          </>
        )}

        {isClosed && (
          <button
            type="button"
            onClick={() => handleStatusChange('ACTIVE')}
            disabled={busy}
            className="px-2.5 py-1 rounded-lg bg-[#D4AF37]/15 hover:bg-[#D4AF37]/25 text-[11px] font-medium text-[#E5C158] cursor-pointer"
          >
            {isAr ? 'إعادة فتح' : 'Reopen'}
          </button>
        )}
      </div>

      <div>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            className="px-2.5 py-1 rounded-lg bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[11px] font-medium text-[#EF4444] flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            <span>{isAr ? 'حذف' : 'Delete'}</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="px-2.5 py-1 rounded-lg bg-[#EF4444] text-white text-[11px] font-bold cursor-pointer"
            >
              {isAr ? 'تأكيد الحذف' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="px-2 py-1 rounded-lg bg-white/10 text-slate-300 text-[11px] cursor-pointer"
            >
              {isAr ? 'تراجع' : 'No'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

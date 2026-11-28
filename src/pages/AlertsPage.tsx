import React, { useEffect, useState } from 'react';
import { BellPlus, Trash2 } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiFetch } from '../lib/api.ts';
import { formatPrice, formatTimestamp } from '../lib/formatters.ts';
import { ConfigNotice } from '../components/ConfigNotice.tsx';
import type { PriceAlert } from '../types/trading.ts';

export function AlertsPage() {
  const { language, t, navigate, user, tickers, tickerMap, route, readiness } = useApp();
  const isAr = language === 'ar';

  const initialSymbol = new URLSearchParams(route.split('?')[1] || '').get('symbol')?.toUpperCase() || 'BTCUSDT';

  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [condition, setCondition] = useState<PriceAlert['condition']>('ABOVE');
  const [targetPrice, setTargetPrice] = useState('');
  const [targetPriceUpper, setTargetPriceUpper] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    apiFetch<{ alerts: PriceAlert[] }>('/api/user/alerts')
      .then((res) => setAlerts(res.alerts || []))
      .catch(() => {});
  }, [user]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate('/login');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ alert: PriceAlert }>('/api/user/alerts', {
        method: 'POST',
        body: JSON.stringify({
          symbol: symbol.trim().toUpperCase(),
          condition,
          targetPrice: Number(targetPrice),
          targetPriceUpper: condition === 'ENTRY_ZONE' && targetPriceUpper ? Number(targetPriceUpper) : undefined,
          emailNotify: false,
        }),
      });
      setAlerts((prev) => [res.alert, ...prev]);
      setTargetPrice('');
      setTargetPriceUpper('');
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to create alert');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/user/alerts/${id}`, { method: 'DELETE' });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // ignore
    }
  };

  const livePrice = tickerMap.get(symbol)?.lastPrice;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
          <BellPlus className="w-6 h-6 text-[#D4AF37]" />
          <span>{t.nav.alerts}</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          {isAr
            ? 'مراقبة خادمية مستمرة للأسعار ومناطق الدخول والأهداف ووقف الخسارة بدون تكرار'
            : 'Background server-monitored price, entry zone, TP, and SL alerts with duplicate prevention'}
        </p>
      </div>

      {readiness && !readiness.clerk.configured && (
        <ConfigNotice
          message={
            isAr
              ? 'حفظ ومراقبة تنبيهات الأسعار يتطلب تهيئة مصادقة Clerk.'
              : 'Saving and monitoring price alerts requires Clerk authentication configuration.'
          }
          missingVars={readiness.clerk.missingVars}
        />
      )}

      <form
        onSubmit={handleCreate}
        className="bg-[#0D131F] border border-white/10 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end"
      >
        <div>
          <label className="block text-xs text-slate-300 mb-1">
            {t.markets.pair} {livePrice ? `(Live: $${formatPrice(livePrice)})` : ''}
          </label>
          <input
            type="text"
            dir="ltr"
            list="alert-pairs"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className="w-full min-h-[42px] px-3 rounded-xl bg-[#070A0F] border border-white/12 text-sm font-mono-num text-[#F8FAFC]"
          />
          <datalist id="alert-pairs">
            {tickers.slice(0, 100).map((tk) => (
              <option key={tk.symbol} value={tk.symbol} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="block text-xs text-slate-300 mb-1">{isAr ? 'الشرط' : 'Condition'}</label>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value as PriceAlert['condition'])}
            className="w-full min-h-[42px] px-3 rounded-xl bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC]"
          >
            <option value="ABOVE">{isAr ? 'السعر أعلى من (ABOVE)' : 'Price Above'}</option>
            <option value="BELOW">{isAr ? 'السعر أقل من (BELOW)' : 'Price Below'}</option>
            <option value="ENTRY_ZONE">{isAr ? 'دخول منطقة الدخول (ENTRY ZONE)' : 'Entry Zone'}</option>
            <option value="TP_TARGET">{isAr ? 'وصول هدف جني الأرباح (TP)' : 'TP Target Hit'}</option>
            <option value="SL_TARGET">{isAr ? 'وصول وقف الخسارة (SL)' : 'SL Target Hit'}</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-300 mb-1">
            {condition === 'ENTRY_ZONE'
              ? isAr
                ? 'الحد الأدنى للسعر'
                : 'Lower Bound'
              : isAr
                ? 'السعر المستهدف'
                : 'Target Price'}
          </label>
          <input
            type="number"
            step="any"
            required
            dir="ltr"
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            placeholder={livePrice ? String(livePrice) : '62000'}
            className="w-full min-h-[42px] px-3 rounded-xl bg-[#070A0F] border border-white/12 text-sm font-mono-num text-[#F8FAFC]"
          />
        </div>

        {condition === 'ENTRY_ZONE' ? (
          <div>
            <label className="block text-xs text-slate-300 mb-1">{isAr ? 'الحد الأعلى للسعر' : 'Upper Bound'}</label>
            <input
              type="number"
              step="any"
              required
              dir="ltr"
              value={targetPriceUpper}
              onChange={(e) => setTargetPriceUpper(e.target.value)}
              className="w-full min-h-[42px] px-3 rounded-xl bg-[#070A0F] border border-white/12 text-sm font-mono-num text-[#F8FAFC]"
            />
          </div>
        ) : (
          <div className="text-[11px] text-slate-500 min-h-[42px] flex items-center">
            {isAr ? 'إشعار داخل التطبيق مفعّل تلقائياً' : 'In-app notification enabled'}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="min-h-[42px] px-4 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] text-xs font-bold cursor-pointer"
        >
          {loading ? t.common.loading : user ? (isAr ? 'إنشاء التنبيه' : 'Create Alert') : t.nav.login}
        </button>
      </form>

      {error && (
        <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444]">
          {error}
        </div>
      )}

      <div className="bg-[#0D131F] border border-white/10 rounded-xl divide-y divide-white/8">
        {alerts.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            {isAr ? 'لا توجد تنبيهات أسعار مسجلة حالياً.' : 'No price alerts configured yet.'}
          </div>
        ) : (
          alerts.map((al) => (
            <div key={al.id} className="p-4 flex flex-wrap items-center justify-between gap-3 font-mono-num text-xs">
              <div>
                <div className="text-sm font-bold text-[#F8FAFC]">{al.symbol}</div>
                <div className="text-slate-400 mt-0.5">
                  {al.condition} @ ${formatPrice(al.targetPrice)}
                  {al.targetPriceUpper ? ` – $${formatPrice(al.targetPriceUpper)}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={al.status === 'TRIGGERED' ? 'text-[#10B981] font-bold' : 'text-[#E5C158]'}>
                  {al.status}
                </span>
                <span className="text-slate-500 hidden sm:inline">
                  {formatTimestamp(al.createdAt, language)}
                </span>
                <button
                  onClick={() => handleDelete(al.id)}
                  className="p-1.5 text-slate-500 hover:text-[#EF4444] cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

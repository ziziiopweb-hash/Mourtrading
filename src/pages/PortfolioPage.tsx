import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, Info, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiFetch } from '../lib/api.ts';
import { formatPercent, formatPrice, formatTimestamp, formatUsd } from '../lib/formatters.ts';
import { ConfigNotice } from '../components/ConfigNotice.tsx';
import type { PortfolioHolding, PortfolioTransaction } from '../types/trading.ts';

export function PortfolioPage() {
  const { language, t, navigate, user, tickerMap, tickers, readiness } = useApp();
  const isAr = language === 'ar';

  const [usdtBalance, setUsdtBalance] = useState<number>(0);
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [transactions, setTransactions] = useState<PortfolioTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add holding / tx form
  const [assetInput, setAssetInput] = useState('BTC');
  const [qtyInput, setQtyInput] = useState('');
  const [avgPriceInput, setAvgPriceInput] = useState('');
  const [sideInput, setSideInput] = useState<'BUY' | 'SELL'>('BUY');
  const [noteInput, setNoteInput] = useState('');

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    apiFetch<{
      portfolio: { usdtBalance: number; holdings: PortfolioHolding[] };
      transactions: PortfolioTransaction[];
    }>('/api/user/portfolio')
      .then((res) => {
        setUsdtBalance(res.portfolio?.usdtBalance ?? 0);
        setHoldings(res.portfolio?.holdings ?? []);
        setTransactions(res.transactions ?? []);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load portfolio');
      })
      .finally(() => setLoading(false));
  }, [user]);

  const persistPortfolio = async (nextUsdt: number, nextHoldings: PortfolioHolding[]) => {
    if (!user) {
      navigate('/login');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/api/user/portfolio', {
        method: 'PUT',
        body: JSON.stringify({
          usdtBalance: nextUsdt,
          holdings: nextHoldings.map((h) => ({
            symbol: h.symbol,
            quantity: h.quantity,
            avgBuyPrice: h.avgBuyPrice,
          })),
        }),
      });
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAddTransactionAndHolding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate('/login');
      return;
    }
    const cleanAsset = assetInput.trim().toUpperCase().replace(/USDT$/, '');
    const qty = Number(qtyInput);
    const price = Number(avgPriceInput);
    if (!cleanAsset || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) {
      setError(isAr ? 'يرجى إدخال كمية وسعر صحيحين' : 'Please enter valid quantity and price');
      return;
    }

    const nowIso = new Date().toISOString();
    const existingIdx = holdings.findIndex((h) => h.symbol === cleanAsset);
    const nextHoldings = [...holdings];

    if (sideInput === 'BUY') {
      if (existingIdx >= 0) {
        const old = nextHoldings[existingIdx];
        const totalQty = old.quantity + qty;
        const newAvg = (old.quantity * old.avgBuyPrice + qty * price) / totalQty;
        nextHoldings[existingIdx] = {
          ...old,
          quantity: totalQty,
          avgBuyPrice: Number(newAvg.toFixed(6)),
          updatedAt: nowIso,
        };
      } else {
        nextHoldings.push({
          symbol: cleanAsset,
          pair: `${cleanAsset}USDT`,
          quantity: qty,
          avgBuyPrice: price,
          updatedAt: nowIso,
        });
      }
    } else {
      if (existingIdx >= 0) {
        const rem = Math.max(0, nextHoldings[existingIdx].quantity - qty);
        if (rem <= 0) nextHoldings.splice(existingIdx, 1);
        else nextHoldings[existingIdx] = { ...nextHoldings[existingIdx], quantity: rem, updatedAt: nowIso };
      }
    }

    setHoldings(nextHoldings);
    await persistPortfolio(usdtBalance, nextHoldings);

    try {
      const txRes = await apiFetch<{ transaction: PortfolioTransaction }>('/api/user/portfolio/transactions', {
        method: 'POST',
        body: JSON.stringify({
          asset: cleanAsset,
          side: sideInput,
          quantity: qty,
          priceUsdt: price,
          note: noteInput.trim(),
        }),
      });
      setTransactions((prev) => [txRes.transaction, ...prev]);
    } catch {
      // ignore tx log error if portfolio saved
    }

    setQtyInput('');
    setAvgPriceInput('');
    setNoteInput('');
  };

  const handleRemoveHolding = async (symbol: string) => {
    const next = holdings.filter((h) => h.symbol !== symbol);
    setHoldings(next);
    await persistPortfolio(usdtBalance, next);
  };

  const enriched = useMemo(() => {
    let assetsValue = 0;
    let totalCost = 0;
    const rows = holdings.map((h) => {
      const pair = h.pair || `${h.symbol}USDT`;
      const currentPrice = tickerMap.get(pair)?.lastPrice ?? h.avgBuyPrice;
      const value = h.quantity * currentPrice;
      const cost = h.quantity * h.avgBuyPrice;
      const pnl = value - cost;
      const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
      assetsValue += value;
      totalCost += cost;
      return { ...h, pair, currentPrice, value, cost, pnl, pnlPct };
    });

    const totalPortfolioValue = assetsValue + usdtBalance;
    const totalPnl = assetsValue - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    return { rows, assetsValue, totalPortfolioValue, totalPnl, totalPnlPct };
  }, [holdings, usdtBalance, tickerMap]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC] flex items-center gap-2.5">
            <Briefcase className="w-6 h-6 text-[#D4AF37]" />
            <span>{t.nav.portfolio}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
            <span>{t.common.userReportedNotice}</span>
          </p>
        </div>

        {!user && (
          <button
            onClick={() => navigate('/login')}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-[#D4AF37] text-[#070A0F] text-xs font-bold cursor-pointer"
          >
            {t.nav.login}
          </button>
        )}
      </div>

      {readiness && (!readiness.supabase.configured || !readiness.supabase.schemaReady) && (
        <ConfigNotice
          message={
            readiness.supabase.error ||
            (isAr
              ? 'حفظ المحفظة وسجل المعاملات في Supabase PostgreSQL يتطلب إعداد متغيرات Supabase.'
              : 'Persisting manual holdings and transactions in Supabase PostgreSQL requires Supabase configuration.')
          }
          missingVars={readiness.supabase.missingVars}
        />
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono-num">
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-400">{isAr ? 'إجمالي قيمة المحفظة' : 'Total Portfolio Value'}</div>
          <div className="text-2xl font-bold text-[#F8FAFC] mt-1">{formatUsd(enriched.totalPortfolioValue)}</div>
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-400">{isAr ? 'الربح / الخسارة غير المحققة' : 'Unrealized P&L'}</div>
          <div
            className={`text-2xl font-bold mt-1 ${
              enriched.totalPnl >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'
            }`}
          >
            {formatUsd(enriched.totalPnl)}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{formatPercent(enriched.totalPnlPct)}</div>
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-400">{isAr ? 'رصيد USDT الافتراضي' : 'USDT Cash Balance'}</div>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="number"
              min="0"
              step="any"
              dir="ltr"
              value={usdtBalance}
              onChange={(e) => setUsdtBalance(Math.max(0, Number(e.target.value) || 0))}
              className="w-full min-h-[36px] px-2.5 rounded-lg bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC]"
            />
            <button
              onClick={() => persistPortfolio(usdtBalance, holdings)}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-[#D4AF37] text-[#070A0F] text-xs font-bold cursor-pointer"
            >
              {t.common.save}
            </button>
          </div>
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-400">{isAr ? 'عدد الأصول المتتبعة' : 'Tracked Assets'}</div>
          <div className="text-2xl font-bold text-[#E5C158] mt-1">{holdings.length}</div>
        </div>
      </div>

      {/* Portfolio Allocation Bar */}
      {enriched.totalPortfolioValue > 0 && (
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-[#F8FAFC]">
            {isAr ? 'توزيع المحفظة' : 'Portfolio Allocation'}
          </h2>
          <div className="h-3 w-full rounded-full bg-[#070A0F] overflow-hidden flex">
            {enriched.rows.map((r, i) => {
              const pct = (r.value / enriched.totalPortfolioValue) * 100;
              const palette = ['#D4AF37', '#10B981', '#38BDF8', '#A78BFA', '#F59E0B', '#EC4899'];
              return (
                <div
                  key={r.symbol}
                  style={{ width: `${pct}%`, backgroundColor: palette[i % palette.length] }}
                  title={`${r.symbol}: ${pct.toFixed(1)}%`}
                />
              );
            })}
            {usdtBalance > 0 && (
              <div
                style={{
                  width: `${(usdtBalance / enriched.totalPortfolioValue) * 100}%`,
                  backgroundColor: '#475569',
                }}
                title="USDT"
              />
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-xs font-mono-num text-slate-300">
            {enriched.rows.map((r) => (
              <span key={r.symbol}>
                {r.symbol}: {((r.value / enriched.totalPortfolioValue) * 100).toFixed(1)}%
              </span>
            ))}
            {usdtBalance > 0 && (
              <span>USDT: {((usdtBalance / enriched.totalPortfolioValue) * 100).toFixed(1)}%</span>
            )}
          </div>
        </div>
      )}

      {/* Add Holding / Transaction Form */}
      <form
        onSubmit={handleAddTransactionAndHolding}
        className="bg-[#0D131F] border border-white/10 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
      >
        <div>
          <label className="block text-xs text-slate-400 mb-1">{isAr ? 'العملة' : 'Asset'}</label>
          <input
            type="text"
            dir="ltr"
            list="portfolio-assets"
            value={assetInput}
            onChange={(e) => setAssetInput(e.target.value.toUpperCase())}
            placeholder="BTC"
            className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-sm font-mono-num text-[#F8FAFC]"
          />
          <datalist id="portfolio-assets">
            {tickers.slice(0, 80).map((tk) => (
              <option key={tk.baseAsset} value={tk.baseAsset} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">{isAr ? 'العملية' : 'Side'}</label>
          <select
            value={sideInput}
            onChange={(e) => setSideInput(e.target.value as 'BUY' | 'SELL')}
            className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC]"
          >
            <option value="BUY">{isAr ? 'شراء (BUY)' : 'BUY'}</option>
            <option value="SELL">{isAr ? 'بيع (SELL)' : 'SELL'}</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">{isAr ? 'الكمية' : 'Quantity'}</label>
          <input
            type="number"
            step="any"
            required
            dir="ltr"
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            placeholder="0.25"
            className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-sm font-mono-num text-[#F8FAFC]"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">{isAr ? 'سعر الشراء (USDT)' : 'Price (USDT)'}</label>
          <input
            type="number"
            step="any"
            required
            dir="ltr"
            value={avgPriceInput}
            onChange={(e) => setAvgPriceInput(e.target.value)}
            placeholder="60000"
            className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-sm font-mono-num text-[#F8FAFC]"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">{isAr ? 'ملاحظة' : 'Note'}</label>
          <input
            type="text"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder={isAr ? 'اختياري' : 'Optional'}
            className="w-full min-h-[40px] px-3 rounded-lg bg-[#070A0F] border border-white/12 text-sm text-[#F8FAFC]"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="min-h-[40px] px-4 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{t.common.add}</span>
        </button>
      </form>

      {error && (
        <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444]">
          {error}
        </div>
      )}

      {/* Holdings Table */}
      <div className="bg-[#0D131F] border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono-num">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 bg-[#070A0F]/60">
                <th className="py-3 px-4 text-start">{isAr ? 'الأصل' : 'Asset'}</th>
                <th className="py-3 px-4 text-end">{isAr ? 'الكمية' : 'Qty'}</th>
                <th className="py-3 px-4 text-end">{isAr ? 'متوسط الشراء' : 'Avg Buy'}</th>
                <th className="py-3 px-4 text-end">{isAr ? 'السعر الحي' : 'Live Price'}</th>
                <th className="py-3 px-4 text-end">{isAr ? 'القيمة' : 'Value'}</th>
                <th className="py-3 px-4 text-end">{isAr ? 'الربح / الخسارة' : 'Unrealized P&L'}</th>
                <th className="py-3 px-4 text-end">{t.common.delete}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    {t.common.loading}
                  </td>
                </tr>
              ) : enriched.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    {isAr ? 'لا توجد أصول مضافة في المحفظة بعد.' : 'No manual Spot holdings added yet.'}
                  </td>
                </tr>
              ) : (
                enriched.rows.map((row) => (
                  <tr key={row.symbol}>
                    <td className="py-3 px-4 font-bold text-[#F8FAFC]">{row.symbol}</td>
                    <td className="py-3 px-4 text-end text-slate-200">{row.quantity}</td>
                    <td className="py-3 px-4 text-end text-slate-300">${formatPrice(row.avgBuyPrice)}</td>
                    <td className="py-3 px-4 text-end text-[#E5C158]">${formatPrice(row.currentPrice)}</td>
                    <td className="py-3 px-4 text-end font-semibold text-[#F8FAFC]">{formatUsd(row.value)}</td>
                    <td
                      className={`py-3 px-4 text-end font-semibold ${
                        row.pnl >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'
                      }`}
                    >
                      {formatUsd(row.pnl)} ({formatPercent(row.pnlPct)})
                    </td>
                    <td className="py-3 px-4 text-end">
                      <button
                        onClick={() => handleRemoveHolding(row.symbol)}
                        className="p-1.5 text-slate-500 hover:text-[#EF4444] cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transaction History */}
      {transactions.length > 0 && (
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-[#F8FAFC]">
            {isAr ? 'سجل المعاملات اليدوية' : 'Manual Transaction History'}
          </h2>
          <div className="divide-y divide-white/6 text-xs font-mono-num">
            {transactions.map((tx) => (
              <div key={tx.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className={tx.side === 'BUY' ? 'text-[#10B981] font-bold' : 'text-[#EF4444] font-bold'}>
                  {tx.side} {tx.asset}
                </span>
                <span className="text-slate-200">
                  {tx.quantity} @ ${formatPrice(tx.priceUsdt)}
                </span>
                <span className="text-slate-500">{formatTimestamp(tx.executedAt, language)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Bot, Briefcase, Calculator, CheckCircle2, Signal, Star, TrendingDown, TrendingUp } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { formatPercent, formatPrice } from '../lib/formatters.ts';
import { ConfigNotice } from '../components/ConfigNotice.tsx';
import type { TradingSignal } from '../types/trading.ts';

export function DashboardPage() {
  const { language, t, navigate, user, tickers, watchlist, readiness } = useApp();
  const isAr = language === 'ar';

  const [quota, setQuota] = useState<{ used24h: number; limit24h: number; remaining24h: number } | null>(null);
  const [signals, setSignals] = useState<TradingSignal[]>([]);

  useEffect(() => {
    apiFetch<{ signals: TradingSignal[] }>('/api/signals?status=ACTIVE')
      .then((res) => setSignals((res.signals || []).slice(0, 4)))
      .catch(() => {});

    if (user) {
      apiFetch<{ used24h: number; limit24h: number; remaining24h: number }>('/api/ai/quota')
        .then(setQuota)
        .catch(() => {});
    }
  }, [user]);

  const watchlistTickers = watchlist
    .map((sym) => tickers.find((tk) => tk.symbol === sym))
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC]">{t.nav.dashboard}</h1>
          <p className="text-xs text-slate-400 mt-1">
            {user
              ? `${user.email} · ${user.plan.toUpperCase()}`
              : isAr
                ? 'وضع الضيف — سجّل دخولك لحفظ المحفظة والتنبيهات وتحليلات Mour AI في السحابة'
                : 'Guest mode — sign in with Clerk to sync portfolio, alerts, and Mour AI history'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/ai')}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Bot className="w-4 h-4" />
            <span>{t.nav.ai}</span>
          </button>
          <button
            onClick={() => navigate('/calculator')}
            className="min-h-[40px] px-4 py-2 rounded-xl border border-white/12 bg-[#0D131F] hover:border-[#D4AF37]/40 text-xs font-medium text-slate-200 flex items-center gap-1.5 cursor-pointer"
          >
            <Calculator className="w-4 h-4 text-[#D4AF37]" />
            <span>{t.nav.calculator}</span>
          </button>
        </div>
      </div>

      {/* Missing Services Banner only if Clerk or Gemini AI are not configured */}
      {readiness && (!readiness.clerk.configured || !readiness.geminiAi.configured) && (
        <ConfigNotice
          title={isAr ? 'حالة ربط خدمات Clerk و Gemini' : 'Clerk & AI Readiness'}
          message={
            isAr
              ? 'بيانات السوق الحية والشارت والمؤشرات وحاسبة المخاطر تعمل مباشرة الآن. لتفعيل الحسابات عبر Clerk وتحليلات Gemini AI، أضف المتغيرات التالية:'
              : 'Live Binance markets, charts, indicators, and risk calculator are active. To enable Clerk user authentication and Gemini AI analyses, configure these env vars:'
          }
          missingVars={[
            ...readiness.clerk.missingVars,
            ...readiness.geminiAi.missingVars,
          ]}
        />
      )}

      {/* Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-400">{isAr ? 'الأزواج الحية المتاحة' : 'Live Spot Pairs'}</div>
          <div className="text-2xl font-bold font-mono-num text-[#F8FAFC] mt-1">{tickers.length}</div>
          <div className="text-[11px] text-[#10B981] mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            <span>Binance Spot</span>
          </div>
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-400">{t.ai.quotaLabel}</div>
          <div className="text-2xl font-bold font-mono-num text-[#E5C158] mt-1">
            {quota ? `${quota.remaining24h} / ${quota.limit24h}` : '3 / 24h'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {user ? user.plan.toUpperCase() : 'FREE PLAN'}
          </div>
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-400">{t.nav.watchlist}</div>
          <div className="text-2xl font-bold font-mono-num text-[#F8FAFC] mt-1">{watchlist.length}</div>
          <button
            onClick={() => navigate('/watchlist')}
            className="text-[11px] text-[#D4AF37] hover:underline mt-1 cursor-pointer"
          >
            {isAr ? 'إدارة المفضلة' : 'Manage Watchlist'}
          </button>
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-400">{t.nav.portfolio}</div>
          <div className="text-sm font-semibold text-[#F8FAFC] mt-2">
            {isAr ? 'تتبع الأصول الفورية' : 'Manual Spot Tracker'}
          </div>
          <button
            onClick={() => navigate('/portfolio')}
            className="text-[11px] text-[#D4AF37] hover:underline mt-1 inline-flex items-center gap-1 cursor-pointer"
          >
            <Briefcase className="w-3 h-3" />
            <span>{isAr ? 'فتح المحفظة' : 'Open Portfolio'}</span>
          </button>
        </div>
      </div>

      {/* Watchlist Movers + Active Signals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#F8FAFC] flex items-center gap-2">
              <Star className="w-4 h-4 text-[#D4AF37]" />
              <span>{t.nav.watchlist}</span>
            </h2>
            <button onClick={() => navigate('/markets')} className="text-xs text-[#D4AF37] hover:underline cursor-pointer">
              {t.nav.markets}
            </button>
          </div>

          <div className="divide-y divide-white/6">
            {watchlistTickers.map((tk) => {
              const up = tk.priceChangePercent >= 0;
              return (
                <button
                  key={tk.symbol}
                  onClick={() => navigate(`/coin/${tk.symbol}`)}
                  className="w-full py-3 flex items-center justify-between hover:bg-white/[0.03] px-2 rounded-lg transition-colors cursor-pointer"
                >
                  <div className="text-start">
                    <div className="font-mono-num text-sm font-bold text-[#F8FAFC]">{tk.symbol}</div>
                    <div className="text-[11px] text-slate-500 font-mono-num">
                      H: ${formatPrice(tk.highPrice)} · L: ${formatPrice(tk.lowPrice)}
                    </div>
                  </div>
                  <div className="text-end font-mono-num">
                    <div className="text-sm font-semibold text-[#F8FAFC]">${formatPrice(tk.lastPrice)}</div>
                    <div className={`text-xs inline-flex items-center gap-1 ${up ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {formatPercent(tk.priceChangePercent)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#F8FAFC] flex items-center gap-2">
              <Signal className="w-4 h-4 text-[#D4AF37]" />
              <span>{t.nav.signals}</span>
            </h2>
            <button onClick={() => navigate('/signals')} className="text-xs text-[#D4AF37] hover:underline cursor-pointer">
              {isAr ? 'عرض الكل' : 'View All'}
            </button>
          </div>

          {signals.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm text-slate-400">
                {isAr ? 'لا توجد إشارات نشطة حالياً.' : 'No active Spot signals published yet.'}
              </p>
              <button
                onClick={() => navigate('/ai')}
                className="text-xs text-[#D4AF37] hover:underline cursor-pointer"
              >
                {isAr ? 'تشغيل تحليل Mour AI الآن' : 'Run Mour AI Analysis'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {signals.map((sig) => (
                <div
                  key={sig.id}
                  className="p-3 rounded-lg bg-[#070A0F] border border-white/8 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-mono-num text-sm font-bold text-[#F8FAFC]">
                      {sig.symbol} · {sig.timeframe.toUpperCase()}
                    </div>
                    <div className="text-xs text-slate-400 font-mono-num">
                      Entry: {formatPrice(sig.entryLow)}–{formatPrice(sig.entryHigh)} · SL: {formatPrice(sig.stopLoss)}
                    </div>
                  </div>
                  <span className="text-xs font-mono-num font-semibold text-[#10B981]">
                    {sig.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

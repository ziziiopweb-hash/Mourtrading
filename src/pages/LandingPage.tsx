import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, CandlestickChart, Globe2, ShieldCheck, Signal, TrendingDown, TrendingUp } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { formatCompactVolume, formatPercent, formatPrice, formatTimestamp } from '../lib/formatters.ts';

interface GlobalStats {
  total_market_cap?: { usd?: number };
  total_volume?: { usd?: number };
  market_cap_percentage?: { btc?: number; eth?: number };
  market_cap_change_percentage_24h_usd?: number;
}

export function LandingPage() {
  const { language, t, navigate, tickers, wsConnected, lastTickAt, user } = useApp();
  const isAr = language === 'ar';
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);

  useEffect(() => {
    apiFetch<{ available: boolean; data: GlobalStats | null }>('/api/market/global')
      .then((res) => {
        if (res.available && res.data) setGlobalStats(res.data);
      })
      .catch(() => {});
  }, []);

  const featuredSymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'PEPEUSDT'];
  const featuredTickers = featuredSymbols
    .map((sym) => tickers.find((tk) => tk.symbol === sym))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  const displayRows = featuredTickers.length > 0 ? featuredTickers : tickers.slice(0, 7);
  const DirArrow = isAr ? ArrowLeft : ArrowRight;

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch pt-2">
        <div className="lg:col-span-7 flex flex-col justify-between bg-[#0D131F] border border-white/10 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="text-[#D4AF37] font-semibold">{t.brandName}</span>
              <span aria-hidden="true">·</span>
              <span>{t.tagline}</span>
              <span aria-hidden="true">·</span>
              <span>{wsConnected ? t.status.liveWs : t.status.reconnecting}</span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-bold text-[#F8FAFC] leading-tight" style={{ textWrap: 'balance' }}>
              {t.landing.heroTitle}
            </h1>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
              {t.landing.heroSubtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={() => navigate('/markets')}
              className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] font-bold text-sm inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>{t.landing.ctaPrimary}</span>
              <DirArrow className="w-4 h-4" />
            </button>

            <button
              onClick={() => navigate(user ? '/dashboard' : '/register')}
              className="min-h-[44px] px-5 py-2.5 rounded-xl border border-white/15 bg-[#070A0F] hover:border-[#D4AF37]/50 text-[#F1F5F9] font-medium text-sm transition-colors cursor-pointer whitespace-nowrap"
            >
              {user ? t.nav.dashboard : t.landing.ctaSecondary}
            </button>
          </div>
        </div>

        {/* Live Verified Market Feed Card */}
        <div className="lg:col-span-5 bg-[#0D131F] border border-white/10 rounded-2xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/8">
            <h2 className="text-sm font-semibold text-[#F8FAFC]">
              {isAr ? 'أسعار Binance Spot الحية' : 'Verified Binance Spot Feed'}
            </h2>
            <span className="text-[11px] font-mono-num text-slate-400">
              {formatTimestamp(lastTickAt, language)}
            </span>
          </div>

          <div className="divide-y divide-white/6 my-2 flex-1">
            {displayRows.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400">{t.common.loading}</div>
            ) : (
              displayRows.map((tk) => {
                const up = tk.priceChangePercent >= 0;
                return (
                  <button
                    key={tk.symbol}
                    onClick={() => navigate(`/coin/${tk.symbol}`)}
                    className="w-full py-2.5 px-2 flex items-center justify-between gap-3 hover:bg-white/[0.03] rounded-lg transition-colors cursor-pointer text-start"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono-num font-bold text-sm text-[#F8FAFC]">
                        {tk.baseAsset}
                      </span>
                      <span className="text-xs font-mono-num text-slate-500">/{tk.quoteAsset}</span>
                    </div>
                    <div className="flex items-center gap-4 font-mono-num text-xs shrink-0">
                      <span className="text-sm font-semibold text-[#F8FAFC]">
                        ${formatPrice(tk.lastPrice)}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 min-w-[68px] justify-end font-semibold ${
                          up ? 'text-[#10B981]' : 'text-[#EF4444]'
                        }`}
                      >
                        {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {formatPercent(tk.priceChangePercent)}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <button
            onClick={() => navigate('/markets')}
            className="w-full mt-2 py-2 text-xs font-medium text-[#D4AF37] hover:text-[#E5C158] border-t border-white/8 pt-3 cursor-pointer"
          >
            {isAr ? `عرض جميع الأزواج (${tickers.length}+)` : `View All Spot Pairs (${tickers.length}+)`}
          </button>
        </div>
      </section>

      {/* Global Market Snapshot (Only when CoinGecko responds cleanly) */}
      {globalStats?.total_market_cap?.usd && (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-[#0D131F] border border-white/10 rounded-xl p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400">{t.markets.globalCap}</div>
              <div className="text-lg font-bold font-mono-num text-[#F8FAFC] mt-1">
                {formatCompactVolume(globalStats.total_market_cap.usd)}
              </div>
            </div>
            <Globe2 className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div className="bg-[#0D131F] border border-white/10 rounded-xl p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400">{t.markets.volumeGlobal}</div>
              <div className="text-lg font-bold font-mono-num text-[#F8FAFC] mt-1">
                {formatCompactVolume(globalStats.total_volume?.usd)}
              </div>
            </div>
            <CandlestickChart className="w-5 h-5 text-[#10B981]" />
          </div>
          <div className="bg-[#0D131F] border border-white/10 rounded-xl p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400">{t.markets.btcDominance}</div>
              <div className="text-lg font-bold font-mono-num text-[#E5C158] mt-1">
                {globalStats.market_cap_percentage?.btc?.toFixed(2)}%
              </div>
            </div>
            <span className="text-xs text-slate-500">CoinGecko</span>
          </div>
        </section>
      )}

      {/* Core Capabilities */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {[
          {
            icon: CandlestickChart,
            title: t.landing.feature1Title,
            desc: t.landing.feature1Desc,
            path: '/charts',
          },
          {
            icon: ShieldCheck,
            title: t.landing.feature2Title,
            desc: t.landing.feature2Desc,
            path: '/coin/BTCUSDT',
          },
          {
            icon: Bot,
            title: t.landing.feature3Title,
            desc: t.landing.feature3Desc,
            path: '/ai',
          },
          {
            icon: Signal,
            title: t.landing.feature4Title,
            desc: t.landing.feature4Desc,
            path: '/signals',
          },
        ].map((item, idx) => {
          const Icon = item.icon;
          return (
            <button
              key={idx}
              onClick={() => navigate(item.path)}
              className="text-start bg-[#0D131F] border border-white/10 hover:border-[#D4AF37]/40 rounded-xl p-5 space-y-3 transition-colors cursor-pointer"
            >
              <Icon className="w-5 h-5 text-[#D4AF37]" />
              <h3 className="text-sm font-bold text-[#F8FAFC]">{item.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
            </button>
          );
        })}
      </section>
    </div>
  );
}

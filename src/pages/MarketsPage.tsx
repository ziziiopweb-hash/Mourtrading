import React, { useMemo, useState } from 'react';
import { RefreshCw, Search, Star, TrendingDown, TrendingUp } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { formatCompactVolume, formatPercent, formatPrice, formatTimestamp } from '../lib/formatters.ts';

type SortMode = 'volume' | 'gainers' | 'losers' | 'trending';

export function MarketsPage() {
  const {
    language,
    t,
    navigate,
    tickers,
    wsConnected,
    lastTickAt,
    marketLoading,
    marketError,
    refreshMarkets,
    watchlist,
    toggleWatchlist,
  } = useApp();

  const isAr = language === 'ar';
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('volume');
  const [page, setPage] = useState(1);
  const pageSize = 35;

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    const base = q
      ? tickers.filter((tk) => tk.symbol.includes(q) || tk.baseAsset.includes(q))
      : [...tickers];

    if (sort === 'gainers') {
      base.sort((a, b) => b.priceChangePercent - a.priceChangePercent);
    } else if (sort === 'losers') {
      base.sort((a, b) => a.priceChangePercent - b.priceChangePercent);
    } else if (sort === 'trending') {
      base.sort((a, b) => {
        const sA = a.count * (1 + Math.abs(a.priceChangePercent) / 100);
        const sB = b.count * (1 + Math.abs(b.priceChangePercent) / 100);
        return sB - sA;
      });
    } else {
      base.sort((a, b) => b.quoteVolume - a.quoteVolume);
    }

    return base;
  }, [tickers, search, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC]">{t.markets.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
            <span>{t.status.binanceSource}</span>
            <span aria-hidden="true">·</span>
            <span>{wsConnected ? t.status.liveWs : t.status.reconnecting}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num">
              {t.status.lastUpdate}: {formatTimestamp(lastTickAt, language)}
            </span>
          </div>
        </div>

        <button
          onClick={() => refreshMarkets()}
          className="min-h-[40px] px-4 py-2 rounded-xl border border-white/12 bg-[#0D131F] hover:border-[#D4AF37]/40 text-xs font-medium text-slate-200 flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[#D4AF37]" />
          <span>{isAr ? 'تحديث' : 'Refresh'}</span>
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute top-1/2 -translate-y-1/2 start-3.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t.markets.searchPlaceholder}
            className="w-full min-h-[44px] ps-10 pe-4 rounded-xl bg-[#0D131F] border border-white/10 text-sm text-[#F8FAFC] placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37]"
          />
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-[#0D131F] border border-white/10 rounded-xl overflow-x-auto">
          {(
            [
              { key: 'volume', label: t.markets.sortVolume },
              { key: 'gainers', label: t.markets.sortGainers },
              { key: 'losers', label: t.markets.sortLosers },
              { key: 'trending', label: t.markets.sortTrending },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setSort(tab.key);
                setPage(1);
              }}
              className={`px-3 py-2 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                sort === tab.key
                  ? 'bg-[#D4AF37] text-[#070A0F] font-bold'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {marketError && (
        <div className="p-4 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-sm text-[#FCA5A5] flex flex-wrap items-center justify-between gap-3">
          <span>{marketError}</span>
          <button
            onClick={() => refreshMarkets()}
            className="px-3 py-1.5 rounded-lg bg-[#EF4444]/15 border border-[#EF4444]/30 text-xs font-semibold text-[#FCA5A5] hover:bg-[#EF4444]/25 cursor-pointer shrink-0"
          >
            {t.common.retry}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-[#0D131F] border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-slate-400 bg-[#070A0F]/60">
                <th className="py-3 px-4 text-start font-medium">{t.markets.pair}</th>
                <th className="py-3 px-4 text-end font-medium">{t.markets.price}</th>
                <th className="py-3 px-4 text-end font-medium">{t.markets.change24h}</th>
                <th className="py-3 px-4 text-end font-medium hidden md:table-cell">{t.markets.high24h}</th>
                <th className="py-3 px-4 text-end font-medium hidden md:table-cell">{t.markets.low24h}</th>
                <th className="py-3 px-4 text-end font-medium hidden sm:table-cell">{t.markets.volume24h}</th>
                <th className="py-3 px-4 text-end font-medium">{t.markets.action}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {marketLoading ? (
                Array.from({ length: 8 }).map((_, idx) => (
                  <tr key={idx}>
                    <td colSpan={7} className="py-3.5 px-4">
                      <div className="h-5 bg-white/5 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-slate-400">
                    {marketError
                      ? isAr
                        ? 'تعذر تحميل بيانات الأسواق الحية حالياً. يرجى المحاولة مرة أخرى.'
                        : 'Unable to load live market data right now. Please retry.'
                      : t.markets.empty}
                  </td>
                </tr>
              ) : (
                visible.map((tk) => {
                  const up = tk.priceChangePercent >= 0;
                  const starred = watchlist.includes(tk.symbol);
                  return (
                    <tr
                      key={tk.symbol}
                      className="hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <button
                            onClick={() => toggleWatchlist(tk.symbol)}
                            className="p-1 text-slate-500 hover:text-[#D4AF37] cursor-pointer"
                            aria-label="Toggle watchlist"
                          >
                            <Star
                              className={`w-4 h-4 ${starred ? 'fill-[#D4AF37] text-[#D4AF37]' : ''}`}
                            />
                          </button>
                          <button
                            onClick={() => navigate(`/coin/${tk.symbol}`)}
                            className="text-start cursor-pointer"
                          >
                            <span className="font-mono-num font-bold text-[#F8FAFC]">{tk.baseAsset}</span>
                            <span className="font-mono-num text-xs text-slate-500">/{tk.quoteAsset}</span>
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num font-semibold text-[#F8FAFC]">
                        ${formatPrice(tk.lastPrice)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num">
                        <span
                          className={`inline-flex items-center justify-end gap-1 font-semibold ${
                            up ? 'text-[#10B981]' : 'text-[#EF4444]'
                          }`}
                        >
                          {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          {formatPercent(tk.priceChangePercent)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num text-slate-300 hidden md:table-cell">
                        ${formatPrice(tk.highPrice)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num text-slate-300 hidden md:table-cell">
                        ${formatPrice(tk.lowPrice)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono-num text-slate-300 hidden sm:table-cell">
                        {formatCompactVolume(tk.quoteVolume)}
                      </td>
                      <td className="py-3 px-4 text-end">
                        <button
                          onClick={() => navigate(`/coin/${tk.symbol}`)}
                          className="px-3 py-1.5 rounded-lg border border-white/12 hover:border-[#D4AF37]/50 text-xs font-medium text-[#E5C158] cursor-pointer whitespace-nowrap"
                        >
                          {t.markets.action}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/8 text-xs text-slate-400">
            <span className="font-mono-num">
              {safePage} / {totalPages} ({filtered.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg border border-white/10 disabled:opacity-40 cursor-pointer"
              >
                {isAr ? 'السابق' : 'Prev'}
              </button>
              <button
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 rounded-lg border border-white/10 disabled:opacity-40 cursor-pointer"
              >
                {isAr ? 'التالي' : 'Next'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

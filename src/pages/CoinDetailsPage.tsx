import React, { useEffect, useState } from 'react';
import { BellPlus, Bot, Star, TrendingDown, TrendingUp } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { formatCompactVolume, formatPercent, formatPrice, formatTimestamp } from '../lib/formatters.ts';
import { TradingChart } from '../components/TradingChart.tsx';
import type {
  OhlcvCandle,
  OrderBookSnapshot,
  TechnicalIndicatorsSummary,
  Timeframe,
} from '../types/trading.ts';

export function CoinDetailsPage({ symbol }: { symbol: string }) {
  const { language, t, navigate, tickerMap, watchlist, toggleWatchlist } = useApp();
  const isAr = language === 'ar';
  const upperSymbol = symbol.toUpperCase();
  const liveTicker = tickerMap.get(upperSymbol);

  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [candles, setCandles] = useState<OhlcvCandle[]>([]);
  const [summary, setSummary] = useState<TechnicalIndicatorsSummary | null>(null);
  const [multiTf, setMultiTf] = useState<TechnicalIndicatorsSummary[]>([]);
  const [depth, setDepth] = useState<OrderBookSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    apiFetch<{
      candles: OhlcvCandle[];
      summary: TechnicalIndicatorsSummary;
    }>(`/api/market/indicators?symbol=${encodeURIComponent(upperSymbol)}&interval=${timeframe}`)
      .then((res) => {
        if (!active) return;
        setCandles(res.candles);
        setSummary(res.summary);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load market data');
      });

    return () => {
      active = false;
    };
  }, [upperSymbol, timeframe]);

  useEffect(() => {
    let active = true;
    apiFetch<{ timeframes: TechnicalIndicatorsSummary[] }>(
      `/api/market/multi-timeframe?symbol=${encodeURIComponent(upperSymbol)}`,
    )
      .then((res) => {
        if (active) setMultiTf(res.timeframes || []);
      })
      .catch(() => {});

    apiFetch<{ depth: OrderBookSnapshot }>(`/api/market/depth?symbol=${encodeURIComponent(upperSymbol)}&limit=15`)
      .then((res) => {
        if (active) setDepth(res.depth);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [upperSymbol]);

  const starred = watchlist.includes(upperSymbol);
  const currentPrice = liveTicker?.lastPrice ?? summary?.lastPrice ?? 0;
  const changePct = liveTicker?.priceChangePercent ?? 0;
  const up = changePct >= 0;

  return (
    <div className="space-y-6">
      {/* Coin Header */}
      <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono-num text-[#F8FAFC]">{upperSymbol}</h1>
            <button
              onClick={() => toggleWatchlist(upperSymbol)}
              className="p-1.5 rounded-lg border border-white/10 hover:border-[#D4AF37]/40 cursor-pointer"
              aria-label="Toggle watchlist"
            >
              <Star className={`w-4 h-4 ${starred ? 'fill-[#D4AF37] text-[#D4AF37]' : 'text-slate-400'}`} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 font-mono-num">
            <span>24h H: ${formatPrice(liveTicker?.highPrice)}</span>
            <span>24h L: ${formatPrice(liveTicker?.lowPrice)}</span>
            <span>24h Vol: {formatCompactVolume(liveTicker?.quoteVolume)}</span>
            <span>{formatTimestamp(liveTicker?.updatedAt, language)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="text-end font-mono-num">
            <div className="text-2xl font-bold text-[#F8FAFC]">${formatPrice(currentPrice)}</div>
            <div className={`text-xs font-semibold inline-flex items-center gap-1 ${up ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
              {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {formatPercent(changePct)}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/ai?symbol=${upperSymbol}`)}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Bot className="w-4 h-4" />
              <span>{isAr ? 'تحليل Mour AI' : 'Analyze with AI'}</span>
            </button>
            <button
              onClick={() => navigate(`/alerts?symbol=${upperSymbol}`)}
              className="min-h-[40px] px-3 py-2 rounded-xl border border-white/12 bg-[#070A0F] hover:border-[#D4AF37]/40 text-xs text-slate-200 flex items-center gap-1.5 cursor-pointer"
            >
              <BellPlus className="w-4 h-4 text-[#D4AF37]" />
              <span>{isAr ? 'تنبيه' : 'Alert'}</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-sm text-[#EF4444]">
          {error}
        </div>
      )}

      {/* Interactive Chart */}
      <TradingChart
        symbol={upperSymbol}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        candles={candles}
        summary={summary}
        language={language}
        height={470}
      />

      {/* Computed Indicators + Order Book */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-bold text-[#F8FAFC]">
            {t.charts.indicators} ({timeframe.toUpperCase()})
          </h2>

          {summary ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono-num text-xs">
                <div className="p-3 rounded-lg bg-[#070A0F] border border-white/6">
                  <div className="text-slate-400">EMA 20</div>
                  <div className="text-sm font-bold text-[#D4AF37] mt-1">
                    {summary.ema20 ? `$${formatPrice(summary.ema20)}` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#070A0F] border border-white/6">
                  <div className="text-slate-400">EMA 50</div>
                  <div className="text-sm font-bold text-[#38BDF8] mt-1">
                    {summary.ema50 ? `$${formatPrice(summary.ema50)}` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#070A0F] border border-white/6">
                  <div className="text-slate-400">EMA 200</div>
                  <div className="text-sm font-bold text-[#A78BFA] mt-1">
                    {summary.ema200 ? `$${formatPrice(summary.ema200)}` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#070A0F] border border-white/6">
                  <div className="text-slate-400">RSI (14)</div>
                  <div className="text-sm font-bold text-[#E5C158] mt-1">
                    {summary.rsi14 ?? '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#070A0F] border border-white/6">
                  <div className="text-slate-400">MACD Hist</div>
                  <div
                    className={`text-sm font-bold mt-1 ${
                      (summary.macd.histogram ?? 0) >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'
                    }`}
                  >
                    {summary.macd.histogram ?? '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#070A0F] border border-white/6">
                  <div className="text-slate-400">BB Width</div>
                  <div className="text-sm font-bold text-[#F8FAFC] mt-1">
                    {summary.bollinger.bandwidthPercent !== null ? `${summary.bollinger.bandwidthPercent}%` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#070A0F] border border-white/6">
                  <div className="text-slate-400">ATR (14)</div>
                  <div className="text-sm font-bold text-[#F8FAFC] mt-1">
                    {summary.atr14 ? `$${formatPrice(summary.atr14)} (${summary.atrPercent}%)` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#070A0F] border border-white/6">
                  <div className="text-slate-400">{t.charts.trend}</div>
                  <div
                    className={`text-sm font-bold mt-1 ${
                      summary.trendDirection === 'BULLISH'
                        ? 'text-[#10B981]'
                        : summary.trendDirection === 'BEARISH'
                          ? 'text-[#EF4444]'
                          : 'text-[#E5C158]'
                    }`}
                  >
                    {summary.trendDirection} · {summary.trendStrength}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/8 text-xs">
                <div>
                  <div className="text-[#10B981] font-semibold mb-1.5">{t.charts.supports}</div>
                  <div className="flex flex-wrap gap-2 font-mono-num">
                    {summary.supportLevels.map((s, i) => (
                      <span key={i} className="text-slate-200">
                        ${formatPrice(s)}
                        {i < summary.supportLevels.length - 1 ? ' · ' : ''}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[#EF4444] font-semibold mb-1.5">{t.charts.resistances}</div>
                  <div className="flex flex-wrap gap-2 font-mono-num">
                    {summary.resistanceLevels.map((r, i) => (
                      <span key={i} className="text-slate-200">
                        ${formatPrice(r)}
                        {i < summary.resistanceLevels.length - 1 ? ' · ' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-400 pt-2 border-t border-white/8">
                <strong className="text-slate-200">{t.charts.structure}:</strong> {summary.marketStructure}
              </div>
            </>
          ) : (
            <div className="py-8 text-xs text-slate-400">{t.common.loading}</div>
          )}
        </div>

        {/* Live Order Book */}
        <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#F8FAFC]">{t.charts.orderBook}</h2>
            {depth && (
              <span className="text-[11px] font-mono-num text-slate-400">
                Spread: {depth.spreadPercent}%
              </span>
            )}
          </div>

          {depth ? (
            <div className="space-y-2 font-mono-num text-xs" dir="ltr">
              <div className="space-y-1">
                {depth.asks.slice(0, 7).reverse().map((a, idx) => (
                  <div key={idx} className="flex justify-between text-[#EF4444]">
                    <span>{formatPrice(a.price)}</span>
                    <span className="text-slate-400">{a.qty.toFixed(4)}</span>
                  </div>
                ))}
              </div>
              <div className="py-1.5 border-y border-white/10 text-center text-[#F8FAFC] font-bold">
                ${formatPrice(currentPrice)}
              </div>
              <div className="space-y-1">
                {depth.bids.slice(0, 7).map((b, idx) => (
                  <div key={idx} className="flex justify-between text-[#10B981]">
                    <span>{formatPrice(b.price)}</span>
                    <span className="text-slate-400">{b.qty.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-8 text-xs text-slate-400">{t.common.loading}</div>
          )}
        </div>
      </div>

      {/* Multi-Timeframe Comparison */}
      <div className="bg-[#0D131F] border border-white/10 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-bold text-[#F8FAFC]">{t.charts.multiTf}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono-num" dir="ltr">
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th className="py-2 px-3 text-left">TF</th>
                <th className="py-2 px-3 text-left">Trend</th>
                <th className="py-2 px-3 text-right">RSI (14)</th>
                <th className="py-2 px-3 text-right">EMA 20</th>
                <th className="py-2 px-3 text-right">EMA 50</th>
                <th className="py-2 px-3 text-right">MACD Hist</th>
                <th className="py-2 px-3 text-right">ATR %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {multiTf.map((row) => (
                <tr key={row.timeframe}>
                  <td className="py-2.5 px-3 font-bold text-[#E5C158] uppercase">{row.timeframe}</td>
                  <td
                    className={`py-2.5 px-3 font-semibold ${
                      row.trendDirection === 'BULLISH'
                        ? 'text-[#10B981]'
                        : row.trendDirection === 'BEARISH'
                          ? 'text-[#EF4444]'
                          : 'text-slate-300'
                    }`}
                  >
                    {row.trendDirection} ({row.trendStrength})
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-200">{row.rsi14 ?? '—'}</td>
                  <td className="py-2.5 px-3 text-right text-slate-200">{row.ema20 ? formatPrice(row.ema20) : '—'}</td>
                  <td className="py-2.5 px-3 text-right text-slate-200">{row.ema50 ? formatPrice(row.ema50) : '—'}</td>
                  <td
                    className={`py-2.5 px-3 text-right ${
                      (row.macd.histogram ?? 0) >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'
                    }`}
                  >
                    {row.macd.histogram ?? '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-300">
                    {row.atrPercent !== null ? `${row.atrPercent}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

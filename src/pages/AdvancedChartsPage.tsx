import React, { useEffect, useState } from 'react';
import { useApp } from '../contexts/AppContext.tsx';
import { fetchDirectBinanceIndicators } from '../lib/binancePublic.ts';
import { formatPercent, formatPrice } from '../lib/formatters.ts';
import { TradingChart } from '../components/TradingChart.tsx';
import type { OhlcvCandle, TechnicalIndicatorsSummary, Timeframe } from '../types/trading.ts';

export function AdvancedChartsPage() {
  const { language, t, tickers, tickerMap, navigate } = useApp();
  const isAr = language === 'ar';

  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [candles, setCandles] = useState<OhlcvCandle[]>([]);
  const [summary, setSummary] = useState<TechnicalIndicatorsSummary | null>(null);

  const popularPairs = tickers.slice(0, 20);
  const liveTicker = tickerMap.get(symbol);

  useEffect(() => {
    let active = true;
    fetchDirectBinanceIndicators(symbol, timeframe, 350)
      .then((res) => {
        if (!active) return;
        setCandles(res.candles);
        setSummary(res.summary);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [symbol, timeframe]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC]">{t.nav.charts}</h1>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'رسوم بيانية تفاعلية مع مؤشرات EMA وRSI وMACD وبولينجر باندز وحساب الدعم والمقاومة'
              : 'Interactive Spot candlestick workspace with EMA, RSI, MACD, Bollinger Bands & S/R'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            dir="ltr"
            className="min-h-[42px] px-3 rounded-xl bg-[#0D131F] border border-white/12 text-sm font-mono-num text-[#F8FAFC] focus:outline-none focus:border-[#D4AF37]"
          >
            {(popularPairs.length > 0 ? popularPairs : [{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }, { symbol: 'SOLUSDT' }]).map(
              (item) => (
                <option key={item.symbol} value={item.symbol}>
                  {item.symbol}
                </option>
              ),
            )}
          </select>

          <button
            onClick={() => navigate(`/ai?symbol=${symbol}`)}
            className="min-h-[42px] px-4 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            {isAr ? 'تحليل Mour AI' : 'Mour AI'}
          </button>
        </div>
      </div>

      {/* Live Pair Strip */}
      {liveTicker && (
        <div className="bg-[#0D131F] border border-white/10 rounded-xl px-4 py-3 flex flex-wrap items-center gap-6 font-mono-num text-xs">
          <span className="text-sm font-bold text-[#F8FAFC]">{symbol}</span>
          <span>
            Price: <strong className="text-[#F8FAFC]">${formatPrice(liveTicker.lastPrice)}</strong>
          </span>
          <span className={liveTicker.priceChangePercent >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}>
            24h: {formatPercent(liveTicker.priceChangePercent)}
          </span>
          <span className="text-slate-400">H: ${formatPrice(liveTicker.highPrice)}</span>
          <span className="text-slate-400">L: ${formatPrice(liveTicker.lowPrice)}</span>
          {summary && (
            <span className="text-[#E5C158]">
              Trend: {summary.trendDirection} ({summary.trendStrength})
            </span>
          )}
        </div>
      )}

      <TradingChart
        symbol={symbol}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        candles={candles}
        summary={summary}
        language={language}
        height={540}
      />
    </div>
  );
}

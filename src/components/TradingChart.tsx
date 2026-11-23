import React, { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type Time,
} from 'lightweight-charts';
import { computeIndicatorSeries } from '../lib/indicators.ts';
import { formatPrice } from '../lib/formatters.ts';
import type { Language, OhlcvCandle, TechnicalIndicatorsSummary, Timeframe } from '../types/trading.ts';

interface TradingChartProps {
  symbol: string;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  candles: OhlcvCandle[];
  summary: TechnicalIndicatorsSummary | null;
  language: Language;
  height?: number;
}

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

export function TradingChart({
  symbol,
  timeframe,
  onTimeframeChange,
  candles,
  summary,
  language,
  height = 460,
}: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [showEma20, setShowEma20] = useState(true);
  const [showEma50, setShowEma50] = useState(true);
  const [showEma200, setShowEma200] = useState(false);
  const [showBb, setShowBb] = useState(false);
  const [showSr, setShowSr] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(false);

  const [hoveredCandle, setHoveredCandle] = useState<OhlcvCandle | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const el = containerRef.current;
    const seriesData = computeIndicatorSeries(candles);

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#070A0F' },
        textColor: '#94A3B8',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(212, 175, 55, 0.4)', labelBackgroundColor: '#121A2B' },
        horzLine: { color: 'rgba(212, 175, 55, 0.4)', labelBackgroundColor: '#121A2B' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    candleSeries.setData(
      candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    volumeSeries.setData(
      candles.map((c) => ({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)',
      })),
    );

    if (showEma20 && seriesData.ema20.length) {
      const s = chart.addSeries(LineSeries, {
        color: '#D4AF37',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(seriesData.ema20.map((p) => ({ time: p.time as Time, value: p.value })));
    }

    if (showEma50 && seriesData.ema50.length) {
      const s = chart.addSeries(LineSeries, {
        color: '#38BDF8',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(seriesData.ema50.map((p) => ({ time: p.time as Time, value: p.value })));
    }

    if (showEma200 && seriesData.ema200.length) {
      const s = chart.addSeries(LineSeries, {
        color: '#A78BFA',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(seriesData.ema200.map((p) => ({ time: p.time as Time, value: p.value })));
    }

    if (showBb && seriesData.bollinger.length) {
      const bbUpper = chart.addSeries(LineSeries, {
        color: 'rgba(148, 163, 184, 0.55)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const bbLower = chart.addSeries(LineSeries, {
        color: 'rgba(148, 163, 184, 0.55)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      bbUpper.setData(seriesData.bollinger.map((p) => ({ time: p.time as Time, value: p.upper })));
      bbLower.setData(seriesData.bollinger.map((p) => ({ time: p.time as Time, value: p.lower })));
    }

    if (showSr && summary) {
      for (const sup of summary.supportLevels.slice(0, 2)) {
        candleSeries.createPriceLine({
          price: sup,
          color: 'rgba(16, 185, 129, 0.55)',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'S',
        });
      }
      for (const res of summary.resistanceLevels.slice(0, 2)) {
        candleSeries.createPriceLine({
          price: res,
          color: 'rgba(239, 68, 68, 0.55)',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'R',
        });
      }
    }

    let nextPane = 1;
    if (showRsi && seriesData.rsi14.length) {
      const rsiSeries = chart.addSeries(
        LineSeries,
        {
          color: '#E5C158',
          lineWidth: 2,
          priceLineVisible: false,
        },
        nextPane,
      );
      rsiSeries.setData(seriesData.rsi14.map((p) => ({ time: p.time as Time, value: p.value })));
      rsiSeries.createPriceLine({ price: 70, color: 'rgba(239,68,68,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      rsiSeries.createPriceLine({ price: 30, color: 'rgba(16,185,129,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      nextPane++;
    }

    if (showMacd && seriesData.macd.length) {
      const histSeries = chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false },
        nextPane,
      );
      histSeries.setData(
        seriesData.macd.map((p) => ({
          time: p.time as Time,
          value: p.histogram,
          color: p.histogram >= 0 ? 'rgba(16,185,129,0.55)' : 'rgba(239,68,68,0.55)',
        })),
      );
      const macdLine = chart.addSeries(LineSeries, { color: '#38BDF8', lineWidth: 2, priceLineVisible: false }, nextPane);
      const signalLine = chart.addSeries(LineSeries, { color: '#F59E0B', lineWidth: 2, priceLineVisible: false }, nextPane);
      macdLine.setData(seriesData.macd.map((p) => ({ time: p.time as Time, value: p.macd })));
      signalLine.setData(seriesData.macd.map((p) => ({ time: p.time as Time, value: p.signal })));
    }

    const candleMap = new Map(candles.map((c) => [c.time, c]));
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHoveredCandle(null);
        return;
      }
      const c = candleMap.get(Number(param.time));
      setHoveredCandle(c ?? null);
    });

    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, summary, height, showEma20, showEma50, showEma200, showBb, showSr, showRsi, showMacd]);

  const displayCandle = hoveredCandle || candles[candles.length - 1] || null;
  const isAr = language === 'ar';

  return (
    <div className="bg-[#0D131F] border border-white/10 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-1.5 overflow-x-auto" dir="ltr">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange(tf)}
              className={`px-2.5 py-1.5 text-xs font-mono-num font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                timeframe === tf
                  ? 'bg-[#D4AF37] text-[#070A0F]'
                  : 'bg-[#070A0F] text-slate-400 hover:text-slate-100 border border-white/8'
              }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5" dir="ltr">
          {[
            { key: 'ema20', label: 'EMA 20', active: showEma20, toggle: () => setShowEma20((v) => !v), color: '#D4AF37' },
            { key: 'ema50', label: 'EMA 50', active: showEma50, toggle: () => setShowEma50((v) => !v), color: '#38BDF8' },
            { key: 'ema200', label: 'EMA 200', active: showEma200, toggle: () => setShowEma200((v) => !v), color: '#A78BFA' },
            { key: 'bb', label: 'BB', active: showBb, toggle: () => setShowBb((v) => !v), color: '#94A3B8' },
            { key: 'sr', label: 'S/R', active: showSr, toggle: () => setShowSr((v) => !v), color: '#10B981' },
            { key: 'rsi', label: 'RSI 14', active: showRsi, toggle: () => setShowRsi((v) => !v), color: '#E5C158' },
            { key: 'macd', label: 'MACD', active: showMacd, toggle: () => setShowMacd((v) => !v), color: '#38BDF8' },
          ].map((ind) => (
            <button
              key={ind.key}
              onClick={ind.toggle}
              className={`px-2.5 py-1 text-[11px] font-mono-num rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                ind.active
                  ? 'bg-white/10 text-slate-100 border-white/20'
                  : 'bg-transparent text-slate-500 border-white/6 hover:text-slate-300'
              }`}
            >
              <span style={{ color: ind.active ? ind.color : undefined }}>{ind.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* OHLCV Readout Bar */}
      {displayCandle && (
        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 text-xs font-mono-num bg-[#070A0F]/60 border-b border-white/6 text-slate-400"
          dir="ltr"
        >
          <span className="font-semibold text-slate-100">{symbol}</span>
          <span>O: <strong className="text-slate-200">{formatPrice(displayCandle.open)}</strong></span>
          <span>H: <strong className="text-[#10B981]">{formatPrice(displayCandle.high)}</strong></span>
          <span>L: <strong className="text-[#EF4444]">{formatPrice(displayCandle.low)}</strong></span>
          <span>
            C:{' '}
            <strong className={displayCandle.close >= displayCandle.open ? 'text-[#10B981]' : 'text-[#EF4444]'}>
              {formatPrice(displayCandle.close)}
            </strong>
          </span>
          <span>Vol: <strong className="text-slate-200">{displayCandle.volume.toLocaleString('en-US', { maximumFractionDigits: 2 })}</strong></span>
          {summary?.rsi14 !== null && summary?.rsi14 !== undefined && (
            <span>RSI(14): <strong className="text-[#E5C158]">{summary.rsi14}</strong></span>
          )}
          {summary?.atr14 !== null && summary?.atr14 !== undefined && (
            <span>ATR(14): <strong className="text-slate-200">{formatPrice(summary.atr14)}</strong></span>
          )}
        </div>
      )}

      {/* Chart Canvas */}
      <div className="relative w-full" dir="ltr">
        {candles.length === 0 ? (
          <div className="flex items-center justify-center text-sm text-slate-400" style={{ height }}>
            {isAr ? 'جاري تحميل بيانات الشموع من Binance...' : 'Loading Binance OHLCV candles...'}
          </div>
        ) : (
          <div ref={containerRef} className="w-full" style={{ height }} />
        )}
      </div>

      <div className="flex items-center justify-between px-4 py-2 text-[11px] text-slate-500 border-t border-white/6">
        <span>{isAr ? 'المصدر: Binance Spot OHLCV الفعلي' : 'Source: Real Binance Spot OHLCV'}</span>
        <span className="font-mono-num">
          {candles.length} {isAr ? 'شمعة' : 'candles'}
        </span>
      </div>
    </div>
  );
}

import { summarizeIndicators } from './indicators.ts';
import type { OhlcvCandle, SignalTradeType, Timeframe } from '../types/trading.ts';

export interface DetectedAutoSignal {
  symbol: string;
  timeframe: Timeframe;
  tradeType: SignalTradeType;
  entryLow: number;
  entryHigh: number;
  tp1: number;
  tp2: number;
  tp3: number;
  stopLoss: number;
  riskRewardRatio: number;
  score: number;
  explanation: string;
  setupTag: 'SUPPORT_BOUNCE' | 'TREND_MOMENTUM' | 'OVERSOLD_REVERSAL';
}

export function roundSignalPrice(val: number): number {
  if (!Number.isFinite(val) || val <= 0) return 0;
  if (val >= 1000) return Number(val.toFixed(2));
  if (val >= 10) return Number(val.toFixed(3));
  if (val >= 1) return Number(val.toFixed(4));
  if (val >= 0.01) return Number(val.toFixed(5));
  return Number(val.toFixed(7));
}

export function detectAutoSignalOpportunity(
  symbol: string,
  timeframe: Timeframe,
  candles: OhlcvCandle[],
  quoteVolume24h?: number,
): DetectedAutoSignal | null {
  if (!candles || candles.length < 60) return null;

  const summary = summarizeIndicators(symbol, timeframe, candles);
  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];
  const price = summary.lastPrice;

  if (!lastCandle || !prevCandle || !Number.isFinite(price) || price <= 0) {
    return null;
  }

  // Avoid extreme illiquid spikes or vertical blow-off candles
  const candleBodyPct = Math.abs(lastCandle.close - lastCandle.open) / Math.max(lastCandle.open, 1e-8);
  if (candleBodyPct > 0.08) return null;

  const rsi = summary.rsi14;
  const ema20 = summary.ema20;
  const ema50 = summary.ema50;
  const atr = summary.atr14 && summary.atr14 > 0 ? summary.atr14 : price * 0.018;
  const nearestSupport = summary.supportLevels[0] ?? null;
  const nearestResistance = summary.resistanceLevels[0] ?? null;
  const secondResistance = summary.resistanceLevels[1] ?? null;
  const lowerBb = summary.bollinger.lower;

  const isBullishClose = lastCandle.close > lastCandle.open || lastCandle.close > prevCandle.close;
  const macdBullish =
    summary.macd.line !== null &&
    summary.macd.signal !== null &&
    summary.macd.line > summary.macd.signal;
  const macdHistogramImproving =
    summary.macd.histogram !== null && summary.macd.histogram >= 0;
  const volumeHealthy = summary.volumeRatio === null || summary.volumeRatio >= 0.8;

  let setupTag: DetectedAutoSignal['setupTag'] | null = null;
  let score = 0;
  const reasonsAr: string[] = [];

  // Setup 1: Support Bounce (price near swing support or lower Bollinger with RSI recovery)
  const distToSupport =
    nearestSupport !== null && nearestSupport < price
      ? (price - nearestSupport) / price
      : null;
  const nearLowerBb = lowerBb !== null && price <= lowerBb * 1.018;

  if (
    ((distToSupport !== null && distToSupport <= 0.024) || nearLowerBb) &&
    rsi !== null &&
    rsi >= 28 &&
    rsi <= 56 &&
    isBullishClose &&
    volumeHealthy
  ) {
    setupTag = 'SUPPORT_BOUNCE';
    score += 75;
    if (distToSupport !== null) {
      reasonsAr.push(`ارتداد إيجابي قرب منطقة الدعم ${roundSignalPrice(nearestSupport!)}`);
    } else {
      reasonsAr.push('ارتداد من الحد السفلي لمؤشر بولينجر');
    }
    reasonsAr.push(`مؤشر RSI(${rsi.toFixed(1)}) في نطاق تعافٍ صحي`);
  }

  // Setup 2: Bullish Trend Pullback / Momentum (EMA20 > EMA50 + MACD bullish + RSI 48-68)
  if (
    !setupTag &&
    summary.trendDirection === 'BULLISH' &&
    ema20 !== null &&
    ema50 !== null &&
    ema20 > ema50 &&
    price >= ema20 * 0.992 &&
    price <= ema20 * 1.032 &&
    rsi !== null &&
    rsi >= 48 &&
    rsi <= 68 &&
    macdBullish &&
    macdHistogramImproving &&
    isBullishClose
  ) {
    setupTag = 'TREND_MOMENTUM';
    score += 80;
    reasonsAr.push(`اتجاه صاعد مؤكد (EMA20 فوق EMA50) مع تقاطع MACD إيجابي`);
    reasonsAr.push(`زخم RSI متوازن عند ${rsi.toFixed(1)} مع استقرار السعر أعلى المتوسط`);
  }

  // Setup 3: Oversold Reversal (RSI < 38 recovering with bullish candle & volume)
  if (
    !setupTag &&
    rsi !== null &&
    rsi >= 24 &&
    rsi <= 39 &&
    lastCandle.close > lastCandle.open &&
    lastCandle.close > prevCandle.high * 0.996 &&
    (summary.volumeRatio === null || summary.volumeRatio >= 1.05)
  ) {
    setupTag = 'OVERSOLD_REVERSAL';
    score += 70;
    reasonsAr.push(`إشارة انعكاس من تشبع بيعي RSI(${rsi.toFixed(1)}) مع شمعة ارتداد وتأكيد حجم التداول`);
  }

  if (!setupTag) return null;

  if (quoteVolume24h && quoteVolume24h > 100_000_000) score += 8;
  if (summary.volumeRatio && summary.volumeRatio >= 1.2) score += 6;
  if (macdBullish) score += 5;

  // Entry zone & risk levels
  const entryLow = roundSignalPrice(
    nearestSupport && distToSupport !== null && distToSupport <= 0.015
      ? Math.max(price * 0.988, nearestSupport * 1.001)
      : price * 0.994,
  );
  const entryHigh = roundSignalPrice(Math.max(entryLow * 1.001, price * 1.003));
  const refEntry = (entryLow + entryHigh) / 2;

  const rawSlFromAtr = entryLow - atr * 1.45;
  const rawSlFromSupport = nearestSupport ? nearestSupport * 0.988 : rawSlFromAtr;
  let stopLoss = roundSignalPrice(Math.min(rawSlFromAtr, rawSlFromSupport));

  // Clamp stop-loss distance between 1.5% and 7.5% below entryLow
  const minAllowedSl = entryLow * 0.925;
  const maxAllowedSl = entryLow * 0.985;
  if (stopLoss < minAllowedSl) stopLoss = roundSignalPrice(minAllowedSl);
  if (stopLoss > maxAllowedSl) stopLoss = roundSignalPrice(maxAllowedSl);

  const risk = refEntry - stopLoss;
  if (risk <= 0) return null;

  let tp1 = roundSignalPrice(
    nearestResistance && nearestResistance > entryHigh * 1.012 && nearestResistance < refEntry + risk * 2.1
      ? nearestResistance * 0.998
      : Math.max(entryHigh * 1.012, refEntry + risk * 1.35),
  );
  if (tp1 <= entryHigh) {
    tp1 = roundSignalPrice(entryHigh + risk * 1.25);
  }

  let tp2 = roundSignalPrice(
    secondResistance && secondResistance > tp1 * 1.01
      ? Math.min(secondResistance * 0.998, refEntry + risk * 3.0)
      : Math.max(tp1 * 1.012, refEntry + risk * 2.3),
  );
  if (tp2 <= tp1) {
    tp2 = roundSignalPrice(tp1 + risk * 0.95);
  }

  let tp3 = roundSignalPrice(Math.max(tp2 * 1.014, refEntry + risk * 3.4));
  if (tp3 <= tp2) {
    tp3 = roundSignalPrice(tp2 + risk * 1.15);
  }

  // Strict ordering verification
  if (!(stopLoss < entryLow && entryLow <= entryHigh && entryHigh < tp1 && tp1 < tp2 && tp2 < tp3)) {
    return null;
  }

  const riskRewardRatio = Number(((tp2 - refEntry) / risk).toFixed(2));
  if (riskRewardRatio < 1.35) return null;

  const tradeType: SignalTradeType =
    timeframe === '1m' || timeframe === '5m' || timeframe === '15m'
      ? 'SPOT_SCALP'
      : timeframe === '1d' || timeframe === '1w'
        ? 'SPOT_SWING'
        : 'SPOT_BUY';

  if (summary.volumeRatio && summary.volumeRatio >= 1.1) {
    reasonsAr.push(`حجم تداول ${summary.volumeRatio}x فوق المتوسط`);
  }

  return {
    symbol,
    timeframe,
    tradeType,
    entryLow,
    entryHigh,
    tp1,
    tp2,
    tp3,
    stopLoss,
    riskRewardRatio,
    score,
    setupTag,
    explanation: `فرصة آلية (${timeframe.toUpperCase()}): ${reasonsAr.join(' · ')}.`,
  };
}

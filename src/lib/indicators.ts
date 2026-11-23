import type {
  BollingerPoint,
  LinePoint,
  MacdPoint,
  OhlcvCandle,
  TechnicalIndicatorSeries,
  TechnicalIndicatorsSummary,
  Timeframe,
} from '../types/trading.ts';

function roundValue(val: number): number {
  if (!Number.isFinite(val)) return 0;
  if (Math.abs(val) >= 1000) return Number(val.toFixed(2));
  if (Math.abs(val) >= 1) return Number(val.toFixed(4));
  if (Math.abs(val) >= 0.01) return Number(val.toFixed(6));
  return Number(val.toFixed(8));
}

export function calculateEMA(candles: OhlcvCandle[], period: number): LinePoint[] {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  let ema = sum / period;
  const result: LinePoint[] = [{ time: candles[period - 1].time, value: roundValue(ema) }];

  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    result.push({ time: candles[i].time, value: roundValue(ema) });
  }
  return result;
}

export function calculateRSI(candles: OhlcvCandle[], period = 14): LinePoint[] {
  if (candles.length <= period) return [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  const result: LinePoint[] = [];
  const firstRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const firstRsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRs);
  result.push({ time: candles[period].time, value: Number(firstRsi.toFixed(2)) });

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    result.push({ time: candles[i + 1].time, value: Number(rsi.toFixed(2)) });
  }

  return result;
}

export function calculateMACD(
  candles: OhlcvCandle[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdPoint[] {
  const emaFast = calculateEMA(candles, fastPeriod);
  const emaSlow = calculateEMA(candles, slowPeriod);
  if (emaSlow.length === 0) return [];

  const fastMap = new Map<number, number>(emaFast.map((p) => [p.time, p.value]));
  const macdRaw: LinePoint[] = [];

  for (const slowPt of emaSlow) {
    const fastVal = fastMap.get(slowPt.time);
    if (fastVal !== undefined) {
      macdRaw.push({
        time: slowPt.time,
        value: fastVal - slowPt.value,
      });
    }
  }

  if (macdRaw.length < signalPeriod) return [];

  const k = 2 / (signalPeriod + 1);
  let signalSum = 0;
  for (let i = 0; i < signalPeriod; i++) {
    signalSum += macdRaw[i].value;
  }
  let signalEma = signalSum / signalPeriod;

  const points: MacdPoint[] = [
    {
      time: macdRaw[signalPeriod - 1].time,
      macd: roundValue(macdRaw[signalPeriod - 1].value),
      signal: roundValue(signalEma),
      histogram: roundValue(macdRaw[signalPeriod - 1].value - signalEma),
    },
  ];

  for (let i = signalPeriod; i < macdRaw.length; i++) {
    signalEma = macdRaw[i].value * k + signalEma * (1 - k);
    points.push({
      time: macdRaw[i].time,
      macd: roundValue(macdRaw[i].value),
      signal: roundValue(signalEma),
      histogram: roundValue(macdRaw[i].value - signalEma),
    });
  }

  return points;
}

export function calculateBollingerBands(
  candles: OhlcvCandle[],
  period = 20,
  stdDevMultiplier = 2,
): BollingerPoint[] {
  if (candles.length < period) return [];
  const points: BollingerPoint[] = [];

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += candles[j].close;
    }
    const mean = sum / period;

    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = candles[j].close - mean;
      sqSum += diff * diff;
    }
    const stdDev = Math.sqrt(sqSum / period);

    points.push({
      time: candles[i].time,
      upper: roundValue(mean + stdDevMultiplier * stdDev),
      middle: roundValue(mean),
      lower: roundValue(mean - stdDevMultiplier * stdDev),
    });
  }

  return points;
}

export function calculateATR(candles: OhlcvCandle[], period = 14): LinePoint[] {
  if (candles.length <= period) return [];
  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    );
    trueRanges.push(tr);
  }

  let atr = 0;
  for (let i = 0; i < period; i++) {
    atr += trueRanges[i];
  }
  atr /= period;

  const result: LinePoint[] = [{ time: candles[period].time, value: roundValue(atr) }];
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result.push({ time: candles[i + 1].time, value: roundValue(atr) });
  }

  return result;
}

export function calculateSupportResistance(
  candles: OhlcvCandle[],
  lastPrice: number,
): { supports: number[]; resistances: number[] } {
  if (candles.length < 15) return { supports: [], resistances: [] };

  const lookback = candles.slice(-120);
  const swingLows: number[] = [];
  const swingHighs: number[] = [];
  const window = 3;

  for (let i = window; i < lookback.length - window; i++) {
    let isLow = true;
    let isHigh = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (lookback[j].low <= lookback[i].low) isLow = false;
      if (lookback[j].high >= lookback[i].high) isHigh = false;
    }
    if (isLow) swingLows.push(lookback[i].low);
    if (isHigh) swingHighs.push(lookback[i].high);
  }

  // Cluster nearby levels within 0.6% tolerance
  const clusterLevels = (levels: number[]): number[] => {
    const sorted = [...levels].sort((a, b) => a - b);
    const clusters: number[][] = [];
    for (const lvl of sorted) {
      const lastCluster = clusters[clusters.length - 1];
      if (lastCluster && Math.abs(lvl - lastCluster[0]) / Math.max(lastCluster[0], 1e-8) < 0.006) {
        lastCluster.push(lvl);
      } else {
        clusters.push([lvl]);
      }
    }
    return clusters
      .map((c) => ({
        avg: roundValue(c.reduce((a, b) => a + b, 0) / c.length),
        weight: c.length,
      }))
      .sort((a, b) => b.weight - a.weight)
      .map((c) => c.avg);
  };

  const allPivots = [...swingLows, ...swingHighs];
  const clustered = clusterLevels(allPivots);

  const supports = clustered
    .filter((lvl) => lvl < lastPrice * 0.999)
    .sort((a, b) => b - a)
    .slice(0, 4);

  const resistances = clustered
    .filter((lvl) => lvl > lastPrice * 1.001)
    .sort((a, b) => a - b)
    .slice(0, 4);

  return { supports, resistances };
}

export function computeIndicatorSeries(candles: OhlcvCandle[]): TechnicalIndicatorSeries {
  return {
    ema20: calculateEMA(candles, 20),
    ema50: calculateEMA(candles, 50),
    ema200: calculateEMA(candles, 200),
    rsi14: calculateRSI(candles, 14),
    macd: calculateMACD(candles, 12, 26, 9),
    bollinger: calculateBollingerBands(candles, 20, 2),
    atr14: calculateATR(candles, 14),
  };
}

export function summarizeIndicators(
  symbol: string,
  timeframe: Timeframe,
  candles: OhlcvCandle[],
): TechnicalIndicatorsSummary {
  const series = computeIndicatorSeries(candles);
  const lastCandle = candles[candles.length - 1];
  const lastPrice = lastCandle ? lastCandle.close : 0;

  const ema20 = series.ema20.length ? series.ema20[series.ema20.length - 1].value : null;
  const ema50 = series.ema50.length ? series.ema50[series.ema50.length - 1].value : null;
  const ema200 = series.ema200.length ? series.ema200[series.ema200.length - 1].value : null;
  const rsi14 = series.rsi14.length ? series.rsi14[series.rsi14.length - 1].value : null;
  const lastMacd = series.macd.length ? series.macd[series.macd.length - 1] : null;
  const lastBb = series.bollinger.length ? series.bollinger[series.bollinger.length - 1] : null;
  const atr14 = series.atr14.length ? series.atr14[series.atr14.length - 1].value : null;

  const bandwidthPercent =
    lastBb && lastBb.middle > 0
      ? Number((((lastBb.upper - lastBb.lower) / lastBb.middle) * 100).toFixed(2))
      : null;

  const atrPercent = atr14 !== null && lastPrice > 0 ? Number(((atr14 / lastPrice) * 100).toFixed(2)) : null;

  let volumeSma20: number | null = null;
  let volumeRatio: number | null = null;
  if (candles.length >= 20 && lastCandle) {
    const volSlice = candles.slice(-20);
    volumeSma20 = volSlice.reduce((acc, c) => acc + c.volume, 0) / 20;
    volumeRatio = volumeSma20 > 0 ? Number((lastCandle.volume / volumeSma20).toFixed(2)) : null;
  }

  const { supports, resistances } = calculateSupportResistance(candles, lastPrice);

  let bullScore = 0;
  let bearScore = 0;
  if (ema20 !== null && ema50 !== null) {
    if (lastPrice > ema20 && ema20 > ema50) bullScore += 2;
    else if (lastPrice < ema20 && ema20 < ema50) bearScore += 2;
  }
  if (ema200 !== null) {
    if (lastPrice > ema200) bullScore += 1;
    else bearScore += 1;
  }
  if (lastMacd) {
    if (lastMacd.macd > lastMacd.signal && lastMacd.histogram > 0) bullScore += 1;
    else if (lastMacd.macd < lastMacd.signal && lastMacd.histogram < 0) bearScore += 1;
  }
  if (rsi14 !== null) {
    if (rsi14 >= 55) bullScore += 1;
    else if (rsi14 <= 45) bearScore += 1;
  }

  let trendDirection: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' = 'SIDEWAYS';
  let trendStrength: 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';

  const netScore = Math.abs(bullScore - bearScore);
  if (bullScore >= 3 && bullScore > bearScore) {
    trendDirection = 'BULLISH';
    trendStrength = netScore >= 4 ? 'STRONG' : 'MODERATE';
  } else if (bearScore >= 3 && bearScore > bullScore) {
    trendDirection = 'BEARISH';
    trendStrength = netScore >= 4 ? 'STRONG' : 'MODERATE';
  } else {
    trendDirection = 'SIDEWAYS';
    trendStrength = 'WEAK';
  }

  // Market structure check via last two swing segments
  let marketStructure = 'Consolidation / Range-bound price action';
  if (candles.length >= 30) {
    const prevHalf = candles.slice(-30, -15);
    const currHalf = candles.slice(-15);
    const prevHigh = Math.max(...prevHalf.map((c) => c.high));
    const prevLow = Math.min(...prevHalf.map((c) => c.low));
    const currHigh = Math.max(...currHalf.map((c) => c.high));
    const currLow = Math.min(...currHalf.map((c) => c.low));

    if (currHigh > prevHigh && currLow > prevLow) {
      marketStructure = 'Higher Highs & Higher Lows (Bullish Structure)';
    } else if (currHigh < prevHigh && currLow < prevLow) {
      marketStructure = 'Lower Highs & Lower Lows (Bearish Structure)';
    } else if (currHigh > prevHigh && currLow < prevLow) {
      marketStructure = 'Expanding Volatility Range (Broadening Structure)';
    } else {
      marketStructure = 'Tightening Consolidation (Lower Highs & Higher Lows)';
    }
  }

  let volatilityState: 'LOW' | 'NORMAL' | 'HIGH' = 'NORMAL';
  if (atrPercent !== null) {
    if (atrPercent < 0.8) volatilityState = 'LOW';
    else if (atrPercent > 3.2) volatilityState = 'HIGH';
  }

  return {
    symbol,
    timeframe,
    candleCount: candles.length,
    lastPrice,
    lastCandleTime: lastCandle ? lastCandle.time : 0,
    ema20,
    ema50,
    ema200,
    rsi14,
    macd: {
      line: lastMacd ? lastMacd.macd : null,
      signal: lastMacd ? lastMacd.signal : null,
      histogram: lastMacd ? lastMacd.histogram : null,
    },
    bollinger: {
      upper: lastBb ? lastBb.upper : null,
      middle: lastBb ? lastBb.middle : null,
      lower: lastBb ? lastBb.lower : null,
      bandwidthPercent,
    },
    atr14,
    atrPercent,
    volumeSma20: volumeSma20 !== null ? Number(volumeSma20.toFixed(2)) : null,
    volumeRatio,
    supportLevels: supports,
    resistanceLevels: resistances,
    trendDirection,
    trendStrength,
    marketStructure,
    volatilityState,
  };
}

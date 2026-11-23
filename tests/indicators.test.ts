import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateATR,
  calculateBollingerBands,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  summarizeIndicators,
} from '../src/lib/indicators.ts';
import type { OhlcvCandle } from '../src/types/trading.ts';

function generateLinearCandles(count: number, startPrice = 100, step = 1): OhlcvCandle[] {
  const candles: OhlcvCandle[] = [];
  for (let i = 0; i < count; i++) {
    const close = startPrice + i * step;
    candles.push({
      time: 1_700_000_000 + i * 3600,
      open: close - 0.5,
      high: close + 1.5,
      low: close - 1.5,
      close,
      volume: 1000 + i * 10,
      closeTime: 1_700_000_000 + (i + 1) * 3600,
    });
  }
  return candles;
}

describe('Technical Indicators Engine', () => {
  it('computes EMA 20/50/200 deterministically', () => {
    const candles = generateLinearCandles(250, 100, 0.5);
    const ema20 = calculateEMA(candles, 20);
    const ema50 = calculateEMA(candles, 50);
    const ema200 = calculateEMA(candles, 200);

    assert.equal(ema20.length, 250 - 20 + 1);
    assert.equal(ema50.length, 250 - 50 + 1);
    assert.equal(ema200.length, 250 - 200 + 1);
    // In a strictly rising series, faster EMA > slower EMA
    assert.ok(ema20[ema20.length - 1].value > ema50[ema50.length - 1].value);
    assert.ok(ema50[ema50.length - 1].value > ema200[ema200.length - 1].value);
  });

  it('computes RSI 14 within [0, 100] and near 100 on monotonic uptrend', () => {
    const candles = generateLinearCandles(40, 50, 1);
    const rsi = calculateRSI(candles, 14);
    assert.ok(rsi.length > 0);
    const last = rsi[rsi.length - 1].value;
    assert.ok(last >= 99 && last <= 100);
  });

  it('computes MACD, Bollinger Bands, ATR, and Bullish Summary', () => {
    const candles = generateLinearCandles(260, 100, 0.4);
    const macd = calculateMACD(candles);
    const bb = calculateBollingerBands(candles, 20, 2);
    const atr = calculateATR(candles, 14);
    const summary = summarizeIndicators('BTCUSDT', '1h', candles);

    assert.ok(macd.length > 0);
    assert.ok(bb.length > 0);
    assert.ok(atr.length > 0);
    assert.ok(bb[bb.length - 1].upper > bb[bb.length - 1].middle);
    assert.ok(bb[bb.length - 1].middle > bb[bb.length - 1].lower);
    assert.equal(summary.trendDirection, 'BULLISH');
    assert.equal(summary.symbol, 'BTCUSDT');
  });
});

import { Router } from 'express';
import { z } from 'zod';
import { binanceMarket } from '../services/binanceMarket.ts';
import { computeIndicatorSeries, summarizeIndicators } from '../../src/lib/indicators.ts';
import type { Timeframe } from '../../src/types/trading.ts';

const router = Router();

const timeframeSchema = z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']).default('1h');
const symbolSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[a-zA-Z0-9]+$/)
  .transform((s) => s.toUpperCase());

router.get('/tickers', async (req, res) => {
  try {
    const quote = typeof req.query.quote === 'string' ? req.query.quote : 'USDT';
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const sortParam = typeof req.query.sort === 'string' ? req.query.sort : 'volume';
    const sort = ['volume', 'gainers', 'losers', 'trending'].includes(sortParam)
      ? (sortParam as 'volume' | 'gainers' | 'losers' | 'trending')
      : 'volume';
    const limit = Math.min(Number(req.query.limit || 150), 400);

    const tickers = await binanceMarket.getMarketTickers({ quote, search, sort, limit });
    res.json({
      source: 'Binance Spot Public Market Data',
      status: binanceMarket.getStatus(),
      timestamp: new Date().toISOString(),
      count: tickers.length,
      tickers,
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to load Binance market tickers',
    });
  }
});

router.get('/ticker/:symbol', async (req, res) => {
  try {
    const parsed = symbolSchema.safeParse(req.params.symbol);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid trading symbol' });
      return;
    }
    const ticker = await binanceMarket.getTickerBySymbol(parsed.data);
    if (!ticker) {
      res.status(404).json({ error: `Trading pair ${parsed.data} not found on Binance Spot` });
      return;
    }
    res.json({
      source: 'Binance Spot Public Market Data',
      timestamp: new Date().toISOString(),
      ticker,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to load ticker' });
  }
});

router.get('/klines', async (req, res) => {
  try {
    const symbolRes = symbolSchema.safeParse(req.query.symbol || 'BTCUSDT');
    const tfRes = timeframeSchema.safeParse(req.query.interval || '1h');
    if (!symbolRes.success || !tfRes.success) {
      res.status(400).json({ error: 'Invalid symbol or timeframe' });
      return;
    }
    const limit = Math.min(Math.max(Number(req.query.limit || 300), 30), 1000);
    const candles = await binanceMarket.getKlines(symbolRes.data, tfRes.data, limit);
    res.json({
      symbol: symbolRes.data,
      interval: tfRes.data,
      source: 'Binance Spot Klines',
      timestamp: new Date().toISOString(),
      candles,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch OHLCV candles' });
  }
});

router.get('/depth', async (req, res) => {
  try {
    const symbolRes = symbolSchema.safeParse(req.query.symbol || 'BTCUSDT');
    if (!symbolRes.success) {
      res.status(400).json({ error: 'Invalid symbol' });
      return;
    }
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 5), 50);
    const depth = await binanceMarket.getOrderBook(symbolRes.data, limit);
    res.json({
      source: 'Binance Spot Order Book',
      depth,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch order book' });
  }
});

router.get('/indicators', async (req, res) => {
  try {
    const symbolRes = symbolSchema.safeParse(req.query.symbol || 'BTCUSDT');
    const tfRes = timeframeSchema.safeParse(req.query.interval || '1h');
    if (!symbolRes.success || !tfRes.success) {
      res.status(400).json({ error: 'Invalid symbol or interval' });
      return;
    }
    const candles = await binanceMarket.getKlines(symbolRes.data, tfRes.data, 350);
    const series = computeIndicatorSeries(candles);
    const summary = summarizeIndicators(symbolRes.data, tfRes.data, candles);
    res.json({
      source: 'Binance Spot OHLCV + Deterministic Technical Calculations',
      timestamp: new Date().toISOString(),
      candles,
      series,
      summary,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to compute indicators' });
  }
});

router.get('/multi-timeframe', async (req, res) => {
  try {
    const symbolRes = symbolSchema.safeParse(req.query.symbol || 'BTCUSDT');
    if (!symbolRes.success) {
      res.status(400).json({ error: 'Invalid symbol' });
      return;
    }
    const timeframes: Timeframe[] = ['15m', '1h', '4h', '1d'];
    const results = await Promise.all(
      timeframes.map(async (tf) => {
        const candles = await binanceMarket.getKlines(symbolRes.data, tf, 240);
        return summarizeIndicators(symbolRes.data, tf, candles);
      }),
    );
    res.json({
      symbol: symbolRes.data,
      source: 'Binance Spot Multi-Timeframe Analysis',
      timestamp: new Date().toISOString(),
      timeframes: results,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed multi-timeframe calculation' });
  }
});

router.get('/global', async (_req, res) => {
  const global = await binanceMarket.getGlobalStats();
  if (!global) {
    res.json({
      available: false,
      source: 'CoinGecko Global API (temporarily unavailable)',
      data: null,
    });
    return;
  }
  res.json({
    available: true,
    source: 'CoinGecko Global Market Data',
    timestamp: new Date().toISOString(),
    data: global,
  });
});

export default router;

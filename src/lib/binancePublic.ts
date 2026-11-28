import { summarizeIndicators } from './indicators.ts';
import type {
  MarketTicker,
  OhlcvCandle,
  OrderBookSnapshot,
  TechnicalIndicatorsSummary,
  Timeframe,
} from '../types/trading.ts';

const BINANCE_PUBLIC_REST_BASES = [
  'https://api.binance.com/api/v3',
  'https://data-api.binance.vision/api/v3',
  'https://api1.binance.com/api/v3',
  'https://api4.binance.com/api/v3',
] as const;

export const BINANCE_PUBLIC_WS_URLS = [
  'wss://stream.binance.com:9443/ws/!miniTicker@arr',
  'wss://data-stream.binance.vision/ws/!miniTicker@arr',
] as const;

const EXCLUDED_SUFFIXES = ['UPUSDT', 'DOWNUSDT', 'BULLUSDT', 'BEARUSDT'];

interface RawBinanceTicker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  closeTime: number;
  count: number;
}

interface CoinGeckoMarketRow {
  symbol: string;
  current_price: number | null;
  price_change_24h: number | null;
  price_change_percentage_24h: number | null;
  high_24h: number | null;
  low_24h: number | null;
  total_volume: number | null;
  last_updated?: string;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 8500): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`HTTP_${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBinancePublicJson<T>(pathAndQuery: string, timeoutMs = 8500): Promise<T> {
  let lastErr: unknown = null;
  for (const base of BINANCE_PUBLIC_REST_BASES) {
    try {
      return await fetchJsonWithTimeout<T>(`${base}${pathAndQuery}`, timeoutMs);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('BINANCE_UNREACHABLE');
}

export async function fetchDirectBinanceTickers(limit = 250): Promise<{
  tickers: MarketTicker[];
  source: 'binance' | 'coingecko-fallback';
  fetchedAt: number;
}> {
  try {
    const raw = await fetchBinancePublicJson<RawBinanceTicker24hr[]>('/ticker/24hr', 9500);
    const now = Date.now();
    const mapped: MarketTicker[] = [];

    for (const t of raw) {
      if (!t.symbol || !t.symbol.endsWith('USDT')) continue;
      if (EXCLUDED_SUFFIXES.some((suf) => t.symbol.endsWith(suf))) continue;

      const lastPrice = Number(t.lastPrice);
      const quoteVolume = Number(t.quoteVolume);
      const count = Number(t.count);
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;
      if (!Number.isFinite(quoteVolume) || quoteVolume <= 0) continue;
      if (!Number.isFinite(count) || count <= 0) continue;

      const baseAsset = t.symbol.slice(0, -4);
      if (!baseAsset) continue;

      mapped.push({
        symbol: t.symbol,
        baseAsset,
        quoteAsset: 'USDT',
        lastPrice,
        priceChange: Number(t.priceChange) || 0,
        priceChangePercent: Number(t.priceChangePercent) || 0,
        highPrice: Number(t.highPrice) || lastPrice,
        lowPrice: Number(t.lowPrice) || lastPrice,
        volume: Number(t.volume) || 0,
        quoteVolume,
        weightedAvgPrice: Number(t.weightedAvgPrice) || lastPrice,
        bidPrice: Number(t.bidPrice) || lastPrice,
        askPrice: Number(t.askPrice) || lastPrice,
        count,
        updatedAt: t.closeTime || now,
      });
    }

    if (mapped.length > 0) {
      mapped.sort((a, b) => b.quoteVolume - a.quoteVolume);
      return {
        tickers: mapped.slice(0, limit),
        source: 'binance',
        fetchedAt: now,
      };
    }
  } catch {
    // Fall through to safe CORS-enabled CoinGecko fallback
  }

  try {
    const cg = await fetchJsonWithTimeout<CoinGeckoMarketRow[]>(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h',
      8500,
    );
    const now = Date.now();
    const fallbackTickers: MarketTicker[] = [];
    const seen = new Set<string>();

    for (const c of cg) {
      const baseAsset = String(c.symbol || '').trim().toUpperCase();
      const price = Number(c.current_price);
      if (!baseAsset || baseAsset === 'USDT' || !Number.isFinite(price) || price <= 0) continue;
      const symbol = `${baseAsset}USDT`;
      if (seen.has(symbol)) continue;
      seen.add(symbol);

      const quoteVolume = Number(c.total_volume) || 0;
      fallbackTickers.push({
        symbol,
        baseAsset,
        quoteAsset: 'USDT',
        lastPrice: price,
        priceChange: Number(c.price_change_24h) || 0,
        priceChangePercent: Number(c.price_change_percentage_24h) || 0,
        highPrice: Number(c.high_24h) || price,
        lowPrice: Number(c.low_24h) || price,
        volume: price > 0 ? quoteVolume / price : 0,
        quoteVolume,
        weightedAvgPrice: price,
        bidPrice: price,
        askPrice: price,
        count: Math.max(100, Math.round(quoteVolume / 1000)),
        updatedAt: c.last_updated ? Date.parse(c.last_updated) || now : now,
      });
    }

    if (fallbackTickers.length > 0) {
      return {
        tickers: fallbackTickers.slice(0, limit),
        source: 'coingecko-fallback',
        fetchedAt: now,
      };
    }
  } catch {
    // Both primary Binance endpoints and fallback failed
  }

  throw new Error('MARKET_FEED_UNAVAILABLE');
}

export async function fetchDirectBinanceKlines(
  symbol: string,
  interval: Timeframe = '1h',
  limit = 350,
): Promise<OhlcvCandle[]> {
  const upper = symbol.trim().toUpperCase();
  const safeLimit = Math.min(Math.max(limit, 30), 1000);
  type RawKline = [number, string, string, string, string, string, number, ...unknown[]];
  const rows = await fetchBinancePublicJson<RawKline[]>(
    `/klines?symbol=${encodeURIComponent(upper)}&interval=${encodeURIComponent(interval)}&limit=${safeLimit}`,
    8500,
  );
  return rows.map((r) => ({
    time: Math.floor(r[0] / 1000),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
    closeTime: Math.floor(Number(r[6]) / 1000),
  }));
}

export async function fetchDirectBinanceIndicators(
  symbol: string,
  interval: Timeframe = '1h',
  limit = 350,
): Promise<{ candles: OhlcvCandle[]; summary: TechnicalIndicatorsSummary }> {
  const upper = symbol.trim().toUpperCase();
  const candles = await fetchDirectBinanceKlines(upper, interval, limit);
  const summary = summarizeIndicators(upper, interval, candles);
  return { candles, summary };
}

export async function fetchDirectBinanceMultiTimeframe(
  symbol: string,
): Promise<TechnicalIndicatorsSummary[]> {
  const upper = symbol.trim().toUpperCase();
  const timeframes: Timeframe[] = ['15m', '1h', '4h', '1d'];
  return Promise.all(
    timeframes.map(async (tf) => {
      const candles = await fetchDirectBinanceKlines(upper, tf, 240);
      return summarizeIndicators(upper, tf, candles);
    }),
  );
}

export async function fetchDirectBinanceOrderBook(
  symbol: string,
  limit = 15,
): Promise<OrderBookSnapshot> {
  const upper = symbol.trim().toUpperCase();
  const safeLimit = Math.min(Math.max(limit, 5), 50);
  interface RawDepth {
    bids: [string, string][];
    asks: [string, string][];
  }
  const raw = await fetchBinancePublicJson<RawDepth>(
    `/depth?symbol=${encodeURIComponent(upper)}&limit=${safeLimit}`,
    6500,
  );
  const bids = raw.bids.map(([p, q]) => ({ price: Number(p), qty: Number(q) }));
  const asks = raw.asks.map(([p, q]) => ({ price: Number(p), qty: Number(q) }));
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const spreadPercent = bestBid > 0 ? Number((((bestAsk - bestBid) / bestBid) * 100).toFixed(4)) : 0;
  const bidVolumeTop20 = bids.reduce((acc, b) => acc + b.qty, 0);
  const askVolumeTop20 = asks.reduce((acc, a) => acc + a.qty, 0);
  const total = bidVolumeTop20 + askVolumeTop20;
  const imbalanceRatio = total > 0 ? Number(((bidVolumeTop20 - askVolumeTop20) / total).toFixed(3)) : 0;

  return {
    symbol: upper,
    bids,
    asks,
    bestBid,
    bestAsk,
    spreadPercent,
    bidVolumeTop20: Number(bidVolumeTop20.toFixed(4)),
    askVolumeTop20: Number(askVolumeTop20.toFixed(4)),
    imbalanceRatio,
    updatedAt: Date.now(),
  };
}

export interface GlobalMarketStats {
  total_market_cap?: { usd?: number };
  total_volume?: { usd?: number };
  market_cap_percentage?: { btc?: number; eth?: number };
  market_cap_change_percentage_24h_usd?: number;
}

export async function fetchDirectGlobalStats(): Promise<GlobalMarketStats | null> {
  try {
    const res = await fetchJsonWithTimeout<{ data?: GlobalMarketStats }>(
      'https://api.coingecko.com/api/v3/global',
      5000,
    );
    return res?.data ?? null;
  } catch {
    return null;
  }
}

export function formatMarketFeedError(err: unknown, language: 'ar' | 'en'): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (
    raw === 'MARKET_FEED_UNAVAILABLE' ||
    raw.includes('NOT_FOUND') ||
    raw.includes('Failed to fetch') ||
    raw.includes('NetworkError') ||
    raw.includes('AbortError') ||
    raw.includes('HTTP_404')
  ) {
    return language === 'ar'
      ? 'تعذر جلب بيانات السوق الحية من Binance أو المصدر البديل حالياً بسبب قيود الشبكة أو CORS. يرجى التحقق من اتصالك والمحاولة مرة أخرى.'
      : 'Unable to fetch live Binance Spot data due to network or CORS restrictions. Please check your connection and retry.';
  }
  return language === 'ar'
    ? 'حدث خطأ أثناء تحميل بيانات السوق الحية. يرجى إعادة المحاولة.'
    : raw || 'Unable to load Binance Spot market data';
}

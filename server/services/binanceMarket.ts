import WebSocket from 'ws';
import type {
  MarketTicker,
  OhlcvCandle,
  OrderBookSnapshot,
  Timeframe,
} from '../../src/types/trading.ts';

const BINANCE_REST_BASES = [
  'https://data-api.binance.vision/api/v3',
  'https://api.binance.com/api/v3',
];

const BINANCE_WS_URLS = [
  'wss://data-stream.binance.vision/ws/!miniTicker@arr',
  'wss://stream.binance.com:9443/ws/!miniTicker@arr',
];

interface ExchangePairMeta {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
}

type PriceTickHandler = (updates: Array<{ symbol: string; price: number; high24h: number; low24h: number }>) => void;

class BinanceMarketService {
  private pairMetaMap = new Map<string, ExchangePairMeta>();
  private tickerMap = new Map<string, MarketTicker>();
  private lastExchangeInfoSync = 0;
  private lastTickerSync = 0;
  private lastWsTickAt: number | null = null;
  private wsConnected = false;
  private wsClient: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private wsUrlIndex = 0;
  private tickListeners = new Set<PriceTickHandler>();
  private globalStatsCache: { data: Record<string, unknown> | null; fetchedAt: number } = {
    data: null,
    fetchedAt: 0,
  };

  public start(): void {
    this.ensureExchangeInfo().catch((err) => {
      console.warn('[BinanceMarket] Initial exchangeInfo sync failed:', err instanceof Error ? err.message : err);
    });
    this.refreshAllTickers().catch((err) => {
      console.warn('[BinanceMarket] Initial 24hr ticker sync failed:', err instanceof Error ? err.message : err);
    });
    this.connectWebSocket();

    // Stale-data watchdog every 15s
    setInterval(() => {
      if (this.wsConnected && this.lastWsTickAt && Date.now() - this.lastWsTickAt > 35_000) {
        console.warn('[BinanceMarket] Stale WebSocket detected (>35s without tick). Reconnecting...');
        this.wsConnected = false;
        this.wsClient?.terminate();
      }
    }, 15_000);
  }

  public onPriceTick(handler: PriceTickHandler): () => void {
    this.tickListeners.add(handler);
    return () => {
      this.tickListeners.delete(handler);
    };
  }

  public getStatus() {
    const stale = this.lastWsTickAt ? Date.now() - this.lastWsTickAt > 35_000 : true;
    return {
      ok: this.tickerMap.size > 0,
      wsConnected: this.wsConnected && !stale,
      lastTickAt: this.lastWsTickAt,
      pairCount: this.tickerMap.size,
      source: 'Binance Spot Public API (data-api.binance.vision)',
    };
  }

  public getLivePrice(symbol: string): number | null {
    const upper = symbol.toUpperCase();
    return this.tickerMap.get(upper)?.lastPrice ?? null;
  }

  private async fetchWithFallback<T>(pathAndQuery: string, timeoutMs = 8000): Promise<T> {
    let lastError: Error | null = null;
    for (const base of BINANCE_REST_BASES) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(`${base}${pathAndQuery}`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          });
          clearTimeout(timer);

          if (res.status === 429 || res.status === 418) {
            const retryAfter = Number(res.headers.get('Retry-After') || 2);
            await new Promise((r) => setTimeout(r, Math.min(retryAfter * 1000, 4000)));
            continue;
          }

          if (!res.ok) {
            throw new Error(`Binance HTTP ${res.status} for ${pathAndQuery}`);
          }
          return (await res.json()) as T;
        } catch (err) {
          clearTimeout(timer);
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }
    }
    throw lastError ?? new Error(`Failed to fetch ${pathAndQuery} from Binance`);
  }

  public async ensureExchangeInfo(): Promise<void> {
    if (Date.now() - this.lastExchangeInfoSync < 3_600_000 && this.pairMetaMap.size > 0) {
      return;
    }
    interface ExchangeInfoRes {
      symbols: Array<{
        symbol: string;
        status: string;
        baseAsset: string;
        quoteAsset: string;
        isSpotTradingAllowed?: boolean;
      }>;
    }
    const info = await this.fetchWithFallback<ExchangeInfoRes>('/exchangeInfo?permissions=SPOT', 10_000);
    const nextMap = new Map<string, ExchangePairMeta>();
    for (const s of info.symbols) {
      if (s.status === 'TRADING') {
        nextMap.set(s.symbol, {
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          status: s.status,
        });
      }
    }
    this.pairMetaMap = nextMap;
    this.lastExchangeInfoSync = Date.now();
  }

  public async refreshAllTickers(): Promise<MarketTicker[]> {
    if (Date.now() - this.lastTickerSync < 5000 && this.tickerMap.size > 0) {
      return Array.from(this.tickerMap.values());
    }

    await this.ensureExchangeInfo();

    interface RawTicker24hr {
      symbol: string;
      priceChange: string;
      priceChangePercent: string;
      weightedAvgPrice: string;
      lastPrice: string;
      bidPrice: string;
      askPrice: string;
      openPrice: string;
      highPrice: string;
      lowPrice: string;
      volume: string;
      quoteVolume: string;
      closeTime: number;
      count: number;
    }

    const raw = await this.fetchWithFallback<RawTicker24hr[]>('/ticker/24hr', 10_000);
    const now = Date.now();

    for (const t of raw) {
      const meta = this.pairMetaMap.get(t.symbol);
      if (!meta) continue;
      const lastPrice = Number(t.lastPrice);
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;

      this.tickerMap.set(t.symbol, {
        symbol: t.symbol,
        baseAsset: meta.baseAsset,
        quoteAsset: meta.quoteAsset,
        lastPrice,
        priceChange: Number(t.priceChange),
        priceChangePercent: Number(t.priceChangePercent),
        highPrice: Number(t.highPrice),
        lowPrice: Number(t.lowPrice),
        volume: Number(t.volume),
        quoteVolume: Number(t.quoteVolume),
        weightedAvgPrice: Number(t.weightedAvgPrice),
        bidPrice: Number(t.bidPrice),
        askPrice: Number(t.askPrice),
        count: Number(t.count),
        updatedAt: t.closeTime || now,
      });
    }

    this.lastTickerSync = now;
    return Array.from(this.tickerMap.values());
  }

  public async getMarketTickers(options: {
    quote?: string;
    search?: string;
    sort?: 'volume' | 'gainers' | 'losers' | 'trending';
    limit?: number;
  }): Promise<MarketTicker[]> {
    let tickers = await this.refreshAllTickers();
    const quote = (options.quote || 'USDT').toUpperCase();
    if (quote !== 'ALL') {
      tickers = tickers.filter((t) => t.quoteAsset === quote);
    }

    if (options.search) {
      const q = options.search.trim().toUpperCase();
      tickers = tickers.filter(
        (t) => t.symbol.includes(q) || t.baseAsset.includes(q),
      );
    }

    const sort = options.sort || 'volume';
    if (sort === 'gainers') {
      tickers.sort((a, b) => b.priceChangePercent - a.priceChangePercent);
    } else if (sort === 'losers') {
      tickers.sort((a, b) => a.priceChangePercent - b.priceChangePercent);
    } else if (sort === 'trending') {
      // Trending based on actual trade count weighted by quote volume and momentum
      tickers.sort((a, b) => {
        const scoreA = a.count * (1 + Math.abs(a.priceChangePercent) / 100);
        const scoreB = b.count * (1 + Math.abs(b.priceChangePercent) / 100);
        return scoreB - scoreA;
      });
    } else {
      tickers.sort((a, b) => b.quoteVolume - a.quoteVolume);
    }

    if (options.limit && options.limit > 0) {
      return tickers.slice(0, options.limit);
    }
    return tickers;
  }

  public async getTickerBySymbol(symbol: string): Promise<MarketTicker | null> {
    const upper = symbol.trim().toUpperCase();
    await this.refreshAllTickers();
    return this.tickerMap.get(upper) ?? null;
  }

  public async getKlines(
    symbol: string,
    interval: Timeframe = '1h',
    limit = 300,
  ): Promise<OhlcvCandle[]> {
    const upper = symbol.trim().toUpperCase();
    const safeLimit = Math.min(Math.max(limit, 20), 1000);
    type RawKline = [number, string, string, string, string, string, number, ...unknown[]];
    const rows = await this.fetchWithFallback<RawKline[]>(
      `/klines?symbol=${encodeURIComponent(upper)}&interval=${encodeURIComponent(interval)}&limit=${safeLimit}`,
      8000,
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

  public async getOrderBook(symbol: string, limit = 20): Promise<OrderBookSnapshot> {
    const upper = symbol.trim().toUpperCase();
    const safeLimit = Math.min(Math.max(limit, 5), 50);
    interface RawDepth {
      bids: [string, string][];
      asks: [string, string][];
    }
    const raw = await this.fetchWithFallback<RawDepth>(
      `/depth?symbol=${encodeURIComponent(upper)}&limit=${safeLimit}`,
      6000,
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

  public async getGlobalStats() {
    if (Date.now() - this.globalStatsCache.fetchedAt < 180_000 && this.globalStatsCache.data) {
      return this.globalStatsCache.data;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('https://api.coingecko.com/api/v3/global', {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!res.ok) return this.globalStatsCache.data;
      const json = (await res.json()) as { data?: Record<string, unknown> };
      if (json?.data) {
        this.globalStatsCache = { data: json.data, fetchedAt: Date.now() };
        return json.data;
      }
    } catch {
      // Optional enrichment: return cached or null silently without fabricating values
    }
    return this.globalStatsCache.data;
  }

  private connectWebSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const url = BINANCE_WS_URLS[this.wsUrlIndex % BINANCE_WS_URLS.length];
    const ws = new WebSocket(url);
    this.wsClient = ws;

    ws.on('open', () => {
      this.wsConnected = true;
      this.reconnectAttempt = 0;
      this.lastWsTickAt = Date.now();
    });

    ws.on('message', (rawBuf) => {
      try {
        const parsed = JSON.parse(rawBuf.toString()) as Array<{
          s: string; // symbol
          c: string; // close price
          o: string; // open price
          h: string; // high price
          l: string; // low price
          v: string; // base volume
          q: string; // quote volume
          E: number; // event time
        }>;
        if (!Array.isArray(parsed)) return;

        const now = Date.now();
        this.lastWsTickAt = now;
        const updates: Array<{ symbol: string; price: number; high24h: number; low24h: number }> = [];

        for (const item of parsed) {
          const existing = this.tickerMap.get(item.s);
          const price = Number(item.c);
          if (!Number.isFinite(price) || price <= 0) continue;

          if (existing) {
            const open = Number(item.o);
            const change = open > 0 ? price - open : existing.priceChange;
            const changePct = open > 0 ? (change / open) * 100 : existing.priceChangePercent;
            existing.lastPrice = price;
            existing.highPrice = Number(item.h) || existing.highPrice;
            existing.lowPrice = Number(item.l) || existing.lowPrice;
            existing.volume = Number(item.v) || existing.volume;
            existing.quoteVolume = Number(item.q) || existing.quoteVolume;
            existing.priceChange = change;
            existing.priceChangePercent = Number(changePct.toFixed(2));
            existing.updatedAt = item.E || now;
          }

          if (item.s.endsWith('USDT')) {
            updates.push({
              symbol: item.s,
              price,
              high24h: Number(item.h),
              low24h: Number(item.l),
            });
          }
        }

        if (updates.length > 0) {
          for (const listener of this.tickListeners) {
            try {
              listener(updates);
            } catch {
              // Listener errors should not break stream
            }
          }
        }
      } catch {
        // Ignore malformed frame
      }
    });

    ws.on('close', () => {
      this.wsConnected = false;
      this.scheduleReconnect();
    });

    ws.on('error', () => {
      this.wsConnected = false;
      this.wsUrlIndex++;
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30_000);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, delayMs);
  }
}

export const binanceMarket = new BinanceMarketService();

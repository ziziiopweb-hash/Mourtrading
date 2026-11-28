import type { SupabaseClient } from '@supabase/supabase-js';
import { binanceMarket } from './binanceMarket.ts';
import {
  createAdminSignal,
  getAutoSignalSnapshotForCooldown,
  getAutoSignalsConfig,
  recordAdminAuditLog,
  runMonitorTick,
  updateAutoSignalsConfig,
} from './dataStore.ts';
import { detectAutoSignalOpportunity, type DetectedAutoSignal } from '../../src/lib/autoSignalScanner.ts';
import type { AutoSignalsConfig, TradingSignal } from '../../src/types/trading.ts';

class MonitorEngine {
  private started = false;
  private isEvaluating = false;
  private isScanningAuto = false;
  private lastEvaluatedAt: string | null = null;
  private latestPrices = new Map<string, { price: number; high24h: number; low24h: number }>();

  public start(): void {
    if (this.started) return;
    this.started = true;

    binanceMarket.onPriceTick((updates) => {
      for (const u of updates) {
        this.latestPrices.set(u.symbol, {
          price: u.price,
          high24h: u.high24h,
          low24h: u.low24h,
        });
      }
    });

    // Periodic server-side evaluation every 12 seconds (runs on Supabase or local fallback store)
    setInterval(() => {
      this.evaluateTick().catch((err) => {
        console.warn('[MonitorEngine] Tick evaluation error:', err instanceof Error ? err.message : err);
      });
    }, 12_000);

    // Periodic Auto Signals scan every 2 minutes when enabled
    setInterval(() => {
      this.scanAutoSignalsOnce(false).catch((err) => {
        console.warn('[MonitorEngine] Auto Signal scan error:', err instanceof Error ? err.message : err);
      });
    }, 120_000);
  }

  public getLastEvaluatedAt(): string | null {
    return this.lastEvaluatedAt;
  }

  public async evaluateNow(): Promise<string> {
    await this.evaluateTick();
    return this.lastEvaluatedAt || new Date().toISOString();
  }

  private async evaluateTick(): Promise<void> {
    if (this.isEvaluating) return;
    this.isEvaluating = true;
    try {
      await runMonitorTick((symbol) => {
        return this.latestPrices.get(symbol)?.price ?? binanceMarket.getLivePrice(symbol);
      });
      this.lastEvaluatedAt = new Date().toISOString();
    } finally {
      this.isEvaluating = false;
    }
  }

  public async scanAutoSignalsOnce(force = false): Promise<{
    created: TradingSignal[];
    scannedCount: number;
    skippedCooldown: number;
    config: AutoSignalsConfig;
  }> {
    const cfg = getAutoSignalsConfig();
    if (!force && !cfg.enabled) {
      return { created: [], scannedCount: 0, skippedCooldown: 0, config: cfg };
    }
    if (this.isScanningAuto) {
      return { created: [], scannedCount: 0, skippedCooldown: 0, config: cfg };
    }

    this.isScanningAuto = true;
    try {
      const { activeAutoCount, recentOrActiveAutoSymbols } = await getAutoSignalSnapshotForCooldown();
      const remainingSlots = Math.max(0, cfg.maxActiveSignals - activeAutoCount);

      if (remainingSlots <= 0) {
        const updatedCfg = await updateAutoSignalsConfig(null, {
          lastScanAt: new Date().toISOString(),
          lastScanSummary: `Max active auto signals reached (${activeAutoCount}/${cfg.maxActiveSignals}).`,
        });
        return { created: [], scannedCount: 0, skippedCooldown: 0, config: updatedCfg };
      }

      const tickers = await binanceMarket.getMarketTickers({
        quote: 'USDT',
        sort: 'volume',
        limit: 30,
      });

      const eligible = tickers.filter(
        (tk) =>
          tk.quoteVolume >= cfg.minQuoteVolumeUsdt &&
          tk.priceChangePercent > -15 &&
          tk.priceChangePercent < 22 &&
          !['USDCUSDT', 'FDUSDUSDT', 'TUSDUSDT', 'BUSDUSDT', 'USDPUSDT'].includes(tk.symbol),
      );

      let skippedCooldown = 0;
      const toInspect = [];
      for (const tk of eligible) {
        if (recentOrActiveAutoSymbols.has(tk.symbol.toUpperCase())) {
          skippedCooldown++;
          continue;
        }
        toInspect.push(tk);
        if (toInspect.length >= 12) break;
      }

      const detected: DetectedAutoSignal[] = [];
      for (const tk of toInspect) {
        try {
          const candles = await binanceMarket.getKlines(tk.symbol, cfg.timeframe, 150);
          const opp = detectAutoSignalOpportunity(tk.symbol, cfg.timeframe, candles, tk.quoteVolume);
          if (opp) detected.push(opp);
        } catch {
          // Ignore single pair transient fetch error
        }
      }

      detected.sort((a, b) => b.score - a.score);
      const maxToPublish = Math.min(remainingSlots, 2);
      const created: TradingSignal[] = [];

      for (const opp of detected.slice(0, maxToPublish)) {
        const livePrice = binanceMarket.getLivePrice(opp.symbol);
        const sig = await createAdminSignal(
          'system_auto',
          {
            symbol: opp.symbol,
            source: 'AUTO',
            tradeType: opp.tradeType,
            timeframe: opp.timeframe,
            entryLow: opp.entryLow,
            entryHigh: opp.entryHigh,
            tp1: opp.tp1,
            tp2: opp.tp2,
            tp3: opp.tp3,
            stopLoss: opp.stopLoss,
            explanation: opp.explanation,
          },
          livePrice,
        );
        created.push(sig);
      }

      const updatedCfg = await updateAutoSignalsConfig(null, {
        lastScanAt: new Date().toISOString(),
        lastScanSummary: `Scanned ${toInspect.length} Spot pairs · Published ${created.length} auto signal(s).`,
      });

      return {
        created,
        scannedCount: toInspect.length,
        skippedCooldown,
        config: updatedCfg,
      };
    } finally {
      this.isScanningAuto = false;
    }
  }

  public async recordAuditLog(
    adminUid: string,
    action: string,
    targetId: string,
    details?: Record<string, unknown>,
    supabaseClient?: SupabaseClient,
  ) {
    await recordAdminAuditLog(adminUid, action, targetId, details, supabaseClient);
  }
}

export const monitorEngine = new MonitorEngine();

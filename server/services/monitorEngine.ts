import type { SupabaseClient } from '@supabase/supabase-js';
import { binanceMarket } from './binanceMarket.ts';
import { recordAdminAuditLog, runMonitorTick } from './dataStore.ts';

class MonitorEngine {
  private started = false;
  private isEvaluating = false;
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
  }

  private async evaluateTick(): Promise<void> {
    if (this.isEvaluating) return;
    this.isEvaluating = true;
    try {
      await runMonitorTick((symbol) => {
        return this.latestPrices.get(symbol)?.price ?? binanceMarket.getLivePrice(symbol);
      });
    } finally {
      this.isEvaluating = false;
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

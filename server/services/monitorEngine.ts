import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseServiceRoleConfigured } from '../config/env.ts';
import { getServiceRoleSupabaseClient } from './supabase.ts';
import { binanceMarket } from './binanceMarket.ts';
import { sendPriceAlertEmail } from './resendEmail.ts';
import type { SignalStatus } from '../../src/types/trading.ts';

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

    // Periodic server-side evaluation every 12 seconds when SUPABASE_SERVICE_ROLE_KEY is configured
    setInterval(() => {
      this.evaluateTick().catch((err) => {
        console.warn('[MonitorEngine] Tick evaluation error:', err instanceof Error ? err.message : err);
      });
    }, 12_000);
  }

  private async evaluateTick(): Promise<void> {
    if (!isSupabaseServiceRoleConfigured() || this.isEvaluating) return;
    const supabase = getServiceRoleSupabaseClient();
    if (!supabase) return;

    this.isEvaluating = true;
    try {
      await Promise.all([this.evaluateSignals(supabase), this.evaluatePriceAlerts(supabase)]);
    } finally {
      this.isEvaluating = false;
    }
  }

  private async evaluateSignals(supabase: SupabaseClient): Promise<void> {
    const activeStatuses: SignalStatus[] = ['ACTIVE', 'TP1_HIT', 'TP2_HIT'];
    const { data: rows, error } = await supabase
      .from('signals')
      .select('*')
      .in('status', activeStatuses)
      .limit(100);

    if (error || !rows || rows.length === 0) return;

    for (const sig of rows) {
      const tick = this.latestPrices.get(sig.symbol);
      const livePrice = tick?.price ?? binanceMarket.getLivePrice(sig.symbol);
      if (!livePrice || livePrice <= 0) continue;

      const entryLow = Number(sig.entry_low);
      const entryHigh = Number(sig.entry_high);
      const refEntry = Number(sig.entry_reference_price) || (entryLow + entryHigh) / 2;
      const tp1 = Number(sig.tp1);
      const tp2 = Number(sig.tp2);
      const tp3 = Number(sig.tp3);
      const stopLoss = Number(sig.stop_loss);

      let nextStatus: SignalStatus | null = null;
      let ambiguityNote: string | undefined;

      const hitStop = livePrice <= stopLoss;
      const hitTp3 = livePrice >= tp3;
      const hitTp2 = livePrice >= tp2;
      const hitTp1 = livePrice >= tp1;

      if (hitStop && (hitTp1 || hitTp2 || hitTp3)) {
        nextStatus = 'STOP_LOSS_HIT';
        ambiguityNote = `Ambiguous gap crossing detected at ${livePrice} intersecting both SL (${stopLoss}) and target levels; conservatively resolved to STOP_LOSS_HIT.`;
      } else if (hitStop) {
        nextStatus = 'STOP_LOSS_HIT';
      } else if (hitTp3 && sig.status !== 'TP3_HIT') {
        nextStatus = 'TP3_HIT';
      } else if (hitTp2 && (sig.status === 'ACTIVE' || sig.status === 'TP1_HIT')) {
        nextStatus = 'TP2_HIT';
      } else if (hitTp1 && sig.status === 'ACTIVE') {
        nextStatus = 'TP1_HIT';
      }

      if (!nextStatus || nextStatus === sig.status) continue;

      const resultPercent = refEntry > 0 ? Number((((livePrice - refEntry) / refEntry) * 100).toFixed(2)) : 0;
      const eventId = `${sig.id}_${nextStatus}`;
      const nowIso = new Date().toISOString();

      // Insert event first with primary key idempotency so concurrent workers never duplicate
      const { error: eventErr } = await supabase.from('signal_events').insert({
        id: eventId,
        signal_id: sig.id,
        symbol: sig.symbol,
        event_type: nextStatus,
        trigger_price: livePrice,
        result_percent: resultPercent,
        note: ambiguityNote ?? null,
        occurred_at: nowIso,
      });

      if (eventErr) continue;

      await supabase
        .from('signals')
        .update({
          status: nextStatus,
          actual_result_percent: resultPercent,
          ...(ambiguityNote ? { ambiguity_note: ambiguityNote } : {}),
          updated_at: nowIso,
        })
        .eq('id', sig.id)
        .eq('status', sig.status);
    }
  }

  private async evaluatePriceAlerts(supabase: SupabaseClient): Promise<void> {
    const { data: alerts, error } = await supabase
      .from('price_alerts')
      .select('*')
      .eq('status', 'ACTIVE')
      .limit(200);

    if (error || !alerts || alerts.length === 0) return;

    for (const alert of alerts) {
      const livePrice = this.latestPrices.get(alert.symbol)?.price ?? binanceMarket.getLivePrice(alert.symbol);
      if (!livePrice || livePrice <= 0) continue;

      const targetPrice = Number(alert.target_price);
      const targetUpper = alert.target_price_upper !== null ? Number(alert.target_price_upper) : null;

      let triggered = false;
      if (alert.condition === 'ABOVE' || alert.condition === 'TP_TARGET') {
        triggered = livePrice >= targetPrice;
      } else if (alert.condition === 'BELOW' || alert.condition === 'SL_TARGET') {
        triggered = livePrice <= targetPrice;
      } else if (alert.condition === 'ENTRY_ZONE') {
        const upper = targetUpper ?? targetPrice * 1.005;
        const lower = Math.min(targetPrice, upper);
        const high = Math.max(targetPrice, upper);
        triggered = livePrice >= lower && livePrice <= high;
      }

      if (!triggered) continue;

      const nowIso = new Date().toISOString();
      const { data: updatedRows, error: updateErr } = await supabase
        .from('price_alerts')
        .update({
          status: 'TRIGGERED',
          triggered_at: nowIso,
        })
        .eq('id', alert.id)
        .eq('status', 'ACTIVE')
        .select('id');

      if (updateErr || !updatedRows || updatedRows.length === 0) continue;

      const notifId = `notif_${alert.id}`;
      await supabase.from('notifications').upsert(
        {
          id: notifId,
          user_id: alert.user_id,
          type: 'PRICE_ALERT',
          title: `${alert.symbol} Alert Triggered`,
          message: `${alert.symbol} reached $${livePrice} (${alert.condition} $${targetPrice})`,
          read: false,
          created_at: nowIso,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );

      if (alert.email_notify) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('email')
          .eq('id', alert.user_id)
          .maybeSingle();

        if (profile?.email) {
          sendPriceAlertEmail({
            to: profile.email,
            symbol: alert.symbol,
            condition: alert.condition,
            targetPrice,
            currentPrice: livePrice,
          }).catch(() => {});
        }
      }
    }
  }

  public async recordAuditLog(
    adminUid: string,
    action: string,
    targetId: string,
    details?: Record<string, unknown>,
    supabaseClient?: SupabaseClient,
  ) {
    const client = supabaseClient || getServiceRoleSupabaseClient();
    if (!client) return;
    const id = `log_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await client.from('admin_audit_logs').insert({
      id,
      admin_uid: adminUid,
      action,
      target_id: targetId,
      details: details ?? {},
      created_at: new Date().toISOString(),
    });
  }
}

export const monitorEngine = new MonitorEngine();

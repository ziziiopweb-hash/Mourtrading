import { Router } from 'express';
import { getMissingSupabaseVars, isSupabaseConfigured } from '../config/env.ts';
import { getPublicSupabaseClient } from '../services/supabase.ts';
import { binanceMarket } from '../services/binanceMarket.ts';

const router = Router();

function mapSignalRow(sig: Record<string, unknown>) {
  const symbol = String(sig.symbol || '');
  return {
    id: String(sig.id),
    symbol,
    source: sig.source === 'AI' ? ('AI' as const) : ('ADMIN' as const),
    timeframe: String(sig.timeframe),
    status: String(sig.status),
    entryLow: Number(sig.entry_low),
    entryHigh: Number(sig.entry_high),
    tp1: Number(sig.tp1),
    tp2: Number(sig.tp2),
    tp3: Number(sig.tp3),
    stopLoss: Number(sig.stop_loss),
    riskRewardRatio: Number(sig.risk_reward_ratio),
    entryReferencePrice: sig.entry_reference_price !== null && sig.entry_reference_price !== undefined
      ? Number(sig.entry_reference_price)
      : undefined,
    actualResultPercent: sig.actual_result_percent !== null && sig.actual_result_percent !== undefined
      ? Number(sig.actual_result_percent)
      : undefined,
    ambiguityNote: sig.ambiguity_note ? String(sig.ambiguity_note) : undefined,
    explanation: String(sig.explanation || ''),
    createdBy: String(sig.created_by || ''),
    createdAt: String(sig.created_at),
    updatedAt: String(sig.updated_at),
    livePrice: binanceMarket.getLivePrice(symbol),
  };
}

function mapEventRow(ev: Record<string, unknown>) {
  return {
    id: String(ev.id),
    signalId: String(ev.signal_id),
    symbol: String(ev.symbol),
    eventType: String(ev.event_type),
    triggerPrice: Number(ev.trigger_price),
    resultPercent: Number(ev.result_percent || 0),
    note: ev.note ? String(ev.note) : undefined,
    occurredAt: String(ev.occurred_at),
  };
}

router.get('/', async (req, res) => {
  if (!isSupabaseConfigured()) {
    const missingVars = getMissingSupabaseVars();
    res.json({
      configured: false,
      signals: [],
      events: [],
      missingVars,
      message: 'Supabase environment variables are required to store and monitor Spot signals.',
    });
    return;
  }

  try {
    const supabase = getPublicSupabaseClient();
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : 'ALL';
    const sourceFilter = typeof req.query.source === 'string' ? req.query.source : 'ALL';

    let query = supabase
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (statusFilter === 'ACTIVE') {
      query = query.in('status', ['ACTIVE', 'TP1_HIT', 'TP2_HIT']);
    } else if (statusFilter === 'COMPLETED') {
      query = query.in('status', ['TP3_HIT', 'STOP_LOSS_HIT', 'CANCELLED']);
    }

    if (sourceFilter === 'ADMIN' || sourceFilter === 'AI') {
      query = query.eq('source', sourceFilter);
    }

    const [{ data: signalRows, error: sigErr }, { data: eventRows, error: evErr }] = await Promise.all([
      query,
      supabase.from('signal_events').select('*').order('occurred_at', { ascending: false }).limit(50),
    ]);

    if (sigErr) {
      res.status(500).json({ error: sigErr.message });
      return;
    }

    res.json({
      configured: true,
      signals: (signalRows || []).map(mapSignalRow),
      events: evErr ? [] : (eventRows || []).map(mapEventRow),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load signals' });
  }
});

export default router;

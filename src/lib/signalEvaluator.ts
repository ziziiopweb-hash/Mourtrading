import type { SignalDirection, SignalStatus, TradingSignal } from '../types/trading.ts';

export interface SignalEvaluationResult {
  nextStatus: SignalStatus;
  resultPercent: number;
  triggerPrice: number;
  closedAt?: string;
  ambiguityNote?: string;
}

export function isSignalMonitoringTerminal(status: SignalStatus): boolean {
  return status === 'TP3_HIT' || status === 'STOP_LOSS_HIT' || status === 'CANCELLED';
}

export function isSignalProfitTargetHit(status: SignalStatus): boolean {
  return status === 'TP1_HIT' || status === 'TP2_HIT' || status === 'TP3_HIT';
}

export function computeSignalResultPercent(
  direction: SignalDirection,
  refEntry: number,
  price: number,
): number {
  if (!Number.isFinite(refEntry) || refEntry <= 0 || !Number.isFinite(price) || price <= 0) {
    return 0;
  }
  const raw =
    direction === 'SHORT'
      ? ((refEntry - price) / refEntry) * 100
      : ((price - refEntry) / refEntry) * 100;
  return Number(raw.toFixed(2));
}

/**
 * Pure, direction-aware signal evaluator.
 * Guarantees that once TP1/TP2 is hit, a signal NEVER flips back to STOP_LOSS_HIT,
 * and terminal states (TP3_HIT, STOP_LOSS_HIT, CANCELLED) are never re-evaluated.
 */
export function evaluateSignalAgainstPrice(
  sig: Pick<
    TradingSignal,
    'status' | 'direction' | 'entryLow' | 'entryHigh' | 'entryReferencePrice' | 'tp1' | 'tp2' | 'tp3' | 'stopLoss'
  >,
  livePrice: number,
): SignalEvaluationResult | null {
  if (!Number.isFinite(livePrice) || livePrice <= 0) return null;
  if (isSignalMonitoringTerminal(sig.status)) return null;

  const direction: SignalDirection =
    sig.direction === 'SHORT' || sig.stopLoss > sig.entryHigh ? 'SHORT' : 'LONG';
  const refEntry = sig.entryReferencePrice || (sig.entryLow + sig.entryHigh) / 2;

  const hitStop =
    direction === 'SHORT' ? livePrice >= sig.stopLoss : livePrice <= sig.stopLoss;
  const hitTp3 =
    direction === 'SHORT' ? livePrice <= sig.tp3 : livePrice >= sig.tp3;
  const hitTp2 =
    direction === 'SHORT' ? livePrice <= sig.tp2 : livePrice >= sig.tp2;
  const hitTp1 =
    direction === 'SHORT' ? livePrice <= sig.tp1 : livePrice >= sig.tp1;

  let nextStatus: SignalStatus | null = null;
  let ambiguityNote: string | undefined;

  if (sig.status === 'ACTIVE') {
    if (hitStop && (hitTp1 || hitTp2 || hitTp3)) {
      nextStatus = 'STOP_LOSS_HIT';
      ambiguityNote = `Gap crossing at ${livePrice} touched both SL (${sig.stopLoss}) and target levels; conservatively closed at STOP_LOSS_HIT.`;
    } else if (hitStop) {
      nextStatus = 'STOP_LOSS_HIT';
    } else if (hitTp3) {
      nextStatus = 'TP3_HIT';
    } else if (hitTp2) {
      nextStatus = 'TP2_HIT';
    } else if (hitTp1) {
      nextStatus = 'TP1_HIT';
    }
  } else if (sig.status === 'TP1_HIT') {
    // Already achieved profit target 1 -> never revert to STOP_LOSS_HIT
    if (hitTp3) {
      nextStatus = 'TP3_HIT';
    } else if (hitTp2) {
      nextStatus = 'TP2_HIT';
    }
  } else if (sig.status === 'TP2_HIT') {
    // Already achieved profit target 2 -> never revert to STOP_LOSS_HIT
    if (hitTp3) {
      nextStatus = 'TP3_HIT';
    }
  }

  if (!nextStatus || nextStatus === sig.status) return null;

  const nowIso = new Date().toISOString();
  const resultPercent = computeSignalResultPercent(direction, refEntry, livePrice);

  return {
    nextStatus,
    resultPercent,
    triggerPrice: livePrice,
    closedAt:
      nextStatus === 'STOP_LOSS_HIT' || nextStatus === 'TP3_HIT'
        ? nowIso
        : nowIso,
    ambiguityNote,
  };
}

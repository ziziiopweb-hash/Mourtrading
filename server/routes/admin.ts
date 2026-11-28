import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.ts';
import {
  getClerkBackendClient,
  invalidateIdentityCache,
} from '../services/clerkAuth.ts';
import { binanceMarket } from '../services/binanceMarket.ts';
import { monitorEngine } from '../services/monitorEngine.ts';
import {
  broadcastAdminAnnouncement,
  cancelAdminSignal,
  createAdminSignal,
  deleteAdminSignal,
  exportAdminSnapshot,
  getAdminOverviewStats,
  getAutoSignalsConfig,
  getGlobalAppConfig,
  listAdminAuditLogs,
  listAdminUsers,
  updateAdminSignal,
  updateAdminSignalStatus,
  updateAdminUser,
  updateAutoSignalsConfig,
  updateGlobalAppConfig,
} from '../services/dataStore.ts';
import { roundSignalPrice } from '../../src/lib/autoSignalScanner.ts';
import { isGeminiConfigured } from '../config/env.ts';

const router = Router();

router.use(requireAdmin);

const createSignalSchema = z.object({
  symbol: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9]+$/).transform((s) => s.toUpperCase()),
  tradeType: z.enum(['SPOT_BUY', 'SPOT_SCALP', 'SPOT_SWING']).optional().default('SPOT_BUY'),
  direction: z.enum(['LONG', 'SHORT']).optional().default('LONG'),
  timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']),
  entryLow: z.number().positive(),
  entryHigh: z.number().positive().optional(),
  tp1: z.number().positive(),
  tp2: z.number().positive().optional(),
  tp3: z.number().positive().optional(),
  stopLoss: z.number().positive(),
  explanation: z.string().trim().max(4000).optional().default(''),
  source: z.enum(['ADMIN', 'AUTO', 'AI']).optional().default('ADMIN'),
});

const updateSignalSchema = z.object({
  symbol: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9]+$/).transform((s) => s.toUpperCase()).optional(),
  tradeType: z.enum(['SPOT_BUY', 'SPOT_SCALP', 'SPOT_SWING']).optional(),
  direction: z.enum(['LONG', 'SHORT']).optional(),
  timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']).optional(),
  entryLow: z.number().positive().optional(),
  entryHigh: z.number().positive().optional(),
  tp1: z.number().positive().optional(),
  tp2: z.number().positive().optional(),
  tp3: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  explanation: z.string().trim().max(4000).optional(),
  status: z.enum(['ACTIVE', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_LOSS_HIT', 'CANCELLED']).optional(),
});

const autoSignalsSchema = z.object({
  enabled: z.boolean().optional(),
  timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']).optional(),
  cooldownMinutes: z.number().int().min(10).max(1440).optional(),
  maxActiveSignals: z.number().int().min(1).max(30).optional(),
  minQuoteVolumeUsdt: z.number().nonnegative().optional(),
});

const updateUserSchema = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  plan: z.enum(['free', 'pro']).optional(),
  role: z.enum(['user', 'admin']).optional(),
});

const appConfigSchema = z.object({
  freeDailyAiLimit: z.number().int().min(1).max(100),
  proDailyAiLimit: z.number().int().min(1).max(1000),
  proMonthlyPriceUsd: z.number().nonnegative(),
  proAnnualPriceUsd: z.number().nonnegative(),
  proDurationDays: z.number().int().min(1).max(365),
  freeFeatures: z.array(z.string().max(120)).max(20),
  proFeatures: z.array(z.string().max(120)).max(20),
  announcement: z.string().max(500),
});

router.get('/overview', async (_req, res) => {
  try {
    const overview = await getAdminOverviewStats();
    res.json({
      stats: overview.stats,
      apiHealth: {
        binance: binanceMarket.getStatus(),
        geminiConfigured: isGeminiConfigured(),
        checkedAt: new Date().toISOString(),
      },
      recentAuthFailures: overview.recentAuthFailures,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load admin overview' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const users = await listAdminUsers(q);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list users' });
  }
});

router.patch('/users/:uid', async (req, res) => {
  const targetUid = String(req.params.uid || '');
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid user update' });
    return;
  }

  try {
    const result = await updateAdminUser(targetUid, parsed.data);
    if (result.error) {
      res.status(result.statusCode || 400).json({ error: result.error });
      return;
    }

    if (result.clerkId) {
      if (parsed.data.role) {
        await getClerkBackendClient()
          .users.updateUserMetadata(result.clerkId, {
            publicMetadata: {
              role: parsed.data.role,
              supabaseUserId: targetUid,
            },
          })
          .catch(() => {});
      }
      invalidateIdentityCache(result.clerkId);
    }

    await monitorEngine.recordAuditLog(req.authUser!.uid, 'UPDATE_USER', targetUid, parsed.data);
    res.json({ user: result.user });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update user' });
  }
});

router.post('/signals', async (req, res) => {
  const parsed = createSignalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid signal parameters' });
    return;
  }
  const d = parsed.data;
  const entryLow = Math.min(d.entryLow, d.entryHigh ?? d.entryLow);
  const entryHigh = Math.max(d.entryLow, d.entryHigh ?? d.entryLow);
  const refEntry = (entryLow + entryHigh) / 2;
  const direction = d.direction === 'SHORT' || d.stopLoss > entryHigh ? 'SHORT' : 'LONG';
  const tp1 = d.tp1;
  let tp2: number;
  let tp3: number;

  if (direction === 'SHORT') {
    const risk = Math.max(d.stopLoss - refEntry, refEntry * 0.01);
    tp2 = d.tp2 && d.tp2 < tp1 ? d.tp2 : roundSignalPrice(Math.max(tp1 - risk * 0.9, tp1 * 0.985));
    tp3 = d.tp3 && d.tp3 < tp2 ? d.tp3 : roundSignalPrice(Math.max(tp2 - risk * 1.1, tp2 * 0.98));
    if (d.stopLoss <= entryHigh || tp1 >= entryLow || tp2 >= tp1 || tp3 >= tp2 || tp3 <= 0) {
      res.status(400).json({
        error: 'Invalid SHORT level ordering: require tp3 < tp2 < tp1 < entryLow <= entryHigh < stopLoss',
      });
      return;
    }
  } else {
    const risk = Math.max(refEntry - d.stopLoss, refEntry * 0.01);
    tp2 = d.tp2 && d.tp2 > tp1 ? d.tp2 : roundSignalPrice(tp1 + risk * 0.9);
    tp3 = d.tp3 && d.tp3 > tp2 ? d.tp3 : roundSignalPrice(tp2 + risk * 1.1);
    if (d.stopLoss >= entryLow || tp1 <= entryHigh || tp2 <= tp1 || tp3 <= tp2) {
      res.status(400).json({
        error: 'Invalid LONG/Spot level ordering: require stopLoss < entryLow <= entryHigh < tp1 < tp2 < tp3',
      });
      return;
    }
  }

  const explanation = d.explanation || `صفقة ${direction === 'SHORT' ? 'بيع (Short)' : 'شراء (Spot)'} منشورة يدوياً على ${d.symbol}`;

  try {
    const livePrice = binanceMarket.getLivePrice(d.symbol) ?? refEntry;
    const signal = await createAdminSignal(
      req.authUser!.uid,
      {
        symbol: d.symbol,
        tradeType: d.tradeType,
        direction,
        timeframe: d.timeframe,
        entryLow,
        entryHigh,
        tp1,
        tp2,
        tp3,
        stopLoss: d.stopLoss,
        explanation,
        source: d.source,
      },
      livePrice,
    );
    res.status(201).json({ signal });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to publish signal' });
  }
});

router.patch('/signals/:id', async (req, res) => {
  const signalId = String(req.params.id || '');
  const parsed = updateSignalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid signal update' });
    return;
  }
  try {
    const updated = await updateAdminSignal(req.authUser!.uid, signalId, parsed.data, (sym) =>
      binanceMarket.getLivePrice(sym),
    );
    if (!updated) {
      res.status(404).json({ error: 'Signal not found' });
      return;
    }
    res.json({ signal: updated });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update signal' });
  }
});

router.patch('/signals/:id/status', async (req, res) => {
  const signalId = String(req.params.id || '');
  const statusParsed = z
    .enum(['ACTIVE', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_LOSS_HIT', 'CANCELLED'])
    .safeParse(req.body?.status);
  if (!statusParsed.success) {
    res.status(400).json({ error: 'Invalid signal status' });
    return;
  }
  try {
    const updated = await updateAdminSignalStatus(
      req.authUser!.uid,
      signalId,
      statusParsed.data,
      (sym) => binanceMarket.getLivePrice(sym),
    );
    if (!updated) {
      res.status(404).json({ error: 'Signal not found' });
      return;
    }
    res.json({ signal: updated });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update signal status' });
  }
});

router.delete('/signals/:id', async (req, res) => {
  const signalId = String(req.params.id || '');
  try {
    const deleted = await deleteAdminSignal(req.authUser!.uid, signalId);
    if (!deleted) {
      res.status(404).json({ error: 'Signal not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete signal' });
  }
});

router.patch('/signals/:id/cancel', async (req, res) => {
  const signalId = String(req.params.id || '');
  try {
    const cancelled = await cancelAdminSignal(req.authUser!.uid, signalId, (sym) =>
      binanceMarket.getLivePrice(sym),
    );
    if (!cancelled) {
      res.status(404).json({ error: 'Signal not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to cancel signal' });
  }
});

router.get('/auto-signals', (_req, res) => {
  res.json({ config: getAutoSignalsConfig() });
});

router.put('/auto-signals', async (req, res) => {
  const parsed = autoSignalsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid auto signals config' });
    return;
  }
  try {
    const config = await updateAutoSignalsConfig(req.authUser!.uid, parsed.data);
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save auto signals config' });
  }
});

router.post('/auto-signals/scan', async (_req, res) => {
  try {
    const result = await monitorEngine.scanAutoSignalsOnce(true);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Auto signals scan failed' });
  }
});

router.get('/settings', async (_req, res) => {
  try {
    const config = await getGlobalAppConfig();
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load settings' });
  }
});

router.put('/settings', async (req, res) => {
  const parsed = appConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid app settings' });
    return;
  }

  try {
    const config = await updateGlobalAppConfig(parsed.data);
    await monitorEngine.recordAuditLog(req.authUser!.uid, 'UPDATE_APP_CONFIG', 'global', parsed.data);
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save settings' });
  }
});

router.post('/announcements', async (req, res) => {
  try {
    const title = z.string().trim().min(2).max(160).parse(req.body?.title);
    const message = z.string().trim().min(4).max(1000).parse(req.body?.message);
    const sentCount = await broadcastAdminAnnouncement(req.authUser!.uid, title, message);
    res.json({ ok: true, sentCount });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid announcement payload' });
  }
});

router.get('/audit-logs', async (_req, res) => {
  try {
    const logs = await listAdminAuditLogs();
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load audit logs' });
  }
});

router.get('/export', async (req, res) => {
  try {
    const snapshot = await exportAdminSnapshot(req.authUser!.uid);
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to export report' });
  }
});

export default router;

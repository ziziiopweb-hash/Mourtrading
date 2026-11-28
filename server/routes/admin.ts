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
  exportAdminSnapshot,
  getAdminOverviewStats,
  getGlobalAppConfig,
  listAdminAuditLogs,
  listAdminUsers,
  updateAdminUser,
  updateGlobalAppConfig,
} from '../services/dataStore.ts';
import { isGeminiConfigured } from '../config/env.ts';

const router = Router();

router.use(requireAdmin);

const createSignalSchema = z.object({
  symbol: z.string().trim().min(4).max(20).regex(/^[A-Za-z0-9]+$/).transform((s) => s.toUpperCase()),
  timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']),
  entryLow: z.number().positive(),
  entryHigh: z.number().positive(),
  tp1: z.number().positive(),
  tp2: z.number().positive(),
  tp3: z.number().positive(),
  stopLoss: z.number().positive(),
  explanation: z.string().trim().min(10).max(4000),
  source: z.enum(['ADMIN', 'AI']).optional().default('ADMIN'),
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
  if (d.stopLoss >= d.entryLow || d.tp1 <= d.entryHigh || d.tp2 <= d.tp1 || d.tp3 <= d.tp2) {
    res.status(400).json({
      error: 'Invalid Spot level ordering: require stopLoss < entryLow <= entryHigh < tp1 < tp2 < tp3',
    });
    return;
  }

  try {
    const refEntry = (d.entryLow + d.entryHigh) / 2;
    const livePrice = binanceMarket.getLivePrice(d.symbol) ?? refEntry;
    const signal = await createAdminSignal(req.authUser!.uid, d, livePrice);
    res.status(201).json({ signal });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to publish signal' });
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

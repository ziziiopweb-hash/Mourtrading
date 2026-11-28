import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.ts';
import {
  addUserTransaction,
  createUserAlert,
  deleteUserAlert,
  getGlobalAppConfig,
  getUserAlerts,
  getUserNotifications,
  getUserPortfolio,
  getUserPreferences,
  getUserWatchlist,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  replaceUserWatchlist,
  upsertUserPortfolio,
  upsertUserPreferences,
} from '../services/dataStore.ts';

const router = Router();

const preferencesSchema = z.object({
  language: z.enum(['ar', 'en']).optional(),
  defaultTimeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']).optional(),
  emailAlertsEnabled: z.boolean().optional(),
  signalNotificationsEnabled: z.boolean().optional(),
  priceAlertsEnabled: z.boolean().optional(),
});

const watchlistSchema = z.object({
  symbols: z.array(z.string().trim().min(4).max(20).regex(/^[A-Z0-9]+$/)).max(50),
});

const holdingSchema = z.object({
  symbol: z.string().trim().min(1).max(16).regex(/^[A-Za-z0-9]+$/).transform((s) => s.toUpperCase()),
  quantity: z.number().nonnegative(),
  avgBuyPrice: z.number().nonnegative(),
});

const portfolioUpdateSchema = z.object({
  usdtBalance: z.number().nonnegative(),
  holdings: z.array(holdingSchema).max(100),
});

const transactionSchema = z.object({
  asset: z.string().trim().min(1).max(16).regex(/^[A-Za-z0-9]+$/).transform((s) => s.toUpperCase()),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number().positive(),
  priceUsdt: z.number().nonnegative(),
  note: z.string().trim().max(240).optional(),
});

const alertCreateSchema = z.object({
  symbol: z.string().trim().min(4).max(20).regex(/^[A-Za-z0-9]+$/).transform((s) => s.toUpperCase()),
  condition: z.enum(['ABOVE', 'BELOW', 'ENTRY_ZONE', 'TP_TARGET', 'SL_TARGET']),
  targetPrice: z.number().positive(),
  targetPriceUpper: z.number().positive().optional(),
  emailNotify: z.boolean().optional().default(false),
});

router.get('/preferences', requireAuth, async (req, res) => {
  try {
    const preferences = await getUserPreferences(req.authUser!.uid);
    res.json({ preferences });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load preferences' });
  }
});

router.put('/preferences', requireAuth, async (req, res) => {
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid preferences' });
    return;
  }

  try {
    const preferences = await upsertUserPreferences(req.authUser!.uid, parsed.data);
    res.json({ preferences });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update preferences' });
  }
});

router.get('/watchlist', requireAuth, async (req, res) => {
  try {
    const symbols = await getUserWatchlist(req.authUser!.uid);
    res.json({ symbols });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load watchlist' });
  }
});

router.put('/watchlist', requireAuth, async (req, res) => {
  const parsed = watchlistSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid watchlist' });
    return;
  }

  try {
    const symbols = await replaceUserWatchlist(req.authUser!.uid, parsed.data.symbols);
    res.json({ symbols });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save watchlist' });
  }
});

router.get('/portfolio', requireAuth, async (req, res) => {
  try {
    const data = await getUserPortfolio(req.authUser!.uid);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load portfolio' });
  }
});

router.put('/portfolio', requireAuth, async (req, res) => {
  const parsed = portfolioUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid portfolio payload' });
    return;
  }

  try {
    const portfolio = await upsertUserPortfolio(
      req.authUser!.uid,
      parsed.data.usdtBalance,
      parsed.data.holdings,
    );
    res.json({ portfolio });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update portfolio' });
  }
});

router.post('/portfolio/transactions', requireAuth, async (req, res) => {
  const parsed = transactionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid transaction' });
    return;
  }

  try {
    const transaction = await addUserTransaction(req.authUser!.uid, parsed.data);
    res.status(201).json({ transaction });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to record transaction' });
  }
});

router.get('/alerts', requireAuth, async (req, res) => {
  try {
    const alerts = await getUserAlerts(req.authUser!.uid);
    res.json({ alerts });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load alerts' });
  }
});

router.post('/alerts', requireAuth, async (req, res) => {
  const parsed = alertCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid price alert' });
    return;
  }

  try {
    const result = await createUserAlert(req.authUser!.uid, parsed.data);
    if (result.duplicate) {
      res.status(409).json({ error: 'An identical active alert already exists for this price.' });
      return;
    }
    res.status(201).json({ alert: result.alert });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create alert' });
  }
});

router.delete('/alerts/:id', requireAuth, async (req, res) => {
  const alertId = String(req.params.id || '');
  try {
    const deleted = await deleteUserAlert(req.authUser!.uid, alertId);
    if (!deleted) {
      res.status(404).json({ error: 'Alert not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete alert' });
  }
});

router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const notifications = await getUserNotifications(req.authUser!.uid);
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load notifications' });
  }
});

router.patch('/notifications/:id/read', requireAuth, async (req, res) => {
  const notifId = String(req.params.id || '');
  try {
    const updated = await markUserNotificationRead(req.authUser!.uid, notifId);
    if (!updated) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update notification' });
  }
});

router.post('/notifications/read-all', requireAuth, async (req, res) => {
  try {
    const updated = await markAllUserNotificationsRead(req.authUser!.uid);
    res.json({ ok: true, updated });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to mark notifications read' });
  }
});

router.get('/plans', async (_req, res) => {
  try {
    const config = await getGlobalAppConfig();
    res.json({ config });
  } catch {
    res.json({ config: null });
  }
});

export default router;

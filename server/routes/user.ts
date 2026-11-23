import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { ENV, isSupabaseConfigured } from '../config/env.ts';
import { requireAuth } from '../middleware/auth.ts';
import { createUserSupabaseClient, getPublicSupabaseClient } from '../services/supabase.ts';

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

function mapPreferences(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    userId: String(row.user_id || ''),
    language: row.language === 'en' ? 'en' : 'ar',
    defaultQuoteAsset: 'USDT',
    defaultTimeframe: String(row.default_timeframe || '1h'),
    emailAlertsEnabled: Boolean(row.email_alerts_enabled),
    signalNotificationsEnabled: Boolean(row.signal_notifications_enabled),
    priceAlertsEnabled: Boolean(row.price_alerts_enabled),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

function mapTransaction(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    asset: String(row.asset),
    side: row.side === 'SELL' ? 'SELL' : 'BUY',
    quantity: Number(row.quantity),
    priceUsdt: Number(row.price_usdt),
    note: row.note ? String(row.note) : '',
    executedAt: String(row.executed_at),
  };
}

function mapAlert(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    symbol: String(row.symbol),
    condition: String(row.condition),
    targetPrice: Number(row.target_price),
    targetPriceUpper: row.target_price_upper !== null && row.target_price_upper !== undefined
      ? Number(row.target_price_upper)
      : undefined,
    emailNotify: Boolean(row.email_notify),
    status: String(row.status),
    triggeredAt: row.triggered_at ? String(row.triggered_at) : undefined,
    createdAt: String(row.created_at),
  };
}

function mapNotification(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    type: String(row.type),
    title: String(row.title),
    message: String(row.message),
    read: Boolean(row.read),
    createdAt: String(row.created_at),
  };
}

router.get('/preferences', requireAuth, async (req, res) => {
  const userSb = createUserSupabaseClient(req.authToken!);
  const { data } = await userSb
    .from('user_preferences')
    .select('*')
    .eq('user_id', req.authUser!.uid)
    .maybeSingle();
  res.json({ preferences: mapPreferences(data) });
});

router.put('/preferences', requireAuth, async (req, res) => {
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid preferences' });
    return;
  }

  const userSb = createUserSupabaseClient(req.authToken!);
  const nowIso = new Date().toISOString();
  const payload: Record<string, unknown> = {
    user_id: req.authUser!.uid,
    updated_at: nowIso,
  };
  if (parsed.data.language !== undefined) payload.language = parsed.data.language;
  if (parsed.data.defaultTimeframe !== undefined) payload.default_timeframe = parsed.data.defaultTimeframe;
  if (parsed.data.emailAlertsEnabled !== undefined) payload.email_alerts_enabled = parsed.data.emailAlertsEnabled;
  if (parsed.data.signalNotificationsEnabled !== undefined) {
    payload.signal_notifications_enabled = parsed.data.signalNotificationsEnabled;
  }
  if (parsed.data.priceAlertsEnabled !== undefined) payload.price_alerts_enabled = parsed.data.priceAlertsEnabled;

  const { data, error } = await userSb
    .from('user_preferences')
    .upsert(payload, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ preferences: mapPreferences(data) });
});

router.get('/watchlist', requireAuth, async (req, res) => {
  const userSb = createUserSupabaseClient(req.authToken!);
  const { data, error } = await userSb
    .from('favorites')
    .select('symbol')
    .eq('user_id', req.authUser!.uid)
    .order('created_at', { ascending: true });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({
    symbols: data && data.length > 0 ? data.map((r) => String(r.symbol)) : [],
  });
});

router.put('/watchlist', requireAuth, async (req, res) => {
  const parsed = watchlistSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid watchlist' });
    return;
  }

  const uniqueSymbols = Array.from(new Set(parsed.data.symbols));
  const userSb = createUserSupabaseClient(req.authToken!);
  const uid = req.authUser!.uid;

  const { error: delError } = await userSb.from('favorites').delete().eq('user_id', uid);
  if (delError) {
    res.status(500).json({ error: delError.message });
    return;
  }

  if (uniqueSymbols.length > 0) {
    const { error: insError } = await userSb.from('favorites').insert(
      uniqueSymbols.map((symbol) => ({
        user_id: uid,
        symbol,
      })),
    );
    if (insError) {
      res.status(500).json({ error: insError.message });
      return;
    }
  }

  res.json({ symbols: uniqueSymbols });
});

router.get('/portfolio', requireAuth, async (req, res) => {
  const userSb = createUserSupabaseClient(req.authToken!);
  const [{ data: portRow }, { data: txRows }] = await Promise.all([
    userSb.from('portfolios').select('*').eq('user_id', req.authUser!.uid).maybeSingle(),
    userSb
      .from('portfolio_transactions')
      .select('*')
      .eq('user_id', req.authUser!.uid)
      .order('executed_at', { ascending: false })
      .limit(50),
  ]);

  res.json({
    portfolio: portRow
      ? {
          userId: req.authUser!.uid,
          usdtBalance: Number(portRow.usdt_balance || 0),
          holdings: Array.isArray(portRow.holdings) ? portRow.holdings : [],
          updatedAt: String(portRow.updated_at),
        }
      : {
          userId: req.authUser!.uid,
          usdtBalance: 0,
          holdings: [],
          updatedAt: new Date().toISOString(),
        },
    transactions: (txRows || []).map(mapTransaction),
  });
});

router.put('/portfolio', requireAuth, async (req, res) => {
  const parsed = portfolioUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid portfolio payload' });
    return;
  }

  const nowIso = new Date().toISOString();
  const holdings = parsed.data.holdings
    .filter((h) => h.quantity > 0)
    .map((h) => ({
      symbol: h.symbol,
      pair: h.symbol.endsWith('USDT') ? h.symbol : `${h.symbol}USDT`,
      quantity: h.quantity,
      avgBuyPrice: h.avgBuyPrice,
      updatedAt: nowIso,
    }));

  const userSb = createUserSupabaseClient(req.authToken!);
  const { error } = await userSb.from('portfolios').upsert(
    {
      user_id: req.authUser!.uid,
      usdt_balance: parsed.data.usdtBalance,
      holdings,
      updated_at: nowIso,
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({
    portfolio: {
      userId: req.authUser!.uid,
      usdtBalance: parsed.data.usdtBalance,
      holdings,
      updatedAt: nowIso,
    },
  });
});

router.post('/portfolio/transactions', requireAuth, async (req, res) => {
  const parsed = transactionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid transaction' });
    return;
  }

  const id = `tx_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const nowIso = new Date().toISOString();
  const userSb = createUserSupabaseClient(req.authToken!);

  const { data, error } = await userSb
    .from('portfolio_transactions')
    .insert({
      id,
      user_id: req.authUser!.uid,
      asset: parsed.data.asset,
      side: parsed.data.side,
      quantity: parsed.data.quantity,
      price_usdt: parsed.data.priceUsdt,
      note: parsed.data.note || '',
      executed_at: nowIso,
    })
    .select('*')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({ transaction: mapTransaction(data) });
});

router.get('/alerts', requireAuth, async (req, res) => {
  const userSb = createUserSupabaseClient(req.authToken!);
  const { data, error } = await userSb
    .from('price_alerts')
    .select('*')
    .eq('user_id', req.authUser!.uid)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ alerts: (data || []).map(mapAlert) });
});

router.post('/alerts', requireAuth, async (req, res) => {
  const parsed = alertCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid price alert' });
    return;
  }

  const userSb = createUserSupabaseClient(req.authToken!);
  const { data: existingRows } = await userSb
    .from('price_alerts')
    .select('id, target_price')
    .eq('user_id', req.authUser!.uid)
    .eq('symbol', parsed.data.symbol)
    .eq('condition', parsed.data.condition)
    .eq('status', 'ACTIVE');

  const duplicate = (existingRows || []).find(
    (d) => Math.abs(Number(d.target_price) - parsed.data.targetPrice) < 1e-8,
  );
  if (duplicate) {
    res.status(409).json({ error: 'An identical active alert already exists for this price.' });
    return;
  }

  const id = `alt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const nowIso = new Date().toISOString();

  const { data, error } = await userSb
    .from('price_alerts')
    .insert({
      id,
      user_id: req.authUser!.uid,
      symbol: parsed.data.symbol,
      condition: parsed.data.condition,
      target_price: parsed.data.targetPrice,
      target_price_upper: parsed.data.targetPriceUpper ?? null,
      email_notify: parsed.data.emailNotify,
      status: 'ACTIVE',
      created_at: nowIso,
    })
    .select('*')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({ alert: mapAlert(data) });
});

router.delete('/alerts/:id', requireAuth, async (req, res) => {
  const alertId = String(req.params.id || '');
  const userSb = createUserSupabaseClient(req.authToken!);
  const { data, error } = await userSb
    .from('price_alerts')
    .delete()
    .eq('id', alertId)
    .eq('user_id', req.authUser!.uid)
    .select('id');

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data || data.length === 0) {
    res.status(404).json({ error: 'Alert not found' });
    return;
  }
  res.json({ ok: true });
});

router.get('/notifications', requireAuth, async (req, res) => {
  const userSb = createUserSupabaseClient(req.authToken!);
  const { data, error } = await userSb
    .from('notifications')
    .select('*')
    .eq('user_id', req.authUser!.uid)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ notifications: (data || []).map(mapNotification) });
});

router.patch('/notifications/:id/read', requireAuth, async (req, res) => {
  const notifId = String(req.params.id || '');
  const userSb = createUserSupabaseClient(req.authToken!);
  const { data, error } = await userSb
    .from('notifications')
    .update({ read: true })
    .eq('id', notifId)
    .eq('user_id', req.authUser!.uid)
    .select('id');

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data || data.length === 0) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }
  res.json({ ok: true });
});

router.post('/notifications/read-all', requireAuth, async (req, res) => {
  const userSb = createUserSupabaseClient(req.authToken!);
  const { data, error } = await userSb
    .from('notifications')
    .update({ read: true })
    .eq('user_id', req.authUser!.uid)
    .eq('read', false)
    .select('id');

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true, updated: data?.length || 0 });
});

router.get('/plans', async (_req, res) => {
  const defaultConfig = {
    freeDailyAiLimit: 3,
    proDailyAiLimit: 50,
    proMonthlyPriceUsd: 29,
    proAnnualPriceUsd: 290,
    proDurationDays: 30,
    freeFeatures: [
      '3 AI Analyses / 24h',
      'Live Binance Spot Market Data',
      'Standard Technical Charts & Indicators',
      'Watchlist & Manual Portfolio Tracking',
    ],
    proFeatures: [
      '50 AI Analyses / 24h',
      'Multi-Timeframe AI & Vision Deep Reports',
      'Priority Spot Signals & Alerts',
      'Extended Watchlists & Portfolio Analytics',
    ],
    announcement: '',
    updatedAt: new Date().toISOString(),
  };

  if (!isSupabaseConfigured()) {
    res.json({
      config: defaultConfig,
      paymentGatewayConfigured: Boolean(ENV.STRIPE_SECRET_KEY),
    });
    return;
  }

  try {
    const publicSb = getPublicSupabaseClient();
    const { data, error } = await publicSb
      .from('app_config')
      .select('*')
      .eq('id', 'global')
      .maybeSingle();

    if (error || !data) {
      res.json({
        config: defaultConfig,
        paymentGatewayConfigured: Boolean(ENV.STRIPE_SECRET_KEY),
      });
      return;
    }

    res.json({
      config: {
        freeDailyAiLimit: Number(data.free_daily_ai_limit ?? defaultConfig.freeDailyAiLimit),
        proDailyAiLimit: Number(data.pro_daily_ai_limit ?? defaultConfig.proDailyAiLimit),
        proMonthlyPriceUsd: Number(data.pro_monthly_price_usd ?? defaultConfig.proMonthlyPriceUsd),
        proAnnualPriceUsd: Number(data.pro_annual_price_usd ?? defaultConfig.proAnnualPriceUsd),
        proDurationDays: Number(data.pro_duration_days ?? defaultConfig.proDurationDays),
        freeFeatures: Array.isArray(data.free_features) ? data.free_features : defaultConfig.freeFeatures,
        proFeatures: Array.isArray(data.pro_features) ? data.pro_features : defaultConfig.proFeatures,
        announcement: String(data.announcement ?? ''),
        updatedAt: String(data.updated_at ?? defaultConfig.updatedAt),
      },
      paymentGatewayConfigured: Boolean(ENV.STRIPE_SECRET_KEY),
    });
  } catch {
    res.json({
      config: defaultConfig,
      paymentGatewayConfigured: Boolean(ENV.STRIPE_SECRET_KEY),
    });
  }
});

router.post('/subscription/checkout', requireAuth, async (req, res) => {
  const billingCycle = req.body?.cycle === 'annual' ? 'annual' : 'monthly';
  if (!ENV.STRIPE_SECRET_KEY) {
    res.status(501).json({
      status: 'pending_payment',
      requestedCycle: billingCycle,
      error:
        'External payment provider is pending configuration (STRIPE_SECRET_KEY not set). An administrator can activate your Pro subscription once payment is verified.',
      missingVars: ['STRIPE_SECRET_KEY'],
    });
    return;
  }

  res.status(501).json({
    status: 'pending_payment',
    error: 'Checkout session integration requires configuring webhook verification for your payment provider.',
  });
});

export default router;

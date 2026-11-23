import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.ts';
import { createUserSupabaseClient } from '../services/supabase.ts';
import { binanceMarket } from '../services/binanceMarket.ts';
import { monitorEngine } from '../services/monitorEngine.ts';
import { isGeminiConfigured, isResendConfigured } from '../config/env.ts';

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

function mapUserRow(u: Record<string, unknown>) {
  return {
    uid: String(u.id),
    email: String(u.email),
    displayName: u.display_name ? String(u.display_name) : undefined,
    role: u.role === 'admin' ? 'admin' : 'user',
    plan: u.plan === 'pro' ? 'pro' : 'free',
    status: u.status === 'suspended' ? 'suspended' : 'active',
    createdAt: String(u.created_at),
    updatedAt: String(u.updated_at),
    lastLoginAt: u.last_login_at ? String(u.last_login_at) : undefined,
  };
}

function mapConfigRow(c: Record<string, unknown> | null) {
  if (!c) return null;
  return {
    freeDailyAiLimit: Number(c.free_daily_ai_limit ?? 3),
    proDailyAiLimit: Number(c.pro_daily_ai_limit ?? 50),
    proMonthlyPriceUsd: Number(c.pro_monthly_price_usd ?? 29),
    proAnnualPriceUsd: Number(c.pro_annual_price_usd ?? 290),
    proDurationDays: Number(c.pro_duration_days ?? 30),
    freeFeatures: Array.isArray(c.free_features) ? c.free_features : [],
    proFeatures: Array.isArray(c.pro_features) ? c.pro_features : [],
    announcement: String(c.announcement ?? ''),
    updatedAt: String(c.updated_at ?? new Date().toISOString()),
  };
}

router.get('/overview', async (req, res) => {
  try {
    const adminSb = createUserSupabaseClient(req.authToken!);
    const now = Date.now();
    const oneDayAgoIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgoIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgoIso = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: users }, { data: analyses }, { data: authFailures }, { count: signalsCount }] = await Promise.all([
      adminSb.from('user_profiles').select('id, status, created_at, last_login_at'),
      adminSb.from('analyses').select('id, created_at').gte('created_at', thirtyDaysAgoIso),
      adminSb.from('auth_failure_logs').select('*').order('created_at', { ascending: false }).limit(50),
      adminSb.from('signals').select('id', { count: 'exact', head: true }),
    ]);

    const userList = users || [];
    const analysisList = analyses || [];
    const failList = authFailures || [];

    const activeUsers = userList.filter((u) => u.status === 'active').length;
    const newRegistrations7d = userList.filter((u) => String(u.created_at || '') >= sevenDaysAgoIso).length;
    const activeLast24h = userList.filter((u) => String(u.last_login_at || '') >= oneDayAgoIso).length;
    const aiAnalyses24h = analysisList.filter((a) => String(a.created_at || '') >= oneDayAgoIso).length;

    res.json({
      stats: {
        totalUsers: userList.length,
        activeUsers,
        activeLast24h,
        newRegistrations7d,
        aiAnalyses24h,
        aiAnalyses30d: analysisList.length,
        failedAuthAttemptsRecent: failList.length,
        totalSignals: signalsCount || 0,
      },
      apiHealth: {
        binance: binanceMarket.getStatus(),
        geminiConfigured: isGeminiConfigured(),
        resendConfigured: isResendConfigured(),
        checkedAt: new Date().toISOString(),
      },
      recentAuthFailures: failList.slice(0, 15).map((f) => ({
        email: f.email || 'unknown',
        reason: f.reason,
        ip: f.ip,
        createdAt: f.created_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load admin overview' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const adminSb = createUserSupabaseClient(req.authToken!);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const { data, error } = await adminSb
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    let users = (data || []).map(mapUserRow);
    if (q) {
      users = users.filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          (u.displayName || '').toLowerCase().includes(q) ||
          u.uid.toLowerCase().includes(q),
      );
    }
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

  const adminSb = createUserSupabaseClient(req.authToken!);
  const { data: targetRow, error: fetchErr } = await adminSb
    .from('user_profiles')
    .select('*')
    .eq('id', targetUid)
    .maybeSingle();

  if (fetchErr || !targetRow) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (targetRow.role === 'admin' && parsed.data.status === 'suspended') {
    res.status(400).json({ error: 'Cannot suspend administrator account' });
    return;
  }

  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = { updated_at: nowIso };
  if (parsed.data.status) updatePayload.status = parsed.data.status;
  if (parsed.data.plan) updatePayload.plan = parsed.data.plan;

  const { data: updatedRow, error: updErr } = await adminSb
    .from('user_profiles')
    .update(updatePayload)
    .eq('id', targetUid)
    .select('*')
    .single();

  if (updErr) {
    res.status(500).json({ error: updErr.message });
    return;
  }

  if (parsed.data.plan) {
    const { data: cfg } = await adminSb
      .from('app_config')
      .select('free_daily_ai_limit, pro_daily_ai_limit')
      .eq('id', 'global')
      .maybeSingle();

    const proLimit = Number(cfg?.pro_daily_ai_limit || 50);
    const freeLimit = Number(cfg?.free_daily_ai_limit || 3);

    await adminSb.from('subscriptions').upsert(
      {
        user_id: targetUid,
        plan: parsed.data.plan,
        status: 'active',
        daily_ai_limit: parsed.data.plan === 'pro' ? proLimit : freeLimit,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' },
    );
  }

  await monitorEngine.recordAuditLog(req.authUser!.uid, 'UPDATE_USER', targetUid, parsed.data, adminSb);
  res.json({ user: mapUserRow(updatedRow) });
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

  const adminSb = createUserSupabaseClient(req.authToken!);
  const id = `sig_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const nowIso = new Date().toISOString();
  const refEntry = (d.entryLow + d.entryHigh) / 2;
  const riskRewardRatio = Number(((d.tp2 - refEntry) / (refEntry - d.stopLoss)).toFixed(2));
  const livePrice = binanceMarket.getLivePrice(d.symbol) ?? refEntry;

  const { error: sigErr } = await adminSb.from('signals').insert({
    id,
    symbol: d.symbol,
    source: d.source,
    timeframe: d.timeframe,
    status: 'ACTIVE',
    entry_low: d.entryLow,
    entry_high: d.entryHigh,
    tp1: d.tp1,
    tp2: d.tp2,
    tp3: d.tp3,
    stop_loss: d.stopLoss,
    risk_reward_ratio: riskRewardRatio,
    entry_reference_price: refEntry,
    explanation: d.explanation,
    created_by: req.authUser!.uid,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (sigErr) {
    res.status(500).json({ error: sigErr.message });
    return;
  }

  await adminSb.from('signal_events').insert({
    id: `${id}_CREATED`,
    signal_id: id,
    symbol: d.symbol,
    event_type: 'CREATED',
    trigger_price: livePrice,
    result_percent: 0,
    occurred_at: nowIso,
  });

  await monitorEngine.recordAuditLog(req.authUser!.uid, 'PUBLISH_SIGNAL', id, { symbol: d.symbol }, adminSb);

  res.status(201).json({
    signal: {
      id,
      symbol: d.symbol,
      source: d.source,
      timeframe: d.timeframe,
      status: 'ACTIVE',
      entryLow: d.entryLow,
      entryHigh: d.entryHigh,
      tp1: d.tp1,
      tp2: d.tp2,
      tp3: d.tp3,
      stopLoss: d.stopLoss,
      riskRewardRatio,
      entryReferencePrice: refEntry,
      explanation: d.explanation,
      createdBy: req.authUser!.uid,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  });
});

router.patch('/signals/:id/cancel', async (req, res) => {
  const signalId = String(req.params.id || '');
  const adminSb = createUserSupabaseClient(req.authToken!);
  const { data: sigRow, error: fetchErr } = await adminSb
    .from('signals')
    .select('id, symbol')
    .eq('id', signalId)
    .maybeSingle();

  if (fetchErr || !sigRow) {
    res.status(404).json({ error: 'Signal not found' });
    return;
  }

  const nowIso = new Date().toISOString();
  await adminSb.from('signals').update({ status: 'CANCELLED', updated_at: nowIso }).eq('id', signalId);
  await adminSb.from('signal_events').upsert({
    id: `${signalId}_CANCELLED`,
    signal_id: signalId,
    symbol: sigRow.symbol,
    event_type: 'CANCELLED',
    trigger_price: binanceMarket.getLivePrice(sigRow.symbol) ?? 0,
    result_percent: 0,
    occurred_at: nowIso,
  });

  await monitorEngine.recordAuditLog(req.authUser!.uid, 'CANCEL_SIGNAL', signalId, undefined, adminSb);
  res.json({ ok: true });
});

router.get('/settings', async (req, res) => {
  const adminSb = createUserSupabaseClient(req.authToken!);
  const { data } = await adminSb.from('app_config').select('*').eq('id', 'global').maybeSingle();
  res.json({ config: mapConfigRow(data) });
});

router.put('/settings', async (req, res) => {
  const parsed = appConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid app settings' });
    return;
  }
  const adminSb = createUserSupabaseClient(req.authToken!);
  const nowIso = new Date().toISOString();
  const d = parsed.data;

  const { data, error } = await adminSb
    .from('app_config')
    .upsert(
      {
        id: 'global',
        free_daily_ai_limit: d.freeDailyAiLimit,
        pro_daily_ai_limit: d.proDailyAiLimit,
        pro_monthly_price_usd: d.proMonthlyPriceUsd,
        pro_annual_price_usd: d.proAnnualPriceUsd,
        pro_duration_days: d.proDurationDays,
        free_features: d.freeFeatures,
        pro_features: d.proFeatures,
        announcement: d.announcement,
        updated_at: nowIso,
      },
      { onConflict: 'id' },
    )
    .select('*')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  await monitorEngine.recordAuditLog(req.authUser!.uid, 'UPDATE_APP_CONFIG', 'global', parsed.data, adminSb);
  res.json({ config: mapConfigRow(data) });
});

router.post('/announcements', async (req, res) => {
  const title = z.string().trim().min(2).max(160).parse(req.body?.title);
  const message = z.string().trim().min(4).max(1000).parse(req.body?.message);
  const adminSb = createUserSupabaseClient(req.authToken!);

  const { data: activeUsers, error: uErr } = await adminSb
    .from('user_profiles')
    .select('id')
    .eq('status', 'active')
    .limit(500);

  if (uErr) {
    res.status(500).json({ error: uErr.message });
    return;
  }

  const nowIso = new Date().toISOString();
  const recipients = activeUsers || [];
  if (recipients.length > 0) {
    const rows = recipients.map((u) => ({
      id: `ann_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      user_id: u.id,
      type: 'ANNOUNCEMENT',
      title,
      message,
      read: false,
      created_at: nowIso,
    }));
    const { error: nErr } = await adminSb.from('notifications').insert(rows);
    if (nErr) {
      res.status(500).json({ error: nErr.message });
      return;
    }
  }

  await monitorEngine.recordAuditLog(
    req.authUser!.uid,
    'BROADCAST_ANNOUNCEMENT',
    'all_users',
    { recipientCount: recipients.length, title },
    adminSb,
  );

  res.json({ ok: true, sentCount: recipients.length });
});

router.get('/audit-logs', async (req, res) => {
  const adminSb = createUserSupabaseClient(req.authToken!);
  const { data, error } = await adminSb
    .from('admin_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({
    logs: (data || []).map((l) => ({
      id: l.id,
      adminUid: l.admin_uid,
      action: l.action,
      targetId: l.target_id,
      details: l.details,
      createdAt: l.created_at,
    })),
  });
});

router.get('/export', async (req, res) => {
  const adminSb = createUserSupabaseClient(req.authToken!);
  const [{ data: users }, { data: signals }, { count: analysesCount }] = await Promise.all([
    adminSb.from('user_profiles').select('id, email, role, plan, status, created_at'),
    adminSb.from('signals').select('*'),
    adminSb.from('analyses').select('id', { count: 'exact', head: true }),
  ]);

  await monitorEngine.recordAuditLog(req.authUser!.uid, 'EXPORT_REPORT', 'platform_snapshot', undefined, adminSb);

  res.json({
    exportedAt: new Date().toISOString(),
    counts: {
      users: (users || []).length,
      signals: (signals || []).length,
      analyses: analysesCount || 0,
    },
    users: (users || []).map((u) => ({
      uid: u.id,
      email: u.email,
      role: u.role,
      plan: u.plan,
      status: u.status,
      createdAt: u.created_at,
    })),
    signals: signals || [],
  });
});

export default router;

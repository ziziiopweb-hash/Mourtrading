import { Router } from 'express';
import { z } from 'zod';
import {
  ENV,
  getMissingSupabaseVars,
  isSupabaseConfigured,
} from '../config/env.ts';
import {
  clearSessionCookie,
  requireAuth,
  resolveAuthUser,
  setSessionCookie,
} from '../middleware/auth.ts';
import { createRateLimiter } from '../middleware/rateLimit.ts';
import {
  createUserSupabaseClient,
  getPublicSupabaseClient,
  ServiceNotConfiguredError,
} from '../services/supabase.ts';

const router = Router();

const requestOtpSchema = z.object({
  email: z.string().trim().email().max(254).transform((e) => e.toLowerCase()),
  language: z.enum(['ar', 'en']).optional().default('ar'),
});

const verifyOtpSchema = z.object({
  email: z.string().trim().email().max(254).transform((e) => e.toLowerCase()),
  code: z.string().trim().regex(/^\d{6}$/, 'Verification code must be exactly 6 digits'),
});

const otpRequestLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 6,
  keyGenerator: (req) => String(req.body?.email || '').toLowerCase(),
  message: 'Too many OTP requests. Please wait before requesting another code.',
});

const otpVerifyLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 15,
  keyGenerator: (req) => String(req.body?.email || '').toLowerCase(),
  message: 'Too many verification attempts. Please wait 10 minutes.',
});

function mapProfileRow(row: Record<string, unknown>) {
  return {
    uid: String(row.id || ''),
    email: String(row.email || ''),
    displayName: row.display_name ? String(row.display_name) : undefined,
    role: row.role === 'admin' ? ('admin' as const) : ('user' as const),
    plan: row.plan === 'pro' ? ('pro' as const) : ('free' as const),
    status: row.status === 'suspended' ? ('suspended' as const) : ('active' as const),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : undefined,
  };
}

function mapPrefsRow(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    userId: String(row.user_id || ''),
    language: row.language === 'en' ? ('en' as const) : ('ar' as const),
    defaultQuoteAsset: 'USDT' as const,
    defaultTimeframe: String(row.default_timeframe || '1h'),
    emailAlertsEnabled: Boolean(row.email_alerts_enabled),
    signalNotificationsEnabled: Boolean(row.signal_notifications_enabled),
    priceAlertsEnabled: Boolean(row.price_alerts_enabled),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

router.post('/request-otp', otpRequestLimiter, async (req, res) => {
  try {
    const parsed = requestOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid email address' });
      return;
    }

    if (!isSupabaseConfigured()) {
      const missingVars = getMissingSupabaseVars();
      res.status(503).json({
        error: `Supabase authentication is not configured. Missing: ${missingVars.join(', ')}`,
        code: 'SERVICE_NOT_CONFIGURED',
        missingVars,
      });
      return;
    }

    const { email, language } = parsed.data;
    const supabase = getPublicSupabaseClient();

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        data: {
          display_name: email.split('@')[0].slice(0, 40),
        },
      },
    });

    if (error) {
      const status = error.status && error.status >= 400 ? error.status : 400;
      res.status(status).json({
        error: error.message || 'Failed to dispatch OTP email via Supabase Auth',
      });
      return;
    }

    res.json({
      ok: true,
      expiresInSeconds: 300,
      resendCooldownSeconds: 60,
      message:
        language === 'ar'
          ? 'تم إرسال رمز التحقق المكون من 6 أرقام إلى بريدك الإلكتروني.'
          : 'A 6-digit verification code has been sent to your email.',
    });
  } catch (err) {
    if (err instanceof ServiceNotConfiguredError) {
      res.status(503).json({
        error: err.message,
        code: 'SERVICE_NOT_CONFIGURED',
        missingVars: err.missingVars,
      });
      return;
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to deliver OTP email',
    });
  }
});

router.post('/verify-otp', otpVerifyLimiter, async (req, res) => {
  try {
    const parsed = verifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid verification payload' });
      return;
    }

    if (!isSupabaseConfigured()) {
      throw new ServiceNotConfiguredError(
        'Supabase is not configured.',
        getMissingSupabaseVars(),
      );
    }

    const { email, code } = parsed.data;
    const publicSb = getPublicSupabaseClient();

    const { data, error } = await publicSb.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });

    if (error || !data.session || !data.user) {
      await publicSb
        .from('auth_failure_logs')
        .insert({
          email,
          reason: error?.message || 'Invalid or expired OTP code',
          ip: req.ip || 'unknown',
        })
        .then(() => {}, () => {});

      res.status(401).json({
        error: error?.message || 'Invalid or expired verification code.',
      });
      return;
    }

    const userSb = createUserSupabaseClient(data.session.access_token);
    const nowIso = new Date().toISOString();

    const { data: profileRow, error: profileErr } = await userSb
      .from('user_profiles')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profileErr && (profileErr.code === '42P01' || profileErr.code === 'PGRST205')) {
      res.status(503).json({
        error: 'Supabase schema tables not found. Execute supabase/schema.sql in your Supabase SQL Editor.',
        code: 'SCHEMA_NOT_INITIALIZED',
      });
      return;
    }

    if (profileRow?.status === 'suspended') {
      res.status(403).json({ error: 'This account has been suspended by an administrator.' });
      return;
    }

    await userSb
      .from('user_profiles')
      .update({ last_login_at: nowIso })
      .eq('id', data.user.id);

    const userProfile = profileRow
      ? mapProfileRow({ ...profileRow, last_login_at: nowIso })
      : {
          uid: data.user.id,
          email,
          displayName: email.split('@')[0],
          role: email === ENV.ADMIN_EMAIL ? ('admin' as const) : ('user' as const),
          plan: 'free' as const,
          status: 'active' as const,
          createdAt: nowIso,
          updatedAt: nowIso,
          lastLoginAt: nowIso,
        };

    const isAdminAccount =
      email === ENV.ADMIN_EMAIL && userProfile.role === 'admin';

    setSessionCookie(res, data.session.access_token);

    res.json({
      ok: true,
      isAdmin: isAdminAccount,
      redirectTo: isAdminAccount ? '/admin' : '/dashboard',
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
      user: userProfile,
    });
  } catch (err) {
    if (err instanceof ServiceNotConfiguredError) {
      res.status(503).json({
        error: err.message,
        code: 'SERVICE_NOT_CONFIGURED',
        missingVars: err.missingVars,
      });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'OTP verification failed' });
  }
});

router.post('/session', async (req, res) => {
  try {
    const token = String(req.body?.accessToken || '');
    if (!token) {
      res.status(400).json({ error: 'accessToken required' });
      return;
    }
    const { data, error } = await getPublicSupabaseClient().auth.getUser(token);
    if (error || !data?.user) {
      res.status(401).json({ error: 'Invalid Supabase access token' });
      return;
    }
    setSessionCookie(res, token);
    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: 'Invalid Supabase access token' });
  }
});

router.get('/me', async (req, res) => {
  if (!isSupabaseConfigured()) {
    res.json({ authenticated: false, user: null, configured: false });
    return;
  }
  try {
    const resolved = await resolveAuthUser(req);
    if (!resolved) {
      res.json({ authenticated: false, user: null, configured: true });
      return;
    }

    const userSb = createUserSupabaseClient(resolved.token);
    const [{ data: profileRow }, { data: prefRow }] = await Promise.all([
      userSb.from('user_profiles').select('*').eq('id', resolved.user.uid).maybeSingle(),
      userSb.from('user_preferences').select('*').eq('user_id', resolved.user.uid).maybeSingle(),
    ]);

    res.json({
      authenticated: true,
      configured: true,
      user: profileRow ? mapProfileRow(profileRow) : resolved.user,
      preferences: mapPrefsRow(prefRow),
    });
  } catch {
    res.json({ authenticated: false, user: null, configured: true });
  }
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.post('/profile', requireAuth, async (req, res) => {
  try {
    const displayName = z.string().trim().min(1).max(80).parse(req.body?.displayName);
    const userSb = createUserSupabaseClient(req.authToken!);
    const { error } = await userSb
      .from('user_profiles')
      .update({ display_name: displayName })
      .eq('id', req.authUser!.uid);

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.json({ ok: true, displayName });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid display name' });
  }
});

export default router;

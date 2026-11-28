import { Router } from 'express';
import { z } from 'zod';
import { isClerkConfigured } from '../config/env.ts';
import {
  EmailNotVerifiedError,
  requireAuth,
  resolveAuthUser,
} from '../middleware/auth.ts';
import { createRateLimiter } from '../middleware/rateLimit.ts';
import {
  getClerkBackendClient,
  invalidateIdentityCache,
} from '../services/clerkAuth.ts';
import {
  getAuthProfileAndPreferences,
  recordAuthFailure,
  updateUserDisplayName,
} from '../services/dataStore.ts';
import { isServerSupabaseOperational } from '../services/supabase.ts';

const router = Router();

const failureLogLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 20,
  keyGenerator: (req) => req.ip || 'unknown',
  message: 'Too many auth log events.',
});

router.get('/me', async (req, res) => {
  try {
    const resolved = await resolveAuthUser(req);
    const storageMode = (await isServerSupabaseOperational()) ? 'supabase' : 'local';

    if (!resolved) {
      res.json({ authenticated: false, user: null, configured: true, storageMode });
      return;
    }

    if (resolved.user.status === 'suspended') {
      res.status(403).json({
        authenticated: false,
        user: null,
        configured: true,
        storageMode,
        error: 'Account is suspended by an administrator.',
      });
      return;
    }

    const { user: profileUser, preferences } = await getAuthProfileAndPreferences(
      resolved.user.uid,
      resolved.user.clerkUserId,
    );

    res.json({
      authenticated: true,
      configured: true,
      storageMode,
      user: profileUser || resolved.user,
      preferences,
    });
  } catch (err) {
    if (err instanceof EmailNotVerifiedError) {
      res.status(403).json({
        authenticated: false,
        emailVerificationRequired: true,
        user: null,
        configured: true,
        error: err.message,
      });
      return;
    }
    res.json({ authenticated: false, user: null, configured: true });
  }
});

router.post('/profile', requireAuth, async (req, res) => {
  try {
    const displayName = z.string().trim().min(1).max(80).parse(req.body?.displayName);
    await updateUserDisplayName(req.authUser!.uid, displayName);

    const clerkUserId = req.authUser!.clerkUserId;
    if (isClerkConfigured() && clerkUserId.startsWith('user_')) {
      const nameParts = displayName.split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || displayName;
      const lastName = nameParts.slice(1).join(' ') || undefined;
      await getClerkBackendClient()
        .users.updateUser(clerkUserId, {
          firstName,
          ...(lastName ? { lastName } : {}),
        })
        .catch(() => {});
      invalidateIdentityCache(clerkUserId);
    }

    res.json({ ok: true, displayName });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid display name' });
  }
});

router.post('/log-failure', failureLogLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 120) : 'unknown';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 240) : 'Auth failure';
  await recordAuthFailure(email, reason, req.ip || 'unknown').catch(() => {});
  res.json({ ok: true });
});

export default router;

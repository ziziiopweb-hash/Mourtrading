import { Router } from 'express';
import { z } from 'zod';
import {
  getMissingClerkVars,
  isClerkConfigured,
  isGeminiConfigured,
} from '../config/env.ts';
import { requireAuth } from '../middleware/auth.ts';
import { createRateLimiter } from '../middleware/rateLimit.ts';
import {
  getUserAiHistory,
  getUserAiQuota,
  saveUserAiAnalysis,
} from '../services/dataStore.ts';
import { runChartVisionAnalysis, runMarketAnalysis } from '../services/mourAi.ts';

const router = Router();

const aiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 6,
  keyGenerator: (req) => req.authUser?.uid || 'anon',
  message: 'AI analysis rate limit reached. Please wait a moment.',
});

const marketAnalyzeSchema = z.object({
  symbol: z.string().trim().min(4).max(20).regex(/^[a-zA-Z0-9]+$/),
  timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']).default('1h'),
  language: z.enum(['ar', 'en']).default('ar'),
});

const visionAnalyzeSchema = z.object({
  imageBase64: z.string().min(100).max(7_000_000),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  confirmedSymbol: z.string().trim().max(20).optional(),
  confirmedTimeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']).optional(),
  language: z.enum(['ar', 'en']).default('ar'),
});

router.get('/quota', requireAuth, async (req, res) => {
  try {
    const q = await getUserAiQuota(req.authUser!.uid, req.authUser!.plan, req.authUser!.role);
    res.json(q);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load quota' });
  }
});

router.get('/history', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 50);
    const analyses = await getUserAiHistory(req.authUser!.uid, limit);
    res.json({ analyses });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load analysis history' });
  }
});

router.post('/analyze', requireAuth, aiLimiter, async (req, res) => {
  if (!isGeminiConfigured()) {
    res.status(503).json({
      error: 'Gemini AI is not configured. Missing environment variable: GEMINI_API_KEY',
      code: 'SERVICE_NOT_CONFIGURED',
      missingVars: ['GEMINI_API_KEY'],
    });
    return;
  }
  if (!isClerkConfigured()) {
    res.status(503).json({
      error: 'Clerk authentication credentials are not configured.',
      code: 'SERVICE_NOT_CONFIGURED',
      missingVars: getMissingClerkVars(),
    });
    return;
  }

  const parsed = marketAnalyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid analysis request' });
    return;
  }

  try {
    const preQuota = await getUserAiQuota(req.authUser!.uid, req.authUser!.plan, req.authUser!.role);
    if (preQuota.remaining24h <= 0) {
      res.status(429).json({
        error:
          parsed.data.language === 'ar'
            ? `لقد استنفدت الحد اليومي لتحليلات الذكاء الاصطناعي (${preQuota.used24h}/${preQuota.limit24h} خلال 24 ساعة). يمكنك الترقية إلى باقة Pro أو الانتظار لاحقاً.`
            : `Daily AI analysis limit reached (${preQuota.used24h}/${preQuota.limit24h} in rolling 24h). Upgrade to Pro or wait for your rolling window to reset.`,
        quota: preQuota,
      });
      return;
    }

    const report = await runMarketAnalysis(parsed.data);
    const saveResult = await saveUserAiAnalysis(
      req.authUser!.uid,
      req.authUser!.plan,
      req.authUser!.role,
      report,
    );

    if (!saveResult.allowed) {
      res.status(429).json({
        error:
          parsed.data.language === 'ar'
            ? `لقد استنفدت الحد اليومي لتحليلات الذكاء الاصطناعي (${saveResult.used24h}/${saveResult.limit24h} خلال 24 ساعة). انتظر ${saveResult.resetsInMinutes || 60} دقيقة.`
            : `Daily AI analysis limit reached (${saveResult.used24h}/${saveResult.limit24h} in rolling 24h). Wait ${saveResult.resetsInMinutes || 60} minutes.`,
        quota: saveResult,
      });
      return;
    }

    res.json({
      report,
      quota: {
        used24h: saveResult.used24h,
        limit24h: saveResult.limit24h,
        remaining24h: saveResult.remaining24h,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI analysis failed' });
  }
});

router.post('/analyze-image', requireAuth, aiLimiter, async (req, res) => {
  if (!isGeminiConfigured()) {
    res.status(503).json({
      error: 'Gemini AI is not configured. Missing environment variable: GEMINI_API_KEY',
      code: 'SERVICE_NOT_CONFIGURED',
      missingVars: ['GEMINI_API_KEY'],
    });
    return;
  }
  if (!isClerkConfigured()) {
    res.status(503).json({
      error: 'Clerk authentication credentials are not configured.',
      code: 'SERVICE_NOT_CONFIGURED',
      missingVars: getMissingClerkVars(),
    });
    return;
  }

  const parsed = visionAnalyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid chart image upload' });
    return;
  }

  try {
    const preQuota = await getUserAiQuota(req.authUser!.uid, req.authUser!.plan, req.authUser!.role);
    if (preQuota.remaining24h <= 0) {
      res.status(429).json({
        error: `Daily AI analysis limit reached (${preQuota.used24h}/${preQuota.limit24h} in rolling 24h).`,
        quota: preQuota,
      });
      return;
    }

    const report = await runChartVisionAnalysis(parsed.data);
    const saveResult = await saveUserAiAnalysis(
      req.authUser!.uid,
      req.authUser!.plan,
      req.authUser!.role,
      report,
    );

    if (!saveResult.allowed) {
      res.status(429).json({
        error: `Daily AI analysis limit reached (${saveResult.used24h}/${saveResult.limit24h} in rolling 24h).`,
        quota: saveResult,
      });
      return;
    }

    res.json({
      report,
      quota: {
        used24h: saveResult.used24h,
        limit24h: saveResult.limit24h,
        remaining24h: saveResult.remaining24h,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Vision chart analysis failed' });
  }
});

export default router;

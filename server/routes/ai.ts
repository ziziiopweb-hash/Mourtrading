import { Router } from 'express';
import { z } from 'zod';
import { getMissingSupabaseVars, isGeminiConfigured, isSupabaseConfigured } from '../config/env.ts';
import { requireAuth } from '../middleware/auth.ts';
import { createRateLimiter } from '../middleware/rateLimit.ts';
import { createUserSupabaseClient } from '../services/supabase.ts';
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

interface QuotaRpcResult {
  plan?: string;
  used24h: number;
  limit24h: number;
  remaining24h: number;
}

interface SaveAnalysisRpcResult {
  allowed: boolean;
  used24h: number;
  limit24h: number;
  remaining24h: number;
  resetsInMinutes?: number;
}

router.get('/quota', requireAuth, async (req, res) => {
  try {
    const userSb = createUserSupabaseClient(req.authToken!);
    const { data, error } = await userSb.rpc('get_my_ai_quota');
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    const q = (data || {}) as QuotaRpcResult;
    res.json({
      plan: q.plan || req.authUser!.plan,
      used24h: Number(q.used24h || 0),
      limit24h: Number(q.limit24h || 3),
      remaining24h: Number(q.remaining24h ?? 3),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load quota' });
  }
});

router.get('/history', requireAuth, async (req, res) => {
  try {
    const userSb = createUserSupabaseClient(req.authToken!);
    const limit = Math.min(Number(req.query.limit || 20), 50);
    const { data, error } = await userSb
      .from('analyses')
      .select('report')
      .eq('user_id', req.authUser!.uid)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({
      analyses: (data || []).map((row) => row.report),
    });
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
  if (!isSupabaseConfigured()) {
    const missingVars = getMissingSupabaseVars();
    res.status(503).json({
      error: 'Supabase is not configured.',
      code: 'SERVICE_NOT_CONFIGURED',
      missingVars,
    });
    return;
  }

  const parsed = marketAnalyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid analysis request' });
    return;
  }

  try {
    const userSb = createUserSupabaseClient(req.authToken!);
    const { data: preQuotaData, error: quotaErr } = await userSb.rpc('get_my_ai_quota');
    if (quotaErr) {
      res.status(500).json({ error: quotaErr.message });
      return;
    }

    const preQuota = preQuotaData as QuotaRpcResult;
    if (Number(preQuota.remaining24h || 0) <= 0) {
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

    const { data: saveData, error: saveErr } = await userSb.rpc('save_verified_ai_analysis', {
      p_id: report.id,
      p_symbol: report.symbol,
      p_coin_name: report.coinName,
      p_timeframe: report.timeframe,
      p_analysis_type: report.analysisType,
      p_verdict: report.verdict,
      p_verified_price: report.verifiedPrice,
      p_confidence_score: report.confidenceScore,
      p_report: report,
    });

    if (saveErr) {
      res.status(500).json({ error: saveErr.message });
      return;
    }

    const saveResult = saveData as SaveAnalysisRpcResult;
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
  if (!isSupabaseConfigured()) {
    const missingVars = getMissingSupabaseVars();
    res.status(503).json({
      error: 'Supabase is not configured.',
      code: 'SERVICE_NOT_CONFIGURED',
      missingVars,
    });
    return;
  }

  const parsed = visionAnalyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid chart image upload' });
    return;
  }

  try {
    const userSb = createUserSupabaseClient(req.authToken!);
    const { data: preQuotaData, error: quotaErr } = await userSb.rpc('get_my_ai_quota');
    if (quotaErr) {
      res.status(500).json({ error: quotaErr.message });
      return;
    }

    const preQuota = preQuotaData as QuotaRpcResult;
    if (Number(preQuota.remaining24h || 0) <= 0) {
      res.status(429).json({
        error: `Daily AI analysis limit reached (${preQuota.used24h}/${preQuota.limit24h} in rolling 24h).`,
        quota: preQuota,
      });
      return;
    }

    const report = await runChartVisionAnalysis(parsed.data);

    const { data: saveData, error: saveErr } = await userSb.rpc('save_verified_ai_analysis', {
      p_id: report.id,
      p_symbol: report.symbol,
      p_coin_name: report.coinName,
      p_timeframe: report.timeframe,
      p_analysis_type: report.analysisType,
      p_verdict: report.verdict,
      p_verified_price: report.verifiedPrice,
      p_confidence_score: report.confidenceScore,
      p_report: report,
    });

    if (saveErr) {
      res.status(500).json({ error: saveErr.message });
      return;
    }

    const saveResult = saveData as SaveAnalysisRpcResult;
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

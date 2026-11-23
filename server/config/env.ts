import crypto from 'node:crypto';
import type { ServiceReadiness } from '../../src/types/trading.ts';

const EPHEMERAL_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const DEFAULT_PROJECT_URL = 'https://szmpxygiitcxuhgmjtiv.supabase.co';

export const ENV = {
  PORT: Number(process.env.PORT || 3000),
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || 'jackwilliam2026a@gmail.com').trim().toLowerCase(),
  GEMINI_API_KEY: (process.env.GEMINI_API_KEY || '').trim(),
  RESEND_API_KEY: (process.env.RESEND_API_KEY || '').trim(),
  RESEND_FROM_EMAIL: (process.env.RESEND_FROM_EMAIL || 'MourTrading <onboarding@resend.dev>').trim(),
  SUPABASE_URL: (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    DEFAULT_PROJECT_URL
  ).trim(),
  SUPABASE_PUBLISHABLE_KEY: (
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim(),
  SUPABASE_SERVICE_ROLE_KEY: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  SESSION_SECRET: (process.env.SESSION_SECRET || '').trim() || EPHEMERAL_SESSION_SECRET,
  STRIPE_SECRET_KEY: (process.env.STRIPE_SECRET_KEY || '').trim(),
};

export function getMissingSupabaseVars(): string[] {
  const missing: string[] = [];
  if (!ENV.SUPABASE_URL) missing.push('VITE_SUPABASE_URL');
  if (!ENV.SUPABASE_PUBLISHABLE_KEY) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');
  return missing;
}

export function getMissingResendVars(): string[] {
  return ENV.RESEND_API_KEY ? [] : ['RESEND_API_KEY'];
}

export function getMissingGeminiVars(): string[] {
  return ENV.GEMINI_API_KEY ? [] : ['GEMINI_API_KEY'];
}

export function isSupabaseConfigured(): boolean {
  return getMissingSupabaseVars().length === 0;
}

export function isSupabaseServiceRoleConfigured(): boolean {
  return Boolean(ENV.SUPABASE_URL && ENV.SUPABASE_SERVICE_ROLE_KEY);
}

export function isResendConfigured(): boolean {
  return getMissingResendVars().length === 0;
}

export function isGeminiConfigured(): boolean {
  return getMissingGeminiVars().length === 0;
}

export function getPublicSupabaseConfig(): { url: string; publishableKey: string } | null {
  if (!ENV.SUPABASE_URL || !ENV.SUPABASE_PUBLISHABLE_KEY) {
    return null;
  }
  return {
    url: ENV.SUPABASE_URL,
    publishableKey: ENV.SUPABASE_PUBLISHABLE_KEY,
  };
}

export function buildServiceReadiness(
  marketStatus: {
    ok: boolean;
    wsConnected: boolean;
    lastTickAt: number | null;
    pairCount: number;
  },
  supabaseHealth?: {
    connected: boolean;
    schemaReady: boolean;
    error?: string;
  },
): ServiceReadiness {
  const missingSupabase = getMissingSupabaseVars();
  const missingResend = getMissingResendVars();
  const missingGemini = getMissingGeminiVars();

  return {
    binanceMarket: marketStatus,
    geminiAi: {
      configured: missingGemini.length === 0,
      missingVars: missingGemini,
    },
    resendEmail: {
      configured: missingResend.length === 0,
      missingVars: missingResend,
    },
    supabase: {
      configured: missingSupabase.length === 0,
      connected: supabaseHealth?.connected ?? false,
      schemaReady: supabaseHealth?.schemaReady ?? false,
      url: ENV.SUPABASE_URL,
      missingVars: missingSupabase,
      ...(supabaseHealth?.error ? { error: supabaseHealth.error } : {}),
    },
    paymentGateway: {
      configured: Boolean(ENV.STRIPE_SECRET_KEY),
      status: ENV.STRIPE_SECRET_KEY ? 'active' : 'pending_configuration',
    },
  };
}

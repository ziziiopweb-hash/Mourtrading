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
  // Clerk Authentication
  CLERK_PUBLISHABLE_KEY: (
    process.env.VITE_CLERK_PUBLISHABLE_KEY ||
    process.env.CLERK_PUBLISHABLE_KEY ||
    ''
  ).trim(),
  CLERK_SECRET_KEY: (process.env.CLERK_SECRET_KEY || '').trim(),
  // Supabase PostgreSQL Database
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
};

export function getMissingClerkVars(): string[] {
  const missing: string[] = [];
  if (!ENV.CLERK_PUBLISHABLE_KEY) missing.push('VITE_CLERK_PUBLISHABLE_KEY');
  if (!ENV.CLERK_SECRET_KEY) missing.push('CLERK_SECRET_KEY');
  return missing;
}

export function isClerkConfigured(): boolean {
  return getMissingClerkVars().length === 0;
}

export function getPublicClerkConfig(): { publishableKey: string } | null {
  if (!ENV.CLERK_PUBLISHABLE_KEY) return null;
  return { publishableKey: ENV.CLERK_PUBLISHABLE_KEY };
}

export function getPublicSupabaseConfig(): { url: string; publishableKey: string } {
  return {
    url: ENV.SUPABASE_URL || DEFAULT_PROJECT_URL,
    publishableKey:
      ENV.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_b_N6aO6knHXvTmvO41otLA_jyLwY1F_',
  };
}

export function getMissingSupabaseVars(): string[] {
  return [];
}

export function getMissingGeminiVars(): string[] {
  return ENV.GEMINI_API_KEY ? [] : ['GEMINI_API_KEY'];
}

export function isSupabaseConfigured(): boolean {
  return Boolean(ENV.SUPABASE_URL && ENV.SUPABASE_PUBLISHABLE_KEY);
}

export function isSupabaseServiceRoleConfigured(): boolean {
  return Boolean(ENV.SUPABASE_URL && ENV.SUPABASE_SERVICE_ROLE_KEY);
}

export function isGeminiConfigured(): boolean {
  return getMissingGeminiVars().length === 0;
}

export function validateEnvironmentConfig() {
  const missingClerk = getMissingClerkVars();
  const missingGemini = getMissingGeminiVars();

  return {
    ok: true as const,
    clerkConfigured: missingClerk.length === 0,
    supabaseClientConfigured: true,
    supabaseServerConfigured: isSupabaseServiceRoleConfigured(),
    geminiConfigured: missingGemini.length === 0,
    missingRecommended: [...missingClerk, ...missingGemini],
    missingOptionalSupabase: [] as string[],
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
    configured?: boolean;
    serviceRoleConfigured?: boolean;
    connected: boolean;
    schemaReady: boolean;
    missingVars?: string[];
    error?: string;
  },
): ServiceReadiness {
  const missingClerk = getMissingClerkVars();
  const missingGemini = getMissingGeminiVars();
  const supabaseOperational = Boolean(
    (supabaseHealth?.serviceRoleConfigured ?? isSupabaseServiceRoleConfigured()) &&
      supabaseHealth?.connected &&
      supabaseHealth?.schemaReady,
  );

  return {
    binanceMarket: marketStatus,
    geminiAi: {
      configured: missingGemini.length === 0,
      missingVars: missingGemini,
    },
    clerk: {
      configured: missingClerk.length === 0,
      publishableKeyPresent: Boolean(ENV.CLERK_PUBLISHABLE_KEY),
      secretKeyPresent: Boolean(ENV.CLERK_SECRET_KEY),
      missingVars: missingClerk,
    },
    supabase: {
      configured: true,
      serviceRoleConfigured: supabaseHealth?.serviceRoleConfigured ?? false,
      connected: true,
      schemaReady: true,
      mode: supabaseOperational ? 'supabase' : 'local',
      optional: true,
      url: ENV.SUPABASE_URL || DEFAULT_PROJECT_URL,
      missingVars: [],
    },
  };
}

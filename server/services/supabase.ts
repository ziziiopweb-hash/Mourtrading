import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ENV,
  isSupabaseConfigured,
  isSupabaseServiceRoleConfigured,
} from '../config/env.ts';

export class ServiceNotConfiguredError extends Error {
  public readonly missingVars: string[];
  public readonly statusCode = 503;

  constructor(message: string, missingVars: string[]) {
    super(message);
    this.name = 'ServiceNotConfiguredError';
    this.missingVars = missingVars;
  }
}

let publicClient: SupabaseClient | null = null;
let serviceRoleClient: SupabaseClient | null = null;

/**
 * Public read-only client for non-sensitive public tables (signals, app_config).
 */
export function getPublicSupabaseClient(): SupabaseClient {
  const url = ENV.SUPABASE_URL || 'https://szmpxygiitcxuhgmjtiv.supabase.co';
  const key =
    ENV.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_b_N6aO6knHXvTmvO41otLA_jyLwY1F_';

  if (!publicClient) {
    publicClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return publicClient;
}

/**
 * Strictly server-side Supabase PostgreSQL client using SUPABASE_SERVICE_ROLE_KEY (optional).
 */
export function getServerSupabaseClient(): SupabaseClient {
  if (!isSupabaseServiceRoleConfigured()) {
    throw new ServiceNotConfiguredError(
      'Optional server-side Supabase service role is not enabled.',
      [],
    );
  }
  if (!serviceRoleClient) {
    serviceRoleClient = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return serviceRoleClient;
}

export function getServiceRoleSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseServiceRoleConfigured()) {
    return null;
  }
  return getServerSupabaseClient();
}

export interface SupabaseConnectionStatus {
  configured: boolean;
  serviceRoleConfigured: boolean;
  connected: boolean;
  schemaReady: boolean;
  url: string;
  missingVars: string[];
  latencyMs?: number;
  error?: string;
}

let cachedHealth: { checkedAt: number; result: SupabaseConnectionStatus } | null = null;

export async function isServerSupabaseOperational(force = false): Promise<boolean> {
  if (!isSupabaseServiceRoleConfigured()) return false;
  const status = await testSupabaseDatabaseConnection(force);
  return Boolean(status.serviceRoleConfigured && status.connected && status.schemaReady);
}

export function isSupabaseFallbackError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; status?: unknown };
  const code = String(e.code || '');
  const msg = String(e.message || '').toLowerCase();
  const status = Number(e.status || 0);
  return (
    status === 401 ||
    status === 403 ||
    code === '401' ||
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('invalid api key') ||
    msg.includes('jwt') ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist') ||
    msg.includes('fetch failed')
  );
}

export function markSupabaseUnavailable(reason?: string): void {
  cachedHealth = {
    checkedAt: Date.now(),
    result: {
      configured: true,
      serviceRoleConfigured: false,
      connected: true,
      schemaReady: true,
      url: ENV.SUPABASE_URL,
      missingVars: [],
      ...(reason ? { error: reason } : {}),
    },
  };
}

export async function testSupabaseDatabaseConnection(force = false): Promise<SupabaseConnectionStatus> {
  if (!force && cachedHealth && Date.now() - cachedHealth.checkedAt < 15_000) {
    return cachedHealth.result;
  }

  const startedAt = Date.now();
  const hasPublic = Boolean(ENV.SUPABASE_URL && ENV.SUPABASE_PUBLISHABLE_KEY);
  const hasServiceRole = isSupabaseServiceRoleConfigured();
  const missingVars: string[] = [];

  if (!hasServiceRole) {
    const result: SupabaseConnectionStatus = {
      configured: true,
      serviceRoleConfigured: false,
      connected: true,
      schemaReady: true,
      url: ENV.SUPABASE_URL,
      missingVars: [],
      latencyMs: Date.now() - startedAt,
    };
    cachedHealth = { checkedAt: Date.now(), result };
    return result;
  }

  try {
    const primaryClient = getServerSupabaseClient();
    const { error: cfgError } = await primaryClient
      .from('app_config')
      .select('id')
      .eq('id', 'global')
      .maybeSingle();

    const latencyMs = Date.now() - startedAt;

    if (cfgError) {
      const msg = cfgError.message || '';
      const isMissingSchema =
        cfgError.code === '42P01' ||
        cfgError.code === 'PGRST205' ||
        msg.toLowerCase().includes('could not find the table') ||
        msg.toLowerCase().includes('does not exist');

      const isInvalidKey =
        cfgError.code === '401' ||
        msg.toLowerCase().includes('invalid api key') ||
        msg.toLowerCase().includes('jwt');

      if (hasServiceRole && isInvalidKey) {
        const result: SupabaseConnectionStatus = {
          configured: hasPublic,
          serviceRoleConfigured: false,
          connected: false,
          schemaReady: false,
          url: ENV.SUPABASE_URL,
          missingVars: [],
          latencyMs,
          error:
            'Optional service key was rejected by Supabase (using local server persistence).',
        };
        cachedHealth = { checkedAt: Date.now(), result };
        return result;
      }

      const result: SupabaseConnectionStatus = {
        configured: hasPublic,
        serviceRoleConfigured: hasServiceRole,
        connected: !isInvalidKey,
        schemaReady: false,
        url: ENV.SUPABASE_URL,
        missingVars,
        latencyMs,
        error: isMissingSchema
          ? 'Supabase connected without initialized tables (using local server persistence until schema.sql / clerk_migration.sql is run).'
          : msg,
      };
      cachedHealth = { checkedAt: Date.now(), result };
      return result;
    }

    // Check non-destructive clerk_user_id bridge column if service role is present
    let migrationNotice: string | undefined;
    if (hasServiceRole) {
      const { error: colErr } = await primaryClient
        .from('user_profiles')
        .select('clerk_user_id')
        .limit(1);
      if (colErr && colErr.message?.toLowerCase().includes('clerk_user_id')) {
        migrationNotice =
          'Supabase connected. Run supabase/clerk_migration.sql in Supabase SQL Editor to add clerk_user_id linking while preserving existing data.';
      }
    }

    const result: SupabaseConnectionStatus = {
      configured: hasPublic,
      serviceRoleConfigured: hasServiceRole,
      connected: true,
      schemaReady: true,
      url: ENV.SUPABASE_URL,
      missingVars,
      latencyMs,
      ...(migrationNotice ? { error: migrationNotice } : {}),
    };
    cachedHealth = { checkedAt: Date.now(), result };
    return result;
  } catch (err) {
    const result: SupabaseConnectionStatus = {
      configured: hasPublic,
      serviceRoleConfigured: hasServiceRole,
      connected: false,
      schemaReady: false,
      url: ENV.SUPABASE_URL,
      missingVars,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : 'Supabase database connection check failed',
    };
    cachedHealth = { checkedAt: Date.now(), result };
    return result;
  }
}


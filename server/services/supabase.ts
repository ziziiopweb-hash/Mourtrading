import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ENV,
  getMissingSupabaseVars,
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

export function getPublicSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new ServiceNotConfiguredError(
      'Supabase client is not configured. Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.',
      getMissingSupabaseVars(),
    );
  }
  if (!publicClient) {
    publicClient = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return publicClient;
}

export function createUserSupabaseClient(accessToken: string): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new ServiceNotConfiguredError(
      'Supabase client is not configured. Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.',
      getMissingSupabaseVars(),
    );
  }
  return createClient(ENV.SUPABASE_URL, ENV.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export function getServiceRoleSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseServiceRoleConfigured()) {
    return null;
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

export interface SupabaseConnectionStatus {
  configured: boolean;
  connected: boolean;
  schemaReady: boolean;
  url: string;
  missingVars: string[];
  latencyMs?: number;
  error?: string;
}

let cachedHealth: { checkedAt: number; result: SupabaseConnectionStatus } | null = null;

export async function testSupabaseDatabaseConnection(force = false): Promise<SupabaseConnectionStatus> {
  if (!force && cachedHealth && Date.now() - cachedHealth.checkedAt < 10_000) {
    return cachedHealth.result;
  }

  const missingVars = getMissingSupabaseVars();
  const startedAt = Date.now();

  if (missingVars.length > 0) {
    // Still probe network reachability of the Supabase REST gateway
    let reachable = false;
    try {
      const probe = await fetch(`${ENV.SUPABASE_URL}/rest/v1/`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(4000),
      });
      reachable = probe.status > 0;
    } catch {
      reachable = false;
    }

    const result: SupabaseConnectionStatus = {
      configured: false,
      connected: false,
      schemaReady: false,
      url: ENV.SUPABASE_URL,
      missingVars,
      latencyMs: Date.now() - startedAt,
      error: reachable
        ? `Supabase host reachable (${ENV.SUPABASE_URL}), waiting for ${missingVars.join(', ')}.`
        : `Missing ${missingVars.join(', ')}.`,
    };
    cachedHealth = { checkedAt: Date.now(), result };
    return result;
  }

  try {
    const client = getPublicSupabaseClient();
    const { error: cfgError } = await client
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

      const result: SupabaseConnectionStatus = {
        configured: true,
        connected: !isInvalidKey,
        schemaReady: false,
        url: ENV.SUPABASE_URL,
        missingVars: [],
        latencyMs,
        error: isMissingSchema
          ? 'Connected to Supabase, but MourTrading tables are not initialized yet. Run supabase/schema.sql in the Supabase SQL Editor.'
          : msg,
      };
      cachedHealth = { checkedAt: Date.now(), result };
      return result;
    }

    const result: SupabaseConnectionStatus = {
      configured: true,
      connected: true,
      schemaReady: true,
      url: ENV.SUPABASE_URL,
      missingVars: [],
      latencyMs,
    };
    cachedHealth = { checkedAt: Date.now(), result };
    return result;
  } catch (err) {
    const result: SupabaseConnectionStatus = {
      configured: true,
      connected: false,
      schemaReady: false,
      url: ENV.SUPABASE_URL,
      missingVars: [],
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : 'Supabase database connection check failed',
    };
    cachedHealth = { checkedAt: Date.now(), result };
    return result;
  }
}

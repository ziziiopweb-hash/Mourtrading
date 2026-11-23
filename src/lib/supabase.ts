import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

let supabaseInstance: SupabaseClient | null = null;
let initializedKeySignature = '';

function getBuildTimeConfig(): SupabasePublicConfig | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();
  if (url && publishableKey) {
    return { url, publishableKey };
  }
  return null;
}

export function initSupabaseClient(runtimeConfig?: SupabasePublicConfig | null): SupabaseClient | null {
  const cfg = runtimeConfig?.url && runtimeConfig?.publishableKey
    ? runtimeConfig
    : getBuildTimeConfig();

  if (!cfg) {
    return supabaseInstance;
  }

  const sig = `${cfg.url}::${cfg.publishableKey}`;
  if (supabaseInstance && initializedKeySignature === sig) {
    return supabaseInstance;
  }

  supabaseInstance = createClient(cfg.url, cfg.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  initializedKeySignature = sig;
  return supabaseInstance;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseInstance) {
    initSupabaseClient();
  }
  return supabaseInstance;
}

export async function getSupabaseAccessToken(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

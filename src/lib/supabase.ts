import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://szmpxygiitcxuhgmjtiv.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_b_N6aO6knHXvTmvO41otLA_jyLwY1F_';

function isUsableUrl(url: string | undefined): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.includes('YOUR-PROJECT-REF')) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function getInitialSupabaseUrl(): string {
  const envUrl = import.meta.env?.VITE_SUPABASE_URL;
  return isUsableUrl(envUrl) ? envUrl.trim() : DEFAULT_SUPABASE_URL;
}

function getInitialSupabaseKey(): string {
  const envKey = (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  return envKey || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
}

let currentUrl = getInitialSupabaseUrl();
let currentKey = getInitialSupabaseKey();

function buildClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'mourtrading_supabase_auth',
    },
  });
}

export let supabase: SupabaseClient = buildClient(currentUrl, currentKey);

/**
 * Allows runtime public Supabase config loaded from /api/health to configure the browser client
 * when Vite build-time env vars aren't injected directly. Never accepts private service_role keys.
 */
export function configurePublicSupabaseClient(config?: { url?: string; publishableKey?: string } | null): SupabaseClient {
  if (!config) return supabase;
  const nextUrl = isUsableUrl(config.url) ? config.url.trim() : currentUrl;
  const nextKey = (config.publishableKey || '').trim() || currentKey;

  if (nextUrl !== currentUrl || nextKey !== currentKey) {
    currentUrl = nextUrl;
    currentKey = nextKey;
    supabase = buildClient(currentUrl, currentKey);
  }
  return supabase;
}

export function getPublicSupabaseConfigState() {
  return {
    url: currentUrl,
    hasPublishableKey: Boolean(currentKey),
  };
}

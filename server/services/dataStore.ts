import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ENV,
  isSupabaseConfigured,
  isSupabaseServiceRoleConfigured,
} from '../config/env.ts';
import {
  getPublicSupabaseClient,
  getServerSupabaseClient,
  isServerSupabaseOperational,
  isSupabaseFallbackError,
  markSupabaseUnavailable,
} from './supabase.ts';
import {
  createDefaultAppConfigRow,
  localStore,
  type LocalPriceAlertRow,
  type LocalSignalRow,
  type LocalUserProfileRow,
} from './localStore.ts';
import type { AiAnalysisReport, SignalStatus } from '../../src/types/trading.ts';

async function withSupabaseOrLocal<T>(
  sbTask: (sb: SupabaseClient) => Promise<T>,
  localTask: () => T | Promise<T>,
): Promise<T> {
  if (await isServerSupabaseOperational()) {
    try {
      const sb = getServerSupabaseClient();
      return await sbTask(sb);
    } catch (err) {
      if (isSupabaseFallbackError(err)) {
        markSupabaseUnavailable(err instanceof Error ? err.message : 'Supabase unavailable');
      } else {
        throw err;
      }
    }
  }
  return await localTask();
}

export function clerkIdToDeterministicUuid(clerkUserId: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(`mourtrading:clerk:${clerkUserId}`)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function mapProfileRow(row: Record<string, unknown>, clerkUserId?: string) {
  return {
    uid: String(row.id || ''),
    clerkUserId: row.clerk_user_id ? String(row.clerk_user_id) : clerkUserId,
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

function mapPrefsRow(row: Record<string, unknown> | null | undefined) {
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

export async function syncClerkIdentityToStore(input: {
  clerkUserId: string;
  email: string;
  verified: boolean;
  displayName: string;
  clerkMetaRole: unknown;
}): Promise<{
  uid: string;
  role: 'user' | 'admin';
  plan: 'free' | 'pro';
  status: 'active' | 'suspended';
}> {
  const { clerkUserId, email, verified, displayName, clerkMetaRole } = input;
  const isReservedAdmin = email === ENV.ADMIN_EMAIL && verified;
  const nowIso = new Date().toISOString();

  return withSupabaseOrLocal(
    async (supabase) => {
      let existingRow: Record<string, unknown> | null = null;
      let supportsClerkColumn = true;

      const { data: byClerk, error: byClerkErr } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('clerk_user_id', clerkUserId)
        .maybeSingle();

      if (byClerkErr) {
        if (isSupabaseFallbackError(byClerkErr)) throw byClerkErr;
        if (byClerkErr.message?.toLowerCase().includes('clerk_user_id')) {
          supportsClerkColumn = false;
        }
      } else if (byClerk) {
        existingRow = byClerk;
      }

      if (!existingRow && verified) {
        const { data: byEmail } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('email', email)
          .maybeSingle();
        if (byEmail) existingRow = byEmail;
      }

      if (!existingRow) {
        const detUid = clerkIdToDeterministicUuid(clerkUserId);
        const { data: byUuid } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', detUid)
          .maybeSingle();
        if (byUuid) existingRow = byUuid;
      }

      if (existingRow) {
        const canonicalUid = String(existingRow.id);
        const dbRole = existingRow.role === 'admin' ? 'admin' : 'user';
        const finalRole =
          isReservedAdmin || (verified && (clerkMetaRole === 'admin' || dbRole === 'admin'))
            ? 'admin'
            : 'user';
        const finalPlan = existingRow.plan === 'pro' ? 'pro' : 'free';
        const finalStatus = isReservedAdmin
          ? 'active'
          : existingRow.status === 'suspended'
            ? 'suspended'
            : 'active';

        const updatePatch: Record<string, unknown> = {
          role: finalRole,
          last_login_at: nowIso,
          updated_at: nowIso,
        };
        if (supportsClerkColumn && existingRow.clerk_user_id !== clerkUserId) {
          updatePatch.clerk_user_id = clerkUserId;
        }
        if (!existingRow.display_name && displayName) {
          updatePatch.display_name = displayName;
        }
        await supabase.from('user_profiles').update(updatePatch).eq('id', canonicalUid);

        return { uid: canonicalUid, role: finalRole, plan: finalPlan, status: finalStatus };
      }

      const canonicalUid = clerkIdToDeterministicUuid(clerkUserId);
      const finalRole = isReservedAdmin || (verified && clerkMetaRole === 'admin') ? 'admin' : 'user';
      const insertPayload: Record<string, unknown> = {
        id: canonicalUid,
        email,
        display_name: displayName,
        role: finalRole,
        plan: 'free',
        status: 'active',
        last_login_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      };
      if (supportsClerkColumn) {
        insertPayload.clerk_user_id = clerkUserId;
      }

      const { error: insertErr } = await supabase.from('user_profiles').insert(insertPayload);
      if (insertErr) {
        if (isSupabaseFallbackError(insertErr)) throw insertErr;
        throw new Error(`Unable to provision user profile in Supabase: ${insertErr.message}`);
      }

      await Promise.all([
        supabase.from('user_preferences').upsert({ user_id: canonicalUid }, { onConflict: 'user_id' }),
        supabase.from('portfolios').upsert({ user_id: canonicalUid }, { onConflict: 'user_id' }),
        supabase
          .from('subscriptions')
          .upsert({ user_id: canonicalUid, plan: 'free', status: 'active', daily_ai_limit: 3 }, { onConflict: 'user_id' }),
        supabase.from('favorites').upsert(
          [
            { user_id: canonicalUid, symbol: 'BTCUSDT' },
            { user_id: canonicalUid, symbol: 'ETHUSDT' },
            { user_id: canonicalUid, symbol: 'SOLUSDT' },
            { user_id: canonicalUid, symbol: 'BNBUSDT' },
          ],
          { onConflict: 'user_id,symbol', ignoreDuplicates: true },
        ),
      ]);

      return { uid: canonicalUid, role: finalRole, plan: 'free', status: 'active' };
    },
    () => {
      const db = localStore.data;
      let existing =
        db.user_profiles.find((u) => u.clerk_user_id === clerkUserId) ||
        (verified ? db.user_profiles.find((u) => u.email.toLowerCase() === email) : undefined) ||
        db.user_profiles.find((u) => u.id === clerkIdToDeterministicUuid(clerkUserId));

      if (existing) {
        const finalRole =
          isReservedAdmin || (verified && (clerkMetaRole === 'admin' || existing.role === 'admin'))
            ? 'admin'
            : 'user';
        existing.clerk_user_id = clerkUserId;
        existing.role = finalRole;
        existing.status = isReservedAdmin ? 'active' : existing.status;
        if (!existing.display_name && displayName) {
          existing.display_name = displayName;
        }
        existing.last_login_at = nowIso;
        existing.updated_at = nowIso;
        localStore.save();
        return {
          uid: existing.id,
          role: existing.role,
          plan: existing.plan,
          status: existing.status,
        };
      }

      const canonicalUid = clerkIdToDeterministicUuid(clerkUserId);
      const finalRole = isReservedAdmin || (verified && clerkMetaRole === 'admin') ? 'admin' : 'user';
      const created: LocalUserProfileRow = {
        id: canonicalUid,
        clerk_user_id: clerkUserId,
        email,
        display_name: displayName,
        role: finalRole,
        plan: 'free',
        status: 'active',
        last_login_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      };
      db.user_profiles.push(created);

      if (!db.user_preferences.some((p) => p.user_id === canonicalUid)) {
        db.user_preferences.push({
          user_id: canonicalUid,
          language: 'ar',
          default_quote_asset: 'USDT',
          default_timeframe: '1h',
          email_alerts_enabled: false,
          signal_notifications_enabled: true,
          price_alerts_enabled: true,
          updated_at: nowIso,
        });
      }

      if (!db.portfolios.some((p) => p.user_id === canonicalUid)) {
        db.portfolios.push({
          user_id: canonicalUid,
          usdt_balance: 0,
          holdings: [],
          updated_at: nowIso,
        });
      }

      if (!db.favorites.some((f) => f.user_id === canonicalUid)) {
        for (const symbol of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']) {
          db.favorites.push({ user_id: canonicalUid, symbol, created_at: nowIso });
        }
      }

      localStore.save();
      return {
        uid: canonicalUid,
        role: finalRole,
        plan: 'free',
        status: 'active',
      };
    },
  );
}

export async function getAuthProfileAndPreferences(uid: string, clerkUserId?: string) {
  return withSupabaseOrLocal(
    async (sb) => {
      const [{ data: profileRow, error: pErr }, { data: prefRow }] = await Promise.all([
        sb.from('user_profiles').select('*').eq('id', uid).maybeSingle(),
        sb.from('user_preferences').select('*').eq('user_id', uid).maybeSingle(),
      ]);
      if (pErr && isSupabaseFallbackError(pErr)) throw pErr;
      return {
        user: profileRow ? mapProfileRow(profileRow, clerkUserId) : null,
        preferences: mapPrefsRow(prefRow),
      };
    },
    () => {
      const profile = localStore.data.user_profiles.find((u) => u.id === uid) || null;
      const pref = localStore.data.user_preferences.find((p) => p.user_id === uid) || null;
      return {
        user: profile ? mapProfileRow(profile as unknown as Record<string, unknown>, clerkUserId) : null,
        preferences: mapPrefsRow(pref as unknown as Record<string, unknown> | null),
      };
    },
  );
}

export async function updateUserDisplayName(uid: string, displayName: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await withSupabaseOrLocal(
    async (sb) => {
      const { error } = await sb
        .from('user_profiles')
        .update({ display_name: displayName, updated_at: nowIso })
        .eq('id', uid);
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
    },
    () => {
      const row = localStore.data.user_profiles.find((u) => u.id === uid);
      if (row) {
        row.display_name = displayName;
        row.updated_at = nowIso;
        localStore.save();
      }
    },
  );
}

export async function recordAuthFailure(email: string, reason: string, ip: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await withSupabaseOrLocal(
    async (sb) => {
      const { error } = await sb.from('auth_failure_logs').insert({ email, reason, ip });
      if (error && isSupabaseFallbackError(error)) throw error;
    },
    () => {
      localStore.data.auth_failure_logs.unshift({ email, reason, ip, created_at: nowIso });
      if (localStore.data.auth_failure_logs.length > 200) {
        localStore.data.auth_failure_logs.length = 200;
      }
      localStore.save();
    },
  );
}

export async function getUserPreferences(uid: string) {
  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb
        .from('user_preferences')
        .select('*')
        .eq('user_id', uid)
        .maybeSingle();
      if (error && isSupabaseFallbackError(error)) throw error;
      return mapPrefsRow(data);
    },
    () => {
      const row = localStore.data.user_preferences.find((p) => p.user_id === uid) || null;
      return mapPrefsRow(row as unknown as Record<string, unknown> | null);
    },
  );
}

export async function upsertUserPreferences(
  uid: string,
  patch: {
    language?: 'ar' | 'en';
    defaultTimeframe?: string;
    emailAlertsEnabled?: boolean;
    signalNotificationsEnabled?: boolean;
    priceAlertsEnabled?: boolean;
  },
) {
  const nowIso = new Date().toISOString();
  return withSupabaseOrLocal(
    async (sb) => {
      const payload: Record<string, unknown> = { user_id: uid, updated_at: nowIso };
      if (patch.language !== undefined) payload.language = patch.language;
      if (patch.defaultTimeframe !== undefined) payload.default_timeframe = patch.defaultTimeframe;
      if (patch.emailAlertsEnabled !== undefined) payload.email_alerts_enabled = patch.emailAlertsEnabled;
      if (patch.signalNotificationsEnabled !== undefined) {
        payload.signal_notifications_enabled = patch.signalNotificationsEnabled;
      }
      if (patch.priceAlertsEnabled !== undefined) payload.price_alerts_enabled = patch.priceAlertsEnabled;

      const { data, error } = await sb
        .from('user_preferences')
        .upsert(payload, { onConflict: 'user_id' })
        .select('*')
        .single();

      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      return mapPrefsRow(data);
    },
    () => {
      let existing = localStore.data.user_preferences.find((p) => p.user_id === uid);
      if (!existing) {
        existing = {
          user_id: uid,
          language: 'ar',
          default_quote_asset: 'USDT',
          default_timeframe: '1h',
          email_alerts_enabled: false,
          signal_notifications_enabled: true,
          price_alerts_enabled: true,
          updated_at: nowIso,
        };
        localStore.data.user_preferences.push(existing);
      }
      if (patch.language !== undefined) existing.language = patch.language;
      if (patch.defaultTimeframe !== undefined) existing.default_timeframe = patch.defaultTimeframe;
      if (patch.emailAlertsEnabled !== undefined) existing.email_alerts_enabled = patch.emailAlertsEnabled;
      if (patch.signalNotificationsEnabled !== undefined) {
        existing.signal_notifications_enabled = patch.signalNotificationsEnabled;
      }
      if (patch.priceAlertsEnabled !== undefined) existing.price_alerts_enabled = patch.priceAlertsEnabled;
      existing.updated_at = nowIso;
      localStore.save();
      return mapPrefsRow(existing as unknown as Record<string, unknown>);
    },
  );
}

export async function getUserWatchlist(uid: string): Promise<string[]> {
  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb
        .from('favorites')
        .select('symbol')
        .eq('user_id', uid)
        .order('created_at', { ascending: true });
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      return (data || []).map((r) => String(r.symbol));
    },
    () => {
      return localStore.data.favorites.filter((f) => f.user_id === uid).map((f) => f.symbol);
    },
  );
}

export async function replaceUserWatchlist(uid: string, symbols: string[]): Promise<string[]> {
  const uniqueSymbols = Array.from(new Set(symbols));
  const nowIso = new Date().toISOString();
  return withSupabaseOrLocal(
    async (sb) => {
      const { error: delErr } = await sb.from('favorites').delete().eq('user_id', uid);
      if (delErr) {
        if (isSupabaseFallbackError(delErr)) throw delErr;
        throw new Error(delErr.message);
      }
      if (uniqueSymbols.length > 0) {
        const { error: insErr } = await sb
          .from('favorites')
          .insert(uniqueSymbols.map((symbol) => ({ user_id: uid, symbol })));
        if (insErr) {
          if (isSupabaseFallbackError(insErr)) throw insErr;
          throw new Error(insErr.message);
        }
      }
      return uniqueSymbols;
    },
    () => {
      localStore.data.favorites = localStore.data.favorites.filter((f) => f.user_id !== uid);
      for (const symbol of uniqueSymbols) {
        localStore.data.favorites.push({ user_id: uid, symbol, created_at: nowIso });
      }
      localStore.save();
      return uniqueSymbols;
    },
  );
}

function mapTransaction(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    asset: String(row.asset),
    side: row.side === 'SELL' ? ('SELL' as const) : ('BUY' as const),
    quantity: Number(row.quantity),
    priceUsdt: Number(row.price_usdt),
    note: row.note ? String(row.note) : '',
    executedAt: String(row.executed_at),
  };
}

export async function getUserPortfolio(uid: string) {
  return withSupabaseOrLocal(
    async (sb) => {
      const [{ data: portRow, error: pErr }, { data: txRows }] = await Promise.all([
        sb.from('portfolios').select('*').eq('user_id', uid).maybeSingle(),
        sb
          .from('portfolio_transactions')
          .select('*')
          .eq('user_id', uid)
          .order('executed_at', { ascending: false })
          .limit(50),
      ]);
      if (pErr && isSupabaseFallbackError(pErr)) throw pErr;
      return {
        portfolio: portRow
          ? {
              userId: uid,
              usdtBalance: Number(portRow.usdt_balance || 0),
              holdings: Array.isArray(portRow.holdings) ? portRow.holdings : [],
              updatedAt: String(portRow.updated_at),
            }
          : {
              userId: uid,
              usdtBalance: 0,
              holdings: [],
              updatedAt: new Date().toISOString(),
            },
        transactions: (txRows || []).map(mapTransaction),
      };
    },
    () => {
      const port = localStore.data.portfolios.find((p) => p.user_id === uid);
      const txs = localStore.data.portfolio_transactions
        .filter((t) => t.user_id === uid)
        .slice(0, 50)
        .map((t) => mapTransaction(t as unknown as Record<string, unknown>));
      return {
        portfolio: port
          ? {
              userId: uid,
              usdtBalance: port.usdt_balance,
              holdings: port.holdings,
              updatedAt: port.updated_at,
            }
          : {
              userId: uid,
              usdtBalance: 0,
              holdings: [],
              updatedAt: new Date().toISOString(),
            },
        transactions: txs,
      };
    },
  );
}

export async function upsertUserPortfolio(
  uid: string,
  usdtBalance: number,
  rawHoldings: Array<{ symbol: string; quantity: number; avgBuyPrice: number }>,
) {
  const nowIso = new Date().toISOString();
  const holdings = rawHoldings
    .filter((h) => h.quantity > 0)
    .map((h) => ({
      symbol: h.symbol,
      pair: h.symbol.endsWith('USDT') ? h.symbol : `${h.symbol}USDT`,
      quantity: h.quantity,
      avgBuyPrice: h.avgBuyPrice,
      updatedAt: nowIso,
    }));

  return withSupabaseOrLocal(
    async (sb) => {
      const { error } = await sb.from('portfolios').upsert(
        {
          user_id: uid,
          usdt_balance: usdtBalance,
          holdings,
          updated_at: nowIso,
        },
        { onConflict: 'user_id' },
      );
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      return { userId: uid, usdtBalance, holdings, updatedAt: nowIso };
    },
    () => {
      const existing = localStore.data.portfolios.find((p) => p.user_id === uid);
      if (existing) {
        existing.usdt_balance = usdtBalance;
        existing.holdings = holdings;
        existing.updated_at = nowIso;
      } else {
        localStore.data.portfolios.push({
          user_id: uid,
          usdt_balance: usdtBalance,
          holdings,
          updated_at: nowIso,
        });
      }
      localStore.save();
      return { userId: uid, usdtBalance, holdings, updatedAt: nowIso };
    },
  );
}

export async function addUserTransaction(
  uid: string,
  tx: { asset: string; side: 'BUY' | 'SELL'; quantity: number; priceUsdt: number; note?: string },
) {
  const id = `tx_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const nowIso = new Date().toISOString();

  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb
        .from('portfolio_transactions')
        .insert({
          id,
          user_id: uid,
          asset: tx.asset,
          side: tx.side,
          quantity: tx.quantity,
          price_usdt: tx.priceUsdt,
          note: tx.note || '',
          executed_at: nowIso,
        })
        .select('*')
        .single();
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      return mapTransaction(data);
    },
    () => {
      const row = {
        id,
        user_id: uid,
        asset: tx.asset,
        side: tx.side,
        quantity: tx.quantity,
        price_usdt: tx.priceUsdt,
        note: tx.note || '',
        executed_at: nowIso,
      };
      localStore.data.portfolio_transactions.unshift(row);
      localStore.save();
      return mapTransaction(row as unknown as Record<string, unknown>);
    },
  );
}

function mapAlert(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    symbol: String(row.symbol),
    condition: String(row.condition),
    targetPrice: Number(row.target_price),
    targetPriceUpper:
      row.target_price_upper !== null && row.target_price_upper !== undefined
        ? Number(row.target_price_upper)
        : undefined,
    emailNotify: Boolean(row.email_notify),
    status: String(row.status),
    triggeredAt: row.triggered_at ? String(row.triggered_at) : undefined,
    createdAt: String(row.created_at),
  };
}

export async function getUserAlerts(uid: string) {
  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb
        .from('price_alerts')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      return (data || []).map(mapAlert);
    },
    () =>
      localStore.data.price_alerts
        .filter((a) => a.user_id === uid)
        .slice(0, 100)
        .map((a) => mapAlert(a as unknown as Record<string, unknown>)),
  );
}

export async function createUserAlert(
  uid: string,
  input: {
    symbol: string;
    condition: LocalPriceAlertRow['condition'];
    targetPrice: number;
    targetPriceUpper?: number;
    emailNotify: boolean;
  },
) {
  const id = `alt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const nowIso = new Date().toISOString();

  return withSupabaseOrLocal(
    async (sb) => {
      const { data: existingRows, error: checkErr } = await sb
        .from('price_alerts')
        .select('id, target_price')
        .eq('user_id', uid)
        .eq('symbol', input.symbol)
        .eq('condition', input.condition)
        .eq('status', 'ACTIVE');

      if (checkErr && isSupabaseFallbackError(checkErr)) throw checkErr;

      const duplicate = (existingRows || []).find(
        (d) => Math.abs(Number(d.target_price) - input.targetPrice) < 1e-8,
      );
      if (duplicate) {
        return { duplicate: true as const };
      }

      const { data, error } = await sb
        .from('price_alerts')
        .insert({
          id,
          user_id: uid,
          symbol: input.symbol,
          condition: input.condition,
          target_price: input.targetPrice,
          target_price_upper: input.targetPriceUpper ?? null,
          email_notify: input.emailNotify,
          status: 'ACTIVE',
          created_at: nowIso,
        })
        .select('*')
        .single();
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      return { duplicate: false as const, alert: mapAlert(data) };
    },
    () => {
      const duplicate = localStore.data.price_alerts.find(
        (d) =>
          d.user_id === uid &&
          d.symbol === input.symbol &&
          d.condition === input.condition &&
          d.status === 'ACTIVE' &&
          Math.abs(d.target_price - input.targetPrice) < 1e-8,
      );
      if (duplicate) return { duplicate: true as const };

      const row: LocalPriceAlertRow = {
        id,
        user_id: uid,
        symbol: input.symbol,
        condition: input.condition,
        target_price: input.targetPrice,
        target_price_upper: input.targetPriceUpper ?? null,
        email_notify: input.emailNotify,
        status: 'ACTIVE',
        created_at: nowIso,
      };
      localStore.data.price_alerts.unshift(row);
      localStore.save();
      return { duplicate: false as const, alert: mapAlert(row as unknown as Record<string, unknown>) };
    },
  );
}

export async function deleteUserAlert(uid: string, alertId: string): Promise<boolean> {
  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb
        .from('price_alerts')
        .delete()
        .eq('id', alertId)
        .eq('user_id', uid)
        .select('id');
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      return Boolean(data && data.length > 0);
    },
    () => {
      const idx = localStore.data.price_alerts.findIndex((a) => a.id === alertId && a.user_id === uid);
      if (idx === -1) return false;
      localStore.data.price_alerts.splice(idx, 1);
      localStore.save();
      return true;
    },
  );
}

function mapNotification(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    type: String(row.type),
    title: String(row.title),
    message: String(row.message),
    read: Boolean(row.read),
    createdAt: String(row.created_at),
  };
}

export async function getUserNotifications(uid: string) {
  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb
        .from('notifications')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      return (data || []).map(mapNotification);
    },
    () =>
      localStore.data.notifications
        .filter((n) => n.user_id === uid)
        .slice(0, 50)
        .map((n) => mapNotification(n as unknown as Record<string, unknown>)),
  );
}

export async function markUserNotificationRead(uid: string, notifId: string): Promise<boolean> {
  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb
        .from('notifications')
        .update({ read: true })
        .eq('id', notifId)
        .eq('user_id', uid)
        .select('id');
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      return Boolean(data && data.length > 0);
    },
    () => {
      const found = localStore.data.notifications.find((n) => n.id === notifId && n.user_id === uid);
      if (!found) return false;
      found.read = true;
      localStore.save();
      return true;
    },
  );
}

export async function markAllUserNotificationsRead(uid: string): Promise<number> {
  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb
        .from('notifications')
        .update({ read: true })
        .eq('user_id', uid)
        .eq('read', false)
        .select('id');
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      return data?.length || 0;
    },
    () => {
      let count = 0;
      for (const n of localStore.data.notifications) {
        if (n.user_id === uid && !n.read) {
          n.read = true;
          count++;
        }
      }
      if (count > 0) localStore.save();
      return count;
    },
  );
}

function mapAppConfig(c: Record<string, unknown>) {
  const def = createDefaultAppConfigRow();
  return {
    freeDailyAiLimit: Number(c.free_daily_ai_limit ?? def.free_daily_ai_limit),
    proDailyAiLimit: Number(c.pro_daily_ai_limit ?? def.pro_daily_ai_limit),
    proMonthlyPriceUsd: Number(c.pro_monthly_price_usd ?? def.pro_monthly_price_usd),
    proAnnualPriceUsd: Number(c.pro_annual_price_usd ?? def.pro_annual_price_usd),
    proDurationDays: Number(c.pro_duration_days ?? def.pro_duration_days),
    freeFeatures: Array.isArray(c.free_features) ? (c.free_features as string[]) : def.free_features,
    proFeatures: Array.isArray(c.pro_features) ? (c.pro_features as string[]) : def.pro_features,
    announcement: String(c.announcement ?? ''),
    updatedAt: String(c.updated_at ?? def.updated_at),
  };
}

export async function getGlobalAppConfig() {
  if (await isServerSupabaseOperational()) {
    try {
      const { data, error } = await getServerSupabaseClient()
        .from('app_config')
        .select('*')
        .eq('id', 'global')
        .maybeSingle();
      if (!error && data) {
        return mapAppConfig(data);
      }
    } catch {
      // fall through
    }
  } else if (isSupabaseConfigured()) {
    try {
      const { data, error } = await getPublicSupabaseClient()
        .from('app_config')
        .select('*')
        .eq('id', 'global')
        .maybeSingle();
      if (!error && data) {
        return mapAppConfig(data);
      }
    } catch {
      // fall through
    }
  }
  return mapAppConfig(localStore.data.app_config as unknown as Record<string, unknown>);
}

export async function updateGlobalAppConfig(d: {
  freeDailyAiLimit: number;
  proDailyAiLimit: number;
  proMonthlyPriceUsd: number;
  proAnnualPriceUsd: number;
  proDurationDays: number;
  freeFeatures: string[];
  proFeatures: string[];
  announcement: string;
}) {
  const nowIso = new Date().toISOString();
  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb
        .from('app_config')
        .upsert(
          {
            id: 'global',
            free_daily_ai_limit: d.freeDailyAiLimit,
            pro_daily_ai_limit: d.proDailyAiLimit,
            pro_monthly_price_usd: d.proMonthlyPriceUsd,
            pro_annual_price_usd: d.proAnnualPriceUsd,
            pro_duration_days: d.proDurationDays,
            free_features: d.freeFeatures,
            pro_features: d.proFeatures,
            announcement: d.announcement,
            updated_at: nowIso,
          },
          { onConflict: 'id' },
        )
        .select('*')
        .single();
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      return mapAppConfig(data);
    },
    () => {
      localStore.data.app_config = {
        id: 'global',
        free_daily_ai_limit: d.freeDailyAiLimit,
        pro_daily_ai_limit: d.proDailyAiLimit,
        pro_monthly_price_usd: d.proMonthlyPriceUsd,
        pro_annual_price_usd: d.proAnnualPriceUsd,
        pro_duration_days: d.proDurationDays,
        free_features: d.freeFeatures,
        pro_features: d.proFeatures,
        announcement: d.announcement,
        updated_at: nowIso,
      };
      localStore.save();
      return mapAppConfig(localStore.data.app_config as unknown as Record<string, unknown>);
    },
  );
}

export async function getUserAiQuota(
  userId: string,
  fallbackPlan: 'free' | 'pro',
  fallbackRole: 'user' | 'admin',
) {
  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb.rpc('get_user_ai_quota', { p_user_id: userId });
      if (!error && data) {
        const q = data as { plan?: string; used24h?: number; limit24h?: number; remaining24h?: number };
        return {
          plan: q.plan || fallbackPlan,
          used24h: Number(q.used24h || 0),
          limit24h: Number(q.limit24h || 3),
          remaining24h: Number(q.remaining24h ?? 3),
        };
      }

      const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [{ data: profile, error: pErr }, { data: cfg }, { count }] = await Promise.all([
        sb.from('user_profiles').select('plan, role').eq('id', userId).maybeSingle(),
        sb.from('app_config').select('free_daily_ai_limit, pro_daily_ai_limit').eq('id', 'global').maybeSingle(),
        sb.from('analyses').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sinceIso),
      ]);
      if (pErr && isSupabaseFallbackError(pErr)) throw pErr;

      const role = profile?.role === 'admin' ? 'admin' : fallbackRole;
      const plan = profile?.plan === 'pro' ? 'pro' : fallbackPlan;
      const limit24h =
        role === 'admin'
          ? 500
          : plan === 'pro'
            ? Number(cfg?.pro_daily_ai_limit ?? 50)
            : Number(cfg?.free_daily_ai_limit ?? 3);
      const used24h = Number(count || 0);
      return {
        plan,
        used24h,
        limit24h,
        remaining24h: Math.max(0, limit24h - used24h),
      };
    },
    () => {
      const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const profile = localStore.data.user_profiles.find((u) => u.id === userId);
      const role = profile?.role || fallbackRole;
      const plan = profile?.plan || fallbackPlan;
      const cfg = localStore.data.app_config;
      const limit24h =
        role === 'admin' ? 500 : plan === 'pro' ? cfg.pro_daily_ai_limit : cfg.free_daily_ai_limit;
      const used24h = localStore.data.analyses.filter(
        (a) => a.user_id === userId && a.created_at >= sinceIso,
      ).length;
      return {
        plan,
        used24h,
        limit24h,
        remaining24h: Math.max(0, limit24h - used24h),
      };
    },
  );
}

export async function saveUserAiAnalysis(
  userId: string,
  fallbackPlan: 'free' | 'pro',
  fallbackRole: 'user' | 'admin',
  report: AiAnalysisReport,
) {
  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb.rpc('save_verified_user_ai_analysis', {
        p_user_id: userId,
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

      if (!error && data) {
        return data as {
          allowed: boolean;
          used24h: number;
          limit24h: number;
          remaining24h: number;
          resetsInMinutes?: number;
        };
      }

      const quota = await getUserAiQuota(userId, fallbackPlan, fallbackRole);
      if (quota.remaining24h <= 0) {
        return {
          allowed: false,
          used24h: quota.used24h,
          limit24h: quota.limit24h,
          remaining24h: 0,
          resetsInMinutes: 60,
        };
      }

      const { error: insErr } = await sb.from('analyses').insert({
        id: report.id,
        user_id: userId,
        symbol: report.symbol,
        coin_name: report.coinName,
        timeframe: report.timeframe,
        analysis_type: report.analysisType,
        verdict: report.verdict,
        verified_price: report.verifiedPrice,
        confidence_score: report.confidenceScore,
        report,
      });
      if (insErr) {
        if (isSupabaseFallbackError(insErr)) throw insErr;
        throw new Error(insErr.message);
      }

      const nextUsed = quota.used24h + 1;
      return {
        allowed: true,
        used24h: nextUsed,
        limit24h: quota.limit24h,
        remaining24h: Math.max(0, quota.limit24h - nextUsed),
      };
    },
    async () => {
      const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const profile = localStore.data.user_profiles.find((u) => u.id === userId);
      const role = profile?.role || fallbackRole;
      const plan = profile?.plan || fallbackPlan;
      const cfg = localStore.data.app_config;
      const limit24h =
        role === 'admin' ? 500 : plan === 'pro' ? cfg.pro_daily_ai_limit : cfg.free_daily_ai_limit;
      const used24h = localStore.data.analyses.filter(
        (a) => a.user_id === userId && a.created_at >= sinceIso,
      ).length;

      if (used24h >= limit24h) {
        return {
          allowed: false,
          used24h,
          limit24h,
          remaining24h: 0,
          resetsInMinutes: 60,
        };
      }

      localStore.data.analyses.unshift({
        id: report.id,
        user_id: userId,
        symbol: report.symbol,
        coin_name: report.coinName,
        timeframe: report.timeframe,
        analysis_type: report.analysisType,
        verdict: report.verdict,
        verified_price: report.verifiedPrice,
        confidence_score: report.confidenceScore,
        report,
        created_at: report.createdAt || new Date().toISOString(),
      });
      localStore.save();

      const nextUsed = used24h + 1;
      return {
        allowed: true,
        used24h: nextUsed,
        limit24h,
        remaining24h: Math.max(0, limit24h - nextUsed),
      };
    },
  );
}

export async function getUserAiHistory(userId: string, limit: number): Promise<AiAnalysisReport[]> {
  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb
        .from('analyses')
        .select('report')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      return (data || []).map((row) => row.report as AiAnalysisReport);
    },
    () =>
      localStore.data.analyses
        .filter((a) => a.user_id === userId)
        .slice(0, limit)
        .map((a) => a.report),
  );
}

function mapSignalRow(sig: Record<string, unknown>, livePrice: number | null) {
  const symbol = String(sig.symbol || '');
  return {
    id: String(sig.id),
    symbol,
    source: sig.source === 'AI' ? ('AI' as const) : ('ADMIN' as const),
    timeframe: String(sig.timeframe),
    status: String(sig.status) as SignalStatus,
    entryLow: Number(sig.entry_low),
    entryHigh: Number(sig.entry_high),
    tp1: Number(sig.tp1),
    tp2: Number(sig.tp2),
    tp3: Number(sig.tp3),
    stopLoss: Number(sig.stop_loss),
    riskRewardRatio: Number(sig.risk_reward_ratio),
    entryReferencePrice:
      sig.entry_reference_price !== null && sig.entry_reference_price !== undefined
        ? Number(sig.entry_reference_price)
        : undefined,
    actualResultPercent:
      sig.actual_result_percent !== null && sig.actual_result_percent !== undefined
        ? Number(sig.actual_result_percent)
        : undefined,
    ambiguityNote: sig.ambiguity_note ? String(sig.ambiguity_note) : undefined,
    explanation: String(sig.explanation || ''),
    createdBy: String(sig.created_by || ''),
    createdAt: String(sig.created_at),
    updatedAt: String(sig.updated_at),
    livePrice,
  };
}

function mapSignalEventRow(ev: Record<string, unknown>) {
  return {
    id: String(ev.id),
    signalId: String(ev.signal_id),
    symbol: String(ev.symbol),
    eventType: String(ev.event_type),
    triggerPrice: Number(ev.trigger_price),
    resultPercent: Number(ev.result_percent || 0),
    note: ev.note ? String(ev.note) : undefined,
    occurredAt: String(ev.occurred_at),
  };
}

export async function listPublicSignals(
  statusFilter: string,
  sourceFilter: string,
  getLivePriceFn: (symbol: string) => number | null,
) {
  return withSupabaseOrLocal(
    async (sb) => {
      let query = sb.from('signals').select('*').order('created_at', { ascending: false }).limit(100);
      if (statusFilter === 'ACTIVE') {
        query = query.in('status', ['ACTIVE', 'TP1_HIT', 'TP2_HIT']);
      } else if (statusFilter === 'COMPLETED') {
        query = query.in('status', ['TP3_HIT', 'STOP_LOSS_HIT', 'CANCELLED']);
      }
      if (sourceFilter === 'ADMIN' || sourceFilter === 'AI') {
        query = query.eq('source', sourceFilter);
      }

      const [{ data: signalRows, error: sigErr }, { data: eventRows, error: evErr }] = await Promise.all([
        query,
        sb.from('signal_events').select('*').order('occurred_at', { ascending: false }).limit(50),
      ]);

      if (sigErr) {
        if (isSupabaseFallbackError(sigErr)) throw sigErr;
        throw new Error(sigErr.message);
      }

      return {
        signals: (signalRows || []).map((s) => mapSignalRow(s, getLivePriceFn(String(s.symbol || '')))),
        events: evErr ? [] : (eventRows || []).map(mapSignalEventRow),
      };
    },
    () => {
      let rows = [...localStore.data.signals];
      if (statusFilter === 'ACTIVE') {
        rows = rows.filter((s) => ['ACTIVE', 'TP1_HIT', 'TP2_HIT'].includes(s.status));
      } else if (statusFilter === 'COMPLETED') {
        rows = rows.filter((s) => ['TP3_HIT', 'STOP_LOSS_HIT', 'CANCELLED'].includes(s.status));
      }
      if (sourceFilter === 'ADMIN' || sourceFilter === 'AI') {
        rows = rows.filter((s) => s.source === sourceFilter);
      }
      return {
        signals: rows.slice(0, 100).map((s) =>
          mapSignalRow(s as unknown as Record<string, unknown>, getLivePriceFn(s.symbol)),
        ),
        events: localStore.data.signal_events
          .slice(0, 50)
          .map((e) => mapSignalEventRow(e as unknown as Record<string, unknown>)),
      };
    },
  );
}

export async function recordAdminAuditLog(
  adminUid: string,
  action: string,
  targetId: string,
  details?: Record<string, unknown>,
  sbClient?: SupabaseClient,
) {
  const id = `log_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const nowIso = new Date().toISOString();

  if (sbClient) {
    await sbClient
      .from('admin_audit_logs')
      .insert({ id, admin_uid: adminUid, action, target_id: targetId, details: details ?? {}, created_at: nowIso })
      .then(() => {}, () => {});
    return;
  }

  await withSupabaseOrLocal(
    async (sb) => {
      const { error } = await sb.from('admin_audit_logs').insert({
        id,
        admin_uid: adminUid,
        action,
        target_id: targetId,
        details: details ?? {},
        created_at: nowIso,
      });
      if (error && isSupabaseFallbackError(error)) throw error;
    },
    () => {
      localStore.data.admin_audit_logs.unshift({
        id,
        admin_uid: adminUid,
        action,
        target_id: targetId,
        details: details ?? {},
        created_at: nowIso,
      });
      if (localStore.data.admin_audit_logs.length > 500) {
        localStore.data.admin_audit_logs.length = 500;
      }
      localStore.save();
    },
  );
}

export async function runMonitorTick(getPrice: (symbol: string) => number | null): Promise<void> {
  if (await isServerSupabaseOperational()) {
    try {
      const sb = getServerSupabaseClient();
      const activeStatuses: SignalStatus[] = ['ACTIVE', 'TP1_HIT', 'TP2_HIT'];
      const [{ data: sigRows, error: sigErr }, { data: alertRows }] = await Promise.all([
        sb.from('signals').select('*').in('status', activeStatuses).limit(100),
        sb.from('price_alerts').select('*').eq('status', 'ACTIVE').limit(200),
      ]);

      if (sigErr && isSupabaseFallbackError(sigErr)) {
        markSupabaseUnavailable(sigErr.message);
      } else {
        for (const sig of sigRows || []) {
          const livePrice = getPrice(sig.symbol);
          if (!livePrice || livePrice <= 0) continue;
          const evalRes = evaluateSignalPrice(sig, livePrice);
          if (!evalRes) continue;

          const nowIso = new Date().toISOString();
          const { error: eventErr } = await sb.from('signal_events').insert({
            id: `${sig.id}_${evalRes.nextStatus}`,
            signal_id: sig.id,
            symbol: sig.symbol,
            event_type: evalRes.nextStatus,
            trigger_price: livePrice,
            result_percent: evalRes.resultPercent,
            note: evalRes.ambiguityNote ?? null,
            occurred_at: nowIso,
          });
          if (eventErr) continue;

          await sb
            .from('signals')
            .update({
              status: evalRes.nextStatus,
              actual_result_percent: evalRes.resultPercent,
              ...(evalRes.ambiguityNote ? { ambiguity_note: evalRes.ambiguityNote } : {}),
              updated_at: nowIso,
            })
            .eq('id', sig.id)
            .eq('status', sig.status);
        }

        for (const alert of alertRows || []) {
          const livePrice = getPrice(alert.symbol);
          if (!livePrice || livePrice <= 0) continue;
          if (!isAlertTriggered(alert, livePrice)) continue;

          const nowIso = new Date().toISOString();
          const { data: updatedRows, error: updErr } = await sb
            .from('price_alerts')
            .update({ status: 'TRIGGERED', triggered_at: nowIso })
            .eq('id', alert.id)
            .eq('status', 'ACTIVE')
            .select('id');

          if (updErr || !updatedRows || updatedRows.length === 0) continue;

          await sb.from('notifications').upsert(
            {
              id: `notif_${alert.id}`,
              user_id: alert.user_id,
              type: 'PRICE_ALERT',
              title: `${alert.symbol} Alert Triggered`,
              message: `${alert.symbol} reached $${livePrice} (${alert.condition} $${alert.target_price})`,
              read: false,
              created_at: nowIso,
            },
            { onConflict: 'id', ignoreDuplicates: true },
          );
        }
        return;
      }
    } catch (err) {
      if (isSupabaseFallbackError(err)) {
        markSupabaseUnavailable(err instanceof Error ? err.message : undefined);
      } else {
        throw err;
      }
    }
  }

  // Local store evaluation
  let dirty = false;
  const nowIso = new Date().toISOString();

  for (const sig of localStore.data.signals) {
    if (!['ACTIVE', 'TP1_HIT', 'TP2_HIT'].includes(sig.status)) continue;
    const livePrice = getPrice(sig.symbol);
    if (!livePrice || livePrice <= 0) continue;
    const evalRes = evaluateSignalPrice(sig as unknown as Record<string, unknown>, livePrice);
    if (!evalRes) continue;

    const eventId = `${sig.id}_${evalRes.nextStatus}`;
    if (localStore.data.signal_events.some((e) => e.id === eventId)) continue;

    localStore.data.signal_events.unshift({
      id: eventId,
      signal_id: sig.id,
      symbol: sig.symbol,
      event_type: evalRes.nextStatus,
      trigger_price: livePrice,
      result_percent: evalRes.resultPercent,
      note: evalRes.ambiguityNote ?? null,
      occurred_at: nowIso,
    });
    sig.status = evalRes.nextStatus;
    sig.actual_result_percent = evalRes.resultPercent;
    if (evalRes.ambiguityNote) sig.ambiguity_note = evalRes.ambiguityNote;
    sig.updated_at = nowIso;
    dirty = true;
  }

  for (const alert of localStore.data.price_alerts) {
    if (alert.status !== 'ACTIVE') continue;
    const livePrice = getPrice(alert.symbol);
    if (!livePrice || livePrice <= 0) continue;
    if (!isAlertTriggered(alert as unknown as Record<string, unknown>, livePrice)) continue;

    alert.status = 'TRIGGERED';
    alert.triggered_at = nowIso;
    const notifId = `notif_${alert.id}`;
    if (!localStore.data.notifications.some((n) => n.id === notifId)) {
      localStore.data.notifications.unshift({
        id: notifId,
        user_id: alert.user_id,
        type: 'PRICE_ALERT',
        title: `${alert.symbol} Alert Triggered`,
        message: `${alert.symbol} reached $${livePrice} (${alert.condition} $${alert.target_price})`,
        read: false,
        created_at: nowIso,
      });
    }
    dirty = true;
  }

  if (dirty) localStore.save();
}

function evaluateSignalPrice(sig: Record<string, unknown>, livePrice: number) {
  const entryLow = Number(sig.entry_low);
  const entryHigh = Number(sig.entry_high);
  const refEntry = Number(sig.entry_reference_price) || (entryLow + entryHigh) / 2;
  const tp1 = Number(sig.tp1);
  const tp2 = Number(sig.tp2);
  const tp3 = Number(sig.tp3);
  const stopLoss = Number(sig.stop_loss);
  const status = String(sig.status) as SignalStatus;

  let nextStatus: SignalStatus | null = null;
  let ambiguityNote: string | undefined;

  const hitStop = livePrice <= stopLoss;
  const hitTp3 = livePrice >= tp3;
  const hitTp2 = livePrice >= tp2;
  const hitTp1 = livePrice >= tp1;

  if (hitStop && (hitTp1 || hitTp2 || hitTp3)) {
    nextStatus = 'STOP_LOSS_HIT';
    ambiguityNote = `Ambiguous gap crossing detected at ${livePrice} intersecting both SL (${stopLoss}) and target levels; conservatively resolved to STOP_LOSS_HIT.`;
  } else if (hitStop) {
    nextStatus = 'STOP_LOSS_HIT';
  } else if (hitTp3 && status !== 'TP3_HIT') {
    nextStatus = 'TP3_HIT';
  } else if (hitTp2 && (status === 'ACTIVE' || status === 'TP1_HIT')) {
    nextStatus = 'TP2_HIT';
  } else if (hitTp1 && status === 'ACTIVE') {
    nextStatus = 'TP1_HIT';
  }

  if (!nextStatus || nextStatus === status) return null;
  const resultPercent = refEntry > 0 ? Number((((livePrice - refEntry) / refEntry) * 100).toFixed(2)) : 0;
  return { nextStatus, resultPercent, ambiguityNote };
}

function isAlertTriggered(alert: Record<string, unknown>, livePrice: number): boolean {
  const targetPrice = Number(alert.target_price);
  const targetUpper = alert.target_price_upper !== null && alert.target_price_upper !== undefined
    ? Number(alert.target_price_upper)
    : null;
  const condition = String(alert.condition);

  if (condition === 'ABOVE' || condition === 'TP_TARGET') return livePrice >= targetPrice;
  if (condition === 'BELOW' || condition === 'SL_TARGET') return livePrice <= targetPrice;
  if (condition === 'ENTRY_ZONE') {
    const upper = targetUpper ?? targetPrice * 1.005;
    const lower = Math.min(targetPrice, upper);
    const high = Math.max(targetPrice, upper);
    return livePrice >= lower && livePrice <= high;
  }
  return false;
}

// ============================================================================
// Admin Data Operations
// ============================================================================

export async function getAdminOverviewStats() {
  const now = Date.now();
  const oneDayAgoIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgoIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgoIso = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  return withSupabaseOrLocal(
    async (sb) => {
      const [{ data: users, error: uErr }, { data: analyses }, { data: authFailures }, { count: signalsCount }] =
        await Promise.all([
          sb.from('user_profiles').select('id, status, created_at, last_login_at'),
          sb.from('analyses').select('id, created_at').gte('created_at', thirtyDaysAgoIso),
          sb.from('auth_failure_logs').select('*').order('created_at', { ascending: false }).limit(50),
          sb.from('signals').select('id', { count: 'exact', head: true }),
        ]);

      if (uErr && isSupabaseFallbackError(uErr)) throw uErr;

      const userList = users || [];
      const analysisList = analyses || [];
      const failList = authFailures || [];

      return {
        stats: {
          totalUsers: userList.length,
          activeUsers: userList.filter((u) => u.status === 'active').length,
          activeLast24h: userList.filter((u) => String(u.last_login_at || '') >= oneDayAgoIso).length,
          newRegistrations7d: userList.filter((u) => String(u.created_at || '') >= sevenDaysAgoIso).length,
          aiAnalyses24h: analysisList.filter((a) => String(a.created_at || '') >= oneDayAgoIso).length,
          aiAnalyses30d: analysisList.length,
          failedAuthAttemptsRecent: failList.length,
          totalSignals: signalsCount || 0,
        },
        recentAuthFailures: failList.slice(0, 15).map((f) => ({
          email: f.email || 'unknown',
          reason: f.reason,
          ip: f.ip,
          createdAt: f.created_at,
        })),
      };
    },
    () => {
      const db = localStore.data;
      const analyses30d = db.analyses.filter((a) => a.created_at >= thirtyDaysAgoIso);
      return {
        stats: {
          totalUsers: db.user_profiles.length,
          activeUsers: db.user_profiles.filter((u) => u.status === 'active').length,
          activeLast24h: db.user_profiles.filter((u) => (u.last_login_at || '') >= oneDayAgoIso).length,
          newRegistrations7d: db.user_profiles.filter((u) => u.created_at >= sevenDaysAgoIso).length,
          aiAnalyses24h: analyses30d.filter((a) => a.created_at >= oneDayAgoIso).length,
          aiAnalyses30d: analyses30d.length,
          failedAuthAttemptsRecent: db.auth_failure_logs.length,
          totalSignals: db.signals.length,
        },
        recentAuthFailures: db.auth_failure_logs.slice(0, 15).map((f) => ({
          email: f.email || 'unknown',
          reason: f.reason,
          ip: f.ip,
          createdAt: f.created_at,
        })),
      };
    },
  );
}

export async function listAdminUsers(q: string) {
  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      let users = (data || []).map((u) => mapProfileRow(u));
      if (q) {
        users = users.filter(
          (u) =>
            u.email.toLowerCase().includes(q) ||
            (u.displayName || '').toLowerCase().includes(q) ||
            u.uid.toLowerCase().includes(q) ||
            (u.clerkUserId || '').toLowerCase().includes(q),
        );
      }
      return users;
    },
    () => {
      let users = localStore.data.user_profiles.map((u) =>
        mapProfileRow(u as unknown as Record<string, unknown>),
      );
      if (q) {
        users = users.filter(
          (u) =>
            u.email.toLowerCase().includes(q) ||
            (u.displayName || '').toLowerCase().includes(q) ||
            u.uid.toLowerCase().includes(q) ||
            (u.clerkUserId || '').toLowerCase().includes(q),
        );
      }
      return users;
    },
  );
}

export async function updateAdminUser(
  targetUid: string,
  patch: { status?: 'active' | 'suspended'; plan?: 'free' | 'pro'; role?: 'user' | 'admin' },
): Promise<{
  error?: string;
  statusCode?: number;
  user?: ReturnType<typeof mapProfileRow>;
  clerkId?: string;
}> {
  const nowIso = new Date().toISOString();
  return withSupabaseOrLocal(
    async (sb) => {
      const { data: targetRow, error: fetchErr } = await sb
        .from('user_profiles')
        .select('*')
        .eq('id', targetUid)
        .maybeSingle();

      if (fetchErr && isSupabaseFallbackError(fetchErr)) throw fetchErr;
      if (fetchErr || !targetRow) {
        return { error: 'User not found', statusCode: 404 };
      }

      const targetEmail = String(targetRow.email || '').toLowerCase();
      if (targetEmail === ENV.ADMIN_EMAIL) {
        if (patch.status === 'suspended') {
          return { error: 'Cannot suspend primary administrator account', statusCode: 400 };
        }
        if (patch.role === 'user') {
          return { error: 'Cannot demote primary administrator account', statusCode: 400 };
        }
      } else if (targetRow.role === 'admin' && patch.status === 'suspended') {
        return { error: 'Demote administrator before suspending account', statusCode: 400 };
      }

      const updatePayload: Record<string, unknown> = { updated_at: nowIso };
      if (patch.status) updatePayload.status = patch.status;
      if (patch.plan) updatePayload.plan = patch.plan;
      if (patch.role) updatePayload.role = patch.role;

      const { data: updatedRow, error: updErr } = await sb
        .from('user_profiles')
        .update(updatePayload)
        .eq('id', targetUid)
        .select('*')
        .single();

      if (updErr) {
        if (isSupabaseFallbackError(updErr)) throw updErr;
        return { error: updErr.message, statusCode: 500 };
      }

      if (patch.plan) {
        const { data: cfg } = await sb
          .from('app_config')
          .select('free_daily_ai_limit, pro_daily_ai_limit')
          .eq('id', 'global')
          .maybeSingle();
        const proLimit = Number(cfg?.pro_daily_ai_limit || 50);
        const freeLimit = Number(cfg?.free_daily_ai_limit || 3);
        await sb.from('subscriptions').upsert(
          {
            user_id: targetUid,
            plan: patch.plan,
            status: 'active',
            daily_ai_limit: patch.plan === 'pro' ? proLimit : freeLimit,
            updated_at: nowIso,
          },
          { onConflict: 'user_id' },
        );
      }

      return {
        user: mapProfileRow(updatedRow),
        clerkId: targetRow.clerk_user_id ? String(targetRow.clerk_user_id) : undefined,
      };
    },
    () => {
      const targetRow = localStore.data.user_profiles.find((u) => u.id === targetUid);
      if (!targetRow) return { error: 'User not found', statusCode: 404 };

      if (targetRow.email.toLowerCase() === ENV.ADMIN_EMAIL) {
        if (patch.status === 'suspended') {
          return { error: 'Cannot suspend primary administrator account', statusCode: 400 };
        }
        if (patch.role === 'user') {
          return { error: 'Cannot demote primary administrator account', statusCode: 400 };
        }
      } else if (targetRow.role === 'admin' && patch.status === 'suspended') {
        return { error: 'Demote administrator before suspending account', statusCode: 400 };
      }

      if (patch.status) targetRow.status = patch.status;
      if (patch.plan) targetRow.plan = patch.plan;
      if (patch.role) targetRow.role = patch.role;
      targetRow.updated_at = nowIso;
      localStore.save();

      return {
        user: mapProfileRow(targetRow as unknown as Record<string, unknown>),
        clerkId: targetRow.clerk_user_id || undefined,
      };
    },
  );
}

export async function createAdminSignal(
  adminUid: string,
  d: {
    symbol: string;
    source: 'ADMIN' | 'AI';
    timeframe: string;
    entryLow: number;
    entryHigh: number;
    tp1: number;
    tp2: number;
    tp3: number;
    stopLoss: number;
    explanation: string;
  },
  livePrice: number | null,
) {
  const id = `sig_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const nowIso = new Date().toISOString();
  const refEntry = (d.entryLow + d.entryHigh) / 2;
  const riskRewardRatio = Number(((d.tp2 - refEntry) / (refEntry - d.stopLoss)).toFixed(2));
  const triggerPrice = livePrice ?? refEntry;

  return withSupabaseOrLocal(
    async (sb) => {
      const { error: sigErr } = await sb.from('signals').insert({
        id,
        symbol: d.symbol,
        source: d.source,
        timeframe: d.timeframe,
        status: 'ACTIVE',
        entry_low: d.entryLow,
        entry_high: d.entryHigh,
        tp1: d.tp1,
        tp2: d.tp2,
        tp3: d.tp3,
        stop_loss: d.stopLoss,
        risk_reward_ratio: riskRewardRatio,
        entry_reference_price: refEntry,
        explanation: d.explanation,
        created_by: adminUid,
        created_at: nowIso,
        updated_at: nowIso,
      });

      if (sigErr) {
        if (isSupabaseFallbackError(sigErr)) throw sigErr;
        throw new Error(sigErr.message);
      }

      await sb.from('signal_events').insert({
        id: `${id}_CREATED`,
        signal_id: id,
        symbol: d.symbol,
        event_type: 'CREATED',
        trigger_price: triggerPrice,
        result_percent: 0,
        occurred_at: nowIso,
      });

      await recordAdminAuditLog(adminUid, 'PUBLISH_SIGNAL', id, { symbol: d.symbol }, sb);
      return {
        id,
        symbol: d.symbol,
        source: d.source,
        timeframe: d.timeframe,
        status: 'ACTIVE' as const,
        entryLow: d.entryLow,
        entryHigh: d.entryHigh,
        tp1: d.tp1,
        tp2: d.tp2,
        tp3: d.tp3,
        stopLoss: d.stopLoss,
        riskRewardRatio,
        entryReferencePrice: refEntry,
        explanation: d.explanation,
        createdBy: adminUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    },
    async () => {
      const row: LocalSignalRow = {
        id,
        symbol: d.symbol,
        source: d.source,
        timeframe: d.timeframe,
        status: 'ACTIVE',
        entry_low: d.entryLow,
        entry_high: d.entryHigh,
        tp1: d.tp1,
        tp2: d.tp2,
        tp3: d.tp3,
        stop_loss: d.stopLoss,
        risk_reward_ratio: riskRewardRatio,
        entry_reference_price: refEntry,
        explanation: d.explanation,
        created_by: adminUid,
        created_at: nowIso,
        updated_at: nowIso,
      };
      localStore.data.signals.unshift(row);
      localStore.data.signal_events.unshift({
        id: `${id}_CREATED`,
        signal_id: id,
        symbol: d.symbol,
        event_type: 'CREATED',
        trigger_price: triggerPrice,
        result_percent: 0,
        occurred_at: nowIso,
      });
      localStore.save();
      await recordAdminAuditLog(adminUid, 'PUBLISH_SIGNAL', id, { symbol: d.symbol });

      return {
        id,
        symbol: d.symbol,
        source: d.source,
        timeframe: d.timeframe,
        status: 'ACTIVE' as const,
        entryLow: d.entryLow,
        entryHigh: d.entryHigh,
        tp1: d.tp1,
        tp2: d.tp2,
        tp3: d.tp3,
        stopLoss: d.stopLoss,
        riskRewardRatio,
        entryReferencePrice: refEntry,
        explanation: d.explanation,
        createdBy: adminUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    },
  );
}

export async function cancelAdminSignal(
  adminUid: string,
  signalId: string,
  getLivePriceFn: (symbol: string) => number | null,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  return withSupabaseOrLocal(
    async (sb) => {
      const { data: sigRow, error: fetchErr } = await sb
        .from('signals')
        .select('id, symbol')
        .eq('id', signalId)
        .maybeSingle();
      if (fetchErr && isSupabaseFallbackError(fetchErr)) throw fetchErr;
      if (fetchErr || !sigRow) return false;

      await sb.from('signals').update({ status: 'CANCELLED', updated_at: nowIso }).eq('id', signalId);
      await sb.from('signal_events').upsert({
        id: `${signalId}_CANCELLED`,
        signal_id: signalId,
        symbol: sigRow.symbol,
        event_type: 'CANCELLED',
        trigger_price: getLivePriceFn(sigRow.symbol) ?? 0,
        result_percent: 0,
        occurred_at: nowIso,
      });
      await recordAdminAuditLog(adminUid, 'CANCEL_SIGNAL', signalId, undefined, sb);
      return true;
    },
    async () => {
      const sig = localStore.data.signals.find((s) => s.id === signalId);
      if (!sig) return false;
      sig.status = 'CANCELLED';
      sig.updated_at = nowIso;
      if (!localStore.data.signal_events.some((e) => e.id === `${signalId}_CANCELLED`)) {
        localStore.data.signal_events.unshift({
          id: `${signalId}_CANCELLED`,
          signal_id: signalId,
          symbol: sig.symbol,
          event_type: 'CANCELLED',
          trigger_price: getLivePriceFn(sig.symbol) ?? 0,
          result_percent: 0,
          occurred_at: nowIso,
        });
      }
      localStore.save();
      await recordAdminAuditLog(adminUid, 'CANCEL_SIGNAL', signalId);
      return true;
    },
  );
}

export async function broadcastAdminAnnouncement(adminUid: string, title: string, message: string): Promise<number> {
  const nowIso = new Date().toISOString();
  return withSupabaseOrLocal(
    async (sb) => {
      const { data: activeUsers, error: uErr } = await sb
        .from('user_profiles')
        .select('id')
        .eq('status', 'active')
        .limit(500);
      if (uErr) {
        if (isSupabaseFallbackError(uErr)) throw uErr;
        throw new Error(uErr.message);
      }
      const recipients = activeUsers || [];
      if (recipients.length > 0) {
        const rows = recipients.map((u) => ({
          id: `ann_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
          user_id: u.id,
          type: 'ANNOUNCEMENT',
          title,
          message,
          read: false,
          created_at: nowIso,
        }));
        const { error: nErr } = await sb.from('notifications').insert(rows);
        if (nErr) throw new Error(nErr.message);
      }
      await recordAdminAuditLog(adminUid, 'BROADCAST_ANNOUNCEMENT', 'all_users', {
        recipientCount: recipients.length,
        title,
      }, sb);
      return recipients.length;
    },
    async () => {
      const recipients = localStore.data.user_profiles.filter((u) => u.status === 'active').slice(0, 500);
      for (const u of recipients) {
        localStore.data.notifications.unshift({
          id: `ann_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
          user_id: u.id,
          type: 'ANNOUNCEMENT',
          title,
          message,
          read: false,
          created_at: nowIso,
        });
      }
      localStore.save();
      await recordAdminAuditLog(adminUid, 'BROADCAST_ANNOUNCEMENT', 'all_users', {
        recipientCount: recipients.length,
        title,
      });
      return recipients.length;
    },
  );
}

export async function listAdminAuditLogs() {
  return withSupabaseOrLocal(
    async (sb) => {
      const { data, error } = await sb
        .from('admin_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        if (isSupabaseFallbackError(error)) throw error;
        throw new Error(error.message);
      }
      return (data || []).map((l) => ({
        id: l.id,
        adminUid: l.admin_uid,
        action: l.action,
        targetId: l.target_id,
        details: l.details,
        createdAt: l.created_at,
      }));
    },
    () =>
      localStore.data.admin_audit_logs.slice(0, 100).map((l) => ({
        id: l.id,
        adminUid: l.admin_uid,
        action: l.action,
        targetId: l.target_id,
        details: l.details,
        createdAt: l.created_at,
      })),
  );
}

export async function exportAdminSnapshot(adminUid: string) {
  return withSupabaseOrLocal(
    async (sb) => {
      const [{ data: users, error: uErr }, { data: signals }, { count: analysesCount }] = await Promise.all([
        sb.from('user_profiles').select('id, clerk_user_id, email, role, plan, status, created_at'),
        sb.from('signals').select('*'),
        sb.from('analyses').select('id', { count: 'exact', head: true }),
      ]);
      if (uErr && isSupabaseFallbackError(uErr)) throw uErr;
      await recordAdminAuditLog(adminUid, 'EXPORT_REPORT', 'platform_snapshot', undefined, sb);
      return {
        exportedAt: new Date().toISOString(),
        counts: {
          users: (users || []).length,
          signals: (signals || []).length,
          analyses: analysesCount || 0,
        },
        users: (users || []).map((u) => ({
          uid: u.id,
          clerkUserId: u.clerk_user_id,
          email: u.email,
          role: u.role,
          plan: u.plan,
          status: u.status,
          createdAt: u.created_at,
        })),
        signals: signals || [],
      };
    },
    async () => {
      await recordAdminAuditLog(adminUid, 'EXPORT_REPORT', 'platform_snapshot');
      return {
        exportedAt: new Date().toISOString(),
        counts: {
          users: localStore.data.user_profiles.length,
          signals: localStore.data.signals.length,
          analyses: localStore.data.analyses.length,
        },
        users: localStore.data.user_profiles.map((u) => ({
          uid: u.id,
          clerkUserId: u.clerk_user_id,
          email: u.email,
          role: u.role,
          plan: u.plan,
          status: u.status,
          createdAt: u.created_at,
        })),
        signals: localStore.data.signals,
      };
    },
  );
}

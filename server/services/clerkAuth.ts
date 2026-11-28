import { createClerkClient, verifyToken, type ClerkClient, type User as ClerkUser } from '@clerk/express';
import { ENV, getMissingClerkVars, isClerkConfigured } from '../config/env.ts';
import { ServiceNotConfiguredError } from './supabase.ts';
import { clerkIdToDeterministicUuid, syncClerkIdentityToStore } from './dataStore.ts';

export { clerkIdToDeterministicUuid };

let clerkClientInstance: ClerkClient | null = null;

export function getClerkBackendClient(): ClerkClient {
  if (!isClerkConfigured()) {
    throw new ServiceNotConfiguredError(
      'Clerk authentication is not configured. Set VITE_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY.',
      getMissingClerkVars(),
    );
  }
  if (!clerkClientInstance) {
    clerkClientInstance = createClerkClient({
      secretKey: ENV.CLERK_SECRET_KEY,
      publishableKey: ENV.CLERK_PUBLISHABLE_KEY,
    });
  }
  return clerkClientInstance;
}

export async function verifyClerkBearerToken(token: string): Promise<{ clerkUserId: string } | null> {
  if (!isClerkConfigured()) {
    throw new ServiceNotConfiguredError(
      'Clerk authentication is not configured.',
      getMissingClerkVars(),
    );
  }
  try {
    const payload = await verifyToken(token, {
      secretKey: ENV.CLERK_SECRET_KEY,
    });
    if (!payload?.sub) return null;
    return { clerkUserId: payload.sub };
  } catch {
    return null;
  }
}

interface CachedIdentity {
  expiresAt: number;
  identity: SyncedUserIdentity;
}

export interface SyncedUserIdentity {
  uid: string;
  clerkUserId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  role: 'user' | 'admin';
  plan: 'free' | 'pro';
  status: 'active' | 'suspended';
  adminClaimVerified: boolean;
}

const identityCache = new Map<string, CachedIdentity>();

export function invalidateIdentityCache(clerkUserId?: string): void {
  if (clerkUserId) {
    identityCache.delete(clerkUserId);
  } else {
    identityCache.clear();
  }
}

function getVerifiedPrimaryEmail(clerkUser: ClerkUser): { email: string; verified: boolean } {
  const primary =
    clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId) ||
    clerkUser.emailAddresses[0];
  if (!primary) return { email: '', verified: false };
  return {
    email: primary.emailAddress.trim().toLowerCase(),
    verified: primary.verification?.status === 'verified',
  };
}

/**
 * Resolves Clerk user -> verifies email -> syncs user profile to Supabase when configured
 * or falls back cleanly to local server persistence without failing.
 */
export async function syncClerkUserToSupabase(clerkUserId: string): Promise<SyncedUserIdentity> {
  const cached = identityCache.get(clerkUserId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.identity;
  }

  const clerk = getClerkBackendClient();
  const clerkUser = await clerk.users.getUser(clerkUserId);
  const { email, verified } = getVerifiedPrimaryEmail(clerkUser);

  if (!email) {
    throw new Error('Clerk account does not have an email address.');
  }

  const displayName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim() ||
    clerkUser.username ||
    email.split('@')[0];

  const currentMeta = (clerkUser.publicMetadata || {}) as Record<string, unknown>;
  const synced = await syncClerkIdentityToStore({
    clerkUserId,
    email,
    verified,
    displayName,
    clerkMetaRole: currentMeta.role,
  });

  if (currentMeta.role !== synced.role || currentMeta.supabaseUserId !== synced.uid) {
    await clerk.users
      .updateUserMetadata(clerkUserId, {
        publicMetadata: {
          ...currentMeta,
          role: synced.role,
          supabaseUserId: synced.uid,
        },
      })
      .catch(() => {});
  }

  const identity: SyncedUserIdentity = {
    uid: synced.uid,
    clerkUserId,
    email,
    emailVerified: verified,
    displayName,
    role: synced.role,
    plan: synced.plan,
    status: synced.status,
    adminClaimVerified: synced.role === 'admin' && verified,
  };

  identityCache.set(clerkUserId, {
    expiresAt: Date.now() + 30_000,
    identity,
  });

  return identity;
}


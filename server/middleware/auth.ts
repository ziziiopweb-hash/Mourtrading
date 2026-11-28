import type { NextFunction, Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import { ENV, isClerkConfigured } from '../config/env.ts';
import { getPublicSupabaseClient, ServiceNotConfiguredError } from '../services/supabase.ts';
import {
  syncClerkUserToSupabase,
  verifyClerkBearerToken,
} from '../services/clerkAuth.ts';
import { syncClerkIdentityToStore } from '../services/dataStore.ts';

export interface AuthenticatedUser {
  uid: string;
  clerkUserId: string;
  email: string;
  emailVerified: boolean;
  role: 'user' | 'admin';
  plan: 'free' | 'pro';
  status: 'active' | 'suspended';
  adminClaimVerified: boolean;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
      authToken?: string;
    }
  }
}

export class EmailNotVerifiedError extends Error {
  public readonly statusCode = 403;
  constructor() {
    super('Please verify your email address before accessing MourTrading.');
    this.name = 'EmailNotVerifiedError';
  }
}

async function resolveSupabaseBearerUser(token: string): Promise<AuthenticatedUser | null> {
  try {
    const sb = getPublicSupabaseClient();
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user || !data.user.email) return null;

    const sbUser = data.user;
    const rawEmail = sbUser.email;
    if (!rawEmail) return null;
    const email = rawEmail.trim().toLowerCase();
    const verified = Boolean(sbUser.email_confirmed_at || sbUser.confirmed_at);
    const fullName =
      typeof sbUser.user_metadata?.full_name === 'string' && sbUser.user_metadata.full_name.trim()
        ? sbUser.user_metadata.full_name.trim()
        : email.split('@')[0];

    const synced = await syncClerkIdentityToStore({
      clerkUserId: `sb:${sbUser.id}`,
      email,
      verified: verified || true,
      displayName: fullName,
      clerkMetaRole: undefined,
    });

    return {
      uid: synced.uid,
      clerkUserId: `sb:${sbUser.id}`,
      email,
      emailVerified: true,
      role: synced.role,
      plan: synced.plan,
      status: synced.status,
      adminClaimVerified: synced.role === 'admin',
    };
  } catch {
    return null;
  }
}

export async function resolveAuthUser(
  req: Request,
): Promise<{ user: AuthenticatedUser; token: string } | null> {
  let clerkUserId: string | null = null;
  let token = '';

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
    if (token) {
      if (isClerkConfigured()) {
        const verified = await verifyClerkBearerToken(token);
        if (verified) {
          clerkUserId = verified.clerkUserId;
        }
      }
      if (!clerkUserId) {
        const sbUser = await resolveSupabaseBearerUser(token);
        if (sbUser) {
          return { token, user: sbUser };
        }
      }
    }
  }

  if (!clerkUserId && isClerkConfigured()) {
    try {
      const clerkAuth = getAuth(req);
      if (clerkAuth?.userId) {
        clerkUserId = clerkAuth.userId;
      }
    } catch {
      // clerkMiddleware not active or no session cookie
    }
  }

  if (!clerkUserId) return null;

  const synced = await syncClerkUserToSupabase(clerkUserId);
  if (!synced.emailVerified) {
    throw new EmailNotVerifiedError();
  }

  return {
    token,
    user: {
      uid: synced.uid,
      clerkUserId: synced.clerkUserId,
      email: synced.email,
      emailVerified: synced.emailVerified,
      role: synced.role,
      plan: synced.plan,
      status: synced.status,
      adminClaimVerified: synced.adminClaimVerified,
    },
  };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const resolved = await resolveAuthUser(req);
    if (!resolved) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (resolved.user.status === 'suspended') {
      res.status(403).json({ error: 'Account is suspended. Contact support.' });
      return;
    }
    req.authUser = resolved.user;
    req.authToken = resolved.token;
    next();
  } catch (err) {
    if (err instanceof ServiceNotConfiguredError) {
      res.status(503).json({
        error: err.message,
        code: 'SERVICE_NOT_CONFIGURED',
        missingVars: err.missingVars,
      });
      return;
    }
    if (err instanceof EmailNotVerifiedError) {
      res.status(403).json({
        error: err.message,
        code: 'EMAIL_NOT_VERIFIED',
      });
      return;
    }
    res.status(401).json({ error: 'Invalid or expired authentication session' });
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, async () => {
    const user = req.authUser;
    const isAdminUser =
      Boolean(user) &&
      user!.role === 'admin' &&
      user!.adminClaimVerified &&
      (user!.emailVerified || user!.email === ENV.ADMIN_EMAIL);

    if (!isAdminUser) {
      res.status(403).json({ error: 'Administrator privileges required' });
      return;
    }
    next();
  });
}

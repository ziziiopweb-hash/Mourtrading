import type { NextFunction, Request, Response } from 'express';
import { ENV, getMissingSupabaseVars, isSupabaseConfigured } from '../config/env.ts';
import {
  createUserSupabaseClient,
  getPublicSupabaseClient,
  ServiceNotConfiguredError,
} from '../services/supabase.ts';

export const SESSION_COOKIE_NAME = 'mour_sb_token';

export interface AuthenticatedUser {
  uid: string;
  email: string;
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

export function setSessionCookie(res: Response, accessToken: string): void {
  res.cookie(SESSION_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
  });
}

function validateCsrfOrigin(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  if (req.headers['x-requested-with'] === 'MourTrading') return true;

  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function resolveAuthUser(req: Request): Promise<{ user: AuthenticatedUser; token: string } | null> {
  if (!isSupabaseConfigured()) {
    throw new ServiceNotConfiguredError(
      'Supabase is not configured.',
      getMissingSupabaseVars(),
    );
  }

  let token: string | null = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookieToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    if (cookieToken) {
      if (!validateCsrfOrigin(req)) {
        return null;
      }
      token = cookieToken;
    }
  }

  if (!token) return null;

  const publicSb = getPublicSupabaseClient();
  const { data: userData, error: authError } = await publicSb.auth.getUser(token);
  if (authError || !userData?.user) {
    return null;
  }

  const sbUser = userData.user;
  const email = (sbUser.email || '').toLowerCase();
  const userSb = createUserSupabaseClient(token);

  const { data: profileRow } = await userSb
    .from('user_profiles')
    .select('id, email, role, plan, status')
    .eq('id', sbUser.id)
    .maybeSingle();

  const isReservedAdmin = email === ENV.ADMIN_EMAIL;
  const role: 'user' | 'admin' =
    isReservedAdmin && profileRow?.role === 'admin' ? 'admin' : 'user';

  return {
    token,
    user: {
      uid: sbUser.id,
      email,
      role,
      plan: profileRow?.plan === 'pro' ? 'pro' : 'free',
      status: profileRow?.status === 'suspended' ? 'suspended' : 'active',
      adminClaimVerified: role === 'admin',
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
    res.status(401).json({ error: 'Invalid or expired authentication session' });
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, async () => {
    const user = req.authUser;
    if (
      !user ||
      user.role !== 'admin' ||
      !user.adminClaimVerified ||
      user.email !== ENV.ADMIN_EMAIL
    ) {
      res.status(403).json({ error: 'Administrator privileges required' });
      return;
    }
    next();
  });
}

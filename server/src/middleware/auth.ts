import type { NextFunction, Request, Response } from 'express';
import { effectivePermissions, type Permission, type Role, type SessionUser, packageHasFeature } from '@sms/shared';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { CSRF_HEADER, loadSession, sessionToken } from '../security/sessions.js';
import { safeEqual } from '../security/crypto.js';
import { AppError, forbidden, unauthorized } from '../utils/http.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
      csrfToken?: string;
    }
  }
}

/** Resolves the session cookie → user. Role and permissions ALWAYS come from the database. */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = sessionToken(req);
    const s = await loadSession(token);
    if (s) {
      const u = await User.findById(s.userId).lean();
      // Pending / unassigned (self-registered, not yet approved) accounts never get a working session.
      if (u && u.status === 'active' && u.role !== 'unassigned' && !u.deletedAt) {
        req.user = {
          id: u._id, username: u.username, fullName: u.fullName, role: u.role as Role,
          permissions: effectivePermissions(u.role as Role, env.PACKAGE, u.extraPermissions as Permission[], u.revokedPermissions as Permission[]),
          mustChangePassword: Boolean(u.mustChangePassword),
          ...(u.role === 'parent' ? { guardianId: u.guardianId ?? null } : {}),
          ...(u.role === 'student' ? { studentId: u.studentId ?? null } : {})
        };
        req.sessionId = s._id;
        req.csrfToken = s.csrfToken;
      }
    }
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  // mustChangePassword is informational only: it never blocks API access.
  next();
}

/** CSRF: state-changing requests must echo the session's CSRF token in a header. */
export function csrfProtect(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.user) return next(); // unauthenticated endpoints (login) are protected by SameSite + rate limits
  const header = String(req.headers[CSRF_HEADER] ?? '');
  if (!req.csrfToken || !header || !safeEqual(header, req.csrfToken)) return next(new AppError(403, 'CSRF', 'Security token missing or invalid. Reload the page.'));
  next();
}

/**
 * Defence in depth for the portals: a parent session can reach ONLY /api/parent/* and a student
 * session ONLY /api/student/* (plus the auth endpoints mounted before this). Even if a staff route forgot its permission check, a parent
 * could not call it.
 */
export function parentFence(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role === 'parent' && !/^\/parent(\/|$)/.test(req.path)) return next(forbidden());
  // Same fence for student accounts: only /api/student/*.
  if (req.user?.role === 'student' && !/^\/student(\/|$)/.test(req.path)) return next(forbidden());
  next();
}

export const can = (...perms: Permission[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized());
  if (!perms.every((p) => req.user!.permissions.includes(p))) return next(forbidden());
  next();
};

export const canAny = (...perms: Permission[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized());
  if (!perms.some((p) => req.user!.permissions.includes(p))) return next(forbidden());
  next();
};

/** Backend package gate — Standard-only APIs return 403 PACKAGE on Starter installs. */
export const requireFeature = (feature: string) => (_req: Request, _res: Response, next: NextFunction) => {
  if (!packageHasFeature(env.PACKAGE, feature)) return next(new AppError(403, 'PACKAGE', `This feature requires the Standard package.`));
  next();
};


import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { forbidden, unauthorized } from '../lib/errors';
import { verifyAccessToken } from '../lib/tokens';
import { ah } from '../lib/asyncHandler';
import { effectiveSchoolStatus } from '../services/schoolStatus';
import { PERMISSION_KEYS, type PermissionKey } from '../config/permissions';

export const ACCESS_COOKIE = 'sms_at';
export const REFRESH_COOKIE = 'sms_rt';

/** Verifies the access cookie and loads the current user (and their school + plan). */
export const authenticate = ah(async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) throw unauthorized();
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    throw unauthorized('Session expired');
  }
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    include: { school: { include: { plan: true } } },
  });
  if (!user || user.deletedAt || !user.isActive || user.tokenVersion !== claims.tv) {
    throw unauthorized('Session expired');
  }
  if (user.school?.deletedAt) throw unauthorized('This school account no longer exists');

  req.user = {
    id: user.id,
    role: user.role,
    schoolId: user.schoolId,
    username: user.username,
    fullName: user.fullName,
    mustChangePassword: user.mustChangePassword,
    permissions:
      user.role === 'PRINCIPAL'
        ? [...PERMISSION_KEYS]
        : Array.isArray(user.permissions)
          ? (user.permissions as string[])
          : [],
    school: user.school ? { ...user.school, effectiveStatus: effectiveSchoolStatus(user.school) } : null,
  };
  next();
});

/** Blocks everything except auth endpoints until a temporary password is changed. */
export function accountGate(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.mustChangePassword) {
    return next(forbidden('Please change your temporary password first', 'PASSWORD_CHANGE_REQUIRED'));
  }
  next();
}

/** For school users: blocks suspended schools, and writes when read-only (unpaid / trial ended). */
export function schoolGate(req: Request, _res: Response, next: NextFunction) {
  const school = req.user?.school;
  if (!school) return next(forbidden('This area is for school accounts'));
  if (school.effectiveStatus === 'SUSPENDED') {
    return next(forbidden('This school account is suspended. Please contact support.', 'SCHOOL_SUSPENDED'));
  }
  if (school.effectiveStatus === 'READ_ONLY' && !['GET', 'HEAD'].includes(req.method)) {
    return next(
      forbidden('This school account is in read-only mode. Please clear the subscription dues.', 'SCHOOL_READ_ONLY'),
    );
  }
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
    next();
  };

/** Principal always passes; staff need the permission key; other roles fail. */
export const requirePermission =
  (key: PermissionKey) => (req: Request, _res: Response, next: NextFunction) => {
    const u = req.user;
    if (u && (u.role === 'PRINCIPAL' || (u.role === 'STAFF' && u.permissions.includes(key)))) return next();
    next(forbidden());
  };

/** The caller's school id. Throws if the caller is not a school user. Use for every tenant query. */
export function tenantId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw forbidden('This area is for school accounts');
  return id;
}

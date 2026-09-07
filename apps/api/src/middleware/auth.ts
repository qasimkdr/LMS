import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '@nexora/database';

export type AuthContext = {
  userId: string;
  role: 'SUPER_ADMIN' | 'PRINCIPAL' | 'STAFF' | 'TEACHER' | 'STUDENT' | 'PARENT';
  schoolId?: string;
  impersonatedById?: string;
};

type TenantStatus =
  | 'TRIAL'
  | 'ACTIVE'
  | 'GRACE_PERIOD'
  | 'READ_ONLY'
  | 'SUSPENDED'
  | 'CANCELLED';

type TenantAccess = {
  schoolId: string;
  status: TenantStatus;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      tenantAccess?: TenantAccess;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.auth) return next();
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return res.status(401).json({ message: 'Authentication required' });
  try {
    req.auth = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as AuthContext;
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired session' });
  }
}

export function requireRoles(...roles: AuthContext['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    return next();
  };
}

const readOnlyException = (req: Request) => {
  if (req.baseUrl === '/api/support') return true;
  if (req.baseUrl === '/api/notifications') return true;
  if (
    req.baseUrl === '/api/backups' &&
    (req.path === '/validate' || req.path === '/restore-plan')
  ) {
    return true;
  }
  return false;
};

const enforceTenantStatus = (
  req: Request,
  res: Response,
  next: NextFunction,
  access: TenantAccess,
) => {
  const supportImpersonation = Boolean(req.auth?.impersonatedById);

  if (access.status === 'CANCELLED') {
    return res.status(403).json({
      message: 'This school account has been cancelled.',
      code: 'SCHOOL_CANCELLED',
    });
  }

  if (access.status === 'SUSPENDED' && !supportImpersonation) {
    return res.status(403).json({
      message: 'This school is suspended. Contact Nexora support.',
      code: 'SCHOOL_SUSPENDED',
    });
  }

  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (
    access.status === 'READ_ONLY' &&
    !safeMethod &&
    !supportImpersonation &&
    !readOnlyException(req)
  ) {
    return res.status(423).json({
      message: 'This school is currently read-only. Renew the subscription to make changes.',
      code: 'SCHOOL_READ_ONLY',
    });
  }

  return next();
};

export async function requireTenant(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.role === 'SUPER_ADMIN') return next();
  const schoolId = req.auth?.schoolId;
  if (!schoolId) return res.status(403).json({ message: 'School scope required' });

  if (req.tenantAccess?.schoolId === schoolId) {
    return enforceTenantStatus(req, res, next, req.tenantAccess);
  }

  try {
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, status: true },
    });
    if (!school) {
      return res.status(403).json({ message: 'School scope is no longer available.' });
    }

    const access: TenantAccess = {
      schoolId: school.id,
      status: school.status as TenantStatus,
    };
    req.tenantAccess = access;
    return enforceTenantStatus(req, res, next, access);
  } catch (error) {
    return next(error);
  }
}

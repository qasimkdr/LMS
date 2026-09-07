import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@nexora/database';
import {
  clearRefreshCookie,
  REFRESH_COOKIE,
  setRefreshCookie,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../lib/tokens.js';
import {
  resolveEffectiveLifecycleStatus,
  type LifecycleStatus,
} from '../services/subscriptionLifecycle.js';

const router = Router();
const loginSchema = z.object({ login: z.string().min(3), password: z.string().min(6) });

const effectiveSchoolStatus = (school: any): LifecycleStatus | null => {
  if (!school) return null;
  return resolveEffectiveLifecycleStatus({
    status: school.status as LifecycleStatus,
    trialEndsAt: school.trialEndsAt ?? null,
    subscriptionEnd: school.subscriptionEnd ?? null,
    graceEndsAt: school.graceEndsAt ?? null,
  });
};

function sessionUser(user: any, impersonatedById?: string) {
  const status = effectiveSchoolStatus(user.school);
  return {
    id: user.id,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    schoolId: user.schoolId,
    school: user.school
      ? {
          id: user.school.id,
          name: user.school.name,
          logoUrl: user.school.logoUrl,
          status,
        }
      : null,
    impersonating: Boolean(impersonatedById),
    impersonatedById: impersonatedById ?? null,
  };
}

const rejectUnavailableSchool = (status: LifecycleStatus | null, res: Response) => {
  if (status === 'CANCELLED') {
    return res.status(403).json({
      message: 'This school account has been cancelled. Contact Nexora support.',
      code: 'SCHOOL_CANCELLED',
    });
  }
  if (status === 'SUSPENDED') {
    return res.status(403).json({
      message: 'This school is suspended. Contact Nexora support.',
      code: 'SCHOOL_SUSPENDED',
    });
  }
  return null;
};

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid login payload' });

  const { login, password } = parsed.data;
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: login.toLowerCase() }, { username: login }],
      isActive: true,
    },
    include: { school: true },
  });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  if (user.role !== 'SUPER_ADMIN') {
    const rejection = rejectUnavailableSchool(effectiveSchoolStatus(user.school), res);
    if (rejection) return rejection;
  }

  const payload = {
    userId: user.id,
    role: user.role,
    ...(user.schoolId ? { schoolId: user.schoolId } : {}),
  };
  const accessToken = signAccessToken(payload);
  setRefreshCookie(res, signRefreshToken(payload));
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return res.json({ accessToken, user: sessionUser(user) });
});

router.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return res.status(401).json({ message: 'Session expired' });

  try {
    const payload = verifyRefreshToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { school: true },
    });
    if (!user?.isActive) throw new Error('Inactive user');

    if (user.role !== 'SUPER_ADMIN' && !payload.impersonatedById) {
      const status = effectiveSchoolStatus(user.school);
      if (status === 'SUSPENDED' || status === 'CANCELLED') {
        clearRefreshCookie(res);
        return rejectUnavailableSchool(status, res);
      }
    }

    if (payload.impersonatedById) {
      const admin = await prisma.user.findFirst({
        where: { id: payload.impersonatedById, role: 'SUPER_ADMIN', isActive: true },
      });
      if (!admin) throw new Error('Impersonating admin is no longer valid');
    }

    const nextPayload = {
      userId: user.id,
      role: user.role,
      ...(user.schoolId ? { schoolId: user.schoolId } : {}),
      ...(payload.impersonatedById ? { impersonatedById: payload.impersonatedById } : {}),
    };
    setRefreshCookie(res, signRefreshToken(nextPayload));
    return res.json({
      accessToken: signAccessToken(nextPayload),
      user: sessionUser(user, payload.impersonatedById),
    });
  } catch {
    clearRefreshCookie(res);
    return res.status(401).json({ message: 'Session expired' });
  }
});

router.post('/impersonation/exit', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return res.status(401).json({ message: 'Session expired' });

  try {
    const payload = verifyRefreshToken(token);
    if (!payload.impersonatedById) {
      return res.status(400).json({ message: 'No impersonation session is active' });
    }
    const admin = await prisma.user.findFirst({
      where: { id: payload.impersonatedById, role: 'SUPER_ADMIN', isActive: true },
      include: { school: true },
    });
    if (!admin) throw new Error('Original admin unavailable');

    const adminPayload = { userId: admin.id, role: 'SUPER_ADMIN' as const };
    setRefreshCookie(res, signRefreshToken(adminPayload));
    if (payload.schoolId) {
      await prisma.auditLog.create({
        data: {
          schoolId: payload.schoolId,
          actorId: admin.id,
          action: 'SUPPORT_IMPERSONATION_ENDED',
          entityType: 'School',
          entityId: payload.schoolId,
          afterData: { impersonatedUserId: payload.userId },
        },
      });
    }
    return res.json({ accessToken: signAccessToken(adminPayload), user: sessionUser(admin) });
  } catch {
    clearRefreshCookie(res);
    return res.status(401).json({ message: 'Could not exit impersonation' });
  }
});

router.post('/logout', (_req, res) => {
  clearRefreshCookie(res);
  return res.status(204).end();
});

export default router;

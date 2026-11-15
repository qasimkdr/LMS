import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { parse } from '../lib/validate';
import { badRequest, unauthorized } from '../lib/errors';
import { hashPassword, passwordSchema, verifyPassword } from '../lib/password';
import { hashToken } from '../lib/tokens';
import { REFRESH_COOKIE, authenticate } from '../middleware/auth';
import { loginLimiter } from '../middleware/rateLimit';
import { clearAuthCookies, issueSession } from '../services/session';
import { audit } from '../services/audit';
import { effectiveSchoolStatus } from '../services/schoolStatus';

const router = Router();

// Compared against when the user does not exist, so response time does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 11);

router.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const body = parse(
      z.object({ identifier: z.string().trim().min(1).max(160), password: z.string().min(1).max(100) }),
      req.body,
    );
    const user = await prisma.user.findFirst({
      where: { OR: [{ username: body.identifier }, { email: body.identifier }], deletedAt: null },
      include: { school: true },
    });
    const ok = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw unauthorized('Wrong username or password');
    if (!user.isActive) throw unauthorized('This account is deactivated. Contact your school.');
    if (user.school?.deletedAt) throw unauthorized('This school account no longer exists');

    await issueSession(req, res, user);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit(null, {
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      schoolId: user.schoolId,
      after: { ip: req.ip },
    });
    res.json({ user: { id: user.id, role: user.role, mustChangePassword: user.mustChangePassword } });
  }),
);

router.post(
  '/refresh',
  ah(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw unauthorized();
    const session = await prisma.refreshSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { school: true } } },
    });
    if (!session) {
      clearAuthCookies(res);
      throw unauthorized('Session expired');
    }
    if (session.revokedAt) {
      // A rotated token was used again: likely stolen. End every session of this user.
      if (session.replacedBy) {
        await prisma.$transaction([
          prisma.refreshSession.updateMany({
            where: { userId: session.userId, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
          prisma.user.update({ where: { id: session.userId }, data: { tokenVersion: { increment: 1 } } }),
        ]);
      }
      clearAuthCookies(res);
      throw unauthorized('Session expired');
    }
    const user = session.user;
    if (session.expiresAt < new Date() || !user.isActive || user.deletedAt || user.school?.deletedAt) {
      clearAuthCookies(res);
      throw unauthorized('Session expired');
    }
    const newId = await issueSession(req, res, user);
    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedBy: newId },
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/logout',
  ah(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      await prisma.refreshSession.updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    clearAuthCookies(res);
    res.json({ ok: true });
  }),
);

router.post(
  '/logout-all',
  authenticate,
  ah(async (req, res) => {
    const userId = req.user!.id;
    await prisma.$transaction([
      prisma.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
    ]);
    clearAuthCookies(res);
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const u = req.user!;
    const s = u.school;
    res.json({
      user: {
        id: u.id,
        role: u.role,
        username: u.username,
        fullName: u.fullName,
        mustChangePassword: u.mustChangePassword,
        permissions: u.permissions,
      },
      school: s
        ? {
            id: s.id,
            name: s.name,
            code: s.code,
            status: s.status,
            effectiveStatus: effectiveSchoolStatus(s),
            trialEndsAt: s.trialEndsAt,
            logoFileId: s.logoFileId,
            currency: s.currency,
            timezone: s.timezone,
            plan: { id: s.plan.id, name: s.plan.name, modules: s.plan.modules },
          }
        : null,
    });
  }),
);

router.post(
  '/change-password',
  authenticate,
  ah(async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw badRequest('Current password is wrong');
    }
    if (body.currentPassword === body.newPassword) throw badRequest('New password must be different');
    // Changing the password ends every other session.
    const [, updated] = await prisma.$transaction([
      prisma.refreshSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(body.newPassword),
          mustChangePassword: false,
          tokenVersion: { increment: 1 },
        },
      }),
    ]);
    await issueSession(req, res, updated);
    await audit(req, { action: 'auth.change_password', entityType: 'User', entityId: user.id });
    res.json({ ok: true });
  }),
);

export default router;

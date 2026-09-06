import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@nexora/database';
import { clearRefreshCookie, REFRESH_COOKIE, setRefreshCookie, signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/tokens.js';

const router = Router();
const loginSchema = z.object({ login: z.string().min(3), password: z.string().min(6) });

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid login payload' });

  const { login, password } = parsed.data;
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: login.toLowerCase() }, { username: login }], isActive: true },
    include: { school: true },
  });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  if (user.role !== 'SUPER_ADMIN' && user.school?.status === 'SUSPENDED') {
    return res.status(403).json({ message: 'This school is suspended. Contact Nexora support.' });
  }

  const payload = { userId: user.id, role: user.role, ...(user.schoolId ? { schoolId: user.schoolId } : {}) };
  const accessToken = signAccessToken(payload);
  setRefreshCookie(res, signRefreshToken(payload));

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  res.json({
    accessToken,
    user: {
      id: user.id,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      schoolId: user.schoolId,
      school: user.school ? { id: user.school.id, name: user.school.name, logoUrl: user.school.logoUrl, status: user.school.status } : null,
    },
  });
});

router.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return res.status(401).json({ message: 'Session expired' });

  try {
    const payload = verifyRefreshToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, include: { school: true } });
    if (!user?.isActive) throw new Error('Inactive user');
    if (user.role !== 'SUPER_ADMIN' && user.school?.status === 'SUSPENDED') {
      clearRefreshCookie(res);
      return res.status(403).json({ message: 'This school is suspended' });
    }
    const nextPayload = { userId: user.id, role: user.role, ...(user.schoolId ? { schoolId: user.schoolId } : {}) };
    setRefreshCookie(res, signRefreshToken(nextPayload));
    return res.json({ accessToken: signAccessToken(nextPayload) });
  } catch {
    clearRefreshCookie(res);
    return res.status(401).json({ message: 'Session expired' });
  }
});

router.post('/logout', (_req, res) => {
  clearRefreshCookie(res);
  res.status(204).end();
});

export default router;

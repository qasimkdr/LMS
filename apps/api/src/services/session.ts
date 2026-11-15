import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, newRefreshToken, signAccessToken } from '../lib/tokens';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../middleware/auth';

const base = { httpOnly: true, sameSite: 'lax' as const, secure: env.COOKIE_SECURE };

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...base, path: '/', maxAge: ACCESS_TTL_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    path: '/api/auth',
    maxAge: REFRESH_TTL_DAYS * 24 * 3600 * 1000,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: '/api/auth' });
}

/** Creates a refresh session and sets both cookies. Returns the new session id. */
export async function issueSession(req: Request, res: Response, user: User): Promise<string> {
  const { token, hash } = newRefreshToken();
  const session = await prisma.refreshSession.create({
    data: {
      userId: user.id,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 3600 * 1000),
      userAgent: req.get('user-agent')?.slice(0, 300),
      ip: req.ip,
    },
  });
  const access = signAccessToken({ sub: user.id, role: user.role, schoolId: user.schoolId, tv: user.tokenVersion });
  setAuthCookies(res, access, token);
  return session.id;
}

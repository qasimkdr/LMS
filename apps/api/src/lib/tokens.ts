import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import type { AuthContext } from '../middleware/auth.js';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '3d';
export const REFRESH_COOKIE = 'nexora_refresh';

function accessSecret() {
  if (!process.env.JWT_ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET is not configured');
  return process.env.JWT_ACCESS_SECRET;
}

function refreshSecret() {
  if (!process.env.JWT_REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET is not configured');
  return process.env.JWT_REFRESH_SECRET;
}

export function signAccessToken(payload: AuthContext) {
  return jwt.sign(payload, accessSecret(), { expiresIn: ACCESS_TTL });
}

export function signRefreshToken(payload: AuthContext) {
  return jwt.sign(payload, refreshSecret(), {
    expiresIn: REFRESH_TTL,
    jwtid: randomUUID(),
  });
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, refreshSecret()) as AuthContext;
}

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Hosted web and API services use different origins, so production refresh
    // requests require a cross-site cookie.
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 3 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/api/auth',
  });
}

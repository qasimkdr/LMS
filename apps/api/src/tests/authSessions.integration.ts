import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@nexora/database';

const PORT = 4018;
const BASE = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = 'AuthTest123!';
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'ci-access-secret-at-least-32-characters-long';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'ci-refresh-secret-at-least-32-characters-long';
const slugs = ['ci-auth-active', 'ci-auth-suspended', 'ci-auth-cancelled'];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForApi(child: ChildProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/health/live`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('Timed out waiting for API test server');
}

function cookieFrom(response: Response) {
  const raw = response.headers.get('set-cookie') ?? '';
  const match = raw.match(/nexora_refresh=[^;]+/);
  return match?.[0] ?? null;
}

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  const text = await response.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { response, body };
}

async function cleanup() {
  await prisma.school.deleteMany({ where: { slug: { in: slugs } } });
}

async function seed() {
  await cleanup();
  const passwordHash = await bcrypt.hash(PASSWORD, 8);
  const [activeSchool, suspendedSchool, cancelledSchool] = await Promise.all([
    prisma.school.create({ data: { name: 'CI Auth Active', slug: slugs[0], status: 'ACTIVE' } }),
    prisma.school.create({ data: { name: 'CI Auth Suspended', slug: slugs[1], status: 'SUSPENDED' } }),
    prisma.school.create({ data: { name: 'CI Auth Cancelled', slug: slugs[2], status: 'CANCELLED' } }),
  ]);

  const activeUser = await prisma.user.create({
    data: {
      schoolId: activeSchool.id,
      role: 'PRINCIPAL',
      email: 'ci-auth-active@nexora.test',
      username: 'ci-auth-active',
      passwordHash,
      firstName: 'Auth',
      lastName: 'Active',
    },
  });
  const inactiveUser = await prisma.user.create({
    data: {
      schoolId: activeSchool.id,
      role: 'STAFF',
      email: 'ci-auth-inactive@nexora.test',
      username: 'ci-auth-inactive',
      passwordHash,
      firstName: 'Auth',
      lastName: 'Inactive',
      isActive: false,
    },
  });
  const suspendedUser = await prisma.user.create({
    data: {
      schoolId: suspendedSchool.id,
      role: 'PRINCIPAL',
      email: 'ci-auth-suspended@nexora.test',
      username: 'ci-auth-suspended',
      passwordHash,
      firstName: 'Auth',
      lastName: 'Suspended',
    },
  });
  const cancelledUser = await prisma.user.create({
    data: {
      schoolId: cancelledSchool.id,
      role: 'PRINCIPAL',
      email: 'ci-auth-cancelled@nexora.test',
      username: 'ci-auth-cancelled',
      passwordHash,
      firstName: 'Auth',
      lastName: 'Cancelled',
    },
  });
  return { activeSchool, activeUser, inactiveUser, suspendedUser, cancelledUser };
}

async function login(login: string, password = PASSWORD) {
  return request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
}

async function main() {
  const fixture = await seed();
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      CLIENT_URL: 'http://localhost:5173',
      JWT_ACCESS_SECRET: ACCESS_SECRET,
      JWT_REFRESH_SECRET: REFRESH_SECRET,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForApi(child);

    const badPassword = await login(fixture.activeUser.email, 'WrongPassword123!');
    assert.equal(badPassword.response.status, 401, 'Wrong password must be rejected');

    const inactive = await login(fixture.inactiveUser.email);
    assert.equal(inactive.response.status, 401, 'Inactive users must not log in');

    const suspended = await login(fixture.suspendedUser.email);
    assert.equal(suspended.response.status, 403, 'Suspended school login must be blocked');
    assert.equal(suspended.body?.code, 'SCHOOL_SUSPENDED');

    const cancelled = await login(fixture.cancelledUser.email);
    assert.equal(cancelled.response.status, 403, 'Cancelled school login must be blocked');
    assert.equal(cancelled.body?.code, 'SCHOOL_CANCELLED');

    const active = await login(fixture.activeUser.email);
    assert.equal(active.response.status, 200, `Active login failed: ${JSON.stringify(active.body)}`);
    assert.ok(active.body?.accessToken, 'Login must return access token');
    const firstCookie = cookieFrom(active.response);
    assert.ok(firstCookie, 'Login must set HttpOnly refresh cookie');
    const loginSetCookie = active.response.headers.get('set-cookie') ?? '';
    assert.match(loginSetCookie, /HttpOnly/i);
    assert.match(loginSetCookie, /SameSite=Lax/i);

    const malformedAccess = await request('/school-directory', {
      headers: { Authorization: 'Bearer definitely-not-a-jwt' },
    });
    assert.equal(malformedAccess.response.status, 401, 'Malformed access token must be rejected');

    const expiredAccess = jwt.sign(
      {
        userId: fixture.activeUser.id,
        role: 'PRINCIPAL',
        schoolId: fixture.activeSchool.id,
        sessionId: 'expired-test-session',
      },
      ACCESS_SECRET,
      { expiresIn: -1 },
    );
    const expiredResult = await request('/school-directory', {
      headers: { Authorization: `Bearer ${expiredAccess}` },
    });
    assert.equal(expiredResult.response.status, 401, 'Expired access token must be rejected');

    const noCookieRefresh = await request('/auth/refresh', { method: 'POST' });
    assert.equal(noCookieRefresh.response.status, 401, 'Refresh without cookie must be rejected');

    const refreshed = await request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: firstCookie! },
    });
    assert.equal(refreshed.response.status, 200, 'Current refresh token must rotate successfully');
    const secondCookie = cookieFrom(refreshed.response);
    assert.ok(secondCookie, 'Refresh must issue a new cookie');
    assert.notEqual(secondCookie, firstCookie, 'Refresh rotation must produce a distinct token');

    const replayOld = await request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: firstCookie! },
    });
    assert.equal(replayOld.response.status, 401, 'A rotated refresh token must never be reusable');

    const refreshedAgain = await request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: secondCookie! },
    });
    assert.equal(refreshedAgain.response.status, 200, 'Latest refresh token must remain valid');
    const thirdCookie = cookieFrom(refreshedAgain.response);
    assert.ok(thirdCookie);

    const logout = await request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: thirdCookie! },
    });
    assert.equal(logout.response.status, 204, 'Logout must succeed');

    const replayLoggedOut = await request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: thirdCookie! },
    });
    assert.equal(replayLoggedOut.response.status, 401, 'Logged-out refresh token must be revoked server-side');

    const loginForInactiveRefresh = await login(fixture.activeUser.email);
    const inactiveCookie = cookieFrom(loginForInactiveRefresh.response);
    assert.ok(inactiveCookie);
    await prisma.user.update({ where: { id: fixture.activeUser.id }, data: { isActive: false } });
    const inactiveRefresh = await request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: inactiveCookie! },
    });
    assert.equal(inactiveRefresh.response.status, 401, 'Refresh must stop working immediately after user deactivation');

    console.log('Auth session integration tests passed');
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  try { await cleanup(); } catch {}
  await prisma.$disconnect();
  process.exitCode = 1;
});

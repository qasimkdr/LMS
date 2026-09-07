import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { prisma } from '@nexora/database';

const PORT = 4030;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'ci-access-secret-at-least-32-characters-long';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'ci-refresh-secret-at-least-32-characters-long';
const ALLOWED_ORIGIN = 'https://nexora-web.example';
const BLOCKED_ORIGIN = 'https://evil.example';
const SLUG = 'ci-production-runtime';
const PASSWORD = 'Runtime123!';

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
  throw new Error('Timed out waiting for production-mode API test server');
}

async function closeChild(child: ChildProcess) {
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
}

async function cleanup() {
  await prisma.school.deleteMany({ where: { slug: SLUG } });
}

async function seed() {
  await cleanup();
  const passwordHash = await bcrypt.hash(PASSWORD, 8);
  const school = await prisma.school.create({ data: { name: 'CI Production Runtime', slug: SLUG, status: 'ACTIVE' } });
  const principal = await prisma.user.create({
    data: {
      schoolId: school.id,
      role: 'PRINCIPAL',
      email: 'ci-production-runtime@nexora.test',
      username: 'ci-production-runtime',
      passwordHash,
      firstName: 'Production',
      lastName: 'Runtime',
    },
  });
  return { school, principal };
}

async function main() {
  const fixture = await seed();
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      CLIENT_URL: ALLOWED_ORIGIN,
      JWT_ACCESS_SECRET: ACCESS_SECRET,
      JWT_REFRESH_SECRET: REFRESH_SECRET,
      NODE_ENV: 'production',
      DISABLE_SUBSCRIPTION_LIFECYCLE: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForApi(child);

    const ready = await fetch(`${BASE}/health/ready`);
    assert.equal(ready.status, 200, 'Readiness endpoint must pass with live PostgreSQL');
    const readyBody = await ready.json() as any;
    assert.equal(readyBody.ok, true);
    assert.equal(readyBody.status, 'ready');
    assert.equal(readyBody.database, 'ok');
    assert.equal(typeof readyBody.latencyMs, 'number');

    const allowedPreflight = await fetch(`${BASE}/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.ok([200, 204].includes(allowedPreflight.status));
    assert.equal(allowedPreflight.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    assert.equal(allowedPreflight.headers.get('access-control-allow-credentials'), 'true');

    const blockedPreflight = await fetch(`${BASE}/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: BLOCKED_ORIGIN,
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.notEqual(blockedPreflight.headers.get('access-control-allow-origin'), BLOCKED_ORIGIN, 'Disallowed origin must never receive ACAO permission');

    const login = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ login: fixture.principal.email, password: PASSWORD }),
    });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    assert.equal(login.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(login.headers.get('x-content-type-options'), 'nosniff', 'Helmet security headers must be enabled');

    const setCookie = login.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /nexora_refresh=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i, 'Production refresh cookie must be Secure');
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\/api\/auth/i);

    const blockedLogin = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: {
        Origin: BLOCKED_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ login: fixture.principal.email, password: PASSWORD }),
    });
    assert.notEqual(blockedLogin.headers.get('access-control-allow-origin'), BLOCKED_ORIGIN);

    console.log('Production runtime security integration tests passed');
  } finally {
    await closeChild(child);
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

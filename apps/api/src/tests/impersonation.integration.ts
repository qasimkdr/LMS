import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { prisma } from '@nexora/database';

const PORT = 4026;
const BASE = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = 'Impersonate123!';
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'ci-access-secret-at-least-32-characters-long';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'ci-refresh-secret-at-least-32-characters-long';
const SLUG = 'ci-impersonation-school';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForApi(child: ChildProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited early with code ${child.exitCode}`);
    try { if ((await fetch(`${BASE}/health/live`)).ok) return; } catch {}
    await sleep(250);
  }
  throw new Error('Timed out waiting for API');
}

function cookieFrom(response: Response) {
  return (response.headers.get('set-cookie') ?? '').match(/nexora_refresh=[^;]+/)?.[0] ?? null;
}

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  const text = await response.text();
  let body: any = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  return { response, body };
}

async function cleanup() {
  const school = await prisma.school.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (school) await prisma.school.delete({ where: { id: school.id } });
  await prisma.user.deleteMany({ where: { email: 'ci-super-admin@nexora.test' } });
}

async function main() {
  await cleanup();
  const passwordHash = await bcrypt.hash(PASSWORD, 8);
  const admin = await prisma.user.create({ data: { role: 'SUPER_ADMIN', email: 'ci-super-admin@nexora.test', username: 'ci-super-admin', passwordHash, firstName: 'CI', lastName: 'Admin' } });
  const school = await prisma.school.create({ data: { name: 'CI Impersonation School', slug: SLUG, status: 'ACTIVE' } });
  const principal = await prisma.user.create({ data: { schoolId: school.id, role: 'PRINCIPAL', email: 'ci-impersonated-principal@nexora.test', username: 'ci-impersonated-principal', passwordHash, firstName: 'CI', lastName: 'Principal' } });

  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/index.ts'], { env: { ...process.env, PORT: String(PORT), CLIENT_URL: 'http://localhost:5173', JWT_ACCESS_SECRET: ACCESS_SECRET, JWT_REFRESH_SECRET: REFRESH_SECRET, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await waitForApi(child);
    const login = await request('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: admin.email, password: PASSWORD }) });
    assert.equal(login.response.status, 200);
    const adminCookie = cookieFrom(login.response); assert.ok(adminCookie);
    const adminAccess = login.body.accessToken;

    const start = await request(`/super-admin/schools/${school.id}/impersonate`, { method: 'POST', headers: { Authorization: `Bearer ${adminAccess}` } });
    assert.equal(start.response.status, 200, JSON.stringify(start.body));
    assert.equal(start.body.user.id, principal.id);
    assert.equal(start.body.user.impersonating, true);
    assert.equal(start.body.user.impersonatedById, admin.id);
    const impersonatedCookie = cookieFrom(start.response); assert.ok(impersonatedCookie);

    const staleAdmin = await request('/auth/refresh', { method: 'POST', headers: { Cookie: adminCookie! } });
    assert.equal(staleAdmin.response.status, 401, 'Pre-impersonation refresh token must be invalidated');

    const refresh = await request('/auth/refresh', { method: 'POST', headers: { Cookie: impersonatedCookie! } });
    assert.equal(refresh.response.status, 200, JSON.stringify(refresh.body));
    assert.equal(refresh.body.user.impersonating, true);
    assert.equal(refresh.body.user.impersonatedById, admin.id);
    const refreshedCookie = cookieFrom(refresh.response); assert.ok(refreshedCookie);

    await prisma.school.update({ where: { id: school.id }, data: { status: 'SUSPENDED' } });
    const suspendedRefresh = await request('/auth/refresh', { method: 'POST', headers: { Cookie: refreshedCookie! } });
    assert.equal(suspendedRefresh.response.status, 200, 'Support impersonation must survive school suspension');
    const suspendedCookie = cookieFrom(suspendedRefresh.response); assert.ok(suspendedCookie);

    const exit = await request('/auth/impersonation/exit', { method: 'POST', headers: { Cookie: suspendedCookie! } });
    assert.equal(exit.response.status, 200, JSON.stringify(exit.body));
    assert.equal(exit.body.user.id, admin.id);
    assert.equal(exit.body.user.role, 'SUPER_ADMIN');
    assert.equal(exit.body.user.impersonating, false);
    const restoredCookie = cookieFrom(exit.response); assert.ok(restoredCookie);

    const restoredRefresh = await request('/auth/refresh', { method: 'POST', headers: { Cookie: restoredCookie! } });
    assert.equal(restoredRefresh.response.status, 200, 'Restored Super Admin session must remain usable');
    assert.equal(restoredRefresh.body.user.role, 'SUPER_ADMIN');

    const audits = await prisma.auditLog.findMany({ where: { schoolId: school.id, actorId: admin.id, action: { in: ['SUPPORT_IMPERSONATION_STARTED', 'SUPPORT_IMPERSONATION_ENDED'] } } });
    assert.equal(audits.length, 2, 'Start and exit must both be audited');

    await prisma.school.update({ where: { id: school.id }, data: { status: 'CANCELLED' } });
    const currentCookie = cookieFrom(restoredRefresh.response); assert.ok(currentCookie);
    const currentAccess = restoredRefresh.body.accessToken;
    const cancelledStart = await request(`/super-admin/schools/${school.id}/impersonate`, { method: 'POST', headers: { Authorization: `Bearer ${currentAccess}` } });
    assert.equal(cancelledStart.response.status, 409, 'Cancelled school impersonation must be rejected');

    console.log('Super Admin impersonation integration tests passed');
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => { if (child.exitCode !== null) return resolve(); const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); child.once('exit', () => { clearTimeout(timeout); resolve(); }); });
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => { console.error(error); try { await cleanup(); } catch {} await prisma.$disconnect(); process.exitCode = 1; });

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { prisma } from '@nexora/database';

const PORT = 4026;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'ci-access-secret-at-least-32-characters-long';
const slugs = ['ci-support-a', 'ci-support-b'];
const superAdminUsername = 'ci-support-super-admin';

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

function token(userId: string, role: string, schoolId?: string) {
  return jwt.sign({ userId, role, ...(schoolId ? { schoolId } : {}) }, ACCESS_SECRET, { expiresIn: '15m' });
}

async function request(path: string, bearer: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${bearer}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${BASE}${path}`, { ...options, headers });
  const text = await response.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { response, body };
}

async function cleanup() {
  // Support messages can be authored by a platform Super Admin outside the tenant.
  // Delete raw support rows first so restrictive author FKs do not block school/user cleanup.
  await prisma.$executeRawUnsafe(`
    DELETE FROM "SupportTicketMessage"
    WHERE "ticketId" IN (
      SELECT t.id
      FROM "SupportTicket" t
      JOIN "School" s ON s.id = t."schoolId"
      WHERE s.slug IN ('ci-support-a','ci-support-b')
    )
  `);
  await prisma.$executeRawUnsafe(`
    DELETE FROM "SupportTicket"
    WHERE "schoolId" IN (
      SELECT id FROM "School" WHERE slug IN ('ci-support-a','ci-support-b')
    )
  `);
  await prisma.school.deleteMany({ where: { slug: { in: slugs } } });
  await prisma.user.deleteMany({ where: { username: superAdminUsername } });
}

async function seed() {
  await cleanup();
  const [schoolA, schoolB] = await Promise.all([
    prisma.school.create({ data: { name: 'CI Support A', slug: slugs[0], status: 'ACTIVE' } }),
    prisma.school.create({ data: { name: 'CI Support B', slug: slugs[1], status: 'ACTIVE' } }),
  ]);
  const makeUser = (schoolId: string, role: any, suffix: string) => prisma.user.create({
    data: {
      schoolId,
      role,
      email: `ci-support-${suffix}@nexora.test`,
      username: `ci-support-${suffix}`,
      passwordHash: 'not-used',
      firstName: 'CI',
      lastName: suffix,
    },
  });
  const [principalA, staffA, principalB, superAdmin] = await Promise.all([
    makeUser(schoolA.id, 'PRINCIPAL', 'principal-a'),
    makeUser(schoolA.id, 'STAFF', 'staff-a'),
    makeUser(schoolB.id, 'PRINCIPAL', 'principal-b'),
    prisma.user.create({
      data: {
        role: 'SUPER_ADMIN',
        email: 'ci-support-super-admin@nexora.test',
        username: superAdminUsername,
        passwordHash: 'not-used',
        firstName: 'CI',
        lastName: 'SuperAdmin',
      },
    }),
  ]);
  return { schoolA, schoolB, principalA, staffA, principalB, superAdmin };
}

async function createTicket(bearer: string, subject: string) {
  return request('/support/tickets', bearer, {
    method: 'POST',
    body: JSON.stringify({ subject, category: 'TECHNICAL', priority: 'HIGH', message: `Initial message for ${subject}` }),
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
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'ci-refresh-secret-at-least-32-characters-long',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const principalAToken = token(fixture.principalA.id, 'PRINCIPAL', fixture.schoolA.id);
  const staffAToken = token(fixture.staffA.id, 'STAFF', fixture.schoolA.id);
  const principalBToken = token(fixture.principalB.id, 'PRINCIPAL', fixture.schoolB.id);
  const adminToken = token(fixture.superAdmin.id, 'SUPER_ADMIN');

  try {
    await waitForApi(child);

    const ticketA = await createTicket(principalAToken, 'School A support issue');
    const ticketB = await createTicket(principalBToken, 'School B support issue');
    assert.equal(ticketA.response.status, 201);
    assert.equal(ticketB.response.status, 201);

    const schoolAList = await request('/support/tickets', principalAToken);
    assert.equal(schoolAList.response.status, 200);
    assert.deepEqual(schoolAList.body.map((ticket: any) => ticket.id), [ticketA.body.id], 'School A must list only its own support tickets');

    const schoolBList = await request('/support/tickets', principalBToken);
    assert.equal(schoolBList.response.status, 200);
    assert.deepEqual(schoolBList.body.map((ticket: any) => ticket.id), [ticketB.body.id]);

    const crossTenantDetail = await request(`/support/tickets/${ticketB.body.id}`, principalAToken);
    assert.equal(crossTenantDetail.response.status, 404, 'School A must not read School B support ticket by UUID');
    const crossTenantReply = await request(`/support/tickets/${ticketB.body.id}/messages`, principalAToken, {
      method: 'POST',
      body: JSON.stringify({ body: 'Cross tenant reply attempt' }),
    });
    assert.equal(crossTenantReply.response.status, 404);

    const adminList = await request('/support/tickets', adminToken);
    assert.equal(adminList.response.status, 200);
    assert.ok(adminList.body.some((ticket: any) => ticket.id === ticketA.body.id));
    assert.ok(adminList.body.some((ticket: any) => ticket.id === ticketB.body.id));

    const schoolInternalAttempt = await request(`/support/tickets/${ticketA.body.id}/messages`, principalAToken, {
      method: 'POST',
      body: JSON.stringify({ body: 'Should not become internal', isInternal: true }),
    });
    assert.equal(schoolInternalAttempt.response.status, 403, 'School users must not create internal support notes');

    const internalNote = await request(`/support/tickets/${ticketA.body.id}/messages`, adminToken, {
      method: 'POST',
      body: JSON.stringify({ body: 'Internal platform-only investigation note', isInternal: true }),
    });
    assert.equal(internalNote.response.status, 201);

    const schoolDetailAfterInternal = await request(`/support/tickets/${ticketA.body.id}`, principalAToken);
    assert.equal(schoolDetailAfterInternal.response.status, 200);
    assert.ok(!schoolDetailAfterInternal.body.messages.some((message: any) => message.id === internalNote.body.id), 'Internal note must be invisible to school users');
    assert.ok(!schoolDetailAfterInternal.body.messages.some((message: any) => message.isInternal));

    const adminDetail = await request(`/support/tickets/${ticketA.body.id}`, adminToken);
    assert.equal(adminDetail.response.status, 200);
    assert.ok(adminDetail.body.messages.some((message: any) => message.id === internalNote.body.id && message.isInternal === true), 'Super Admin must see internal note');

    const publicReply = await request(`/support/tickets/${ticketA.body.id}/messages`, adminToken, {
      method: 'POST',
      body: JSON.stringify({ body: 'Public support response', isInternal: false }),
    });
    assert.equal(publicReply.response.status, 201);
    assert.equal(publicReply.body.status, 'WAITING_ON_SCHOOL');

    const principalNotifications = await request('/notifications', principalAToken);
    const staffNotifications = await request('/notifications', staffAToken);
    const schoolBNotifications = await request('/notifications', principalBToken);
    assert.equal(principalNotifications.response.status, 200);
    assert.equal(staffNotifications.response.status, 200);
    assert.equal(schoolBNotifications.response.status, 200);
    const principalSupportNotice = principalNotifications.body.find((item: any) => item.title === 'Nexora Support replied');
    const staffSupportNotice = staffNotifications.body.find((item: any) => item.title === 'Nexora Support replied');
    assert.ok(principalSupportNotice, 'Principal should receive public Super Admin reply notification');
    assert.ok(staffSupportNotice, 'Staff should receive public Super Admin reply notification');
    assert.ok(!schoolBNotifications.body.some((item: any) => item.title === 'Nexora Support replied'), 'Other school must not receive School A support notification');

    const principalReadsStaffNotice = await request(`/notifications/${staffSupportNotice.id}/read`, principalAToken, { method: 'PATCH' });
    assert.equal(principalReadsStaffNotice.response.status, 404, 'User must not mark another user notification as read');
    const readOwn = await request(`/notifications/${principalSupportNotice.id}/read`, principalAToken, { method: 'PATCH' });
    assert.equal(readOwn.response.status, 200);
    assert.ok(readOwn.body.readAt);

    const resolve = await request(`/support/tickets/${ticketA.body.id}`, adminToken, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'RESOLVED', priority: 'NORMAL' }),
    });
    assert.equal(resolve.response.status, 200);
    assert.equal(resolve.body.status, 'RESOLVED');

    const replyResolved = await request(`/support/tickets/${ticketA.body.id}/messages`, staffAToken, {
      method: 'POST',
      body: JSON.stringify({ body: 'School reply after resolution' }),
    });
    assert.equal(replyResolved.response.status, 409, 'School users must not reply after ticket is resolved');

    const adminCanStillReply = await request(`/support/tickets/${ticketA.body.id}/messages`, adminToken, {
      method: 'POST',
      body: JSON.stringify({ body: 'Admin follow-up after resolution', isInternal: false }),
    });
    assert.equal(adminCanStillReply.response.status, 201, 'Super Admin may reopen conversation after resolution');
    assert.equal(adminCanStillReply.body.status, 'WAITING_ON_SCHOOL');

    console.log('Support and notification integration tests passed');
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

import { beforeEach, describe, expect, it } from 'vitest';
import { client, createUser, login, planInput, resetDb, setupSchool } from './helpers';
import { prisma } from '../src/lib/prisma';

beforeEach(resetDb);

describe('super admin: plans and schools', () => {
  it('only super admin can use admin routes', async () => {
    const { principal } = await setupSchool();
    expect((await principal.get('/api/admin/schools')).status).toBe(403);
    expect((await client().get('/api/admin/schools')).status).toBe(401);
  });

  it('creates a plan, a school and its principal with a temporary password', async () => {
    await createUser({ role: 'SUPER_ADMIN', username: 'boss' });
    const sa = await login('boss');
    const plan = await sa.post('/api/admin/plans', planInput({ modules: ['attendance', 'not_a_module'] }));
    expect(plan.status).toBe(400);
    const okPlan = await sa.post('/api/admin/plans', planInput());
    expect(okPlan.status).toBe(201);

    const res = await sa.post('/api/admin/schools', {
      school: { name: 'City Grammar', code: 'City-Grammar', planId: okPlan.body.plan.id, trialDays: 14 },
      principal: { fullName: 'Ayesha Khan', username: 'ayesha', phone: '' },
    });
    expect(res.status).toBe(201);
    expect(res.body.school.code).toBe('city-grammar');
    expect(res.body.tempPassword).toMatch(/^\w+-\d{4}-\w+$/);

    const school = await prisma.school.findUniqueOrThrow({ where: { id: res.body.school.id } });
    expect(school.status).toBe('TRIAL');
    expect(await prisma.campus.count({ where: { schoolId: school.id, isMain: true } })).toBe(1);

    // Principal logs in with the temp password and must change it.
    const p = client();
    expect((await p.post('/api/auth/login', { identifier: 'ayesha', password: res.body.tempPassword })).status).toBe(200);
    expect((await p.get('/api/school/overview')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // Duplicate code / username are rejected.
    const dup = await sa.post('/api/admin/schools', {
      school: { name: 'Other', code: 'city-grammar', planId: okPlan.body.plan.id },
      principal: { fullName: 'Xavier', username: 'other1' },
    });
    expect(dup.status).toBe(409);

    const list = await sa.get('/api/admin/schools');
    expect(list.body.schools).toHaveLength(1);
    expect(list.body.schools[0].principal.username).toBe('ayesha');
  });

  it('suspends, sets read-only and reactivates a school', async () => {
    const { sa, principal, schoolId } = await setupSchool();
    await sa.post(`/api/admin/schools/${schoolId}/status`, { status: 'READ_ONLY' });
    expect((await principal.get('/api/school/overview')).status).toBe(200);
    const write = await principal.patch('/api/school/profile', { city: 'Lahore' });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('SCHOOL_READ_ONLY');

    await sa.post(`/api/admin/schools/${schoolId}/status`, { status: 'SUSPENDED', reason: 'unpaid' });
    const blocked = await principal.get('/api/school/overview');
    expect(blocked.body.error.code).toBe('SCHOOL_SUSPENDED');
    // /me still works so the app can show the suspended message.
    expect((await principal.get('/api/auth/me')).body.school.effectiveStatus).toBe('SUSPENDED');

    await sa.post(`/api/admin/schools/${schoolId}/status`, { status: 'ACTIVE' });
    expect((await principal.patch('/api/school/profile', { city: 'Lahore' })).status).toBe(200);
  });

  it('an expired trial behaves as read-only', async () => {
    const { principal, schoolId } = await setupSchool();
    await prisma.school.update({ where: { id: schoolId }, data: { status: 'TRIAL', trialEndsAt: new Date(Date.now() - 1000) } });
    expect((await principal.patch('/api/school/profile', { city: 'Lahore' })).body.error.code).toBe('SCHOOL_READ_ONLY');
  });

  it('resets the principal password and ends their sessions', async () => {
    const { sa, principal, schoolId } = await setupSchool();
    const res = await sa.post(`/api/admin/schools/${schoolId}/principal/reset-password`);
    expect(res.status).toBe(200);
    expect((await principal.get('/api/auth/me')).status).toBe(401);
    const fresh = await login('principal-alpha', res.body.tempPassword);
    expect((await fresh.get('/api/auth/me')).body.user.mustChangePassword).toBe(true);
  });

  it('soft-deletes a school only with the confirmation code', async () => {
    const { sa, principal, schoolId } = await setupSchool();
    expect((await sa.del(`/api/admin/schools/${schoolId}`, { confirmCode: 'wrong' })).status).toBe(400);
    expect((await sa.del(`/api/admin/schools/${schoolId}`, { confirmCode: 'alpha' })).status).toBe(200);
    expect((await principal.get('/api/auth/me')).status).toBe(401);
    expect((await sa.get('/api/admin/schools')).body.schools).toHaveLength(0);
  });

  it('writes audit entries without secrets', async () => {
    const { sa } = await setupSchool();
    const audit = await sa.get('/api/admin/audit?action=school.create');
    expect(audit.body.rows).toHaveLength(1);
    expect(JSON.stringify(audit.body.rows[0])).not.toMatch(/passwordHash|\$2a\$/);
  });
});

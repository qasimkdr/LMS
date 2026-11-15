import request from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';

export const app = createApp();

export async function resetDb() {
  await prisma.auditLog.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.storedFile.deleteMany();
  await prisma.schoolInvoice.deleteMany();
  await prisma.user.deleteMany();
  await prisma.campus.deleteMany();
  await prisma.school.deleteMany();
  await prisma.plan.deleteMany();
}

/** Supertest agent that keeps cookies and sends the CSRF header on every request. */
export function client() {
  const agent = request.agent(app);
  const h = { 'X-Requested-With': 'fetch' };
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set(h).send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(url).set(h).send(body ?? {}),
    del: (url: string, body?: object) => agent.delete(url).set(h).send(body ?? {}),
    upload: (url: string, fields: Record<string, string>, file: { name: string; content: Buffer; type: string }) => {
      let r = agent.post(url).set(h);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return r.attach('file', file.content, { filename: file.name, contentType: file.type });
    },
  };
}

export async function createUser(opts: { role: Role; username: string; password?: string; schoolId?: string | null; mustChangePassword?: boolean; permissions?: string[] }) {
  return prisma.user.create({
    data: {
      role: opts.role,
      username: opts.username,
      fullName: opts.username,
      schoolId: opts.schoolId ?? null,
      passwordHash: await hashPassword(opts.password ?? 'Passw0rd!'),
      mustChangePassword: opts.mustChangePassword ?? false,
      permissions: opts.permissions,
    },
  });
}

export async function login(username: string, password = 'Passw0rd!') {
  const c = client();
  const res = await c.post('/api/auth/login', { identifier: username, password });
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}

export const planInput = (over: Record<string, unknown> = {}) => ({
  name: 'Basic',
  monthlyPrice: 5000,
  includedStudents: 2,
  perStudentPrice: 100,
  maxStudents: 10,
  maxStaff: 5,
  maxCampuses: 1,
  storageLimitMb: 10,
  maxFileSizeMb: 1,
  modules: ['attendance', 'fees'],
  ...over,
});

/** Super admin + one plan + one school with a principal who has already set their password. */
export async function setupSchool(code = 'alpha') {
  await createUser({ role: 'SUPER_ADMIN', username: `sa-${code}` }).catch(() => undefined);
  const sa = await login(`sa-${code}`);
  let plan = await prisma.plan.findFirst();
  if (!plan) {
    const r = await sa.post('/api/admin/plans', planInput());
    plan = await prisma.plan.findUniqueOrThrow({ where: { id: r.body.plan.id } });
  }
  const res = await sa.post('/api/admin/schools', {
    school: { name: `School ${code}`, code, planId: plan.id, status: 'ACTIVE' },
    principal: { fullName: `Principal ${code}`, username: `principal-${code}` },
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  await prisma.user.update({
    where: { id: res.body.principal.id },
    data: { passwordHash: await hashPassword('Passw0rd!'), mustChangePassword: false },
  });
  const principal = await login(`principal-${code}`);
  return { sa, principal, schoolId: res.body.school.id as string, planId: plan.id, tempPassword: res.body.tempPassword as string };
}

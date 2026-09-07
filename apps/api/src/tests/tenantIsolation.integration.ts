import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { prisma } from '@nexora/database';

const PORT = 4017;
const BASE = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = 'TenantTest123!';
const slugs = ['ci-tenant-a', 'ci-tenant-b'];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForApi(child: ChildProcessWithoutNullStreams) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/health/live`);
      if (response.ok) return;
    } catch {
      // API is still starting.
    }
    await sleep(250);
  }
  throw new Error('Timed out waiting for API test server');
}

async function request(path: string, options: RequestInit = {}, token?: string) {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${BASE}${path}`, { ...options, headers });
  const text = await response.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { response, body };
}

async function removeFixtures() {
  await prisma.school.deleteMany({ where: { slug: { in: slugs } } });
}

async function seed() {
  await removeFixtures();
  const passwordHash = await bcrypt.hash(PASSWORD, 8);

  const schoolA = await prisma.school.create({
    data: { name: 'CI Tenant A', slug: slugs[0], status: 'ACTIVE' },
  });
  const schoolB = await prisma.school.create({
    data: { name: 'CI Tenant B', slug: slugs[1], status: 'ACTIVE' },
  });

  const [principalA, teacherA, teacherB] = await Promise.all([
    prisma.user.create({
      data: {
        schoolId: schoolA.id,
        role: 'PRINCIPAL',
        email: 'ci-principal-a@nexora.test',
        username: 'ci-principal-a',
        passwordHash,
        firstName: 'Principal',
        lastName: 'A',
      },
    }),
    prisma.user.create({
      data: {
        schoolId: schoolA.id,
        role: 'TEACHER',
        email: 'ci-teacher-a@nexora.test',
        username: 'ci-teacher-a',
        passwordHash,
        firstName: 'Teacher',
        lastName: 'A',
      },
    }),
    prisma.user.create({
      data: {
        schoolId: schoolB.id,
        role: 'TEACHER',
        email: 'ci-teacher-b@nexora.test',
        username: 'ci-teacher-b',
        passwordHash,
        firstName: 'Teacher',
        lastName: 'B',
      },
    }),
  ]);

  const [classA, classB, subjectA, subjectB] = await Promise.all([
    prisma.class.create({ data: { schoolId: schoolA.id, name: 'A-Class', section: 'A' } }),
    prisma.class.create({ data: { schoolId: schoolB.id, name: 'B-Class', section: 'B' } }),
    prisma.subject.create({ data: { schoolId: schoolA.id, name: 'A-Subject', code: 'A101' } }),
    prisma.subject.create({ data: { schoolId: schoolB.id, name: 'B-Subject', code: 'B101' } }),
  ]);

  const assignmentB = await prisma.teacherAssignment.create({
    data: {
      schoolId: schoolB.id,
      teacherId: teacherB.id,
      classId: classB.id,
      subjectId: subjectB.id,
    },
  });

  return { schoolA, schoolB, principalA, teacherA, teacherB, classA, classB, subjectA, subjectB, assignmentB };
}

async function main() {
  const fixture = await seed();
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      CLIENT_URL: 'http://localhost:5173',
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'ci-access-secret-at-least-32-characters',
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'ci-refresh-secret-at-least-32-characters',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  try {
    await waitForApi(child);

    const login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: fixture.principalA.email, password: PASSWORD }),
    });
    assert.equal(login.response.status, 200, `School A Principal login failed: ${JSON.stringify(login.body)}`);
    const token = login.body?.accessToken as string;
    assert.ok(token, 'Login must return an access token');

    const directory = await request('/school-directory', {}, token);
    assert.equal(directory.response.status, 200);
    assert.equal(directory.body.school.id, fixture.schoolA.id, 'Directory must resolve tenant from auth');
    assert.deepEqual(directory.body.classes.map((item: any) => item.id), [fixture.classA.id]);
    assert.deepEqual(directory.body.subjects.map((item: any) => item.id), [fixture.subjectA.id]);
    assert.deepEqual(directory.body.teachers.map((item: any) => item.id), [fixture.teacherA.id]);
    assert.ok(!JSON.stringify(directory.body).includes(fixture.schoolB.id), 'School B identifiers must not leak into School A directory');

    const foreignRefs = await request('/teacher-assignments', {
      method: 'POST',
      body: JSON.stringify({
        teacherId: fixture.teacherB.id,
        classId: fixture.classB.id,
        subjectId: fixture.subjectB.id,
      }),
    }, token);
    assert.equal(foreignRefs.response.status, 400, 'School A must not create an assignment using School B references');

    const mixedRefs = await request('/teacher-assignments', {
      method: 'POST',
      body: JSON.stringify({
        teacherId: fixture.teacherA.id,
        classId: fixture.classB.id,
        subjectId: fixture.subjectA.id,
      }),
    }, token);
    assert.equal(mixedRefs.response.status, 400, 'A single foreign class ID must invalidate teacher assignment creation');

    const deleteForeign = await request(`/teacher-assignments/${fixture.assignmentB.id}`, { method: 'DELETE' }, token);
    assert.equal(deleteForeign.response.status, 404, 'School A must not be able to delete School B assignment by UUID');
    assert.ok(
      await prisma.teacherAssignment.findUnique({ where: { id: fixture.assignmentB.id } }),
      'School B assignment must remain after cross-tenant delete attempt',
    );

    const assignmentList = await request('/teacher-assignments', {}, token);
    assert.equal(assignmentList.response.status, 200);
    assert.ok(
      assignmentList.body.every((item: any) => item.schoolId === fixture.schoolA.id),
      'Teacher assignment listing must remain tenant scoped',
    );
    assert.ok(!assignmentList.body.some((item: any) => item.id === fixture.assignmentB.id));

    console.log('Multi-tenant HTTP isolation tests passed');
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
    await removeFixtures();
    await prisma.$disconnect();
  }

  if (stderr && child.exitCode && child.exitCode !== 0) {
    console.error(stderr);
  }
}

main().catch(async (error) => {
  console.error(error);
  try { await removeFixtures(); } catch {}
  await prisma.$disconnect();
  process.exitCode = 1;
});

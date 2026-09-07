import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { prisma } from '@nexora/database';

const PORT = 4023;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'ci-access-secret-at-least-32-characters-long';
const slugs = ['ci-approval-a', 'ci-approval-b'];

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

function token(userId: string, role: string, schoolId: string) {
  return jwt.sign({ userId, role, schoolId }, ACCESS_SECRET, { expiresIn: '15m' });
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
  await prisma.school.deleteMany({ where: { slug: { in: slugs } } });
}

async function seed() {
  await cleanup();
  const [schoolA, schoolB] = await Promise.all([
    prisma.school.create({ data: { name: 'CI Approval A', slug: slugs[0], status: 'ACTIVE' } }),
    prisma.school.create({ data: { name: 'CI Approval B', slug: slugs[1], status: 'ACTIVE' } }),
  ]);
  const makeUser = (schoolId: string, role: any, suffix: string) => prisma.user.create({
    data: {
      schoolId,
      role,
      email: `ci-approval-${suffix}@nexora.test`,
      username: `ci-approval-${suffix}`,
      passwordHash: 'not-used',
      firstName: 'CI',
      lastName: suffix,
    },
  });
  const [principal, staff, teacherA, teacherB] = await Promise.all([
    makeUser(schoolA.id, 'PRINCIPAL', 'principal'),
    makeUser(schoolA.id, 'STAFF', 'staff'),
    makeUser(schoolA.id, 'TEACHER', 'teacher-a'),
    makeUser(schoolB.id, 'TEACHER', 'teacher-b'),
  ]);
  const [classA, classB, subjectA1, subjectA2, subjectB] = await Promise.all([
    prisma.class.create({ data: { schoolId: schoolA.id, name: 'Approval Class A', section: 'A' } }),
    prisma.class.create({ data: { schoolId: schoolB.id, name: 'Approval Class B', section: 'B' } }),
    prisma.subject.create({ data: { schoolId: schoolA.id, name: 'Subject A1', code: 'AP-A1' } }),
    prisma.subject.create({ data: { schoolId: schoolA.id, name: 'Subject A2', code: 'AP-A2' } }),
    prisma.subject.create({ data: { schoolId: schoolB.id, name: 'Subject B', code: 'AP-B1' } }),
  ]);
  return { schoolA, schoolB, principal, staff, teacherA, teacherB, classA, classB, subjectA1, subjectA2, subjectB };
}

function assignmentRequest(teacherId: string, classId: string, subjectId: string, note?: string) {
  return JSON.stringify({
    requestType: 'TEACHER_ASSIGNMENT',
    entityType: 'TeacherAssignment',
    proposedData: { teacherId, classId, subjectId },
    note,
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

  const staffToken = token(fixture.staff.id, 'STAFF', fixture.schoolA.id);
  const principalToken = token(fixture.principal.id, 'PRINCIPAL', fixture.schoolA.id);

  try {
    await waitForApi(child);

    const foreign = await request('/approvals', staffToken, {
      method: 'POST',
      body: assignmentRequest(fixture.teacherB.id, fixture.classB.id, fixture.subjectB.id),
    });
    assert.equal(foreign.response.status, 400, 'Staff must not submit approval references from another school');

    const created = await request('/approvals', staffToken, {
      method: 'POST',
      body: assignmentRequest(fixture.teacherA.id, fixture.classA.id, fixture.subjectA1.id, 'Initial request'),
    });
    assert.equal(created.response.status, 201);
    const requestId = created.body?.id as string;
    assert.ok(requestId);

    const noRemarkRevision = await request(`/approvals/${requestId}/review`, principalToken, {
      method: 'PATCH',
      body: JSON.stringify({ decision: 'REVISION_REQUIRED' }),
    });
    assert.equal(noRemarkRevision.response.status, 400, 'Revision request must include a Principal remark');

    const revisionRequired = await request(`/approvals/${requestId}/review`, principalToken, {
      method: 'PATCH',
      body: JSON.stringify({ decision: 'REVISION_REQUIRED', remark: 'Use Subject A2 instead' }),
    });
    assert.equal(revisionRequired.response.status, 200);
    assert.equal(revisionRequired.body?.status, 'REVISION_REQUIRED');

    const versionOneBefore = await prisma.approvalVersion.findFirst({
      where: { approvalRequestId: requestId, revision: 1 },
    });
    assert.ok(versionOneBefore);
    assert.equal((versionOneBefore!.proposedData as any).subjectId, fixture.subjectA1.id);

    const resubmitted = await request(`/approvals/${requestId}/resubmit`, staffToken, {
      method: 'PATCH',
      body: JSON.stringify({
        proposedData: {
          teacherId: fixture.teacherA.id,
          classId: fixture.classA.id,
          subjectId: fixture.subjectA2.id,
        },
        note: 'Changed subject as requested',
      }),
    });
    assert.equal(resubmitted.response.status, 200);
    assert.equal(resubmitted.body?.status, 'RESUBMITTED');
    assert.equal(resubmitted.body?.revision, 2);

    const versions = await prisma.approvalVersion.findMany({
      where: { approvalRequestId: requestId },
      orderBy: { revision: 'asc' },
    });
    assert.equal(versions.length, 2, 'Resubmission must append a revision instead of replacing history');
    assert.equal((versions[0].proposedData as any).subjectId, fixture.subjectA1.id, 'Revision 1 must remain immutable');
    assert.equal((versions[1].proposedData as any).subjectId, fixture.subjectA2.id);

    const approved = await request(`/approvals/${requestId}/review`, principalToken, {
      method: 'PATCH',
      body: JSON.stringify({ decision: 'APPROVE', remark: 'Approved revised assignment' }),
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body?.status, 'APPROVED');

    const applied = await prisma.teacherAssignment.findMany({
      where: { schoolId: fixture.schoolA.id, teacherId: fixture.teacherA.id, classId: fixture.classA.id },
    });
    assert.equal(applied.length, 1, 'Approval must apply the operation exactly once');
    assert.equal(applied[0].subjectId, fixture.subjectA2.id, 'Approval must apply the latest submitted revision');

    const approveAgain = await request(`/approvals/${requestId}/review`, principalToken, {
      method: 'PATCH',
      body: JSON.stringify({ decision: 'APPROVE' }),
    });
    assert.equal(approveAgain.response.status, 404, 'Already-approved request must not be executable twice');
    assert.equal(await prisma.teacherAssignment.count({
      where: { schoolId: fixture.schoolA.id, teacherId: fixture.teacherA.id, classId: fixture.classA.id },
    }), 1);

    const rejectedCreate = await request('/approvals', staffToken, {
      method: 'POST',
      body: assignmentRequest(fixture.teacherA.id, fixture.classA.id, fixture.subjectA1.id, 'Reject me'),
    });
    assert.equal(rejectedCreate.response.status, 201);
    const rejectNoRemark = await request(`/approvals/${rejectedCreate.body.id}/review`, principalToken, {
      method: 'PATCH',
      body: JSON.stringify({ decision: 'REJECT' }),
    });
    assert.equal(rejectNoRemark.response.status, 400);
    const rejected = await request(`/approvals/${rejectedCreate.body.id}/review`, principalToken, {
      method: 'PATCH',
      body: JSON.stringify({ decision: 'REJECT', remark: 'Not required' }),
    });
    assert.equal(rejected.response.status, 200);
    assert.equal(rejected.body?.status, 'REJECTED');
    assert.equal(await prisma.teacherAssignment.count({
      where: {
        schoolId: fixture.schoolA.id,
        teacherId: fixture.teacherA.id,
        classId: fixture.classA.id,
        subjectId: fixture.subjectA1.id,
      },
    }), 0, 'Rejected approval must not apply the operation');

    const staffList = await request('/approvals', staffToken);
    assert.equal(staffList.response.status, 200);
    assert.ok(staffList.body.every((item: any) => item.requesterId === fixture.staff.id));
    assert.ok(staffList.body.every((item: any) => item.schoolId === fixture.schoolA.id));

    console.log('Approval engine integration tests passed');
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

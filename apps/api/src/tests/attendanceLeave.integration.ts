import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { Prisma, prisma } from '@nexora/database';

const PORT = 4022;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'ci-access-secret-at-least-32-characters-long';
const slug = 'ci-attendance-leave';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function dayOffset(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

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
  await prisma.school.deleteMany({ where: { slug } });
}

async function seed() {
  await cleanup();
  const school = await prisma.school.create({ data: { name: 'CI Attendance Leave', slug, status: 'ACTIVE' } });
  const makeUser = (role: any, suffix: string) => prisma.user.create({
    data: {
      schoolId: school.id,
      role,
      email: `ci-att-${suffix}@nexora.test`,
      username: `ci-att-${suffix}`,
      passwordHash: 'not-used',
      firstName: 'CI',
      lastName: suffix,
    },
  });
  const [principal, teacher, studentUser] = await Promise.all([
    makeUser('PRINCIPAL', 'principal'),
    makeUser('TEACHER', 'teacher'),
    makeUser('STUDENT', 'student'),
  ]);
  const [klass, subject] = await Promise.all([
    prisma.class.create({ data: { schoolId: school.id, name: 'Leave Class', section: 'A' } }),
    prisma.subject.create({ data: { schoolId: school.id, name: 'Leave Subject', code: 'LV101' } }),
  ]);
  const student = await prisma.studentProfile.create({
    data: {
      schoolId: school.id,
      userId: studentUser.id,
      admissionNo: 'ATT-001',
      classId: klass.id,
    },
  });
  await prisma.teacherAssignment.create({
    data: { schoolId: school.id, teacherId: teacher.id, classId: klass.id, subjectId: subject.id },
  });
  return { school, principal, teacher, studentUser, student, klass };
}

async function insertLeave(
  schoolId: string,
  userId: string,
  fromDate: Date,
  toDate: Date,
  status: 'PENDING' | 'APPROVED',
) {
  const id = randomUUID();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "LeaveRequest"
      (id,"schoolId","userId","fromDate","toDate",reason,status,"createdAt","updatedAt")
    VALUES
      (${id},${schoolId},${userId},${fromDate},${toDate},'CI approved leave',${status},NOW(),NOW())
  `);
  return id;
}

async function attendanceRecord(schoolId: string, classId: string, date: Date, studentProfileId: string) {
  return prisma.attendanceRecord.findFirst({
    where: {
      studentProfileId,
      attendance: { schoolId, classId, date },
    },
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

  const teacherToken = token(fixture.teacher.id, 'TEACHER', fixture.school.id);
  const principalToken = token(fixture.principal.id, 'PRINCIPAL', fixture.school.id);

  try {
    await waitForApi(child);

    const futureDay = dayOffset(2);
    await insertLeave(fixture.school.id, fixture.studentUser.id, futureDay, futureDay, 'APPROVED');

    const markDuringApprovedLeave = await request('/attendance/mark', teacherToken, {
      method: 'POST',
      body: JSON.stringify({
        classId: fixture.klass.id,
        date: futureDay.toISOString(),
        records: [{ studentProfileId: fixture.student.id, status: 'PRESENT', remark: 'Teacher tried present' }],
      }),
    });
    assert.equal(markDuringApprovedLeave.response.status, 201, 'Attendance session should still be created');
    const forcedLeave = await attendanceRecord(fixture.school.id, fixture.klass.id, futureDay, fixture.student.id);
    assert.equal(forcedLeave?.status, 'LEAVE', 'Approved leave must override Teacher PRESENT payload');
    assert.equal(forcedLeave?.remark, 'Approved leave');

    const laterDay = dayOffset(3);
    const markBeforeApproval = await request('/attendance/mark', teacherToken, {
      method: 'POST',
      body: JSON.stringify({
        classId: fixture.klass.id,
        date: laterDay.toISOString(),
        records: [{ studentProfileId: fixture.student.id, status: 'PRESENT' }],
      }),
    });
    assert.equal(markBeforeApproval.response.status, 201);
    assert.equal((await attendanceRecord(fixture.school.id, fixture.klass.id, laterDay, fixture.student.id))?.status, 'PRESENT');

    const pendingLeaveId = await insertLeave(
      fixture.school.id,
      fixture.studentUser.id,
      laterDay,
      laterDay,
      'PENDING',
    );
    const approve = await request(`/school-life/leave/${pendingLeaveId}/review`, principalToken, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'APPROVED', remark: 'CI approved' }),
    });
    assert.equal(approve.response.status, 200, 'Principal should approve pending Student leave');
    const rewritten = await attendanceRecord(fixture.school.id, fixture.klass.id, laterDay, fixture.student.id);
    assert.equal(rewritten?.status, 'LEAVE', 'Approving leave must rewrite an existing attendance record to LEAVE');
    assert.equal(rewritten?.remark, 'Approved leave');

    const remarkOverrideAttempt = await request('/attendance/mark', teacherToken, {
      method: 'POST',
      body: JSON.stringify({
        classId: fixture.klass.id,
        date: laterDay.toISOString(),
        records: [{ studentProfileId: fixture.student.id, status: 'ABSENT', remark: 'Override attempt' }],
      }),
    });
    assert.equal(remarkOverrideAttempt.response.status, 200);
    const lockedAgain = await attendanceRecord(fixture.school.id, fixture.klass.id, laterDay, fixture.student.id);
    assert.equal(lockedAgain?.status, 'LEAVE', 'Approved leave must remain locked on subsequent attendance updates');
    assert.equal(lockedAgain?.remark, 'Approved leave');

    console.log('Attendance approved-leave integration tests passed');
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

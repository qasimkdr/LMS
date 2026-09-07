import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { prisma } from '@nexora/database';

const PORT = 4025;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'ci-access-secret-at-least-32-characters-long';
const slugs = ['ci-portal-a', 'ci-portal-b'];

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
    prisma.school.create({ data: { name: 'CI Portal A', slug: slugs[0], status: 'ACTIVE' } }),
    prisma.school.create({ data: { name: 'CI Portal B', slug: slugs[1], status: 'ACTIVE' } }),
  ]);
  const makeUser = (schoolId: string, role: any, suffix: string) => prisma.user.create({
    data: {
      schoolId,
      role,
      email: `ci-portal-${suffix}@nexora.test`,
      username: `ci-portal-${suffix}`,
      passwordHash: 'not-used',
      firstName: 'CI',
      lastName: suffix,
    },
  });
  const [principal, studentOneUser, studentTwoUser, parentUser, foreignStudentUser] = await Promise.all([
    makeUser(schoolA.id, 'PRINCIPAL', 'principal'),
    makeUser(schoolA.id, 'STUDENT', 'student-one'),
    makeUser(schoolA.id, 'STUDENT', 'student-two'),
    makeUser(schoolA.id, 'PARENT', 'parent'),
    makeUser(schoolB.id, 'STUDENT', 'student-foreign'),
  ]);
  const [classOne, classTwo, foreignClass, subjectA, foreignSubject] = await Promise.all([
    prisma.class.create({ data: { schoolId: schoolA.id, name: 'Portal One', section: 'A' } }),
    prisma.class.create({ data: { schoolId: schoolA.id, name: 'Portal Two', section: 'B' } }),
    prisma.class.create({ data: { schoolId: schoolB.id, name: 'Portal Foreign', section: 'F' } }),
    prisma.subject.create({ data: { schoolId: schoolA.id, name: 'Portal Subject', code: 'PORT-A' } }),
    prisma.subject.create({ data: { schoolId: schoolB.id, name: 'Foreign Subject', code: 'PORT-B' } }),
  ]);
  const [studentOne, studentTwo, foreignStudent] = await Promise.all([
    prisma.studentProfile.create({ data: { schoolId: schoolA.id, userId: studentOneUser.id, admissionNo: 'PORT-001', classId: classOne.id } }),
    prisma.studentProfile.create({ data: { schoolId: schoolA.id, userId: studentTwoUser.id, admissionNo: 'PORT-002', classId: classTwo.id } }),
    prisma.studentProfile.create({ data: { schoolId: schoolB.id, userId: foreignStudentUser.id, admissionNo: 'PORT-F01', classId: foreignClass.id } }),
  ]);
  const parent = await prisma.parentProfile.create({ data: { schoolId: schoolA.id, userId: parentUser.id } });
  await prisma.studentParent.create({ data: { parentId: parent.id, studentId: studentOne.id, relation: 'Guardian' } });
  return { schoolA, schoolB, principal, studentOneUser, studentTwoUser, parentUser, classOne, classTwo, foreignClass, subjectA, foreignSubject, studentOne, studentTwo, foreignStudent };
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

  const principalToken = token(fixture.principal.id, 'PRINCIPAL', fixture.schoolA.id);
  const studentOneToken = token(fixture.studentOneUser.id, 'STUDENT', fixture.schoolA.id);
  const studentTwoToken = token(fixture.studentTwoUser.id, 'STUDENT', fixture.schoolA.id);
  const parentToken = token(fixture.parentUser.id, 'PARENT', fixture.schoolA.id);

  try {
    await waitForApi(child);

    for (const [path, body] of [
      ['/coursework/assignments', { classId: fixture.foreignClass.id, subjectId: fixture.foreignSubject.id, title: 'Foreign assignment', instructions: 'Must be rejected' }],
      ['/coursework/materials', { classId: fixture.foreignClass.id, subjectId: fixture.foreignSubject.id, title: 'Foreign material' }],
      ['/coursework/syllabus', { classId: fixture.foreignClass.id, subjectId: fixture.foreignSubject.id, title: 'Foreign syllabus' }],
    ] as const) {
      const result = await request(path, principalToken, { method: 'POST', body: JSON.stringify(body) });
      assert.equal(result.response.status, 403, `${path} must reject foreign tenant class/subject references even for Principal`);
    }

    const assignmentOne = await request('/coursework/assignments', principalToken, {
      method: 'POST',
      body: JSON.stringify({
        classId: fixture.classOne.id,
        subjectId: fixture.subjectA.id,
        title: 'Class One Assignment',
        instructions: 'Answer for class one',
        maxMarks: 10,
      }),
    });
    assert.equal(assignmentOne.response.status, 201);
    const assignmentTwo = await request('/coursework/assignments', principalToken, {
      method: 'POST',
      body: JSON.stringify({
        classId: fixture.classTwo.id,
        subjectId: fixture.subjectA.id,
        title: 'Class Two Assignment',
        instructions: 'Answer for class two',
      }),
    });
    assert.equal(assignmentTwo.response.status, 201);

    const studentOneAssignments = await request('/coursework/assignments', studentOneToken);
    assert.equal(studentOneAssignments.response.status, 200);
    assert.ok(studentOneAssignments.body.some((item: any) => item.id === assignmentOne.body.id));
    assert.ok(!studentOneAssignments.body.some((item: any) => item.id === assignmentTwo.body.id), 'Student must not see another class assignment');

    const studentTwoAssignments = await request('/coursework/assignments', studentTwoToken);
    assert.equal(studentTwoAssignments.response.status, 200);
    assert.ok(studentTwoAssignments.body.some((item: any) => item.id === assignmentTwo.body.id));
    assert.ok(!studentTwoAssignments.body.some((item: any) => item.id === assignmentOne.body.id));

    const ownSubmission = await request(`/coursework/assignments/${assignmentOne.body.id}/submission`, studentOneToken, {
      method: 'PUT',
      body: JSON.stringify({ textAnswer: 'Student one answer', submit: true }),
    });
    assert.equal(ownSubmission.response.status, 200);
    assert.equal(ownSubmission.body.studentUserId, fixture.studentOneUser.id);

    const updatedDraft = await request(`/coursework/assignments/${assignmentOne.body.id}/submission`, studentOneToken, {
      method: 'PUT',
      body: JSON.stringify({ textAnswer: 'Updated answer', submit: false }),
    });
    assert.equal(updatedDraft.response.status, 200);
    assert.equal(updatedDraft.body.id, ownSubmission.body.id, 'Repeated saves must update the same Student submission');
    assert.equal(await prisma.assignmentSubmission.count({ where: { assignmentId: assignmentOne.body.id, studentUserId: fixture.studentOneUser.id } }), 1);

    const wrongClassSubmit = await request(`/coursework/assignments/${assignmentOne.body.id}/submission`, studentTwoToken, {
      method: 'PUT',
      body: JSON.stringify({ textAnswer: 'Unauthorized answer', submit: true }),
    });
    assert.equal(wrongClassSubmit.response.status, 404, 'Student must not submit to an assignment outside their class');

    const parentSubmit = await request(`/coursework/assignments/${assignmentOne.body.id}/submission`, parentToken, {
      method: 'PUT',
      body: JSON.stringify({ textAnswer: 'Parent must not submit', submit: true }),
    });
    assert.equal(parentSubmit.response.status, 403, 'Parent role must remain read-only and cannot submit as child');

    const genericParentAssignments = await request('/coursework/assignments', parentToken);
    assert.equal(genericParentAssignments.response.status, 400, 'Parent must use linked-child coursework endpoint');

    const parentCoursework = await request(`/parent-coursework/${fixture.studentOne.id}`, parentToken);
    assert.equal(parentCoursework.response.status, 200);
    assert.equal(parentCoursework.body.student.id, fixture.studentOne.id);
    const parentAssignment = parentCoursework.body.assignments.find((item: any) => item.id === assignmentOne.body.id);
    assert.ok(parentAssignment, 'Parent should see linked child coursework');
    assert.equal(parentAssignment.submission.id, ownSubmission.body.id, 'Parent should see only the linked child submission state');

    const unrelatedCoursework = await request(`/parent-coursework/${fixture.studentTwo.id}`, parentToken);
    assert.equal(unrelatedCoursework.response.status, 403, 'Parent must not access unrelated same-school student coursework');
    const foreignCoursework = await request(`/parent-coursework/${fixture.foreignStudent.id}`, parentToken);
    assert.equal(foreignCoursework.response.status, 403, 'Parent must not access foreign-school student coursework');

    const children = await request('/portal/parent/children', parentToken);
    assert.equal(children.response.status, 200);
    assert.deepEqual(children.body.map((child: any) => child.id), [fixture.studentOne.id], 'Parent children list must contain linked children only');

    const linkedDetail = await request(`/portal/parent/children/${fixture.studentOne.id}`, parentToken);
    assert.equal(linkedDetail.response.status, 200);
    assert.equal(linkedDetail.body.student.id, fixture.studentOne.id);
    const unrelatedDetail = await request(`/portal/parent/children/${fixture.studentTwo.id}`, parentToken);
    assert.equal(unrelatedDetail.response.status, 404);
    const foreignDetail = await request(`/portal/parent/children/${fixture.foreignStudent.id}`, parentToken);
    assert.equal(foreignDetail.response.status, 404);

    const studentPortal = await request('/portal/student', studentOneToken);
    assert.equal(studentPortal.response.status, 200);
    assert.equal(studentPortal.body.profile.id, fixture.studentOne.id);
    const studentCannotUseParentEndpoint = await request(`/parent-coursework/${fixture.studentOne.id}`, studentOneToken);
    assert.equal(studentCannotUseParentEndpoint.response.status, 403);

    console.log('Parent and Student permission integration tests passed');
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

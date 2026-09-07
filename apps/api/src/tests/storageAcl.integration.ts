import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { Prisma, prisma } from '@nexora/database';

const API_PORT = 4019;
const MOCK_STORAGE_PORT = 4020;
const BASE = `http://127.0.0.1:${API_PORT}/api`;
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'ci-access-secret-at-least-32-characters-long';
const slugs = ['ci-storage-a', 'ci-storage-b'];

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

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function accessToken(userId: string, role: string, schoolId: string) {
  return jwt.sign({ userId, role, schoolId }, ACCESS_SECRET, { expiresIn: '15m' });
}

async function request(path: string, token: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
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

async function insertStorageObject(input: {
  id?: string;
  schoolId: string;
  uploadedById: string;
  category: string;
  name: string;
  createdAt?: Date;
}) {
  const id = input.id ?? randomUUID();
  const createdAt = input.createdAt ?? new Date(Date.now() - 2 * 60 * 60 * 1000);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "StorageObject"
      (id,"schoolId","uploadedById",bucket,path,"originalName","mimeType","sizeBytes",category,"createdAt")
    VALUES
      (${id},${input.schoolId},${input.uploadedById},'nexora-private',${`${input.schoolId}/${input.category}/${id}.pdf`},${input.name},'application/pdf',1024,${input.category},${createdAt})
  `);
  return {
    id,
    reference: `storage://${id}`,
  };
}

async function seed() {
  await cleanup();
  const [schoolA, schoolB] = await Promise.all([
    prisma.school.create({ data: { name: 'CI Storage A', slug: slugs[0], status: 'ACTIVE' } }),
    prisma.school.create({ data: { name: 'CI Storage B', slug: slugs[1], status: 'ACTIVE' } }),
  ]);

  const makeUser = (schoolId: string, role: any, suffix: string) =>
    prisma.user.create({
      data: {
        schoolId,
        role,
        email: `ci-storage-${suffix}@nexora.test`,
        username: `ci-storage-${suffix}`,
        passwordHash: 'not-used-in-access-token-tests',
        firstName: 'CI',
        lastName: suffix,
      },
    });

  const [principalA, principalB, teacherAllowed, teacherDenied, studentA, studentOther, parentLinkedUser, parentUnlinkedUser, staffA] =
    await Promise.all([
      makeUser(schoolA.id, 'PRINCIPAL', 'principal-a'),
      makeUser(schoolB.id, 'PRINCIPAL', 'principal-b'),
      makeUser(schoolA.id, 'TEACHER', 'teacher-allowed'),
      makeUser(schoolA.id, 'TEACHER', 'teacher-denied'),
      makeUser(schoolA.id, 'STUDENT', 'student-a'),
      makeUser(schoolA.id, 'STUDENT', 'student-other'),
      makeUser(schoolA.id, 'PARENT', 'parent-linked'),
      makeUser(schoolA.id, 'PARENT', 'parent-unlinked'),
      makeUser(schoolA.id, 'STAFF', 'staff-a'),
    ]);

  const [classA, classOther, subjectA, subjectOther] = await Promise.all([
    prisma.class.create({ data: { schoolId: schoolA.id, name: 'Storage A', section: 'A' } }),
    prisma.class.create({ data: { schoolId: schoolA.id, name: 'Storage Other', section: 'B' } }),
    prisma.subject.create({ data: { schoolId: schoolA.id, name: 'Storage Subject A', code: 'STA' } }),
    prisma.subject.create({ data: { schoolId: schoolA.id, name: 'Storage Subject Other', code: 'STB' } }),
  ]);

  const [studentProfileA, studentProfileOther, parentLinked, parentUnlinked] = await Promise.all([
    prisma.studentProfile.create({
      data: { schoolId: schoolA.id, userId: studentA.id, admissionNo: 'STOR-A', classId: classA.id },
    }),
    prisma.studentProfile.create({
      data: { schoolId: schoolA.id, userId: studentOther.id, admissionNo: 'STOR-B', classId: classOther.id },
    }),
    prisma.parentProfile.create({ data: { schoolId: schoolA.id, userId: parentLinkedUser.id } }),
    prisma.parentProfile.create({ data: { schoolId: schoolA.id, userId: parentUnlinkedUser.id } }),
  ]);

  await prisma.studentParent.create({
    data: { studentId: studentProfileA.id, parentId: parentLinked.id, relation: 'Parent' },
  });

  await prisma.teacherAssignment.create({
    data: {
      schoolId: schoolA.id,
      teacherId: teacherAllowed.id,
      classId: classA.id,
      subjectId: subjectA.id,
    },
  });

  const assignmentFile = await insertStorageObject({
    schoolId: schoolA.id,
    uploadedById: principalA.id,
    category: 'assignment',
    name: 'assignment.pdf',
  });
  const materialFile = await insertStorageObject({
    schoolId: schoolA.id,
    uploadedById: principalA.id,
    category: 'material',
    name: 'material.pdf',
  });
  const submissionFile = await insertStorageObject({
    schoolId: schoolA.id,
    uploadedById: studentA.id,
    category: 'submission',
    name: 'submission.pdf',
  });
  const orphanFile = await insertStorageObject({
    schoolId: schoolA.id,
    uploadedById: principalA.id,
    category: 'assignment',
    name: 'orphan.pdf',
  });
  const foreignFile = await insertStorageObject({
    schoolId: schoolB.id,
    uploadedById: principalB.id,
    category: 'assignment',
    name: 'foreign.pdf',
  });

  const assignment = await prisma.assignment.create({
    data: {
      schoolId: schoolA.id,
      classId: classA.id,
      subjectId: subjectA.id,
      createdById: teacherAllowed.id,
      title: 'Storage ACL Assignment',
      instructions: 'Test assignment',
      attachmentUrl: assignmentFile.reference,
    },
  });
  await prisma.courseMaterial.create({
    data: {
      schoolId: schoolA.id,
      classId: classA.id,
      subjectId: subjectA.id,
      createdById: teacherAllowed.id,
      title: 'Storage ACL Material',
      fileUrl: materialFile.reference,
    },
  });
  await prisma.assignmentSubmission.create({
    data: {
      assignmentId: assignment.id,
      studentUserId: studentA.id,
      attachmentUrl: submissionFile.reference,
      status: 'SUBMITTED',
      submittedAt: new Date(),
    },
  });

  return {
    schoolA,
    schoolB,
    principalA,
    teacherAllowed,
    teacherDenied,
    studentA,
    studentOther,
    parentLinkedUser,
    parentUnlinkedUser,
    staffA,
    assignmentFile,
    materialFile,
    submissionFile,
    orphanFile,
    foreignFile,
    subjectOther,
    parentUnlinked,
  };
}

async function main() {
  const fixture = await seed();
  const mockStorage = createServer((req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/storage/v1/object/sign/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ signedURL: '/object/sign/ci-signed-url' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => mockStorage.listen(MOCK_STORAGE_PORT, '127.0.0.1', resolve));

  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(API_PORT),
      CLIENT_URL: 'http://localhost:5173',
      JWT_ACCESS_SECRET: ACCESS_SECRET,
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'ci-refresh-secret-at-least-32-characters-long',
      SUPABASE_URL: `http://127.0.0.1:${MOCK_STORAGE_PORT}`,
      SUPABASE_SERVICE_ROLE_KEY: 'ci-storage-key',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const token = (user: { id: string }, role: string) => accessToken(user.id, role, fixture.schoolA.id);
  const sign = (reference: string, bearer: string) => request('/storage/sign', bearer, {
    method: 'POST',
    body: JSON.stringify({ reference }),
  });

  try {
    await waitForApi(child);

    assert.equal((await sign(fixture.assignmentFile.reference, token(fixture.principalA, 'PRINCIPAL'))).response.status, 200, 'Principal must access same-school assignment files');
    assert.equal((await sign(fixture.assignmentFile.reference, token(fixture.teacherAllowed, 'TEACHER'))).response.status, 200, 'Assigned teacher must access exact class+subject assignment file');
    assert.equal((await sign(fixture.assignmentFile.reference, token(fixture.teacherDenied, 'TEACHER'))).response.status, 403, 'Unassigned teacher must be denied assignment file');
    assert.equal((await sign(fixture.assignmentFile.reference, token(fixture.studentA, 'STUDENT'))).response.status, 200, 'Student in target class must access assignment file');
    assert.equal((await sign(fixture.assignmentFile.reference, token(fixture.studentOther, 'STUDENT'))).response.status, 403, 'Student from another class must be denied assignment file');
    assert.equal((await sign(fixture.assignmentFile.reference, token(fixture.parentLinkedUser, 'PARENT'))).response.status, 200, 'Linked parent must access child-class assignment file');
    assert.equal((await sign(fixture.assignmentFile.reference, token(fixture.parentUnlinkedUser, 'PARENT'))).response.status, 403, 'Unlinked parent must be denied assignment file');
    assert.equal((await sign(fixture.assignmentFile.reference, token(fixture.staffA, 'STAFF'))).response.status, 403, 'Staff must not receive assignment file access by default');

    assert.equal((await sign(fixture.materialFile.reference, token(fixture.teacherAllowed, 'TEACHER'))).response.status, 200, 'Assigned teacher must access material');
    assert.equal((await sign(fixture.materialFile.reference, token(fixture.studentA, 'STUDENT'))).response.status, 200, 'Class student must access material');
    assert.equal((await sign(fixture.materialFile.reference, token(fixture.studentOther, 'STUDENT'))).response.status, 403, 'Other-class student must be denied material');

    assert.equal((await sign(fixture.submissionFile.reference, token(fixture.studentA, 'STUDENT'))).response.status, 200, 'Student must access own submission');
    assert.equal((await sign(fixture.submissionFile.reference, token(fixture.studentOther, 'STUDENT'))).response.status, 403, 'Student must not access another student submission');
    assert.equal((await sign(fixture.submissionFile.reference, token(fixture.parentLinkedUser, 'PARENT'))).response.status, 200, 'Linked parent must access child submission');
    assert.equal((await sign(fixture.submissionFile.reference, token(fixture.parentUnlinkedUser, 'PARENT'))).response.status, 403, 'Unlinked parent must be denied child submission');
    assert.equal((await sign(fixture.submissionFile.reference, token(fixture.teacherAllowed, 'TEACHER'))).response.status, 200, 'Assigned teacher must access class submission');

    const foreign = await sign(fixture.foreignFile.reference, token(fixture.principalA, 'PRINCIPAL'));
    assert.equal(foreign.response.status, 404, 'Cross-school storage object must be invisible even to a Principal who knows its UUID');

    const linkedDelete = await request(`/storage/${fixture.assignmentFile.id}`, token(fixture.principalA, 'PRINCIPAL'), { method: 'DELETE' });
    assert.equal(linkedDelete.response.status, 409, 'Linked storage object must not be manually deleted');
    assert.equal(linkedDelete.body?.code, 'STORAGE_OBJECT_IN_USE');

    const orphanScan = await request('/storage/orphans?olderThanHours=1&limit=100', token(fixture.principalA, 'PRINCIPAL'));
    assert.equal(orphanScan.response.status, 200, 'Principal orphan scan must succeed');
    const orphanIds = new Set((orphanScan.body?.objects ?? []).map((item: any) => item.id));
    assert.ok(orphanIds.has(fixture.orphanFile.id), 'Unlinked old assignment file must be detected as orphan');
    assert.ok(!orphanIds.has(fixture.assignmentFile.id), 'Linked assignment file must never be reported as orphan');
    assert.ok(!orphanIds.has(fixture.materialFile.id), 'Linked material must never be reported as orphan');
    assert.ok(!orphanIds.has(fixture.submissionFile.id), 'Linked submission must never be reported as orphan');

    console.log('Storage ACL integration tests passed');
  } finally {
    await closeChild(child);
    await closeServer(mockStorage);
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

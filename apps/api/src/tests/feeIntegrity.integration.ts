import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { Prisma, prisma } from '@nexora/database';

const PORT = 4021;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'ci-access-secret-at-least-32-characters-long';
const month = new Date().toISOString().slice(0, 7);
const slugs = ['ci-fees-a', 'ci-fees-b'];

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
    prisma.school.create({ data: { name: 'CI Fees A', slug: slugs[0], status: 'ACTIVE' } }),
    prisma.school.create({ data: { name: 'CI Fees B', slug: slugs[1], status: 'ACTIVE' } }),
  ]);

  const makeUser = (schoolId: string, role: any, suffix: string) =>
    prisma.user.create({
      data: {
        schoolId,
        role,
        email: `ci-fees-${suffix}@nexora.test`,
        username: `ci-fees-${suffix}`,
        passwordHash: 'not-used',
        firstName: 'Fee',
        lastName: suffix,
      },
    });

  const [principal, staff, principalB] = await Promise.all([
    makeUser(schoolA.id, 'PRINCIPAL', 'principal'),
    makeUser(schoolA.id, 'STAFF', 'staff'),
    makeUser(schoolB.id, 'PRINCIPAL', 'principal-b'),
  ]);
  const [classA, classB] = await Promise.all([
    prisma.class.create({ data: { schoolId: schoolA.id, name: 'Fee Class A', section: 'A' } }),
    prisma.class.create({ data: { schoolId: schoolB.id, name: 'Fee Class B', section: 'B' } }),
  ]);

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "FeeStructure"
      (id,"schoolId","classId","monthlyAmount",currency,"dueDay","lateFineAmount","lateFineGraceDays","createdAt","updatedAt")
    VALUES
      (${randomUUID()},${schoolA.id},${classA.id},1000,'PKR',28,0,30,NOW(),NOW())
  `);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "FeeStructure"
      (id,"schoolId","classId","monthlyAmount",currency,"dueDay","lateFineAmount","lateFineGraceDays","createdAt","updatedAt")
    VALUES
      (${randomUUID()},${schoolB.id},${classB.id},1000,'PKR',28,0,30,NOW(),NOW())
  `);

  async function makeStudent(schoolId: string, classId: string, suffix: string) {
    const user = await makeUser(schoolId, 'STUDENT', suffix);
    const profile = await prisma.studentProfile.create({
      data: {
        schoolId,
        userId: user.id,
        admissionNo: `FEE-${suffix.toUpperCase()}`,
        classId,
      },
    });
    return { user, profile };
  }

  const [concurrent, overpay, discount, staffStudent, refOne, refTwo, foreign] = await Promise.all([
    makeStudent(schoolA.id, classA.id, 'concurrent'),
    makeStudent(schoolA.id, classA.id, 'overpay'),
    makeStudent(schoolA.id, classA.id, 'discount'),
    makeStudent(schoolA.id, classA.id, 'staff-student'),
    makeStudent(schoolA.id, classA.id, 'ref-one'),
    makeStudent(schoolA.id, classA.id, 'ref-two'),
    makeStudent(schoolB.id, classB.id, 'foreign'),
  ]);

  return {
    schoolA,
    schoolB,
    classA,
    principal,
    staff,
    principalB,
    concurrent,
    overpay,
    discount,
    staffStudent,
    refOne,
    refTwo,
    foreign,
  };
}

async function paymentRows(schoolId: string, studentProfileId: string) {
  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT * FROM "FeePayment"
    WHERE "schoolId"=${schoolId} AND "studentProfileId"=${studentProfileId} AND month=${month}
    ORDER BY "createdAt"
  `);
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
      DISABLE_FEE_INVOICE_SNAPSHOTS: 'true',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const principalToken = token(fixture.principal.id, 'PRINCIPAL', fixture.schoolA.id);
  const staffToken = token(fixture.staff.id, 'STAFF', fixture.schoolA.id);
  const receive = (bearer: string, studentProfileId: string, amount: number, reference?: string) =>
    request('/fees/receive', bearer, {
      method: 'POST',
      body: JSON.stringify({ studentProfileId, month, amount, method: 'CASH', reference }),
    });

  try {
    await waitForApi(child);

    const overpay = await receive(principalToken, fixture.overpay.profile.id, 1000.01);
    assert.equal(overpay.response.status, 400, 'Payment above adjusted balance must be rejected');
    assert.equal((await paymentRows(fixture.schoolA.id, fixture.overpay.profile.id)).length, 0, 'Rejected overpayment must not create a payment row');

    const concurrentResults = await Promise.all([
      receive(principalToken, fixture.concurrent.profile.id, 600),
      receive(principalToken, fixture.concurrent.profile.id, 600),
    ]);
    assert.equal(concurrentResults.filter((item) => item.response.status === 201).length, 1, 'Exactly one concurrent 600 payment may succeed against a 1000 balance');
    assert.equal(concurrentResults.filter((item) => item.response.status !== 201).length, 1, 'Second concurrent payment must be rejected after row lock re-check');
    let concurrentPayments = await paymentRows(fixture.schoolA.id, fixture.concurrent.profile.id);
    assert.equal(concurrentPayments.reduce((sum, row) => sum + Number(row.amount), 0), 600, 'Concurrent requests must not over-collect');

    const invoiceBefore = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT * FROM "FeeInvoice"
      WHERE "schoolId"=${fixture.schoolA.id} AND "studentProfileId"=${fixture.concurrent.profile.id} AND month=${month}
    `);
    assert.equal(Number(invoiceBefore[0]?.baseFee), 1000, 'First collection must snapshot the monthly fee');

    await prisma.$executeRaw(Prisma.sql`
      UPDATE "FeeStructure"
      SET "monthlyAmount"=2000,"updatedAt"=NOW()
      WHERE "schoolId"=${fixture.schoolA.id} AND "classId"=${fixture.classA.id}
    `);
    const frozenRemaining = await receive(principalToken, fixture.concurrent.profile.id, 400);
    assert.equal(frozenRemaining.response.status, 201, 'Historical invoice must keep the original 1000 fee after structure changes');
    assert.equal(frozenRemaining.body?.remainingAfter, 0);
    concurrentPayments = await paymentRows(fixture.schoolA.id, fixture.concurrent.profile.id);
    assert.equal(concurrentPayments.reduce((sum, row) => sum + Number(row.amount), 0), 1000);
    const extraAfterPaid = await receive(principalToken, fixture.concurrent.profile.id, 1);
    assert.equal(extraAfterPaid.response.status, 409, 'Fully paid invoice must reject additional installments');

    await prisma.$executeRaw(Prisma.sql`
      UPDATE "FeeStructure"
      SET "monthlyAmount"=1000,"updatedAt"=NOW()
      WHERE "schoolId"=${fixture.schoolA.id} AND "classId"=${fixture.classA.id}
    `);

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "FeeAdjustment"
        (id,"schoolId","studentProfileId",month,type,amount,reason,"createdById","createdAt")
      VALUES
        (${randomUUID()},${fixture.schoolA.id},${fixture.discount.profile.id},${month},'DISCOUNT',200,'CI discount',${fixture.principal.id},NOW())
    `);
    const discountOverpay = await receive(principalToken, fixture.discount.profile.id, 801);
    assert.equal(discountOverpay.response.status, 400, 'Discount-adjusted balance must reject an 801 payment against an 800 due');
    const discountPartOne = await receive(principalToken, fixture.discount.profile.id, 500);
    const discountPartTwo = await receive(principalToken, fixture.discount.profile.id, 300);
    assert.equal(discountPartOne.response.status, 201);
    assert.equal(discountPartTwo.response.status, 201, 'Multiple installments must be accepted up to adjusted balance');
    assert.equal((await paymentRows(fixture.schoolA.id, fixture.discount.profile.id)).reduce((sum, row) => sum + Number(row.amount), 0), 800);

    const refFirst = await receive(principalToken, fixture.refOne.profile.id, 100, 'CI-DUP-REF');
    assert.equal(refFirst.response.status, 201);
    const refDuplicate = await receive(principalToken, fixture.refTwo.profile.id, 100, 'CI-DUP-REF');
    assert.equal(refDuplicate.response.status, 409, 'Duplicate payment references must be rejected school-wide');

    const staffPayment = await receive(staffToken, fixture.staffStudent.profile.id, 500, 'CI-STAFF-1');
    assert.equal(staffPayment.response.status, 201);
    assert.equal(staffPayment.body?.approvalStatus, 'PENDING', 'Staff-collected money must await Principal handover');
    assert.ok(staffPayment.body?.batchId, 'Staff payment must join an open recovery batch');

    const submitBatch = await request(`/fees/batches/${staffPayment.body.batchId}/submit`, staffToken, { method: 'POST' });
    assert.equal(submitBatch.response.status, 200, 'Staff must be able to submit non-empty recovery batch');
    const collectBatch = await request(`/fees/batches/${staffPayment.body.batchId}/collect`, principalToken, {
      method: 'PATCH',
      body: JSON.stringify({ remark: 'CI handover' }),
    });
    assert.equal(collectBatch.response.status, 200, 'Principal must collect submitted Staff batch');

    const staffRows = await paymentRows(fixture.schoolA.id, fixture.staffStudent.profile.id);
    assert.equal(staffRows[0]?.approvalStatus, 'APPROVED', 'Collected batch payments must become approved');
    const batchRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT * FROM "FeeRecoveryBatch" WHERE id=${staffPayment.body.batchId}
    `);
    assert.equal(batchRows[0]?.status, 'COLLECTED');
    assert.equal(Number(batchRows[0]?.totalAmount), 500);

    const foreignStudent = await receive(principalToken, fixture.foreign.profile.id, 100);
    assert.equal(foreignStudent.response.status, 404, 'School A Principal must not collect money against School B student ID');
    assert.equal((await paymentRows(fixture.schoolB.id, fixture.foreign.profile.id)).length, 0);

    console.log('Fee integrity integration tests passed');
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

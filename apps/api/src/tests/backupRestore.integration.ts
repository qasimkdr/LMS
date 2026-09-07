import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { prisma } from '@nexora/database';

const PORT = 4028;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'ci-access-secret-at-least-32-characters-long';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'ci-refresh-secret-at-least-32-characters-long';
const slugs = ['ci-backup-a', 'ci-backup-b'];

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

function token(userId: string, schoolId: string) {
  return jwt.sign({ userId, role: 'PRINCIPAL', schoolId }, ACCESS_SECRET, { expiresIn: '15m' });
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
  return { response, body, text };
}

async function cleanup() {
  await prisma.school.deleteMany({ where: { slug: { in: slugs } } });
}

async function seed() {
  await cleanup();
  const [schoolA, schoolB] = await Promise.all([
    prisma.school.create({ data: { name: 'CI Backup A', slug: slugs[0], status: 'ACTIVE' } }),
    prisma.school.create({ data: { name: 'CI Backup B', slug: slugs[1], status: 'ACTIVE' } }),
  ]);
  const [principalA, principalB] = await Promise.all([
    prisma.user.create({ data: { schoolId: schoolA.id, role: 'PRINCIPAL', email: 'ci-backup-a@nexora.test', username: 'ci-backup-a', passwordHash: 'not-used', firstName: 'Backup', lastName: 'A' } }),
    prisma.user.create({ data: { schoolId: schoolB.id, role: 'PRINCIPAL', email: 'ci-backup-b@nexora.test', username: 'ci-backup-b', passwordHash: 'not-used', firstName: 'Backup', lastName: 'B' } }),
  ]);
  await prisma.class.create({ data: { schoolId: schoolA.id, name: 'Grade 10', section: 'A', academicYear: '2026' } });
  await prisma.subject.create({ data: { schoolId: schoolA.id, name: 'Mathematics', code: 'MATH' } });
  return { schoolA, schoolB, principalA, principalB };
}

function verifyPlanToken(tokenValue: string, expectedSchoolId: string, backup: any) {
  const [encoded, signature] = tokenValue.split('.');
  assert.ok(encoded && signature, 'Restore confirmation token must have payload and signature');
  const expectedSignature = createHmac('sha256', REFRESH_SECRET).update(encoded).digest('base64url');
  assert.equal(signature, expectedSignature, 'Restore token signature must be valid');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  const expectedHash = createHash('sha256').update(JSON.stringify(backup)).digest('hex');
  assert.equal(payload.v, 1);
  assert.equal(payload.schoolId, expectedSchoolId, 'Restore token must be tenant-bound');
  assert.equal(payload.backupHash, expectedHash, 'Restore token must be bound to exact backup bytes');
  assert.ok(payload.exp > Date.now(), 'Restore token must not be expired when issued');
  assert.ok(payload.exp <= Date.now() + 11 * 60 * 1000, 'Restore token lifetime must stay short');
  return payload;
}

async function main() {
  const fixture = await seed();
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      CLIENT_URL: 'http://localhost:5173',
      JWT_ACCESS_SECRET: ACCESS_SECRET,
      JWT_REFRESH_SECRET: REFRESH_SECRET,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const tokenA = token(fixture.principalA.id, fixture.schoolA.id);
  const tokenB = token(fixture.principalB.id, fixture.schoolB.id);

  try {
    await waitForApi(child);

    const exportA = await request('/backups/export', tokenA);
    assert.equal(exportA.response.status, 200, `Backup export failed: ${exportA.text}`);
    const backupA = exportA.body;
    assert.equal(backupA.format, 'nexora-school-backup');
    assert.equal(backupA.version, 1);
    assert.equal(backupA.school.id, fixture.schoolA.id);
    assert.equal(backupA.data.classes.length, 1);
    assert.equal(backupA.data.subjects.length, 1);
    assert.ok(!backupA.data.users.some((user: any) => 'passwordHash' in user), 'Backup must never export password hashes');

    const sameTenantValidation = await request('/backups/validate', tokenA, {
      method: 'POST', body: JSON.stringify(backupA),
    });
    assert.equal(sameTenantValidation.response.status, 200);
    assert.equal(sameTenantValidation.body.valid, true);
    assert.equal(sameTenantValidation.body.sameTenant, true);
    assert.equal(sameTenantValidation.body.restoreAllowed, true);

    const malformed = structuredClone(backupA);
    delete malformed.data.assignments;
    const malformedValidation = await request('/backups/validate', tokenA, {
      method: 'POST', body: JSON.stringify(malformed),
    });
    assert.equal(malformedValidation.response.status, 422, 'Missing required collection must invalidate backup');
    assert.ok(malformedValidation.body.issues.some((issue: string) => issue.includes('assignments')));

    const legacy = structuredClone(backupA);
    delete legacy.data.feeInvoices;
    const legacyValidation = await request('/backups/validate', tokenA, {
      method: 'POST', body: JSON.stringify(legacy),
    });
    assert.equal(legacyValidation.response.status, 200, 'Legacy v1 backup without feeInvoices must remain valid');
    assert.equal(legacyValidation.body.valid, true);
    assert.ok(legacyValidation.body.warnings.some((warning: string) => warning.includes('feeInvoices')));

    const exportB = await request('/backups/export', tokenB);
    assert.equal(exportB.response.status, 200);
    const crossValidate = await request('/backups/validate', tokenA, {
      method: 'POST', body: JSON.stringify(exportB.body),
    });
    assert.equal(crossValidate.response.status, 200, 'Foreign backup can be structurally valid');
    assert.equal(crossValidate.body.sameTenant, false);
    assert.equal(crossValidate.body.restoreAllowed, false);

    const crossPlan = await request('/backups/restore-plan', tokenA, {
      method: 'POST', body: JSON.stringify(exportB.body),
    });
    assert.equal(crossPlan.response.status, 403, 'Cross-tenant restore plan must be denied');

    const plan = await request('/backups/restore-plan', tokenA, {
      method: 'POST', body: JSON.stringify(backupA),
    });
    assert.equal(plan.response.status, 200, `Restore plan failed: ${JSON.stringify(plan.body)}`);
    assert.equal(plan.body.dryRun, true);
    assert.equal(plan.body.ready, true);
    assert.equal(plan.body.confirmationPhrase, `RESTORE ${fixture.schoolA.slug}`);
    assert.match(plan.body.backupFingerprint, /^[a-f0-9]{16}$/);
    verifyPlanToken(plan.body.confirmationToken, fixture.schoolA.id, backupA);

    const tampered = structuredClone(backupA);
    tampered.data.classes = [...tampered.data.classes, { id: 'tampered-record', schoolId: fixture.schoolA.id }];
    const tamperedPlan = await request('/backups/restore-plan', tokenA, {
      method: 'POST', body: JSON.stringify(tampered),
    });
    assert.equal(tamperedPlan.response.status, 200, 'Structurally valid modified backup should receive its own new plan');
    assert.notEqual(tamperedPlan.body.backupFingerprint, plan.body.backupFingerprint, 'Any backup modification must change fingerprint');
    assert.notEqual(tamperedPlan.body.confirmationToken, plan.body.confirmationToken, 'Any backup modification must invalidate prior token binding');
    verifyPlanToken(tamperedPlan.body.confirmationToken, fixture.schoolA.id, tampered);

    const auditActions = await prisma.auditLog.findMany({ where: { schoolId: fixture.schoolA.id, action: { in: ['SCHOOL_BACKUP_EXPORTED', 'SCHOOL_BACKUP_VALIDATED', 'SCHOOL_BACKUP_RESTORE_PLANNED'] } }, select: { action: true } });
    assert.ok(auditActions.some((row) => row.action === 'SCHOOL_BACKUP_EXPORTED'));
    assert.ok(auditActions.some((row) => row.action === 'SCHOOL_BACKUP_VALIDATED'));
    assert.ok(auditActions.some((row) => row.action === 'SCHOOL_BACKUP_RESTORE_PLANNED'));

    console.log('Backup validation and restore-plan integration tests passed');
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

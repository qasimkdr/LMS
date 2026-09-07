import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const load = async (path) => readFile(new URL(path, root), 'utf8');

const [auth, storage, fees, support, index, entitlements] = await Promise.all([
  load('apps/api/src/middleware/auth.ts'),
  load('apps/api/src/routes/storage.ts'),
  load('apps/api/src/routes/fees.ts'),
  load('apps/api/src/routes/support.ts'),
  load('apps/api/src/index.ts'),
  load('apps/api/src/middleware/entitlements.ts'),
]);

assert.match(auth, /impersonatedById\?:string/, 'Auth context must preserve impersonation provenance');
assert.match(storage, /async function canAccessObject/, 'Storage signing must use object-level authorization');
assert.match(storage, /canAccessObject\(req\.auth! as any,obj\)/, 'Signed URLs must enforce object ACL');
assert.match(fees, /FOR UPDATE/, 'Fee receiving must keep a row lock against concurrent over-collection');
assert.match(fees, /Payment exceeds remaining adjusted balance/, 'Fee receiving must reject overpayment');
assert.ok(support.includes('const schoolId = req.auth!.schoolId!;'), 'School support listing must derive tenant from auth');
assert.ok(support.includes('WHERE t."schoolId" = ${schoolId}'), 'School support listing must filter by authenticated school');
assert.ok(support.includes('AND "schoolId" = ${req.auth!.schoolId!}'), 'Support ticket detail/reply must remain tenant-scoped');
assert.match(support, /Internal notes are Super Admin only/, 'Support internal notes must remain Super Admin-only');
assert.match(entitlements, /MODULE_DISABLED/, 'Entitlement guard must explicitly deny disabled modules');
assert.match(entitlements, /SUBSCRIPTION_EXPIRED/, 'Entitlement guard must reject expired subscriptions');
for (const [path, module] of [
  ['/api/exams','EXAMS'],['/api/attendance','ATTENDANCE'],['/api/coursework','COURSEWORK'],['/api/reports','REPORTS'],['/api/fees','FINANCE'],['/api/timetable','TIMETABLE'],['/api/storage','STORAGE']
]) {
  assert.ok(index.includes(`app.use('${path}',requireModule('${module}')`), `${path} must retain ${module} entitlement guard`);
}

console.log('Security regression checks passed');

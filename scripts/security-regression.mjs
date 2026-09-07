import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const load = async (path) => readFile(new URL(path, root), 'utf8');

const [
  auth,
  authRoutes,
  refreshSessions,
  tokens,
  superAdmin,
  storage,
  fees,
  support,
  index,
  entitlements,
  backups,
  lifecycle,
] = await Promise.all([
  load('apps/api/src/middleware/auth.ts'),
  load('apps/api/src/routes/auth.ts'),
  load('apps/api/src/services/refreshSessions.ts'),
  load('apps/api/src/lib/tokens.ts'),
  load('apps/api/src/routes/superAdmin.ts'),
  load('apps/api/src/routes/storage.ts'),
  load('apps/api/src/routes/fees.ts'),
  load('apps/api/src/routes/support.ts'),
  load('apps/api/src/index.ts'),
  load('apps/api/src/middleware/entitlements.ts'),
  load('apps/api/src/routes/backups.ts'),
  load('apps/api/src/services/subscriptionLifecycle.ts'),
]);

assert.match(auth, /impersonatedById\?\s*:\s*string/, 'Auth context must preserve impersonation provenance');
assert.match(auth, /sessionId\?\s*:\s*string/, 'Auth context must preserve server-side session identity');
assert.match(auth, /SCHOOL_READ_ONLY/, 'Tenant middleware must enforce read-only lifecycle state');
assert.match(auth, /SCHOOL_SUSPENDED/, 'Tenant middleware must enforce suspended lifecycle state');
assert.match(auth, /supportImpersonation/, 'Support impersonation must remain explicit in lifecycle enforcement');

assert.match(tokens, /jwtid:\s*randomUUID\(\)/, 'Every refresh token must carry a unique JWT ID');
assert.match(authRoutes, /createRefreshSession/, 'Login must create a server-side refresh session');
assert.match(authRoutes, /validateRefreshSession/, 'Refresh must validate the presented token against server-side session state');
assert.match(authRoutes, /rotateRefreshSession/, 'Refresh must rotate the server-side token hash');
assert.match(authRoutes, /revokeRefreshSession/, 'Logout and invalidated users must revoke refresh sessions');
assert.match(refreshSessions, /"tokenHash"=\$\{currentHash\}/, 'Refresh rotation must compare the currently stored token hash');
assert.match(refreshSessions, /"revokedAt" IS NULL/, 'Refresh sessions must reject revoked state');
assert.match(refreshSessions, /"expiresAt">NOW\(\)/, 'Refresh sessions must reject server-side expiry');
assert.match(superAdmin, /rotateRefreshSessionFromAccess/, 'Support impersonation must rotate the existing Super Admin session');
assert.match(superAdmin, /sessionId:\s*req\.auth!\.sessionId/, 'Impersonated tokens must stay bound to the original session');

assert.match(storage, /async function canAccessObject/, 'Storage signing must use object-level authorization');
assert.match(storage, /canAccessObject\(req\.auth! as any, obj\)/, 'Signed URLs must enforce object ACL');
assert.match(storage, /async function isObjectLinked/, 'Storage deletion must be able to verify live references');
assert.match(storage, /router\.get\('\/orphans', requireRoles\('PRINCIPAL'\)/, 'Orphan scanning must remain Principal-only');
assert.match(storage, /router\.post\('\/orphans\/cleanup', requireRoles\('PRINCIPAL'\)/, 'Orphan cleanup must remain Principal-only');
assert.match(storage, /confirm: z\.literal\('DELETE_ORPHANS'\)/, 'Orphan cleanup must require explicit destructive confirmation');
assert.match(storage, /referenceTrackedCategories = \['school-logo', 'assignment', 'material', 'submission'\]/, 'Automatic cleanup must stay limited to safely traceable categories');
assert.match(storage, /const linked = await isObjectLinked\(obj\)/, 'Cleanup must re-check object references immediately before deletion');
assert.match(storage, /STORAGE_OBJECT_IN_USE/, 'Manual deletion must reject files that are still referenced');
assert.match(storage, /STORAGE_ORPHANS_CLEANED/, 'Orphan cleanup must remain audited');
assert.match(fees, /FOR UPDATE/, 'Fee receiving must keep a row lock against concurrent over-collection');
assert.match(fees, /Payment exceeds remaining adjusted balance/, 'Fee receiving must reject overpayment');
assert.ok(support.includes('const schoolId = req.auth!.schoolId!;'), 'School support listing must derive tenant from auth');
assert.ok(support.includes('WHERE t."schoolId" = ${schoolId}'), 'School support listing must filter by authenticated school');
assert.ok(support.includes('AND "schoolId" = ${req.auth!.schoolId!}'), 'Support ticket detail/reply must remain tenant-scoped');
assert.match(support, /Internal notes are Super Admin only/, 'Support internal notes must remain Super Admin-only');
assert.match(entitlements, /MODULE_DISABLED/, 'Entitlement guard must explicitly deny disabled modules');
assert.match(entitlements, /SUBSCRIPTION_EXPIRED/, 'Entitlement guard must retain an explicit expired-subscription response');

assert.match(lifecycle, /pg_try_advisory_xact_lock/, 'Lifecycle worker must use a transaction advisory lock');
assert.match(lifecycle, /SCHOOL_LIFECYCLE_AUTO_TRANSITION/, 'Automatic lifecycle changes must be audited');
assert.match(lifecycle, /SUBSCRIPTION_EXPIRY_REMINDER_/, 'Lifecycle worker must deduplicate expiry reminders');
assert.match(index, /startSubscriptionLifecycleScheduler\(\)/, 'API startup must launch the lifecycle scheduler');

assert.match(backups, /router\.post\('\/restore-plan'/, 'Backup restore must retain a dry-run planning endpoint');
assert.match(backups, /Cross-tenant restore is not allowed/, 'Backup restore planning must reject cross-tenant backups');
assert.match(backups, /createHash\('sha256'\)/, 'Restore plan must fingerprint the exact backup payload');
assert.match(backups, /createHmac\('sha256'/, 'Restore plan token must be cryptographically signed');
assert.match(backups, /schoolId, backupHash, exp/, 'Restore plan token must bind school, backup fingerprint and expiry');
assert.match(backups, /'feeInvoices'/, 'School backup collections must include historical fee invoices');
assert.match(backups, /rawCount\('FeeInvoice', schoolId\)/, 'Restore planning must count existing fee invoices');
assert.match(backups, /SELECT \* FROM "FeeInvoice" WHERE "schoolId"=\$\{schoolId\}/, 'Backup export must include fee invoice rows');
assert.match(
  backups,
  /optionalBackupCollections = new Set<BackupCollection>\(\['feeInvoices'\]\)/,
  'Legacy v1 backups must be allowed to omit feeInvoices for backward compatibility',
);
assert.match(
  backups,
  /Backup predates \$\{key\}; this collection will be treated as empty during restore planning/,
  'Legacy missing feeInvoices must generate a compatibility warning rather than a validation failure',
);
assert.match(
  index,
  /app\.use\('\/api\/backups',\s*express\.json\(\{\s*limit:\s*'20mb'\s*\}\),\s*sensitiveLimiter,\s*backupRoutes\)/,
  'Backup route must keep its scoped 20 MB parser and sensitive limiter',
);
assert.match(index, /express\.json\(\{ limit: '2mb' \}\)/, 'Normal API routes must retain the smaller JSON limit');

const routeMount = (path) => {
  const quotedPath = `'${path}'`;
  const pathIndex = index.indexOf(quotedPath);
  assert.notEqual(pathIndex, -1, `${path} route mount must exist`);
  const start = index.lastIndexOf('app.use(', pathIndex);
  assert.notEqual(start, -1, `${path} must be mounted with app.use`);
  const end = index.indexOf(');', pathIndex);
  assert.notEqual(end, -1, `${path} app.use mount must terminate`);
  return index.slice(start, end + 2);
};

for (const [path, module] of [
  ['/api/exams', 'EXAMS'],
  ['/api/attendance', 'ATTENDANCE'],
  ['/api/coursework', 'COURSEWORK'],
  ['/api/reports', 'REPORTS'],
  ['/api/fees', 'FINANCE'],
  ['/api/timetable', 'TIMETABLE'],
  ['/api/storage', 'STORAGE'],
  ['/api/support', 'SUPPORT'],
]) {
  const mount = routeMount(path);
  const authAt = mount.indexOf('requireAuth');
  const tenantAt = mount.indexOf('requireTenant');
  const moduleAt = mount.indexOf(`requireModule('${module}')`);

  assert.ok(authAt >= 0, `${path} must authenticate before feature routing`);
  assert.ok(tenantAt > authAt, `${path} must establish tenant scope after authentication`);
  assert.ok(
    moduleAt > tenantAt,
    `${path} must evaluate the ${module} entitlement after authentication and tenant scope`,
  );
}

console.log('Security regression checks passed');

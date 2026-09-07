import { createHash, createHmac } from 'node:crypto';
import { Router } from 'express';
import { Prisma, prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant, requireRoles('PRINCIPAL'));

const stringify = (value: unknown) =>
  JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), 2);

const backupCollections = [
  'users',
  'students',
  'parents',
  'classes',
  'subjects',
  'teacherAssignments',
  'approvalPolicies',
  'approvalRequests',
  'attendanceSessions',
  'exams',
  'examAttempts',
  'announcements',
  'assignments',
  'materials',
  'syllabusItems',
  'notifications',
  'academicTerms',
  'timetableEntries',
  'leaveRequests',
  'feeStructures',
  'feePayments',
  'feeBatches',
  'feeAdjustments',
  'feeInvoices',
  'schoolEvents',
  'storageObjects',
  'reportCards',
] as const;

type BackupCollection = (typeof backupCollections)[number];
const optionalBackupCollections = new Set<BackupCollection>(['feeInvoices']);

type BackupInspection = {
  valid: boolean;
  counts: Record<BackupCollection, number>;
  issues: string[];
  warnings: string[];
  sourceSchoolId: string | null;
  sourceSchoolName: string | null;
  exportedAt: string | null;
  sameTenant: boolean;
};

const inspectBackup = (backup: any, currentSchoolId: string): BackupInspection => {
  const issues: string[] = [];
  const warnings: string[] = [];
  const counts = Object.fromEntries(
    backupCollections.map((key) => [key, 0]),
  ) as Record<BackupCollection, number>;

  if (!backup || typeof backup !== 'object') {
    return {
      valid: false,
      counts,
      issues: ['Backup must be a JSON object'],
      warnings,
      sourceSchoolId: null,
      sourceSchoolName: null,
      exportedAt: null,
      sameTenant: false,
    };
  }

  if (backup.format !== 'nexora-school-backup') issues.push('Unsupported backup format');
  if (backup.version !== 1) {
    issues.push(`Unsupported backup version: ${String(backup.version ?? 'missing')}`);
  }
  if (!backup.school || typeof backup.school !== 'object') issues.push('School metadata is missing');
  if (!backup.data || typeof backup.data !== 'object') issues.push('Backup data section is missing');

  if (backup.data && typeof backup.data === 'object') {
    for (const key of backupCollections) {
      const value = backup.data[key];
      if (value === undefined) {
        if (optionalBackupCollections.has(key)) {
          warnings.push(
            `Backup predates ${key}; this collection will be treated as empty during restore planning.`,
          );
          continue;
        }
        issues.push(`Missing collection: ${key}`);
        continue;
      }
      if (!Array.isArray(value)) {
        issues.push(`Collection ${key} must be an array`);
        continue;
      }
      counts[key] = value.length;
    }
  }

  const sourceSchoolId = typeof backup.school?.id === 'string' ? backup.school.id : null;
  const sourceSchoolName = typeof backup.school?.name === 'string' ? backup.school.name : null;
  const exportedAt =
    typeof backup.exportedAt === 'string' && !Number.isNaN(Date.parse(backup.exportedAt))
      ? backup.exportedAt
      : null;
  if (!exportedAt) issues.push('Backup exportedAt is missing or invalid');

  const sameTenant = sourceSchoolId === currentSchoolId;
  if (sourceSchoolId && !sameTenant) {
    warnings.push('Backup belongs to a different school. Cross-tenant restore will not be allowed.');
  }
  if (counts.storageObjects > 0) {
    warnings.push(
      'Storage metadata is included, but file bytes are not contained in this JSON backup.',
    );
  }

  return {
    valid: issues.length === 0,
    counts,
    issues,
    warnings,
    sourceSchoolId,
    sourceSchoolName,
    exportedAt,
    sameTenant,
  };
};

const rawCount = async (table: string, schoolId: string) => {
  const allowed = new Set([
    'AcademicTerm',
    'TimetableEntry',
    'LeaveRequest',
    'FeeStructure',
    'FeePayment',
    'FeeRecoveryBatch',
    'FeeAdjustment',
    'FeeInvoice',
    'SchoolEvent',
    'StorageObject',
    'ReportCardPublication',
  ]);
  if (!allowed.has(table)) throw new Error('Unsupported backup count table');
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "${table}" WHERE "schoolId" = $1`,
    schoolId,
  );
  return Number(rows[0]?.count ?? 0);
};

const getCurrentCounts = async (schoolId: string): Promise<Record<BackupCollection, number>> => {
  const [
    users,
    students,
    parents,
    classes,
    subjects,
    teacherAssignments,
    approvalPolicies,
    approvalRequests,
    attendanceSessions,
    exams,
    examAttempts,
    announcements,
    assignments,
    materials,
    syllabusItems,
    notifications,
    academicTerms,
    timetableEntries,
    leaveRequests,
    feeStructures,
    feePayments,
    feeBatches,
    feeAdjustments,
    feeInvoices,
    schoolEvents,
    storageObjects,
    reportCards,
  ] = await Promise.all([
    prisma.user.count({ where: { schoolId } }),
    prisma.studentProfile.count({ where: { schoolId } }),
    prisma.parentProfile.count({ where: { schoolId } }),
    prisma.class.count({ where: { schoolId } }),
    prisma.subject.count({ where: { schoolId } }),
    prisma.teacherAssignment.count({ where: { schoolId } }),
    prisma.approvalPolicy.count({ where: { schoolId } }),
    prisma.approvalRequest.count({ where: { schoolId } }),
    prisma.attendanceSession.count({ where: { schoolId } }),
    prisma.exam.count({ where: { schoolId } }),
    prisma.examAttempt.count({ where: { schoolId } }),
    prisma.announcement.count({ where: { schoolId } }),
    prisma.assignment.count({ where: { schoolId } }),
    prisma.courseMaterial.count({ where: { schoolId } }),
    prisma.syllabusItem.count({ where: { schoolId } }),
    prisma.notification.count({ where: { schoolId } }),
    rawCount('AcademicTerm', schoolId),
    rawCount('TimetableEntry', schoolId),
    rawCount('LeaveRequest', schoolId),
    rawCount('FeeStructure', schoolId),
    rawCount('FeePayment', schoolId),
    rawCount('FeeRecoveryBatch', schoolId),
    rawCount('FeeAdjustment', schoolId),
    rawCount('FeeInvoice', schoolId),
    rawCount('SchoolEvent', schoolId),
    rawCount('StorageObject', schoolId),
    rawCount('ReportCardPublication', schoolId),
  ]);

  return {
    users,
    students,
    parents,
    classes,
    subjects,
    teacherAssignments,
    approvalPolicies,
    approvalRequests,
    attendanceSessions,
    exams,
    examAttempts,
    announcements,
    assignments,
    materials,
    syllabusItems,
    notifications,
    academicTerms,
    timetableEntries,
    leaveRequests,
    feeStructures,
    feePayments,
    feeBatches,
    feeAdjustments,
    feeInvoices,
    schoolEvents,
    storageObjects,
    reportCards,
  };
};

const restoreSecret = () => process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET ?? null;

const createRestorePlanToken = (schoolId: string, backupHash: string, expiresAtMs: number) => {
  const secret = restoreSecret();
  if (!secret) return null;
  const payload = Buffer.from(
    JSON.stringify({ v: 1, schoolId, backupHash, exp: expiresAtMs }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

router.get('/export', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) return res.status(404).json({ message: 'School not found' });

  const [
    users,
    classes,
    subjects,
    teacherAssignments,
    approvalPolicies,
    approvalRequests,
    attendanceSessions,
    exams,
    examAttempts,
    announcements,
    assignments,
    materials,
    syllabusItems,
    notifications,
    academicTerms,
    timetableEntries,
    leaveRequests,
    feeStructures,
    feePayments,
    feeBatches,
    feeAdjustments,
    feeInvoices,
    schoolEvents,
    storageObjects,
    reportCards,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { schoolId },
      select: {
        id: true,
        schoolId: true,
        role: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.class.findMany({ where: { schoolId } }),
    prisma.subject.findMany({ where: { schoolId } }),
    prisma.teacherAssignment.findMany({ where: { schoolId } }),
    prisma.approvalPolicy.findMany({ where: { schoolId } }),
    prisma.approvalRequest.findMany({ where: { schoolId }, include: { versions: true } }),
    prisma.attendanceSession.findMany({ where: { schoolId }, include: { records: true } }),
    prisma.exam.findMany({ where: { schoolId }, include: { questions: { include: { options: true } } } }),
    prisma.examAttempt.findMany({ where: { schoolId }, include: { answers: true } }),
    prisma.announcement.findMany({ where: { schoolId } }),
    prisma.assignment.findMany({ where: { schoolId }, include: { submissions: true } }),
    prisma.courseMaterial.findMany({ where: { schoolId } }),
    prisma.syllabusItem.findMany({ where: { schoolId } }),
    prisma.notification.findMany({ where: { schoolId } }),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "AcademicTerm" WHERE "schoolId"=${schoolId}`),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "TimetableEntry" WHERE "schoolId"=${schoolId}`),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "LeaveRequest" WHERE "schoolId"=${schoolId}`),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FeeStructure" WHERE "schoolId"=${schoolId}`),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FeePayment" WHERE "schoolId"=${schoolId}`),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FeeRecoveryBatch" WHERE "schoolId"=${schoolId}`),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FeeAdjustment" WHERE "schoolId"=${schoolId}`),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FeeInvoice" WHERE "schoolId"=${schoolId} ORDER BY month,"studentProfileId"`),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "SchoolEvent" WHERE "schoolId"=${schoolId}`),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "StorageObject" WHERE "schoolId"=${schoolId}`),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "ReportCardPublication" WHERE "schoolId"=${schoolId}`),
  ]);

  const students = await prisma.studentProfile.findMany({
    where: { schoolId },
    include: { parentLinks: true },
  });
  const parents = await prisma.parentProfile.findMany({
    where: { schoolId },
    include: { students: true },
  });

  const backup = {
    format: 'nexora-school-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    school: { ...school },
    data: {
      users,
      students,
      parents,
      classes,
      subjects,
      teacherAssignments,
      approvalPolicies,
      approvalRequests,
      attendanceSessions,
      exams,
      examAttempts,
      announcements,
      assignments,
      materials,
      syllabusItems,
      notifications,
      academicTerms,
      timetableEntries,
      leaveRequests,
      feeStructures,
      feePayments,
      feeBatches,
      feeAdjustments,
      feeInvoices,
      schoolEvents,
      storageObjects,
      reportCards,
    },
  };

  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: 'SCHOOL_BACKUP_EXPORTED',
      entityType: 'School',
      entityId: schoolId,
      afterData: {
        format: backup.format,
        version: backup.version,
        exportedAt: backup.exportedAt,
      },
    },
  });

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="nexora-${school.slug}-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  return res.send(stringify(backup));
});

router.post('/validate', async (req, res) => {
  const backup = req.body as any;
  const currentSchoolId = req.auth!.schoolId!;
  const inspection = inspectBackup(backup, currentSchoolId);
  const currentSchool = await prisma.school.findUnique({
    where: { id: currentSchoolId },
    select: { id: true, name: true, slug: true },
  });

  await prisma.auditLog.create({
    data: {
      schoolId: currentSchoolId,
      actorId: req.auth!.userId,
      action: 'SCHOOL_BACKUP_VALIDATED',
      entityType: 'School',
      entityId: currentSchoolId,
      afterData: {
        valid: inspection.valid,
        sourceSchoolId: inspection.sourceSchoolId,
        sourceSchoolName: inspection.sourceSchoolName,
        exportedAt: inspection.exportedAt,
        issueCount: inspection.issues.length,
        warningCount: inspection.warnings.length,
      },
    },
  });

  return res.status(inspection.valid ? 200 : 422).json({
    valid: inspection.valid,
    format: backup?.format ?? null,
    version: backup?.version ?? null,
    exportedAt: inspection.exportedAt,
    sourceSchool: {
      id: inspection.sourceSchoolId,
      name: inspection.sourceSchoolName,
      slug: typeof backup?.school?.slug === 'string' ? backup.school.slug : null,
    },
    currentSchool,
    sameTenant: inspection.sameTenant,
    counts: inspection.counts,
    issues: inspection.issues,
    warnings: inspection.warnings,
    restoreAllowed: inspection.valid && inspection.sameTenant,
  });
});

router.post('/restore-plan', async (req, res) => {
  const backup = req.body as any;
  const schoolId = req.auth!.schoolId!;
  const inspection = inspectBackup(backup, schoolId);

  if (!inspection.valid) {
    return res.status(422).json({
      message: 'Backup must pass validation before a restore plan can be created.',
      issues: inspection.issues,
      warnings: inspection.warnings,
    });
  }
  if (!inspection.sameTenant) {
    return res.status(403).json({
      message: 'Cross-tenant restore is not allowed.',
      sourceSchoolId: inspection.sourceSchoolId,
    });
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true, slug: true },
  });
  if (!school) return res.status(404).json({ message: 'School not found' });

  const secret = restoreSecret();
  if (!secret) {
    return res.status(503).json({
      message: 'Restore planning is unavailable until JWT_SECRET or JWT_REFRESH_SECRET is configured.',
    });
  }

  const currentCounts = await getCurrentCounts(schoolId);
  const backupHash = createHash('sha256').update(JSON.stringify(backup)).digest('hex');
  const expiresAtMs = Date.now() + 10 * 60 * 1000;
  const confirmationToken = createRestorePlanToken(schoolId, backupHash, expiresAtMs);
  if (!confirmationToken) {
    return res.status(503).json({ message: 'Restore planning secret is not configured.' });
  }

  const changes = backupCollections.map((collection) => ({
    collection,
    current: currentCounts[collection],
    backup: inspection.counts[collection],
    delta: inspection.counts[collection] - currentCounts[collection],
  }));

  const protections = [
    'Current user password hashes and authentication credentials will be preserved.',
    'School subscription, lifecycle status, quotas and SaaS plan assignment will be preserved.',
    'Audit logs are append-only and will not be replaced by a school backup.',
    'Supabase file bytes are not present in the JSON backup and cannot be recreated from metadata alone.',
    'No data is changed by this dry run. A separate confirmed restore operation is required.',
  ];
  const warnings = [
    ...inspection.warnings,
    'A future confirmed restore will be transaction-based and scoped only to this school.',
    'Keep the original backup file unchanged; the confirmation token is bound to its SHA-256 fingerprint.',
  ];

  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: 'SCHOOL_BACKUP_RESTORE_PLANNED',
      entityType: 'School',
      entityId: schoolId,
      afterData: {
        backupFingerprint: backupHash.slice(0, 16),
        exportedAt: inspection.exportedAt,
        sourceSchoolId: inspection.sourceSchoolId,
        expiresAt: new Date(expiresAtMs).toISOString(),
        collectionCount: backupCollections.length,
      },
    },
  });

  return res.json({
    dryRun: true,
    ready: true,
    school,
    backupFingerprint: backupHash.slice(0, 16),
    exportedAt: inspection.exportedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    confirmationToken,
    confirmationPhrase: `RESTORE ${school.slug}`,
    currentCounts,
    backupCounts: inspection.counts,
    changes,
    protections,
    warnings,
  });
});

export default router;
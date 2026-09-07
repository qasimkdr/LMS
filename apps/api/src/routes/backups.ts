import { Router } from 'express';
import { Prisma, prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant, requireRoles('PRINCIPAL'));

const stringify = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const backupCollections = ['users','students','parents','classes','subjects','teacherAssignments','approvalPolicies','approvalRequests','attendanceSessions','exams','examAttempts','announcements','assignments','materials','syllabusItems','notifications','academicTerms','timetableEntries','leaveRequests','feeStructures','feePayments','feeBatches','feeAdjustments','schoolEvents','storageObjects','reportCards'] as const;

router.get('/export', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) return res.status(404).json({ message: 'School not found' });

  const [users,classes,subjects,teacherAssignments,approvalPolicies,approvalRequests,attendanceSessions,exams,examAttempts,announcements,assignments,materials,syllabusItems,notifications,academicTerms,timetableEntries,leaveRequests,feeStructures,feePayments,feeBatches,feeAdjustments,schoolEvents,storageObjects,reportCards] = await Promise.all([
    prisma.user.findMany({ where: { schoolId }, select: { id:true,schoolId:true,role:true,email:true,username:true,firstName:true,lastName:true,avatarUrl:true,isActive:true,lastLoginAt:true,createdAt:true,updatedAt:true } }),
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
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "SchoolEvent" WHERE "schoolId"=${schoolId}`),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "StorageObject" WHERE "schoolId"=${schoolId}`),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "ReportCardPublication" WHERE "schoolId"=${schoolId}`),
  ]);
  const students = await prisma.studentProfile.findMany({ where: { schoolId }, include: { parentLinks: true } });
  const parents = await prisma.parentProfile.findMany({ where: { schoolId }, include: { students: true } });
  const backup = { format:'nexora-school-backup', version:1, exportedAt:new Date().toISOString(), school:{...school}, data:{users,students,parents,classes,subjects,teacherAssignments,approvalPolicies,approvalRequests,attendanceSessions,exams,examAttempts,announcements,assignments,materials,syllabusItems,notifications,academicTerms,timetableEntries,leaveRequests,feeStructures,feePayments,feeBatches,feeAdjustments,schoolEvents,storageObjects,reportCards} };
  await prisma.auditLog.create({ data:{ schoolId,actorId:req.auth!.userId,action:'SCHOOL_BACKUP_EXPORTED',entityType:'School',entityId:schoolId,afterData:{format:backup.format,version:backup.version,exportedAt:backup.exportedAt} } });
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="nexora-${school.slug}-${new Date().toISOString().slice(0,10)}.json"`);
  return res.send(stringify(backup));
});

router.post('/validate', async (req, res) => {
  const backup = req.body as any;
  const issues:string[] = [];
  if (!backup || typeof backup !== 'object') return res.status(400).json({ valid:false, issues:['Backup must be a JSON object'] });
  if (backup.format !== 'nexora-school-backup') issues.push('Unsupported backup format');
  if (backup.version !== 1) issues.push(`Unsupported backup version: ${String(backup.version ?? 'missing')}`);
  if (!backup.school || typeof backup.school !== 'object') issues.push('School metadata is missing');
  if (!backup.data || typeof backup.data !== 'object') issues.push('Backup data section is missing');
  const counts:Record<string,number> = {};
  if (backup.data && typeof backup.data === 'object') {
    for (const key of backupCollections) {
      const value = backup.data[key];
      if (value === undefined) { issues.push(`Missing collection: ${key}`); counts[key]=0; continue; }
      if (!Array.isArray(value)) { issues.push(`Collection ${key} must be an array`); counts[key]=0; continue; }
      counts[key]=value.length;
    }
  }
  const sourceSchoolId = typeof backup.school?.id === 'string' ? backup.school.id : null;
  const sourceSchoolName = typeof backup.school?.name === 'string' ? backup.school.name : null;
  const exportedAt = typeof backup.exportedAt === 'string' && !Number.isNaN(Date.parse(backup.exportedAt)) ? backup.exportedAt : null;
  if (!exportedAt) issues.push('Backup exportedAt is missing or invalid');
  const currentSchoolId = req.auth!.schoolId!;
  const sameTenant = sourceSchoolId === currentSchoolId;
  const warnings:string[] = [];
  if (sourceSchoolId && !sameTenant) warnings.push('Backup belongs to a different school. Cross-tenant restore will not be allowed.');
  if ((counts.storageObjects ?? 0) > 0) warnings.push('Storage metadata is included, but file bytes are not contained in this JSON backup.');
  const valid = issues.length === 0;
  await prisma.auditLog.create({ data:{ schoolId:currentSchoolId,actorId:req.auth!.userId,action:'SCHOOL_BACKUP_VALIDATED',entityType:'School',entityId:currentSchoolId,afterData:{valid,sourceSchoolId,sourceSchoolName,exportedAt,issueCount:issues.length,warningCount:warnings.length} } });
  return res.status(valid ? 200 : 422).json({ valid, format:backup.format ?? null, version:backup.version ?? null, exportedAt, sourceSchool:{id:sourceSchoolId,name:sourceSchoolName}, sameTenant, counts, issues, warnings, restoreAllowed:valid && sameTenant });
});

export default router;

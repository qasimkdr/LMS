import { Router } from 'express';
import { Prisma, prisma } from '@nexora/database';
import { z } from 'zod';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant, requireRoles('PRINCIPAL', 'STAFF', 'TEACHER'));

router.get('/class/:classId', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const classId = Array.isArray(req.params.classId) ? req.params.classId[0] : req.params.classId;
  const klass = await prisma.class.findFirst({ where: { id: classId, schoolId } });
  if (!klass) return res.status(404).json({ message: 'Class not found' });
  if (req.auth!.role === 'TEACHER') {
    const assigned = await prisma.teacherAssignment.findFirst({
      where: { schoolId, teacherId: req.auth!.userId, classId: klass.id },
    });
    if (!assigned) return res.status(403).json({ message: 'You are not assigned to this class' });
  }
  const students = await prisma.studentProfile.findMany({
    where: { schoolId, classId: klass.id },
    orderBy: { admissionNo: 'asc' },
    include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
  });
  res.json({ class: klass, students });
});

const markSchema = z.object({
  classId: z.string().uuid(),
  date: z.coerce.date(),
  records: z.array(z.object({
    studentProfileId: z.string().uuid(),
    status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'LEAVE']),
    remark: z.string().max(300).optional(),
  })).min(1),
});

async function validateScope(
  schoolId: string,
  userId: string,
  role: string,
  classId: string,
  profileIds: string[],
) {
  const klass = await prisma.class.findFirst({ where: { id: classId, schoolId } });
  if (!klass) return { error: 'Class not found', status: 404 } as const;
  if (
    role === 'TEACHER' &&
    !await prisma.teacherAssignment.findFirst({ where: { schoolId, teacherId: userId, classId } })
  ) {
    return { error: 'You are not assigned to this class', status: 403 } as const;
  }
  const count = await prisma.studentProfile.count({
    where: { schoolId, classId, id: { in: profileIds } },
  });
  if (count !== profileIds.length) {
    return { error: 'One or more students are not in this class', status: 400 } as const;
  }
  return { klass } as const;
}

async function approvedLeaveProfileIds(schoolId: string, profileIds: string[], day: Date) {
  if (!profileIds.length) return new Set<string>();
  const dayStart = new Date(day);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setUTCHours(23, 59, 59, 999);
  const rows = await prisma.$queryRaw<Array<{ studentProfileId: string }>>(Prisma.sql`
    SELECT sp.id AS "studentProfileId"
    FROM "StudentProfile" sp
    JOIN "LeaveRequest" l ON l."userId" = sp."userId"
    WHERE sp."schoolId" = ${schoolId}
      AND l."schoolId" = ${schoolId}
      AND sp.id IN (${Prisma.join(profileIds)})
      AND l.status = 'APPROVED'
      AND l."fromDate" <= ${dayEnd}
      AND l."toDate" >= ${dayStart}
  `);
  return new Set(rows.map((row) => row.studentProfileId));
}

router.get('/session', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const classId = typeof req.query.classId === 'string' ? req.query.classId : '';
  const date = typeof req.query.date === 'string' ? new Date(req.query.date) : null;
  if (!classId || !date || Number.isNaN(date.getTime())) {
    return res.status(400).json({ message: 'classId and valid date are required' });
  }
  date.setUTCHours(0, 0, 0, 0);
  const session = await prisma.attendanceSession.findFirst({
    where: { schoolId, classId, date },
    include: { records: true },
  });
  res.json(session);
});

router.post('/mark', async (req, res) => {
  const parsed = markSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid attendance payload', issues: parsed.error.flatten() });
  }

  const schoolId = req.auth!.schoolId!;
  const day = new Date(parsed.data.date);
  day.setUTCHours(0, 0, 0, 0);
  const profileIds = parsed.data.records.map((record) => record.studentProfileId);
  if (new Set(profileIds).size !== profileIds.length) {
    return res.status(400).json({ message: 'Duplicate students in attendance payload' });
  }

  const scope = await validateScope(
    schoolId,
    req.auth!.userId,
    req.auth!.role,
    parsed.data.classId,
    profileIds,
  );
  if ('error' in scope) {
    return res.status(scope.status ?? 400).json({ message: scope.error });
  }

  const approvedLeave = await approvedLeaveProfileIds(schoolId, profileIds, day);
  const effectiveRecords = parsed.data.records.map((record) =>
    approvedLeave.has(record.studentProfileId)
      ? { ...record, status: 'LEAVE' as const, remark: 'Approved leave' }
      : record,
  );

  const existing = await prisma.attendanceSession.findUnique({
    where: { schoolId_classId_date: { schoolId, classId: parsed.data.classId, date: day } },
    include: { records: true },
  });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const isOld = day < today;

  if (existing && isOld && req.auth!.role !== 'PRINCIPAL') {
    const policy = await prisma.approvalPolicy.findUnique({
      where: { schoolId_actionKey: { schoolId, actionKey: 'EDIT_OLD_ATTENDANCE' } },
    });
    if (policy?.staffAllowed === false && req.auth!.role === 'STAFF') {
      return res.status(403).json({ message: 'Staff attendance corrections are disabled by Principal' });
    }
    if (policy?.requiresApproval !== false) {
      const proposedData = {
        classId: parsed.data.classId,
        date: day.toISOString(),
        records: effectiveRecords,
      };
      const request = await prisma.$transaction(async (tx) => {
        const approval = await tx.approvalRequest.create({
          data: {
            schoolId,
            requesterId: req.auth!.userId,
            requestType: 'ATTENDANCE_CORRECTION',
            entityType: 'AttendanceSession',
            entityId: existing.id,
            proposedData,
            status: 'PENDING',
            submittedAt: new Date(),
          },
        });
        await tx.approvalVersion.create({
          data: { approvalRequestId: approval.id, revision: 1, proposedData },
        });
        await tx.auditLog.create({
          data: {
            schoolId,
            actorId: req.auth!.userId,
            action: 'ATTENDANCE_CORRECTION_SUBMITTED',
            entityType: 'ApprovalRequest',
            entityId: approval.id,
            afterData: proposedData,
          },
        });
        return approval;
      });
      return res.status(202).json({
        approvalRequired: true,
        requestId: request.id,
        status: request.status,
      });
    }
  }

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.attendanceSession.upsert({
      where: { schoolId_classId_date: { schoolId, classId: parsed.data.classId, date: day } },
      create: { schoolId, classId: parsed.data.classId, date: day, markedById: req.auth!.userId },
      update: { markedById: req.auth!.userId },
    });

    for (const record of effectiveRecords) {
      await tx.attendanceRecord.upsert({
        where: {
          attendanceId_studentProfileId: {
            attendanceId: created.id,
            studentProfileId: record.studentProfileId,
          },
        },
        create: {
          attendanceId: created.id,
          studentProfileId: record.studentProfileId,
          status: record.status,
          remark: record.remark,
        },
        update: { status: record.status, remark: record.remark },
      });
    }

    await tx.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: existing ? 'ATTENDANCE_UPDATED' : 'ATTENDANCE_MARKED',
        entityType: 'AttendanceSession',
        entityId: created.id,
        afterData: {
          classId: parsed.data.classId,
          date: day.toISOString(),
          recordCount: effectiveRecords.length,
          approvedLeaveCount: approvedLeave.size,
        },
      },
    });
    return created;
  });

  res.status(existing ? 200 : 201).json(session);
});

router.get('/summary', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 180);
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - days);
  const grouped = await prisma.attendanceRecord.groupBy({
    by: ['status'],
    where: { attendance: { schoolId, date: { gte: from } } },
    _count: { _all: true },
  });
  const total = grouped.reduce((sum, group) => sum + group._count._all, 0);
  const counts = Object.fromEntries(grouped.map((group) => [group.status, group._count._all]));
  const presentLike = (counts.PRESENT ?? 0) + (counts.LATE ?? 0);
  res.json({
    total,
    present: counts.PRESENT ?? 0,
    absent: counts.ABSENT ?? 0,
    late: counts.LATE ?? 0,
    leave: counts.LEAVE ?? 0,
    attendanceRate: total ? Number((presentLike / total * 100).toFixed(1)) : 0,
  });
});

export default router;

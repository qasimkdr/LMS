import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant, requireRoles('PRINCIPAL', 'STAFF', 'TEACHER'));

router.get('/class/:classId', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const klass = await prisma.class.findFirst({ where: { id: req.params.classId, schoolId } });
  if (!klass) return res.status(404).json({ message: 'Class not found' });

  if (req.auth!.role === 'TEACHER') {
    const assigned = await prisma.teacherAssignment.findFirst({ where: { schoolId, teacherId: req.auth!.userId, classId: klass.id } });
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
  records: z.array(z.object({ studentProfileId: z.string().uuid(), status: z.enum(['PRESENT','ABSENT','LATE','LEAVE']), remark: z.string().max(300).optional() })).min(1),
});

router.post('/mark', async (req, res) => {
  const parsed = markSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid attendance payload', issues: parsed.error.flatten() });
  const schoolId = req.auth!.schoolId!;
  const day = new Date(parsed.data.date);
  day.setUTCHours(0, 0, 0, 0);

  const klass = await prisma.class.findFirst({ where: { id: parsed.data.classId, schoolId } });
  if (!klass) return res.status(404).json({ message: 'Class not found' });

  if (req.auth!.role === 'TEACHER') {
    const assigned = await prisma.teacherAssignment.findFirst({ where: { schoolId, teacherId: req.auth!.userId, classId: klass.id } });
    if (!assigned) return res.status(403).json({ message: 'You are not assigned to this class' });
  }

  const profileIds = parsed.data.records.map((r) => r.studentProfileId);
  if (new Set(profileIds).size !== profileIds.length) return res.status(400).json({ message: 'Duplicate students in attendance payload' });
  const count = await prisma.studentProfile.count({ where: { schoolId, classId: klass.id, id: { in: profileIds } } });
  if (count !== profileIds.length) return res.status(400).json({ message: 'One or more students are not in this class' });

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.attendanceSession.upsert({
      where: { schoolId_classId_date: { schoolId, classId: klass.id, date: day } },
      create: { schoolId, classId: klass.id, date: day, markedById: req.auth!.userId },
      update: { markedById: req.auth!.userId },
    });

    for (const record of parsed.data.records) {
      await tx.attendanceRecord.upsert({
        where: { attendanceId_studentProfileId: { attendanceId: created.id, studentProfileId: record.studentProfileId } },
        create: { attendanceId: created.id, studentProfileId: record.studentProfileId, status: record.status, remark: record.remark },
        update: { status: record.status, remark: record.remark },
      });
    }

    await tx.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: 'ATTENDANCE_MARKED',
        entityType: 'AttendanceSession',
        entityId: created.id,
        afterData: { classId: klass.id, date: day.toISOString(), recordCount: parsed.data.records.length },
      },
    });
    return created;
  });

  res.status(201).json(session);
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
  const total = grouped.reduce((sum, g) => sum + g._count._all, 0);
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  const presentLike = (counts.PRESENT ?? 0) + (counts.LATE ?? 0);
  res.json({
    total,
    present: counts.PRESENT ?? 0,
    absent: counts.ABSENT ?? 0,
    late: counts.LATE ?? 0,
    leave: counts.LEAVE ?? 0,
    attendanceRate: total ? Number(((presentLike / total) * 100).toFixed(1)) : 0,
  });
});

export default router;

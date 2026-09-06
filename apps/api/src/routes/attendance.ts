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
  note: z.string().max(500).optional(),
  records: z.array(z.object({ studentId: z.string().uuid(), status: z.enum(['PRESENT','ABSENT','LATE','LEAVE']), remark: z.string().max(300).optional() })).min(1),
});

router.post('/mark', async (req, res) => {
  const parsed = markSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid attendance payload', issues: parsed.error.flatten() });
  const schoolId = req.auth!.schoolId!;
  const day = new Date(parsed.data.date); day.setUTCHours(0,0,0,0);

  const klass = await prisma.class.findFirst({ where: { id: parsed.data.classId, schoolId } });
  if (!klass) return res.status(404).json({ message: 'Class not found' });

  if (req.auth!.role === 'TEACHER') {
    const assigned = await prisma.teacherAssignment.findFirst({ where: { schoolId, teacherId: req.auth!.userId, classId: klass.id } });
    if (!assigned) return res.status(403).json({ message: 'You are not assigned to this class' });
  }

  const studentIds = parsed.data.records.map((r) => r.studentId);
  const count = await prisma.studentProfile.count({ where: { schoolId, classId: klass.id, userId: { in: studentIds } } });
  if (count !== new Set(studentIds).size) return res.status(400).json({ message: 'One or more students are not in this class' });

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.attendanceSession.upsert({
      where: { schoolId_classId_date: { schoolId, classId: klass.id, date: day } },
      create: { schoolId, classId: klass.id, date: day, markedById: req.auth!.userId, note: parsed.data.note },
      update: { markedById: req.auth!.userId, note: parsed.data.note },
    });
    for (const record of parsed.data.records) {
      await tx.attendanceRecord.upsert({
        where: { sessionId_studentId: { sessionId: created.id, studentId: record.studentId } },
        create: { schoolId, sessionId: created.id, studentId: record.studentId, status: record.status, remark: record.remark },
        update: { status: record.status, remark: record.remark },
      });
    }
    await tx.auditLog.create({ data: { schoolId, actorId: req.auth!.userId, action: 'ATTENDANCE_MARKED', entityType: 'AttendanceSession', entityId: created.id, afterData: { classId: klass.id, date: day.toISOString(), recordCount: parsed.data.records.length } } });
    return created;
  });

  res.status(201).json(session);
});

router.get('/summary', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const days = Number(req.query.days ?? 30);
  const from = new Date(); from.setDate(from.getDate() - Math.min(Math.max(days, 1), 180));
  const grouped = await prisma.attendanceRecord.groupBy({
    by: ['status'], where: { schoolId, createdAt: { gte: from } }, _count: { _all: true },
  });
  const total = grouped.reduce((sum, g) => sum + g._count._all, 0);
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  const presentLike = (counts.PRESENT ?? 0) + (counts.LATE ?? 0);
  res.json({ total, present: counts.PRESENT ?? 0, absent: counts.ABSENT ?? 0, late: counts.LATE ?? 0, leave: counts.LEAVE ?? 0, attendanceRate: total ? Number(((presentLike / total) * 100).toFixed(1)) : 0 });
});

export default router;

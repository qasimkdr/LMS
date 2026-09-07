import { Router } from 'express';
import { Prisma, prisma } from '@nexora/database';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';
import { routeParam } from '../utils/http.js';

const router = Router();
router.use(requireAuth, requireTenant);

const monthRe = /^\d{4}-\d{2}$/;
const adjustmentSchema = z.object({
  studentProfileId: z.string().uuid(),
  month: z.string().regex(monthRe),
  type: z.enum(['DISCOUNT', 'SCHOLARSHIP', 'FINE', 'WAIVER']),
  amount: z.coerce.number().positive(),
  reason: z.string().max(500).optional(),
});

type Balance = {
  month: string;
  baseFee: number;
  discount: number;
  manualFine: number;
  autoFine: number;
  expected: number;
  paid: number;
  balance: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  dueDay: number;
  graceDays: number;
  dueDate: Date;
  overdue: boolean;
};

function deadline(month: string, dueDay: number, graceDays: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, dueDay + graceDays, 23, 59, 59, 999));
}

async function calculateBalance(schoolId: string, student: { id: string; classId: string | null }, month: string): Promise<Balance> {
  const [structureRows, payments, adjustments] = await Promise.all([
    student.classId
      ? prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FeeStructure" WHERE "schoolId"=${schoolId} AND "classId"=${student.classId} LIMIT 1`)
      : Promise.resolve([]),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT amount, "paidAt", "approvalStatus"
      FROM "FeePayment"
      WHERE "schoolId"=${schoolId}
        AND "studentProfileId"=${student.id}
        AND month=${month}
        AND "approvalStatus"<>'REJECTED'
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT type, COALESCE(SUM(amount),0) AS total
      FROM "FeeAdjustment"
      WHERE "schoolId"=${schoolId}
        AND "studentProfileId"=${student.id}
        AND month=${month}
      GROUP BY type
    `),
  ]);

  const structure = structureRows[0];
  const baseFee = Number(structure?.monthlyAmount ?? 0);
  const dueDay = Number(structure?.dueDay ?? 10);
  const graceDays = Number(structure?.lateFineGraceDays ?? 0);
  const lateFineAmount = Number(structure?.lateFineAmount ?? 0);
  const grouped = new Map(adjustments.map((row) => [row.type, Number(row.total)]));
  const discount = (grouped.get('DISCOUNT') ?? 0) + (grouped.get('SCHOLARSHIP') ?? 0) + (grouped.get('WAIVER') ?? 0);
  const manualFine = grouped.get('FINE') ?? 0;
  const adjustedBeforeLateFine = Math.max(0, baseFee - discount + manualFine);
  const dueDate = deadline(month, dueDay, graceDays);
  const paidBeforeDeadline = payments
    .filter((payment) => new Date(payment.paidAt) <= dueDate)
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const autoFine = new Date() > dueDate && paidBeforeDeadline < adjustedBeforeLateFine ? lateFineAmount : 0;
  const expected = Math.max(0, adjustedBeforeLateFine + autoFine);
  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const balance = Math.max(0, expected - paid);

  return {
    month,
    baseFee,
    discount,
    manualFine,
    autoFine,
    expected,
    paid,
    balance,
    status: paid <= 0 ? 'UNPAID' : paid < expected ? 'PARTIAL' : 'PAID',
    dueDay,
    graceDays,
    dueDate,
    overdue: new Date() > dueDate && balance > 0,
  };
}

router.post('/adjustments', requireRoles('PRINCIPAL'), async (req, res) => {
  const parsed = adjustmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid fee adjustment', issues: parsed.error.issues });
  const schoolId = req.auth!.schoolId!;
  const data = parsed.data;
  const student = await prisma.studentProfile.findFirst({ where: { id: data.studentProfileId, schoolId } });
  if (!student) return res.status(404).json({ message: 'Student not found' });

  const id = randomUUID();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "FeeAdjustment" (id,"schoolId","studentProfileId","month",type,amount,reason,"createdById")
    VALUES (${id},${schoolId},${data.studentProfileId},${data.month},${data.type},${data.amount},${data.reason ?? null},${req.auth!.userId})
  `);
  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: 'FEE_ADJUSTMENT_CREATED',
      entityType: 'FeeAdjustment',
      entityId: id,
      afterData: { ...data } as any,
    },
  });
  res.status(201).json({ id, ...data });
});

router.get('/adjustments/:studentProfileId', requireRoles('PRINCIPAL', 'STAFF', 'STUDENT', 'PARENT'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const studentProfileId = routeParam(req.params.studentProfileId);
  const student = await prisma.studentProfile.findFirst({ where: { id: studentProfileId, schoolId } });
  if (!student) return res.status(404).json({ message: 'Student not found' });
  if (req.auth!.role === 'STUDENT' && student.userId !== req.auth!.userId) return res.status(403).json({ message: 'Forbidden' });
  if (req.auth!.role === 'PARENT') {
    const parent = await prisma.parentProfile.findFirst({ where: { schoolId, userId: req.auth!.userId } });
    const link = parent ? await prisma.studentParent.findFirst({ where: { parentId: parent.id, studentId: student.id } }) : null;
    if (!link) return res.status(403).json({ message: 'Forbidden' });
  }

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT fa.*, u."firstName", u."lastName"
    FROM "FeeAdjustment" fa
    JOIN "User" u ON u.id=fa."createdById"
    WHERE fa."schoolId"=${schoolId} AND fa."studentProfileId"=${student.id}
    ORDER BY fa."month" DESC, fa."createdAt" DESC
  `);
  res.json(rows.map((row) => ({ ...row, amount: Number(row.amount), createdBy: `${row.firstName} ${row.lastName}` })));
});

router.patch('/structure/:classId/settings', requireRoles('PRINCIPAL'), async (req, res) => {
  const schema = z.object({
    dueDay: z.coerce.number().int().min(1).max(28),
    lateFineAmount: z.coerce.number().min(0),
    lateFineGraceDays: z.coerce.number().int().min(0).max(30),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid fee settings' });

  const schoolId = req.auth!.schoolId!;
  const classId = routeParam(req.params.classId);
  const klass = await prisma.class.findFirst({ where: { id: classId, schoolId } });
  if (!klass) return res.status(404).json({ message: 'Class not found' });

  const changed = await prisma.$executeRaw(Prisma.sql`
    UPDATE "FeeStructure"
    SET "dueDay"=${parsed.data.dueDay},
        "lateFineAmount"=${parsed.data.lateFineAmount},
        "lateFineGraceDays"=${parsed.data.lateFineGraceDays},
        "updatedAt"=NOW()
    WHERE "schoolId"=${schoolId} AND "classId"=${classId}
  `);
  if (!changed) return res.status(404).json({ message: 'Fee structure is not configured for this class' });

  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: 'FEE_STRUCTURE_SETTINGS_UPDATED',
      entityType: 'FeeStructure',
      entityId: classId,
      afterData: parsed.data,
    },
  });
  res.json({ ok: true, ...parsed.data });
});

router.get('/student-balance/:studentProfileId', requireRoles('PRINCIPAL', 'STAFF', 'STUDENT', 'PARENT'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const studentProfileId = routeParam(req.params.studentProfileId);
  const month = typeof req.query.month === 'string' && monthRe.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const student = await prisma.studentProfile.findFirst({ where: { id: studentProfileId, schoolId } });
  if (!student) return res.status(404).json({ message: 'Student not found' });
  if (req.auth!.role === 'STUDENT' && student.userId !== req.auth!.userId) return res.status(403).json({ message: 'Forbidden' });
  if (req.auth!.role === 'PARENT') {
    const parent = await prisma.parentProfile.findFirst({ where: { schoolId, userId: req.auth!.userId } });
    const link = parent ? await prisma.studentParent.findFirst({ where: { parentId: parent.id, studentId: student.id } }) : null;
    if (!link) return res.status(403).json({ message: 'Forbidden' });
  }

  res.json(await calculateBalance(schoolId, student, month));
});

router.post('/send-overdue-notifications', requireRoles('PRINCIPAL'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const month = typeof req.body?.month === 'string' && monthRe.test(req.body.month) ? req.body.month : new Date().toISOString().slice(0, 7);
  const students = await prisma.studentProfile.findMany({
    where: { schoolId, classId: { not: null } },
    include: { user: true, parentLinks: { include: { parent: { include: { user: true } } } } },
  });

  let sent = 0;
  let overdueStudents = 0;
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  for (const student of students) {
    const balance = await calculateBalance(schoolId, student, month);
    if (!balance.overdue || balance.balance <= 0) continue;
    overdueStudents++;

    const title = 'Fee payment reminder';
    const body = `Fee for ${month} is overdue for ${student.user.firstName} ${student.user.lastName}. Remaining balance: PKR ${Math.round(balance.balance).toLocaleString('en-PK')}.`;
    const recipients = [student.user, ...student.parentLinks.map((link) => link.parent.user)];

    for (const user of recipients) {
      const link = user.role === 'PARENT' ? `/parent/fees?studentProfileId=${student.id}` : '/student/fees';
      const duplicate = await prisma.notification.findFirst({
        where: { schoolId, userId: user.id, title, body, link, createdAt: { gte: dayStart } },
        select: { id: true },
      });
      if (duplicate) continue;
      await prisma.notification.create({ data: { schoolId, userId: user.id, title, body, link } });
      sent++;
    }
  }

  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: 'OVERDUE_FEE_NOTIFICATIONS_SENT',
      entityType: 'FeeNotificationBatch',
      afterData: { month, overdueStudents, notificationsSent: sent },
    },
  });

  res.json({ ok: true, month, overdueStudents, notificationsSent: sent });
});

export default router;

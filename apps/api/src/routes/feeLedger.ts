import { Router } from 'express';
import { Prisma, prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant);

const monthPattern = /^\d{4}-\d{2}$/;

function monthsBack(count: number) {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

function deadlineFor(month: string, dueDay: number, graceDays: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, dueDay + graceDays, 23, 59, 59, 999));
}

async function authorizedStudent(req: any, requested?: string) {
  const schoolId = req.auth.schoolId as string;
  if (req.auth.role === 'STUDENT') return prisma.studentProfile.findFirst({ where: { schoolId, userId: req.auth.userId } });
  if (req.auth.role === 'PARENT') {
    if (!requested) return null;
    const parent = await prisma.parentProfile.findFirst({ where: { schoolId, userId: req.auth.userId } });
    if (!parent) return null;
    const link = await prisma.studentParent.findFirst({ where: { parentId: parent.id, studentId: requested } });
    if (!link) return null;
    return prisma.studentProfile.findFirst({ where: { schoolId, id: requested } });
  }
  if (!requested) return null;
  return prisma.studentProfile.findFirst({ where: { schoolId, id: requested } });
}

router.get('/ledger', requireRoles('PRINCIPAL', 'STAFF', 'STUDENT', 'PARENT'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const requested = typeof req.query.studentProfileId === 'string' ? req.query.studentProfileId : undefined;
  const student = await authorizedStudent(req, requested);
  if (!student) return res.status(req.auth!.role === 'PARENT' ? 403 : 404).json({ message: 'Student not found or not accessible' });

  const months = Math.min(36, Math.max(1, Number(req.query.months ?? 12)));
  const list = monthsBack(months);
  const [profile, structureRows, payments, adjustments] = await Promise.all([
    prisma.studentProfile.findFirst({
      where: { id: student.id, schoolId },
      include: { user: { select: { firstName: true, lastName: true } }, class: true },
    }),
    student.classId
      ? prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FeeStructure" WHERE "schoolId"=${schoolId} AND "classId"=${student.classId} LIMIT 1`)
      : Promise.resolve([]),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT fp.*, mb."firstName" AS "markerFirstName", mb."lastName" AS "markerLastName",
             ab."firstName" AS "approverFirstName", ab."lastName" AS "approverLastName"
      FROM "FeePayment" fp
      JOIN "User" mb ON mb.id=fp."markedById"
      LEFT JOIN "User" ab ON ab.id=fp."approvedById"
      WHERE fp."schoolId"=${schoolId}
        AND fp."studentProfileId"=${student.id}
        AND fp."month" IN (${Prisma.join(list)})
      ORDER BY fp."month" DESC, fp."paidAt" DESC
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT "month", type, COALESCE(SUM(amount),0) AS total
      FROM "FeeAdjustment"
      WHERE "schoolId"=${schoolId}
        AND "studentProfileId"=${student.id}
        AND "month" IN (${Prisma.join(list)})
      GROUP BY "month", type
    `),
  ]);

  if (!profile) return res.status(404).json({ message: 'Student profile not found' });

  const structure = structureRows[0];
  const monthlyFee = Number(structure?.monthlyAmount ?? 0);
  const dueDay = Number(structure?.dueDay ?? 10);
  const lateFineAmount = Number(structure?.lateFineAmount ?? 0);
  const lateFineGraceDays = Number(structure?.lateFineGraceDays ?? 0);

  const paymentsByMonth = new Map<string, any[]>();
  for (const payment of payments) {
    const current = paymentsByMonth.get(payment.month) ?? [];
    current.push(payment);
    paymentsByMonth.set(payment.month, current);
  }

  const adjustmentsByMonth = new Map<string, Record<string, number>>();
  for (const adjustment of adjustments) {
    const current = adjustmentsByMonth.get(adjustment.month) ?? {};
    current[adjustment.type] = Number(adjustment.total ?? 0);
    adjustmentsByMonth.set(adjustment.month, current);
  }

  const now = new Date();
  const ledger = list.map((month) => {
    const monthPayments = paymentsByMonth.get(month) ?? [];
    const validPayments = monthPayments.filter((p) => p.approvalStatus !== 'REJECTED');
    const approvedPayments = validPayments.filter((p) => p.approvalStatus === 'APPROVED');
    const pendingPayments = validPayments.filter((p) => p.approvalStatus === 'PENDING');
    const monthAdjustments = adjustmentsByMonth.get(month) ?? {};

    const discount = Number(monthAdjustments.DISCOUNT ?? 0) + Number(monthAdjustments.SCHOLARSHIP ?? 0) + Number(monthAdjustments.WAIVER ?? 0);
    const manualFine = Number(monthAdjustments.FINE ?? 0);
    const deadline = deadlineFor(month, dueDay, lateFineGraceDays);
    const baseAdjusted = Math.max(0, monthlyFee - discount + manualFine);
    const paidBeforeDeadline = validPayments
      .filter((p) => new Date(p.paidAt) <= deadline)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const autoFine = now > deadline && paidBeforeDeadline < baseAdjusted ? lateFineAmount : 0;
    const expected = Math.max(0, baseAdjusted + autoFine);
    const paid = validPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    const approved = approvedPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    const pending = pendingPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    const balance = Math.max(0, expected - paid);

    let status = 'UNPAID';
    if (expected === 0) status = 'PAID';
    else if (paid >= expected && pending > 0) status = 'PENDING_HANDOVER';
    else if (paid >= expected) status = 'PAID';
    else if (paid > 0 && pending > 0) status = 'PARTIAL_PENDING';
    else if (paid > 0) status = 'PARTIAL';

    return {
      month,
      baseFee: monthlyFee,
      discount,
      manualFine,
      autoFine,
      expected,
      paid,
      approved,
      pending,
      balance,
      dueDate: deadline.toISOString(),
      overdue: now > deadline && balance > 0,
      status,
      payments: monthPayments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        method: p.method,
        reference: p.reference,
        paidAt: p.paidAt,
        approvalStatus: p.approvalStatus,
        receivedBy: `${p.markerFirstName} ${p.markerLastName}`,
        approvedBy: p.approverFirstName ? `${p.approverFirstName} ${p.approverLastName}` : null,
        approvedAt: p.approvedAt,
      })),
    };
  });

  const expected = ledger.reduce((sum, row) => sum + row.expected, 0);
  const received = ledger.reduce((sum, row) => sum + row.paid, 0);
  const approved = ledger.reduce((sum, row) => sum + row.approved, 0);
  const outstanding = ledger.reduce((sum, row) => sum + row.balance, 0);

  res.json({
    student: {
      studentProfileId: profile.id,
      name: `${profile.user.firstName} ${profile.user.lastName}`,
      admissionNo: profile.admissionNo,
      className: profile.class ? `${profile.class.name}${profile.class.section ? ` - ${profile.class.section}` : ''}` : 'No class',
    },
    feeSettings: { monthlyFee, dueDay, lateFineAmount, lateFineGraceDays },
    monthlyFee,
    summary: {
      expected,
      received,
      approved,
      outstanding,
      unpaidMonths: ledger.filter((row) => row.balance > 0).length,
    },
    ledger,
  });
});

router.get('/receipt/:paymentId', requireRoles('PRINCIPAL', 'STAFF', 'STUDENT', 'PARENT'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const paymentId = Array.isArray(req.params.paymentId) ? req.params.paymentId[0] : req.params.paymentId;
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT fp.*, sp.id AS "profileId", sp."userId", sp."admissionNo", u."firstName", u."lastName",
           c.name AS "className", c.section, s.name AS "schoolName", s.address AS "schoolAddress", s.phone AS "schoolPhone",
           mb."firstName" AS "markerFirstName", mb."lastName" AS "markerLastName"
    FROM "FeePayment" fp
    JOIN "StudentProfile" sp ON sp.id=fp."studentProfileId"
    JOIN "User" u ON u.id=sp."userId"
    LEFT JOIN "Class" c ON c.id=sp."classId"
    JOIN "School" s ON s.id=fp."schoolId"
    JOIN "User" mb ON mb.id=fp."markedById"
    WHERE fp.id=${paymentId} AND fp."schoolId"=${schoolId}
    LIMIT 1
  `);
  const p = rows[0];
  if (!p) return res.status(404).json({ message: 'Payment not found' });
  if (req.auth!.role === 'STUDENT' && p.userId !== req.auth!.userId) return res.status(403).json({ message: 'Not your payment' });
  if (req.auth!.role === 'PARENT') {
    const parent = await prisma.parentProfile.findFirst({ where: { schoolId, userId: req.auth!.userId } });
    const link = parent ? await prisma.studentParent.findFirst({ where: { parentId: parent.id, studentId: p.profileId } }) : null;
    if (!link) return res.status(403).json({ message: 'Student is not linked to this parent' });
  }
  res.json({
    receiptNo: `FEE-${p.id.slice(0, 8).toUpperCase()}`,
    school: { name: p.schoolName, address: p.schoolAddress, phone: p.schoolPhone },
    student: {
      name: `${p.firstName} ${p.lastName}`,
      admissionNo: p.admissionNo,
      className: p.className ? `${p.className}${p.section ? ` - ${p.section}` : ''}` : 'No class',
    },
    payment: {
      id: p.id,
      month: p.month,
      amount: Number(p.amount),
      method: p.method,
      reference: p.reference,
      status: p.approvalStatus,
      paidAt: p.paidAt,
      receivedBy: `${p.markerFirstName} ${p.markerLastName}`,
    },
  });
});

router.get('/collection-trends', requireRoles('PRINCIPAL'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const months = monthsBack(Math.min(24, Math.max(3, Number(req.query.months ?? 12))));
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT "month",
           COALESCE(SUM("amount") FILTER (WHERE "approvalStatus" <> 'REJECTED'),0) AS received,
           COALESCE(SUM("amount") FILTER (WHERE "approvalStatus"='APPROVED'),0) AS approved,
           COUNT(*) FILTER (WHERE "approvalStatus" <> 'REJECTED') AS payments
    FROM "FeePayment"
    WHERE "schoolId"=${schoolId} AND "month" IN (${Prisma.join(months)})
    GROUP BY "month"
    ORDER BY "month"
  `);
  const map = new Map(rows.map((x) => [x.month, x]));
  res.json([...months].reverse().map((month) => ({
    month,
    received: Number(map.get(month)?.received ?? 0),
    principalCollected: Number(map.get(month)?.approved ?? 0),
    payments: Number(map.get(month)?.payments ?? 0),
  })));
});

router.get('/staff-ranking', requireRoles('PRINCIPAL'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const month = typeof req.query.month === 'string' && monthPattern.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT u.id,u."firstName",u."lastName",
           COUNT(fp.id) FILTER (WHERE fp."approvalStatus" <> 'REJECTED') AS "studentPayments",
           COALESCE(SUM(fp.amount) FILTER (WHERE fp."approvalStatus" <> 'REJECTED'),0) AS "recovered",
           COALESCE(SUM(fp.amount) FILTER (WHERE fp."approvalStatus"='APPROVED'),0) AS "handedOver"
    FROM "User" u
    LEFT JOIN "FeePayment" fp ON fp."markedById"=u.id AND fp."schoolId"=${schoolId} AND fp.month=${month}
    WHERE u."schoolId"=${schoolId} AND u.role='STAFF'
    GROUP BY u.id,u."firstName",u."lastName"
    ORDER BY "recovered" DESC
  `);
  res.json(rows.map((x, i) => ({
    rank: i + 1,
    staffId: x.id,
    name: `${x.firstName} ${x.lastName}`,
    studentPayments: Number(x.studentPayments),
    recovered: Number(x.recovered),
    handedOver: Number(x.handedOver),
    cashPending: Number(x.recovered) - Number(x.handedOver),
  })));
});

export default router;

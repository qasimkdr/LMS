import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { Prisma, prisma } from '@nexora/database';
import { z } from 'zod';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';
import { ensureFeeInvoiceForStudent } from '../services/feeInvoices.js';
import { routeParam } from '../utils/http.js';

const router = Router();
router.use(requireAuth, requireTenant);

const monthPattern = /^\d{4}-\d{2}$/;

type StructureRow = {
  id?: string;
  classId: string;
  studentProfileId?: string;
  monthlyAmount: unknown;
  currency?: string;
  dueDay?: unknown;
  lateFineAmount?: unknown;
  lateFineGraceDays?: unknown;
  className?: string;
  section?: string | null;
};

type PaymentRow = {
  studentProfileId: string;
  amount: unknown;
  paidAt: string | Date;
  approvalStatus: string;
  classId?: string | null;
  [key: string]: any;
};

type AdjustmentRow = {
  studentProfileId: string;
  month: string;
  type: string;
  total: unknown;
};

function previousMonths(count: number) {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

function feeDeadline(month: string, dueDay: number, graceDays: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, dueDay + graceDays, 23, 59, 59, 999));
}

function calculateMonth(
  month: string,
  structure: StructureRow | undefined,
  payments: PaymentRow[],
  adjustmentTotals: Record<string, number>,
) {
  if (!structure) {
    return {
      month,
      configured: false,
      baseFee: 0,
      discount: 0,
      manualFine: 0,
      autoFine: 0,
      expected: 0,
      received: 0,
      approved: 0,
      pendingHandover: 0,
      balance: 0,
      status: 'NO_STRUCTURE',
      dueDate: null as Date | null,
      overdue: false,
    };
  }

  const baseFee = Number(structure.monthlyAmount ?? 0);
  const dueDay = Number(structure.dueDay ?? 10);
  const graceDays = Number(structure.lateFineGraceDays ?? 0);
  const lateFineAmount = Number(structure.lateFineAmount ?? 0);
  const discount = Number(adjustmentTotals.DISCOUNT ?? 0) + Number(adjustmentTotals.SCHOLARSHIP ?? 0) + Number(adjustmentTotals.WAIVER ?? 0);
  const manualFine = Number(adjustmentTotals.FINE ?? 0);
  const adjustedBeforeLateFine = Math.max(0, baseFee - discount + manualFine);
  const dueDate = feeDeadline(month, dueDay, graceDays);
  const validPayments = payments.filter((payment) => payment.approvalStatus !== 'REJECTED');
  const paidBeforeDeadline = validPayments
    .filter((payment) => new Date(payment.paidAt) <= dueDate)
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const autoFine = new Date() > dueDate && paidBeforeDeadline < adjustedBeforeLateFine ? lateFineAmount : 0;
  const expected = Math.max(0, adjustedBeforeLateFine + autoFine);
  const received = validPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const approved = validPayments.filter((payment) => payment.approvalStatus === 'APPROVED').reduce((sum, payment) => sum + Number(payment.amount), 0);
  const pendingHandover = validPayments.filter((payment) => payment.approvalStatus === 'PENDING').reduce((sum, payment) => sum + Number(payment.amount), 0);
  const balance = Math.max(0, expected - received);

  let status = 'UNPAID';
  if (expected === 0 || received >= expected) status = pendingHandover > 0 ? 'PENDING_HANDOVER' : 'PAID';
  else if (received > 0) status = pendingHandover > 0 ? 'PARTIAL_PENDING' : 'PARTIAL';

  return {
    month,
    configured: true,
    baseFee,
    discount,
    manualFine,
    autoFine,
    expected,
    received,
    approved,
    pendingHandover,
    balance,
    status,
    dueDate,
    overdue: new Date() > dueDate && balance > 0,
  };
}

function adjustmentMap(rows: AdjustmentRow[]) {
  const map = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const key = `${row.studentProfileId}:${row.month}`;
    const current = map.get(key) ?? {};
    current[row.type] = Number(row.total ?? 0);
    map.set(key, current);
  }
  return map;
}

function paymentMap(rows: PaymentRow[], includeMonth = false) {
  const map = new Map<string, PaymentRow[]>();
  for (const row of rows) {
    const month = (row as any).month as string | undefined;
    const key = includeMonth ? `${row.studentProfileId}:${month}` : row.studentProfileId;
    const current = map.get(key) ?? [];
    current.push(row);
    map.set(key, current);
  }
  return map;
}

router.get('/recovery-dashboard', requireRoles('PRINCIPAL', 'STAFF'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const month = typeof req.query.month === 'string' && monthPattern.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);

  const [students, structures, invoices, payments, adjustments, batches] = await Promise.all([
    prisma.studentProfile.findMany({
      where: { schoolId },
      include: { user: { select: { firstName: true, lastName: true } }, class: true },
    }),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT fs.*, c.name AS "className", c.section
      FROM "FeeStructure" fs
      JOIN "Class" c ON c.id=fs."classId"
      WHERE fs."schoolId"=${schoolId}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT fi.id,fi."studentProfileId",fi."classId",fi."baseFee" AS "monthlyAmount",fi.currency,
             fi."dueDay",fi."lateFineAmount",fi."lateFineGraceDays",c.name AS "className",c.section
      FROM "FeeInvoice" fi
      LEFT JOIN "Class" c ON c.id=fi."classId"
      WHERE fi."schoolId"=${schoolId} AND fi.month=${month}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT fp.*, sp."classId", u."firstName", u."lastName", c.name AS "className", c.section,
             mb."firstName" AS "markerFirstName", mb."lastName" AS "markerLastName"
      FROM "FeePayment" fp
      JOIN "StudentProfile" sp ON sp.id=fp."studentProfileId"
      JOIN "User" u ON u.id=sp."userId"
      LEFT JOIN "Class" c ON c.id=sp."classId"
      JOIN "User" mb ON mb.id=fp."markedById"
      WHERE fp."schoolId"=${schoolId} AND fp."month"=${month}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT "studentProfileId", month, type, COALESCE(SUM(amount),0) AS total
      FROM "FeeAdjustment"
      WHERE "schoolId"=${schoolId} AND month=${month}
      GROUP BY "studentProfileId", month, type
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT b.*, u."firstName", u."lastName"
      FROM "FeeRecoveryBatch" b
      JOIN "User" u ON u.id=b."staffId"
      WHERE b."schoolId"=${schoolId} AND b."status" IN ('OPEN','SUBMITTED')
      ORDER BY b."createdAt" DESC
    `),
  ]);

  const structuresByClass = new Map<string, StructureRow>(structures.map((row) => [row.classId, row]));
  const invoicesByStudent = new Map<string, StructureRow>(invoices.map((row) => [row.studentProfileId, row]));
  const paymentsByStudent = paymentMap(payments);
  const adjustmentsByStudentMonth = adjustmentMap(adjustments);

  const studentCards = students.map((student) => {
    const invoice = invoicesByStudent.get(student.id);
    const structure = invoice ?? (student.classId ? structuresByClass.get(student.classId) : undefined);
    const metrics = calculateMonth(
      month,
      structure,
      paymentsByStudent.get(student.id) ?? [],
      adjustmentsByStudentMonth.get(`${student.id}:${month}`) ?? {},
    );
    const billingClassId = structure?.classId ?? student.classId;
    const billingClassName = structure?.className
      ? `${structure.className}${structure.section ? ` - ${structure.section}` : ''}`
      : student.class
        ? `${student.class.name}${student.class.section ? ` - ${student.class.section}` : ''}`
        : 'No class';
    return {
      studentProfileId: student.id,
      name: `${student.user.firstName} ${student.user.lastName}`,
      admissionNo: student.admissionNo,
      classId: billingClassId,
      className: billingClassName,
      monthlyFee: metrics.baseFee,
      expectedAmount: metrics.expected,
      paidAmount: metrics.received,
      approvedAmount: metrics.approved,
      cashPending: metrics.pendingHandover,
      balance: metrics.balance,
      discount: metrics.discount,
      manualFine: metrics.manualFine,
      autoFine: metrics.autoFine,
      dueDate: metrics.dueDate?.toISOString() ?? null,
      overdue: metrics.overdue,
      status: metrics.status,
      configured: metrics.configured,
      historicalSnapshot: Boolean(invoice),
    };
  });

  const classSources = new Map<string, StructureRow>();
  for (const structure of structures as StructureRow[]) classSources.set(structure.classId, structure);
  for (const invoice of invoices as StructureRow[]) {
    if (invoice.classId && !classSources.has(invoice.classId)) classSources.set(invoice.classId, invoice);
  }

  const classRows = [...classSources.values()].map((structure) => {
    const classStudents = studentCards.filter((student) => student.classId === structure.classId);
    const expected = classStudents.reduce((sum, student) => sum + student.expectedAmount, 0);
    const collected = classStudents.reduce((sum, student) => sum + student.paidAmount, 0);
    const paid = classStudents.filter((student) => student.balance <= 0).length;
    return {
      classId: structure.classId,
      className: `${structure.className ?? 'Class'}${structure.section ? ` - ${structure.section}` : ''}`,
      monthlyAmount: classStudents[0]?.monthlyFee ?? Number(structure.monthlyAmount),
      students: classStudents.length,
      paid,
      remaining: Math.max(0, classStudents.length - paid),
      expected,
      collected,
      pending: classStudents.reduce((sum, student) => sum + student.balance, 0),
      recoveryRate: expected ? Math.round((Math.min(collected, expected) / expected) * 1000) / 10 : 100,
    };
  });

  const expected = studentCards.reduce((sum, student) => sum + student.expectedAmount, 0);
  const received = studentCards.reduce((sum, student) => sum + student.paidAmount, 0);
  const principalCollected = studentCards.reduce((sum, student) => sum + student.approvedAmount, 0);
  const remaining = studentCards.reduce((sum, student) => sum + student.balance, 0);
  const configuredStudents = studentCards.filter((student) => student.configured);

  res.json({
    month,
    expected,
    received,
    principalCollected,
    cashPendingWithStaff: studentCards.reduce((sum, student) => sum + student.cashPending, 0),
    remaining,
    paidStudents: configuredStudents.filter((student) => student.balance <= 0).length,
    totalStudents: configuredStudents.length,
    unconfiguredStudents: studentCards.length - configuredStudents.length,
    classRows,
    studentCards,
    batches,
  });
});

router.get('/student-dues', requireRoles('PRINCIPAL', 'STAFF', 'STUDENT', 'PARENT'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const months = Math.min(24, Math.max(1, Number(req.query.months ?? 12)));
  const monthList = previousMonths(months);
  let targetId = typeof req.query.studentProfileId === 'string' ? req.query.studentProfileId : undefined;

  if (req.auth!.role === 'STUDENT') {
    const profile = await prisma.studentProfile.findFirst({ where: { schoolId, userId: req.auth!.userId } });
    targetId = profile?.id;
  }
  if (req.auth!.role === 'PARENT') {
    const parent = await prisma.parentProfile.findFirst({ where: { schoolId, userId: req.auth!.userId } });
    if (!parent || !targetId) return res.status(404).json({ message: 'Student not found' });
    const link = await prisma.studentParent.findFirst({ where: { parentId: parent.id, studentId: targetId } });
    if (!link) return res.status(403).json({ message: 'Student is not linked to this parent' });
  }

  const [students, structures, invoices, payments, adjustments] = await Promise.all([
    prisma.studentProfile.findMany({
      where: { schoolId, ...(targetId ? { id: targetId } : {}) },
      include: { user: { select: { firstName: true, lastName: true } }, class: true },
    }),
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "FeeStructure" WHERE "schoolId"=${schoolId}`),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT "studentProfileId","classId",month,"baseFee" AS "monthlyAmount",currency,"dueDay","lateFineAmount","lateFineGraceDays"
      FROM "FeeInvoice"
      WHERE "schoolId"=${schoolId} AND month IN (${Prisma.join(monthList)})
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT "studentProfileId", month, amount, "paidAt", "approvalStatus"
      FROM "FeePayment"
      WHERE "schoolId"=${schoolId} AND month IN (${Prisma.join(monthList)})
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT "studentProfileId", month, type, COALESCE(SUM(amount),0) AS total
      FROM "FeeAdjustment"
      WHERE "schoolId"=${schoolId} AND month IN (${Prisma.join(monthList)})
      GROUP BY "studentProfileId", month, type
    `),
  ]);

  const structuresByClass = new Map<string, StructureRow>(structures.map((row) => [row.classId, row]));
  const invoicesByStudentMonth = new Map<string, StructureRow>(
    invoices.map((row) => [`${row.studentProfileId}:${row.month}`, row]),
  );
  const paymentsByStudentMonth = paymentMap(payments, true);
  const adjustmentsByStudentMonth = adjustmentMap(adjustments);

  const rows = students.map((student) => {
    const currentStructure = student.classId ? structuresByClass.get(student.classId) : undefined;
    const profileMonth = student.createdAt.toISOString().slice(0, 7);
    const eligibleMonths = monthList.filter((month) => month >= profileMonth);
    const monthBalances = eligibleMonths.map((month) => {
      const invoice = invoicesByStudentMonth.get(`${student.id}:${month}`);
      return calculateMonth(
        month,
        invoice ?? currentStructure,
        paymentsByStudentMonth.get(`${student.id}:${month}`) ?? [],
        adjustmentsByStudentMonth.get(`${student.id}:${month}`) ?? {},
      );
    });
    const dueMonths = monthBalances.filter((balance) => balance.configured && balance.balance > 0);
    const snapshots = eligibleMonths.filter((month) => invoicesByStudentMonth.has(`${student.id}:${month}`)).length;
    return {
      studentProfileId: student.id,
      name: `${student.user.firstName} ${student.user.lastName}`,
      admissionNo: student.admissionNo,
      className: student.class ? `${student.class.name}${student.class.section ? ` - ${student.class.section}` : ''}` : 'No class',
      monthlyFee: currentStructure ? Number(currentStructure.monthlyAmount) : 0,
      monthsChecked: eligibleMonths.length,
      snapshotMonths: snapshots,
      unpaidMonths: dueMonths.length,
      overdueMonths: dueMonths.filter((balance) => balance.overdue).length,
      dueAmount: dueMonths.reduce((sum, balance) => sum + balance.balance, 0),
      missingMonths: dueMonths.map((balance) => balance.month),
      configured: Boolean(currentStructure) || snapshots > 0,
    };
  }).sort((a, b) => b.dueAmount - a.dueAmount || b.unpaidMonths - a.unpaidMonths);

  res.json(rows);
});

const paymentSchema = z.object({
  studentProfileId: z.string().uuid(),
  month: z.string().regex(monthPattern),
  amount: z.coerce.number().positive(),
  method: z.string().max(50).optional(),
  reference: z.string().max(120).optional(),
});

router.post('/receive', requireRoles('PRINCIPAL', 'STAFF'), async (req, res) => {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid fee payment' });

  const data = parsed.data;
  const schoolId = req.auth!.schoolId!;
  const actorId = req.auth!.userId;
  const actorRole = req.auth!.role;
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "StudentProfile" WHERE id=${data.studentProfileId} FOR UPDATE`);
      const student = await tx.studentProfile.findFirst({ where: { id: data.studentProfileId, schoolId } });
      if (!student) return { error: { status: 404, message: 'Student not found' } } as const;
      if (!student.classId) return { error: { status: 400, message: 'Student is not assigned to a class' } } as const;

      const structure = await ensureFeeInvoiceForStudent(tx, schoolId, data.studentProfileId, data.month);
      if (!structure) {
        return {
          error: {
            status: 400,
            message: 'Fee invoice could not be created. Check the student admission month and class fee structure.',
          },
        } as const;
      }

      const [payments, adjustments] = await Promise.all([
        tx.$queryRaw<any[]>(Prisma.sql`
          SELECT "studentProfileId", amount, "paidAt", "approvalStatus"
          FROM "FeePayment"
          WHERE "schoolId"=${schoolId} AND "studentProfileId"=${data.studentProfileId} AND month=${data.month}
        `),
        tx.$queryRaw<any[]>(Prisma.sql`
          SELECT type, COALESCE(SUM(amount),0) AS total
          FROM "FeeAdjustment"
          WHERE "schoolId"=${schoolId} AND "studentProfileId"=${data.studentProfileId} AND month=${data.month}
          GROUP BY type
        `),
      ]);

      const adjustmentTotals = Object.fromEntries(adjustments.map((row) => [row.type, Number(row.total)]));
      const before = calculateMonth(data.month, structure as StructureRow, payments, adjustmentTotals);
      if (before.balance <= 0) return { error: { status: 409, message: 'This month is already fully paid' } } as const;
      if (data.amount > before.balance + 0.0001) {
        return { error: { status: 400, message: `Payment exceeds remaining adjusted balance of ${before.balance}` } } as const;
      }

      if (data.reference) {
        const duplicate = await tx.$queryRaw<any[]>(Prisma.sql`
          SELECT id FROM "FeePayment"
          WHERE "schoolId"=${schoolId} AND reference=${data.reference} AND "approvalStatus"<>'REJECTED'
          LIMIT 1
        `);
        if (duplicate[0]) return { error: { status: 409, message: 'A payment with this reference already exists' } } as const;
      }

      const approvalStatus = actorRole === 'PRINCIPAL' ? 'APPROVED' : 'PENDING';
      let batchId: string | null = null;

      if (actorRole === 'STAFF') {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id=${actorId} FOR UPDATE`);
        const open = await tx.$queryRaw<any[]>(Prisma.sql`
          SELECT id FROM "FeeRecoveryBatch"
          WHERE "schoolId"=${schoolId} AND "staffId"=${actorId} AND status='OPEN'
          ORDER BY "createdAt" DESC LIMIT 1
        `);
        batchId = open[0]?.id ?? randomUUID();
        if (!open[0]) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "FeeRecoveryBatch" (id,"schoolId","staffId",status,"createdAt","updatedAt")
            VALUES (${batchId},${schoolId},${actorId},'OPEN',${now},${now})
          `);
        }
      }

      const id = randomUUID();
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "FeePayment"
          (id,"schoolId","studentProfileId",month,amount,status,method,reference,"markedById","paidAt","createdAt","approvalStatus","approvedById","approvedAt","recoveryBatchId")
        VALUES
          (${id},${schoolId},${data.studentProfileId},${data.month},${data.amount},'PAID',${data.method ?? null},${data.reference ?? null},${actorId},${now},${now},${approvalStatus},${actorRole === 'PRINCIPAL' ? actorId : null},${actorRole === 'PRINCIPAL' ? now : null},${batchId})
      `);

      if (batchId) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "FeeRecoveryBatch" b
          SET "totalAmount"=(SELECT COALESCE(SUM(amount),0) FROM "FeePayment" WHERE "recoveryBatchId"=b.id AND "approvalStatus"='PENDING'),
              "studentCount"=(SELECT COUNT(DISTINCT "studentProfileId") FROM "FeePayment" WHERE "recoveryBatchId"=b.id AND "approvalStatus"='PENDING'),
              "updatedAt"=${now}
          WHERE b.id=${batchId}
        `);
      }

      const remainingAfter = Math.max(0, before.balance - data.amount);
      await tx.auditLog.create({
        data: {
          schoolId,
          actorId,
          action: 'FEE_RECEIVED',
          entityType: 'FeePayment',
          entityId: id,
          afterData: {
            studentProfileId: data.studentProfileId,
            month: data.month,
            amount: data.amount,
            approvalStatus,
            batchId,
            feeInvoiceId: structure.id,
            adjustedExpected: before.expected,
            balanceBefore: before.balance,
            balanceAfter: remainingAfter,
          },
        },
      });

      return {
        value: {
          id,
          approvalStatus,
          batchId,
          feeInvoiceId: structure.id,
          expected: before.expected,
          paidBefore: before.received,
          remainingBefore: before.balance,
          remainingAfter,
          status: remainingAfter <= 0 ? (approvalStatus === 'PENDING' ? 'PENDING_HANDOVER' : 'PAID') : approvalStatus === 'PENDING' ? 'PARTIAL_PENDING' : 'PARTIAL',
        },
      } as const;
    });

    if ('error' in result && result.error) return res.status(result.error.status).json({ message: result.error.message });
    if (!('value' in result) || !result.value) return res.status(500).json({ message: 'Payment transaction returned no result' });
    res.status(201).json(result.value);
  } catch (error) {
    console.error('Fee receive transaction failed', error);
    res.status(409).json({ message: 'Payment could not be recorded because the balance changed. Refresh and try again.' });
  }
});

router.post('/batches/:id/submit', requireRoles('STAFF'), async (req, res) => {
  const id = routeParam(req.params.id);
  const schoolId = req.auth!.schoolId!;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.$queryRaw<any[]>(Prisma.sql`
      SELECT id FROM "FeeRecoveryBatch"
      WHERE id=${id} AND "schoolId"=${schoolId} AND "staffId"=${req.auth!.userId} AND status='OPEN'
      FOR UPDATE
    `);
    if (!batch[0]) return null;

    const totals = await tx.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(SUM(amount),0) AS total, COUNT(DISTINCT "studentProfileId") AS students, COUNT(*) AS payments
      FROM "FeePayment"
      WHERE "recoveryBatchId"=${id} AND "schoolId"=${schoolId} AND "approvalStatus"='PENDING'
    `);
    if (Number(totals[0]?.payments ?? 0) === 0) return { empty: true };

    await tx.$executeRaw(Prisma.sql`
      UPDATE "FeeRecoveryBatch"
      SET status='SUBMITTED', "submittedAt"=${now}, "totalAmount"=${Number(totals[0].total)},
          "studentCount"=${Number(totals[0].students)}, "updatedAt"=${now}
      WHERE id=${id}
    `);
    return { empty: false };
  });

  if (!result) return res.status(404).json({ message: 'Open recovery batch not found' });
  if (result.empty) return res.status(400).json({ message: 'Cannot submit an empty batch' });
  res.json({ ok: true });
});

router.get('/batches', requireRoles('PRINCIPAL', 'STAFF'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const rows = req.auth!.role === 'STAFF'
    ? await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT b.*,u."firstName",u."lastName"
        FROM "FeeRecoveryBatch" b JOIN "User" u ON u.id=b."staffId"
        WHERE b."schoolId"=${schoolId} AND b."staffId"=${req.auth!.userId}
        ORDER BY b."createdAt" DESC
      `)
    : await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT b.*,u."firstName",u."lastName"
        FROM "FeeRecoveryBatch" b JOIN "User" u ON u.id=b."staffId"
        WHERE b."schoolId"=${schoolId}
        ORDER BY CASE WHEN b.status='SUBMITTED' THEN 0 WHEN b.status='OPEN' THEN 1 ELSE 2 END,b."createdAt" DESC
      `);
  res.json(rows);
});

router.get('/batches/:id', requireRoles('PRINCIPAL', 'STAFF'), async (req, res) => {
  const id = routeParam(req.params.id);
  const schoolId = req.auth!.schoolId!;
  const batches = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT b.*,u."firstName",u."lastName"
    FROM "FeeRecoveryBatch" b JOIN "User" u ON u.id=b."staffId"
    WHERE b.id=${id} AND b."schoolId"=${schoolId}
  `);
  const batch = batches[0];
  if (!batch) return res.status(404).json({ message: 'Batch not found' });
  if (req.auth!.role === 'STAFF' && batch.staffId !== req.auth!.userId) return res.status(403).json({ message: 'Not your batch' });

  const payments = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT fp.*,sp."admissionNo",u."firstName",u."lastName",c.name AS "className",c.section
    FROM "FeePayment" fp
    JOIN "StudentProfile" sp ON sp.id=fp."studentProfileId"
    JOIN "User" u ON u.id=sp."userId"
    LEFT JOIN "Class" c ON c.id=sp."classId"
    WHERE fp."recoveryBatchId"=${batch.id}
    ORDER BY fp."paidAt" DESC
  `);
  res.json({ ...batch, payments });
});

router.patch('/batches/:id/collect', requireRoles('PRINCIPAL'), async (req, res) => {
  const parsed = z.object({ remark: z.string().max(1000).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid collection' });

  const id = routeParam(req.params.id);
  const schoolId = req.auth!.schoolId!;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const batches = await tx.$queryRaw<any[]>(Prisma.sql`
      SELECT * FROM "FeeRecoveryBatch"
      WHERE id=${id} AND "schoolId"=${schoolId} AND status='SUBMITTED'
      FOR UPDATE
    `);
    if (!batches[0]) return null;

    const totals = await tx.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(SUM(amount),0) AS total, COUNT(DISTINCT "studentProfileId") AS students
      FROM "FeePayment"
      WHERE "recoveryBatchId"=${id} AND "schoolId"=${schoolId} AND "approvalStatus"='PENDING'
    `);
    const totalAmount = Number(totals[0]?.total ?? 0);
    const studentCount = Number(totals[0]?.students ?? 0);

    await tx.$executeRaw(Prisma.sql`
      UPDATE "FeePayment"
      SET "approvalStatus"='APPROVED', "approvedById"=${req.auth!.userId}, "approvedAt"=${now}
      WHERE "recoveryBatchId"=${id} AND "schoolId"=${schoolId} AND "approvalStatus"='PENDING'
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "FeeRecoveryBatch"
      SET status='COLLECTED', "totalAmount"=${totalAmount}, "studentCount"=${studentCount},
          "collectedByPrincipalId"=${req.auth!.userId}, "collectedAt"=${now},
          "principalRemark"=${parsed.data.remark ?? null}, "updatedAt"=${now}
      WHERE id=${id}
    `);
    await tx.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: 'FEE_RECOVERY_BATCH_COLLECTED',
        entityType: 'FeeRecoveryBatch',
        entityId: id,
        afterData: { amount: totalAmount, studentCount, remark: parsed.data.remark ?? null },
      },
    });
    return { totalAmount, studentCount };
  });

  if (!result) return res.status(404).json({ message: 'Submitted recovery batch not found' });
  res.json({ ok: true, ...result });
});

export default router;

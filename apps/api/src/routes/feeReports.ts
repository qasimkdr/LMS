import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { parse } from '../lib/validate';
import { badRequest, forbidden } from '../lib/errors';
import { can } from '../lib/http';
import { round2 } from '../lib/money';
import { addMonths, periodOf } from '../lib/dates';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { schoolToday } from './attendance';
import { familyDues, num, ymd } from '../services/fees';
import { sendFeeNotices } from '../services/feeMessages';

const router = Router();
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const need = (req: Request) => {
  if (!can(req, 'fees.reports')) throw forbidden('You need the fee reports permission');
};
const classLabel = (c: { name: string; stream: string | null }, s?: { name: string } | null) => `${c.name}${c.stream ? ` ${c.stream}` : ''}${s ? ` ${s.name}` : ''}`;

/** Collection comparison and headline numbers for the fees dashboard. */
router.get(
  '/summary',
  ah(async (req, res) => {
    need(req);
    const schoolId = tenantId(req);
    const today = schoolToday(req.user!.school!.timezone);
    const thisPeriod = today.slice(0, 7);
    const from = new Date(`${addMonths(thisPeriod, -12)}-01T00:00:00Z`);
    const payments = await prisma.feePayment.findMany({ where: { schoolId, status: { not: 'CANCELLED' }, receivedAt: { gte: from } }, select: { amount: true, receivedAt: true, method: true, source: true, collectedById: true } });
    const monthly = new Map<string, number>();
    for (let i = 12; i >= 0; i--) monthly.set(addMonths(thisPeriod, -i), 0);
    let todayTotal = 0;
    const byMethod: Record<string, number> = {};
    const byCollector: Record<string, number> = {};
    for (const p of payments) {
      const k = periodOf(p.receivedAt);
      if (monthly.has(k)) monthly.set(k, round2(monthly.get(k)! + num(p.amount)));
      if (ymd(p.receivedAt) === today) todayTotal = round2(todayTotal + num(p.amount));
      if (k === thisPeriod) {
        byMethod[p.method] = round2((byMethod[p.method] ?? 0) + num(p.amount));
        const who = p.source === 'ONLINE' ? 'ONLINE' : (p.collectedById ?? 'unknown');
        byCollector[who] = round2((byCollector[who] ?? 0) + num(p.amount));
      }
    }
    const series = [...monthly.entries()].map(([month, amount]) => ({ month, amount }));
    const sumLast = (n: number) => round2(series.slice(-n).reduce((a, b) => a + b.amount, 0));
    const users = await prisma.user.findMany({ where: { id: { in: Object.keys(byCollector).filter((k) => k !== 'ONLINE') } }, select: { id: true, fullName: true } });

    const open = await prisma.feeInvoice.aggregate({ where: { schoolId, status: { in: ['UNPAID', 'PARTIAL'] } }, _sum: { total: true, paidAmount: true } });
    const overdueFamilies = await prisma.feeInvoice.groupBy({ by: ['studentId'], where: { schoolId, status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: new Date(`${today}T00:00:00Z`) } } });
    const thisMonth = await prisma.feeInvoice.aggregate({ where: { schoolId, period: thisPeriod, status: { not: 'CANCELLED' } }, _sum: { total: true, paidAmount: true }, _count: { _all: true } });
    const [pendingHandovers, pendingCancellations] = await Promise.all([
      prisma.feeHandover.count({ where: { schoolId, status: 'PENDING' } }),
      prisma.feePayment.count({ where: { schoolId, status: 'CANCEL_REQUESTED' } }),
    ]);
    res.json({
      today,
      currency: req.user!.school!.currency,
      collection: {
        today: todayTotal,
        thisMonth: monthly.get(thisPeriod) ?? 0,
        lastMonth: monthly.get(addMonths(thisPeriod, -1)) ?? 0,
        last6Months: sumLast(6),
        last12Months: sumLast(12),
        sameMonthLastYear: monthly.get(addMonths(thisPeriod, -12)) ?? 0,
        series,
        byMethod,
        byCollector: Object.entries(byCollector).map(([id, amount]) => ({ id, name: id === 'ONLINE' ? 'Online payments' : (users.find((u) => u.id === id)?.fullName ?? 'Unknown'), amount })),
      },
      outstanding: round2(num(open._sum.total) - num(open._sum.paidAmount)),
      studentsOverdue: overdueFamilies.length,
      currentMonth: {
        period: thisPeriod,
        vouchers: thisMonth._count._all,
        expected: num(thisMonth._sum.total),
        collected: num(thisMonth._sum.paidAmount),
        recovery: num(thisMonth._sum.total) ? Math.round((num(thisMonth._sum.paidAmount) / num(thisMonth._sum.total)) * 1000) / 10 : null,
      },
      pendingHandovers,
      pendingCancellations,
    });
  }),
);

/** Who paid and who did not, for one month. */
router.get(
  '/month',
  ah(async (req, res) => {
    need(req);
    const schoolId = tenantId(req);
    const q = parse(z.object({ period, classId: z.string().optional(), sectionId: z.string().optional(), status: z.enum(['PAID', 'PARTIAL', 'UNPAID', 'NONE']).optional() }), req.query);
    const students = await prisma.student.findMany({
      where: { schoolId, status: 'ACTIVE', deletedAt: null, ...(q.classId ? { classId: q.classId } : {}), ...(q.sectionId ? { sectionId: q.sectionId } : {}) },
      select: { id: true, fullName: true, admissionNo: true, rollNo: true, familyId: true, class: { select: { name: true, stream: true, sortOrder: true } }, section: { select: { name: true } } },
      orderBy: [{ class: { sortOrder: 'asc' } }, { section: { name: 'asc' } }, { rollNo: 'asc' }, { fullName: 'asc' }],
    });
    const invoices = await prisma.feeInvoice.findMany({ where: { schoolId, period: q.period, status: { not: 'CANCELLED' }, studentId: { in: students.map((s) => s.id) } } });
    let rows = students.map((s) => {
      const inv = invoices.find((i) => i.studentId === s.id);
      return {
        student: { id: s.id, fullName: s.fullName, admissionNo: s.admissionNo, rollNo: s.rollNo, familyId: s.familyId, classLabel: classLabel(s.class, s.section) },
        invoiceId: inv?.id ?? null,
        total: num(inv?.total),
        paid: num(inv?.paidAmount),
        balance: inv ? round2(num(inv.total) - num(inv.paidAmount)) : 0,
        status: inv ? inv.status : 'NONE',
      };
    });
    const counts = { PAID: 0, PARTIAL: 0, UNPAID: 0, NONE: 0 } as Record<string, number>;
    for (const r of rows) counts[r.status]++;
    if (q.status) rows = rows.filter((r) => r.status === q.status);
    const total = round2(invoices.reduce((a, i) => a + num(i.total), 0));
    const paid = round2(invoices.reduce((a, i) => a + num(i.paidAmount), 0));
    res.json({ period: q.period, counts, total, paid, recovery: total ? Math.round((paid / total) * 1000) / 10 : null, rows });
  }),
);

/** Students who owe money, ranked by months unpaid then amount. */
router.get(
  '/defaulters',
  ah(async (req, res) => {
    need(req);
    const schoolId = tenantId(req);
    const today = schoolToday(req.user!.school!.timezone);
    const q = parse(z.object({ classId: z.string().optional(), minMonths: z.coerce.number().int().min(1).default(1) }), req.query);
    const invoices = await prisma.feeInvoice.findMany({
      where: { schoolId, status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: new Date(`${today}T00:00:00Z`) }, ...(q.classId ? { studentId: { in: (await prisma.student.findMany({ where: { schoolId, classId: q.classId }, select: { id: true } })).map((s) => s.id) } } : {}) },
      select: { studentId: true, familyId: true, period: true, total: true, paidAmount: true, dueDate: true },
    });
    const by = new Map<string, { months: Set<string>; vouchers: number; due: number; oldest: Date; familyId: string }>();
    for (const i of invoices) {
      const r = by.get(i.studentId) ?? { months: new Set(), vouchers: 0, due: 0, oldest: i.dueDate, familyId: i.familyId };
      if (i.period) r.months.add(i.period);
      r.vouchers++;
      r.due = round2(r.due + num(i.total) - num(i.paidAmount));
      if (i.dueDate < r.oldest) r.oldest = i.dueDate;
      by.set(i.studentId, r);
    }
    const students = await prisma.student.findMany({
      where: { id: { in: [...by.keys()] }, deletedAt: null },
      select: { id: true, fullName: true, admissionNo: true, status: true, class: { select: { name: true, stream: true } }, section: { select: { name: true } }, family: { select: { familyNo: true, guardians: { where: { receivesMessages: true }, select: { fullName: true, phone: true, whatsapp: true }, take: 1 } } } },
    });
    const rows = students
      .map((s) => {
        const r = by.get(s.id)!;
        return {
          student: { id: s.id, fullName: s.fullName, admissionNo: s.admissionNo, status: s.status, classLabel: classLabel(s.class, s.section) },
          familyId: r.familyId,
          familyNo: s.family.familyNo,
          contact: s.family.guardians[0] ?? null,
          monthsUnpaid: r.months.size,
          vouchers: r.vouchers,
          due: r.due,
          oldestDue: ymd(r.oldest),
        };
      })
      .filter((r) => r.monthsUnpaid >= q.minMonths || (q.minMonths === 1 && r.vouchers > 0))
      .sort((a, b) => b.monthsUnpaid - a.monthsUnpaid || b.due - a.due)
      .map((r, i) => ({ rank: i + 1, ...r }));
    res.json({ rows, totalDue: round2(rows.reduce((a, r) => a + r.due, 0)) });
  }),
);

/** Expected vs collected for each of the last months, and by class for one month. */
router.get(
  '/recovery',
  ah(async (req, res) => {
    need(req);
    const schoolId = tenantId(req);
    const today = schoolToday(req.user!.school!.timezone);
    const q = parse(z.object({ months: z.coerce.number().int().min(1).max(24).default(6), period: period.optional() }), req.query);
    const periods = Array.from({ length: q.months }, (_, i) => addMonths(today.slice(0, 7), -(q.months - 1 - i)));
    const sums = await prisma.feeInvoice.groupBy({ by: ['period'], where: { schoolId, period: { in: periods }, status: { not: 'CANCELLED' } }, _sum: { total: true, paidAmount: true } });
    const byPeriod = periods.map((p) => {
      const s = sums.find((x) => x.period === p);
      const expected = num(s?._sum.total);
      const collected = num(s?._sum.paidAmount);
      return { period: p, expected, collected, recovery: expected ? Math.round((collected / expected) * 1000) / 10 : null };
    });
    const focus = q.period ?? periods[periods.length - 1];
    const invoices = await prisma.feeInvoice.findMany({ where: { schoolId, period: focus, status: { not: 'CANCELLED' } }, select: { studentId: true, total: true, paidAmount: true } });
    const students = await prisma.student.findMany({ where: { id: { in: invoices.map((i) => i.studentId) } }, select: { id: true, classId: true, class: { select: { name: true, stream: true, sortOrder: true } } } });
    const byClass = new Map<string, { name: string; sort: number; expected: number; collected: number }>();
    for (const i of invoices) {
      const st = students.find((s) => s.id === i.studentId);
      if (!st) continue;
      const r = byClass.get(st.classId) ?? { name: classLabel(st.class), sort: st.class.sortOrder, expected: 0, collected: 0 };
      r.expected = round2(r.expected + num(i.total));
      r.collected = round2(r.collected + num(i.paidAmount));
      byClass.set(st.classId, r);
    }
    res.json({
      byPeriod,
      period: focus,
      byClass: [...byClass.entries()].sort((a, b) => a[1].sort - b[1].sort).map(([id, r]) => ({ id, name: r.name, expected: r.expected, collected: r.collected, recovery: r.expected ? Math.round((r.collected / r.expected) * 1000) / 10 : null })),
    });
  }),
);

/** Day sheet: receipts of one day by collector and method. */
router.get(
  '/daily',
  ah(async (req, res) => {
    need(req);
    const schoolId = tenantId(req);
    const { date = schoolToday(req.user!.school!.timezone) } = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
    const start = new Date(`${date}T00:00:00Z`);
    const payments = await prisma.feePayment.findMany({ where: { schoolId, receivedAt: { gte: start, lt: new Date(start.getTime() + 86400000) } }, orderBy: { receivedAt: 'asc' } });
    const users = await prisma.user.findMany({ where: { id: { in: payments.map((p) => p.collectedById).filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
    const valid = payments.filter((p) => p.status !== 'CANCELLED');
    const group = (key: (p: (typeof valid)[number]) => string) => {
      const m: Record<string, number> = {};
      for (const p of valid) m[key(p)] = round2((m[key(p)] ?? 0) + num(p.amount));
      return m;
    };
    res.json({
      date,
      total: round2(valid.reduce((a, p) => a + num(p.amount), 0)),
      receipts: valid.length,
      cancelled: payments.length - valid.length,
      byMethod: group((p) => p.method),
      byCollector: Object.entries(group((p) => (p.source === 'ONLINE' ? 'Online payments' : (users.find((u) => u.id === p.collectedById)?.fullName ?? 'Unknown'))))
        .map(([name, amount]) => ({ name, amount })),
    });
  }),
);

/** One-click reminders: chosen families, a class, or every defaulter. */
router.post(
  '/reminders',
  ah(async (req, res) => {
    if (!(can(req, 'fees.reports') || can(req, 'messages.send'))) throw forbidden();
    const schoolId = tenantId(req);
    const today = schoolToday(req.user!.school!.timezone);
    const body = parse(z.object({ familyIds: z.array(z.string()).optional(), classId: z.string().optional(), allDefaulters: z.boolean().optional() }), req.body);
    const where: Prisma.FeeInvoiceWhereInput = { schoolId, status: { in: ['UNPAID', 'PARTIAL'] } };
    if (body.familyIds?.length) where.familyId = { in: body.familyIds };
    else if (body.classId) where.studentId = { in: (await prisma.student.findMany({ where: { schoolId, classId: body.classId }, select: { id: true } })).map((s) => s.id) };
    else if (body.allDefaulters) where.dueDate = { lt: new Date(`${today}T00:00:00Z`) };
    else throw badRequest('Choose who to remind');
    const families = [...new Set((await prisma.feeInvoice.findMany({ where, select: { familyId: true } })).map((i) => i.familyId))];
    const r = await sendFeeNotices(schoolId, families, { force: true, title: 'Fee reminder' });
    await audit(req, { action: 'fees.reminders', entityType: 'School', entityId: schoolId, after: { ...body, families: families.length, ...r } });
    res.json({ families: families.length, ...r });
  }),
);

export default router;

// ---------- Parent / student view ----------

export const myFeesRouter = Router();

myFeesRouter.get(
  '/',
  ah(async (req, res) => {
    const u = req.user!;
    const schoolId = tenantId(req);
    const where = u.role === 'PARENT' ? { parentUserId: u.id } : u.role === 'STUDENT' ? { students: { some: { userId: u.id } } } : null;
    if (!where) throw forbidden();
    const fam = await prisma.family.findFirst({ where: { schoolId, ...where }, select: { id: true, familyNo: true, students: { where: { deletedAt: null }, select: { id: true, fullName: true } } } });
    if (!fam) return res.json({ family: null });
    const today = schoolToday(u.school!.timezone);
    const dues = await familyDues(schoolId, fam.id, today);
    const [paidInvoices, receipts, gateway] = await Promise.all([
      prisma.feeInvoice.findMany({ where: { familyId: fam.id, status: 'PAID' }, orderBy: { dueDate: 'desc' }, take: 12, select: { id: true, invoiceNo: true, title: true, studentId: true, total: true, dueDate: true } }),
      prisma.feePayment.findMany({ where: { familyId: fam.id, status: { not: 'CANCELLED' } }, orderBy: { receivedAt: 'desc' }, take: 20, select: { id: true, receiptNo: true, amount: true, method: true, source: true, receivedAt: true } }),
      prisma.paymentGatewaySettings.findUnique({ where: { schoolId } }),
    ]);
    const modules = (u.school!.plan.modules as string[]) ?? [];
    res.json({
      family: fam,
      currency: u.school!.currency,
      ...dues,
      invoices: dues.invoices.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, title: i.title, period: i.period, studentId: i.studentId, total: num(i.total), paidAmount: num(i.paidAmount), balance: i.balance, dueDate: ymd(i.dueDate), overdue: i.overdue, lateFeeIfPaidToday: i.lateFeeIfPaidToday, lines: i.lines.map((l) => ({ description: l.description, amount: num(l.amount) })) })),
      paidInvoices: paidInvoices.map((i) => ({ ...i, total: num(i.total), dueDate: ymd(i.dueDate) })),
      receipts: receipts.map((r) => ({ ...r, amount: num(r.amount) })),
      onlinePayment: u.role === 'PARENT' && modules.includes('online_fee_payment') && Boolean(gateway?.enabled && gateway.provider !== 'NONE'),
      allowPartial: Boolean(gateway?.allowPartial),
    });
  }),
);

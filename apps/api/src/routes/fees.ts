import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optStr, parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { assertPrincipal, can } from '../lib/http';
import { round2 } from '../lib/money';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { schoolToday } from './attendance';
import {
  cancelPayment,
  collect,
  createOneOff,
  familyDues,
  generateMonthly,
  getFeeSettings,
  monthLabel,
  num,
  openInvoices,
  recalcInvoice,
  ymd,
} from '../services/fees';
import { sendFeeNotices, sendReceipt } from '../services/feeMessages';
import { notify } from '../services/messaging';

const router = Router();
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.coerce.number().min(0).max(10_000_000);
const METHODS = ['CASH', 'BANK', 'CHEQUE', 'ONLINE', 'OTHER'] as const;

const need = (req: Request, ...keys: ('fees.collect' | 'fees.manage' | 'fees.reports')[]) => {
  if (!keys.some((k) => can(req, k))) throw forbidden('You do not have fee permissions');
};
const today = (req: Request) => schoolToday(req.user!.school!.timezone);

// ---------- Setup: fee heads, class amounts, settings ----------

router.get(
  '/setup',
  ah(async (req, res) => {
    need(req, 'fees.manage', 'fees.collect', 'fees.reports');
    const schoolId = tenantId(req);
    const [heads, classes, settings] = await Promise.all([
      prisma.feeHead.findMany({ where: { schoolId }, include: { classFees: true }, orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.classLevel.findMany({ where: { schoolId, deletedAt: null }, select: { id: true, name: true, stream: true, _count: { select: { students: { where: { status: 'ACTIVE', deletedAt: null } } } } }, orderBy: { sortOrder: 'asc' } }),
      getFeeSettings(schoolId),
    ]);
    res.json({
      heads: heads.map((h) => ({ ...h, classFees: h.classFees.map((c) => ({ classId: c.classId, amount: num(c.amount) })) })),
      classes: classes.map((c) => ({ id: c.id, name: c.name, stream: c.stream, students: c._count.students })),
      settings: { ...settings, lateFeeAmount: num(settings.lateFeeAmount), lateFeeMax: num(settings.lateFeeMax) },
      currency: req.user!.school!.currency,
    });
  }),
);

const headBody = z.object({
  name: z.string().trim().min(2).max(80),
  frequency: z.enum(['MONTHLY', 'SELECTED_MONTHS', 'ONE_TIME']).default('MONTHLY'),
  months: z.array(z.number().int().min(1).max(12)).optional(),
  discountable: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

router.post(
  '/heads',
  ah(async (req, res) => {
    need(req, 'fees.manage');
    const body = parse(headBody, req.body);
    if (body.frequency === 'SELECTED_MONTHS' && !body.months?.length) throw badRequest('Choose the months this fee is charged in');
    const head = await prisma.feeHead.create({ data: { ...body, months: body.months ?? undefined, schoolId: tenantId(req) } });
    await audit(req, { action: 'fees.head_create', entityType: 'FeeHead', entityId: head.id, after: body });
    res.status(201).json({ head });
  }),
);

/** Quick start: the usual fee heads. */
router.post(
  '/heads/presets',
  ah(async (req, res) => {
    need(req, 'fees.manage');
    const schoolId = tenantId(req);
    const existing = new Set((await prisma.feeHead.findMany({ where: { schoolId } })).map((h) => h.name.toLowerCase()));
    const presets = [
      { name: 'Tuition fee', frequency: 'MONTHLY', discountable: true, sortOrder: 10 },
      { name: 'Computer / lab fee', frequency: 'MONTHLY', discountable: false, sortOrder: 20 },
      { name: 'Annual charges', frequency: 'SELECTED_MONTHS', months: [4], discountable: false, sortOrder: 30 },
      { name: 'Exam fee', frequency: 'SELECTED_MONTHS', months: [9, 2], discountable: false, sortOrder: 40 },
      { name: 'Admission fee', frequency: 'ONE_TIME', discountable: false, sortOrder: 50 },
    ] as const;
    let created = 0;
    for (const p of presets) {
      if (existing.has(p.name.toLowerCase())) continue;
      await prisma.feeHead.create({ data: { ...p, months: 'months' in p ? [...p.months] : undefined, schoolId } });
      created++;
    }
    res.json({ created });
  }),
);

router.patch(
  '/heads/:id',
  ah(async (req, res) => {
    need(req, 'fees.manage');
    const before = await prisma.feeHead.findFirst({ where: { id: req.params.id, schoolId: tenantId(req) } });
    if (!before) throw notFound('Fee head not found');
    const body = parse(headBody.partial(), req.body);
    const head = await prisma.feeHead.update({ where: { id: before.id }, data: { ...body, months: body.months ?? undefined } });
    await audit(req, { action: 'fees.head_update', entityType: 'FeeHead', entityId: head.id, before, after: body });
    res.json({ head });
  }),
);

/** Save the fee structure grid (class × head amounts). */
router.put(
  '/structure',
  ah(async (req, res) => {
    need(req, 'fees.manage');
    const schoolId = tenantId(req);
    const body = parse(z.object({ rows: z.array(z.object({ classId: z.string(), headId: z.string(), amount: money })).max(2000) }), req.body);
    const classIds = new Set((await prisma.classLevel.findMany({ where: { schoolId }, select: { id: true } })).map((c) => c.id));
    const headIds = new Set((await prisma.feeHead.findMany({ where: { schoolId }, select: { id: true } })).map((h) => h.id));
    if (body.rows.some((r) => !classIds.has(r.classId) || !headIds.has(r.headId))) throw badRequest('Unknown class or fee head');
    await prisma.$transaction(
      body.rows.map((r) =>
        r.amount > 0
          ? prisma.classFee.upsert({ where: { classId_headId: { classId: r.classId, headId: r.headId } }, create: r, update: { amount: r.amount } })
          : prisma.classFee.deleteMany({ where: { classId: r.classId, headId: r.headId } }),
      ),
    );
    await audit(req, { action: 'fees.structure', entityType: 'School', entityId: schoolId, after: { rows: body.rows.length } });
    res.json({ ok: true });
  }),
);

router.put(
  '/settings',
  ah(async (req, res) => {
    need(req, 'fees.manage');
    const schoolId = tenantId(req);
    const body = parse(
      z.object({
        dueDay: z.coerce.number().int().min(1).max(28),
        lateFeeType: z.enum(['NONE', 'FIXED', 'PER_DAY']),
        lateFeeAmount: money,
        lateFeeMax: money.default(0),
        autoGenerate: z.boolean(),
        bankDetails: z.object({ bankName: optStr(80), accountTitle: optStr(120), accountNumber: optStr(40), iban: optStr(40), branch: optStr(120) }).nullish(),
        voucherNote: optStr(500),
        receiptPrefix: z.string().trim().regex(/^[A-Z0-9]{1,10}$/i, 'Letters and numbers only').transform((v) => v.toUpperCase()),
      }).partial(),
      req.body,
    );
    const before = await getFeeSettings(schoolId);
    const settings = await prisma.feeSettings.update({ where: { schoolId }, data: { ...body, bankDetails: body.bankDetails ?? undefined } });
    await audit(req, { action: 'fees.settings', entityType: 'School', entityId: schoolId, before, after: body });
    res.json({ settings });
  }),
);

router.patch(
  '/students/:id/discount',
  ah(async (req, res) => {
    need(req, 'fees.manage');
    const st = await prisma.student.findFirst({ where: { id: req.params.id, schoolId: tenantId(req), deletedAt: null } });
    if (!st) throw notFound('Student not found');
    const body = parse(z.object({ discountType: optStr(60), discountPercent: z.coerce.number().min(0).max(100).nullish(), discountAmount: money.nullish(), reason: optStr(300) }), req.body);
    const { reason, ...data } = body;
    await prisma.student.update({ where: { id: st.id }, data });
    await audit(req, { action: 'fees.discount', entityType: 'Student', entityId: st.id, before: { discountType: st.discountType, discountPercent: st.discountPercent, discountAmount: st.discountAmount }, after: data, reason });
    res.json({ ok: true });
  }),
);

// ---------- Vouchers ----------

router.post(
  '/generate',
  ah(async (req, res) => {
    need(req, 'fees.manage');
    const schoolId = tenantId(req);
    const body = parse(z.object({ period, classIds: z.array(z.string()).optional(), dueDate: dateStr.optional(), notify: z.boolean().default(false) }), req.body);
    const heads = await prisma.feeHead.count({ where: { schoolId, isActive: true, classFees: { some: {} } } });
    if (!heads) throw badRequest('Set up the fee structure first');
    const r = await generateMonthly(schoolId, body.period, { classIds: body.classIds, createdById: req.user!.id, dueDate: body.dueDate });
    let notices = { whatsapp: 0, inApp: 0 };
    if (r.created) {
      const families = (await prisma.feeInvoice.findMany({ where: { schoolId, period: body.period, createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } }, select: { familyId: true } })).map((i) => i.familyId);
      notices = await sendFeeNotices(schoolId, families, { force: body.notify, title: `Fee voucher for ${monthLabel(body.period)}` });
    }
    await audit(req, { action: 'fees.generate', entityType: 'School', entityId: schoolId, after: { ...body, ...r } });
    res.json({ ...r, notices });
  }),
);

router.post(
  '/charges',
  ah(async (req, res) => {
    need(req, 'fees.manage');
    const schoolId = tenantId(req);
    const body = parse(
      z.object({
        studentIds: z.array(z.string()).min(1).max(2000).optional(),
        classId: z.string().optional(),
        title: z.string().trim().min(2).max(120),
        lines: z.array(z.object({ headId: z.string().nullish(), description: z.string().trim().min(1).max(160), amount: z.coerce.number().min(-10_000_000).max(10_000_000) })).min(1).max(20),
        dueDate: dateStr,
      }),
      req.body,
    );
    let ids = body.studentIds ?? [];
    if (body.classId) ids = (await prisma.student.findMany({ where: { schoolId, classId: body.classId, status: 'ACTIVE', deletedAt: null }, select: { id: true } })).map((s) => s.id);
    if (!ids.length) throw badRequest('Choose students or a class');
    const created = await createOneOff(schoolId, { studentIds: ids, title: body.title, lines: body.lines, dueDate: body.dueDate, createdById: req.user!.id });
    await audit(req, { action: 'fees.charge', entityType: 'School', entityId: schoolId, after: { title: body.title, students: ids.length } });
    res.status(201).json({ created: created.length });
  }),
);

const invoiceInclude = {
  lines: true,
  allocations: { where: { payment: { status: { not: 'CANCELLED' } } }, include: { payment: { select: { id: true, receiptNo: true, receivedAt: true, method: true, source: true } } } },
} satisfies Prisma.FeeInvoiceInclude;

router.get(
  '/invoices',
  ah(async (req, res) => {
    need(req, 'fees.collect', 'fees.manage', 'fees.reports');
    const schoolId = tenantId(req);
    const q = parse(
      z.object({
        period: period.optional(),
        classId: z.string().optional(),
        sectionId: z.string().optional(),
        status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'CANCELLED', 'OPEN']).optional(),
        studentId: z.string().optional(),
        familyId: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
      }),
      req.query,
    );
    const where: Prisma.FeeInvoiceWhereInput = {
      schoolId,
      ...(q.period ? { period: q.period } : {}),
      ...(q.status === 'OPEN' ? { status: { in: ['UNPAID', 'PARTIAL'] } } : q.status ? { status: q.status } : {}),
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.familyId ? { familyId: q.familyId } : {}),
    };
    if (q.classId || q.sectionId) {
      const st = await prisma.student.findMany({ where: { schoolId, ...(q.classId ? { classId: q.classId } : {}), ...(q.sectionId ? { sectionId: q.sectionId } : {}) }, select: { id: true } });
      where.studentId = { in: st.map((s) => s.id) };
    }
    const [rows, total, sums] = await Promise.all([
      prisma.feeInvoice.findMany({ where, orderBy: [{ dueDate: 'desc' }, { invoiceNo: 'desc' }], skip: (q.page - 1) * 100, take: 100 }),
      prisma.feeInvoice.count({ where }),
      prisma.feeInvoice.aggregate({ where: { ...where, status: { not: 'CANCELLED' } }, _sum: { total: true, paidAmount: true } }),
    ]);
    const students = await prisma.student.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } },
      select: { id: true, fullName: true, admissionNo: true, class: { select: { name: true, stream: true } }, section: { select: { name: true } } },
    });
    res.json({
      invoices: rows.map((r) => ({ ...r, total: num(r.total), paidAmount: num(r.paidAmount), balance: round2(num(r.total) - num(r.paidAmount)), student: students.find((s) => s.id === r.studentId) })),
      total,
      sums: { total: num(sums._sum.total), paid: num(sums._sum.paidAmount) },
      page: q.page,
      pageSize: 100,
    });
  }),
);

router.get(
  '/invoices/:id',
  ah(async (req, res) => {
    need(req, 'fees.collect', 'fees.manage', 'fees.reports');
    const inv = await prisma.feeInvoice.findFirst({ where: { id: req.params.id, schoolId: tenantId(req) }, include: invoiceInclude });
    if (!inv) throw notFound('Voucher not found');
    res.json({ invoice: inv });
  }),
);

router.post(
  '/invoices/:id/cancel',
  ah(async (req, res) => {
    need(req, 'fees.manage');
    const body = parse(z.object({ reason: z.string().trim().min(2).max(300) }), req.body);
    const inv = await prisma.feeInvoice.findFirst({ where: { id: req.params.id, schoolId: tenantId(req) } });
    if (!inv) throw notFound('Voucher not found');
    if (num(inv.paidAmount) > 0) throw badRequest('This voucher has payments. Cancel the receipts first.');
    await prisma.feeInvoice.update({ where: { id: inv.id }, data: { status: 'CANCELLED' } });
    await audit(req, { action: 'fees.invoice_cancel', entityType: 'FeeInvoice', entityId: inv.id, before: { invoiceNo: inv.invoiceNo, total: num(inv.total) }, reason: body.reason });
    res.json({ ok: true });
  }),
);

/** Principal: add a waiver (negative) or extra charge to a voucher. */
router.post(
  '/invoices/:id/adjust',
  ah(async (req, res) => {
    assertPrincipal(req);
    const body = parse(z.object({ description: z.string().trim().min(2).max(160), amount: z.coerce.number().min(-10_000_000).max(10_000_000).refine((v) => v !== 0, 'Enter an amount') }), req.body);
    const inv = await prisma.feeInvoice.findFirst({ where: { id: req.params.id, schoolId: tenantId(req), status: { not: 'CANCELLED' } } });
    if (!inv) throw notFound('Voucher not found');
    if (num(inv.total) + body.amount < num(inv.paidAmount)) throw badRequest('The voucher would be less than what is already paid');
    await prisma.$transaction(async (tx) => {
      await tx.feeInvoiceLine.create({ data: { invoiceId: inv.id, kind: 'ADJUSTMENT', description: body.description, amount: body.amount } });
      await tx.feeInvoice.update({ where: { id: inv.id }, data: { total: { increment: body.amount } } });
      await recalcInvoice(tx, inv.id);
    });
    await audit(req, { action: 'fees.invoice_adjust', entityType: 'FeeInvoice', entityId: inv.id, after: body });
    res.json({ ok: true });
  }),
);

/** Everything needed to print vouchers: per student, or per family (one combined voucher). */
router.get(
  '/vouchers/print',
  ah(async (req, res) => {
    need(req, 'fees.collect', 'fees.manage');
    const schoolId = tenantId(req);
    const q = parse(
      z.object({ period: period.optional(), classId: z.string().optional(), sectionId: z.string().optional(), studentId: z.string().optional(), familyId: z.string().optional(), family: z.enum(['true', 'false']).default('false') }),
      req.query,
    );
    const studentWhere: Prisma.StudentWhereInput = {
      schoolId,
      deletedAt: null,
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.sectionId ? { sectionId: q.sectionId } : {}),
      ...(q.studentId ? { id: q.studentId } : {}),
      ...(q.familyId ? { familyId: q.familyId } : {}),
    };
    const students = await prisma.student.findMany({
      where: studentWhere,
      select: { id: true, fullName: true, admissionNo: true, rollNo: true, familyId: true, class: { select: { name: true, stream: true } }, section: { select: { name: true } }, family: { select: { familyNo: true, guardians: { where: { relation: 'FATHER' }, select: { fullName: true }, take: 1 } } } },
      orderBy: [{ class: { sortOrder: 'asc' } }, { section: { name: 'asc' } }, { rollNo: 'asc' }, { fullName: 'asc' }],
    });
    const ids = students.map((s) => s.id);
    const invoices = await prisma.feeInvoice.findMany({ where: { schoolId, studentId: { in: ids }, status: { in: ['UNPAID', 'PARTIAL'] } }, include: { lines: true }, orderBy: { dueDate: 'asc' } });
    const settings = await getFeeSettings(schoolId);
    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const late = (_due: Date) => (settings.lateFeeType === 'FIXED' ? num(settings.lateFeeAmount) : settings.lateFeeType === 'PER_DAY' ? num(settings.lateFeeAmount) : 0);
    const voucherFor = (studs: typeof students) => {
      const mine = invoices.filter((i) => studs.some((s) => s.id === i.studentId));
      const current = q.period ? mine.filter((i) => i.period === q.period) : mine.slice(-studs.length);
      const previous = mine.filter((i) => !current.includes(i));
      const bal = (i: (typeof mine)[number]) => round2(num(i.total) - num(i.paidAmount));
      const currentTotal = round2(current.reduce((a, i) => a + bal(i), 0));
      const arrears = round2(previous.reduce((a, i) => a + bal(i), 0));
      const dueDate = current[0]?.dueDate ?? mine[mine.length - 1]?.dueDate ?? null;
      return {
        students: studs.map((s) => ({ id: s.id, fullName: s.fullName, admissionNo: s.admissionNo, rollNo: s.rollNo, class: s.class, section: s.section })),
        familyNo: studs[0].family.familyNo,
        fatherName: studs[0].family.guardians[0]?.fullName ?? null,
        invoiceNos: current.map((i) => i.invoiceNo),
        lines: current.flatMap((i) => i.lines.map((l) => ({ description: studs.length > 1 ? `${students.find((s) => s.id === i.studentId)?.fullName.split(' ')[0]}: ${l.description}` : l.description, amount: num(l.amount) }))),
        alreadyPaid: round2(current.reduce((a, i) => a + num(i.paidAmount), 0)),
        currentTotal,
        arrears,
        total: round2(currentTotal + arrears),
        dueDate: dueDate ? ymd(dueDate) : null,
        lateFee: dueDate ? late(dueDate) : 0,
      };
    };
    let vouchers;
    if (q.family === 'true') {
      const byFam = new Map<string, typeof students>();
      for (const s of students) byFam.set(s.familyId, [...(byFam.get(s.familyId) ?? []), s]);
      vouchers = [...byFam.values()].map(voucherFor);
    } else vouchers = students.map((s) => voucherFor([s]));
    res.json({
      school: { name: school.name, address: school.address, city: school.city, phone: school.phone, logoFileId: school.logoFileId, currency: school.currency },
      settings: { bankDetails: settings.bankDetails, voucherNote: settings.voucherNote, lateFeeType: settings.lateFeeType, lateFeeAmount: num(settings.lateFeeAmount), lateFeeMax: num(settings.lateFeeMax) },
      period: q.period ?? null,
      vouchers: vouchers.filter((v) => v.total > 0),
    });
  }),
);

// ---------- Collection ----------

/** Find a family to collect from by student name, admission no, father name, phone or family no. */
router.get(
  '/lookup',
  ah(async (req, res) => {
    need(req, 'fees.collect');
    const schoolId = tenantId(req);
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query);
    const digits = q.replace(/[ \-]/g, '');
    const students = await prisma.student.findMany({
      where: {
        schoolId,
        deletedAt: null,
        OR: [
          { fullName: { contains: q } },
          { admissionNo: { contains: q } },
          { family: { familyNo: q } },
          { family: { guardians: { some: { OR: [{ fullName: { contains: q } }, { phone: { contains: digits } }, { whatsapp: { contains: digits } }, { cnic: { contains: q } }] } } } },
        ],
      },
      select: { id: true, fullName: true, admissionNo: true, status: true, photoFileId: true, familyId: true, class: { select: { name: true, stream: true } }, section: { select: { name: true } }, family: { select: { familyNo: true, guardians: { where: { relation: 'FATHER' }, select: { fullName: true }, take: 1 } } } },
      take: 15,
    });
    const dues = await prisma.feeInvoice.groupBy({ by: ['familyId'], where: { schoolId, familyId: { in: students.map((s) => s.familyId) }, status: { in: ['UNPAID', 'PARTIAL'] } }, _sum: { total: true, paidAmount: true } });
    res.json({
      students: students.map((s) => {
        const d = dues.find((x) => x.familyId === s.familyId);
        return { ...s, familyDue: d ? round2(num(d._sum.total) - num(d._sum.paidAmount)) : 0 };
      }),
    });
  }),
);

router.get(
  '/families/:familyId/dues',
  ah(async (req, res) => {
    need(req, 'fees.collect', 'fees.manage', 'fees.reports');
    const schoolId = tenantId(req);
    const fam = await prisma.family.findFirst({
      where: { id: req.params.familyId, schoolId },
      select: {
        id: true,
        familyNo: true,
        guardians: { select: { relation: true, fullName: true, phone: true, whatsapp: true } },
        students: { where: { deletedAt: null }, select: { id: true, fullName: true, admissionNo: true, status: true, photoFileId: true, discountType: true, discountPercent: true, discountAmount: true, class: { select: { name: true, stream: true } }, section: { select: { name: true } } } },
      },
    });
    if (!fam) throw notFound('Family not found');
    const dues = await familyDues(schoolId, fam.id, today(req));
    const recent = await prisma.feePayment.findMany({ where: { familyId: fam.id }, orderBy: { receivedAt: 'desc' }, take: 10, select: { id: true, receiptNo: true, amount: true, method: true, source: true, receivedAt: true, status: true } });
    res.json({
      family: { ...fam, students: fam.students.map((s) => ({ ...s, discountPercent: num(s.discountPercent), discountAmount: num(s.discountAmount) })) },
      ...dues,
      invoices: dues.invoices.map((i) => ({ ...i, total: num(i.total), paidAmount: num(i.paidAmount), lines: i.lines.map((l) => ({ ...l, amount: num(l.amount) })) })),
      recentPayments: recent.map((p) => ({ ...p, amount: num(p.amount) })),
      today: today(req),
    });
  }),
);

router.post(
  '/payments',
  ah(async (req, res) => {
    need(req, 'fees.collect');
    const schoolId = tenantId(req);
    const body = parse(
      z.object({
        familyId: z.string(),
        studentIds: z.array(z.string()).optional(),
        invoiceIds: z.array(z.string()).optional(),
        amount: z.coerce.number().positive().max(10_000_000),
        method: z.enum(METHODS),
        reference: optStr(120),
        receivedAt: dateStr.optional(),
        chargeLateFee: z.boolean().default(true),
        note: optStr(300),
      }),
      req.body,
    );
    const fam = await prisma.family.findFirst({ where: { id: body.familyId, schoolId } });
    if (!fam) throw notFound('Family not found');
    const t = today(req);
    if (body.receivedAt && body.receivedAt > t) throw badRequest('Payment date cannot be in the future');
    if (body.receivedAt && body.receivedAt < t && req.user!.role !== 'PRINCIPAL') throw forbidden('Only the principal can enter payments for past dates');
    if (body.method === 'ONLINE') throw badRequest('Online payments are recorded automatically');
    // Waiving a late fee needs fee-management rights.
    if (!body.chargeLateFee && !can(req, 'fees.manage')) {
      const d = await familyDues(schoolId, fam.id, body.receivedAt ?? t, body.studentIds);
      if (d.lateFee > 0) throw forbidden('Only the principal can waive the late fee');
    }
    const result = await prisma.$transaction(
      (tx) =>
        collect(tx, {
          schoolId,
          familyId: fam.id,
          studentIds: body.studentIds,
          invoiceIds: body.invoiceIds,
          amount: body.amount,
          method: body.method,
          reference: body.reference,
          receivedAt: body.receivedAt ? new Date(`${body.receivedAt}T${new Date().toISOString().slice(11)}`) : new Date(),
          collectedById: req.user!.id,
          source: 'COUNTER',
          chargeLateFee: body.chargeLateFee,
          note: body.note,
        }),
      { timeout: 20000 },
    );
    const whatsapp = await sendReceipt(schoolId, result.payment.id);
    await audit(req, { action: 'fees.collect', entityType: 'FeePayment', entityId: result.payment.id, after: { ...body, receiptNo: result.payment.receiptNo, credit: result.credit, lateFees: result.lateAdded } });
    res.status(201).json({ paymentId: result.payment.id, receiptNo: result.payment.receiptNo, credit: result.credit, lateFeeAdded: round2(result.lateAdded.reduce((a, l) => a + l.amount, 0)), whatsappQueued: whatsapp });
  }),
);

const paymentSelect = {
  id: true,
  receiptNo: true,
  familyId: true,
  studentId: true,
  amount: true,
  method: true,
  reference: true,
  source: true,
  receivedAt: true,
  collectedById: true,
  handoverId: true,
  status: true,
  cancelReason: true,
  note: true,
} satisfies Prisma.FeePaymentSelect;

router.get(
  '/payments',
  ah(async (req, res) => {
    need(req, 'fees.collect', 'fees.reports');
    const schoolId = tenantId(req);
    const q = parse(
      z.object({
        from: dateStr.optional(),
        to: dateStr.optional(),
        collectedById: z.string().optional(),
        method: z.enum(METHODS).optional(),
        source: z.enum(['COUNTER', 'ONLINE']).optional(),
        status: z.enum(['VALID', 'CANCEL_REQUESTED', 'CANCELLED']).optional(),
        familyId: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
      }),
      req.query,
    );
    // Collectors without report rights see only their own receipts.
    const onlyMine = !can(req, 'fees.reports');
    const where: Prisma.FeePaymentWhereInput = {
      schoolId,
      ...(q.from || q.to ? { receivedAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86400000) } : {}) } } : {}),
      ...(onlyMine ? { collectedById: req.user!.id } : q.collectedById ? { collectedById: q.collectedById } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.familyId ? { familyId: q.familyId } : {}),
    };
    const [rows, total, sum] = await Promise.all([
      prisma.feePayment.findMany({ where, select: paymentSelect, orderBy: { receivedAt: 'desc' }, skip: (q.page - 1) * 100, take: 100 }),
      prisma.feePayment.count({ where }),
      prisma.feePayment.aggregate({ where: { ...where, status: { not: 'CANCELLED' } }, _sum: { amount: true } }),
    ]);
    const [families, users] = await Promise.all([
      prisma.family.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.familyId))] } }, select: { id: true, familyNo: true, students: { where: { deletedAt: null }, select: { id: true, fullName: true } } } }),
      prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.collectedById).filter(Boolean) as string[])] } }, select: { id: true, fullName: true } }),
    ]);
    res.json({
      payments: rows.map((r) => {
        const f = families.find((x) => x.id === r.familyId);
        return { ...r, amount: num(r.amount), familyNo: f?.familyNo, students: r.studentId ? f?.students.filter((s) => s.id === r.studentId) : f?.students, collectedBy: users.find((u) => u.id === r.collectedById)?.fullName ?? null };
      }),
      total,
      sum: num(sum._sum.amount),
      page: q.page,
      pageSize: 100,
    });
  }),
);

/** Receipt (also used for printing). */
router.get(
  '/payments/:id',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const p = await prisma.feePayment.findFirst({
      where: { id: req.params.id, schoolId },
      include: { allocations: { include: { invoice: { select: { id: true, invoiceNo: true, title: true, period: true, studentId: true, total: true, paidAmount: true } } } } },
    });
    if (!p) throw notFound('Receipt not found');
    const u = req.user!;
    const isParent = u.role === 'PARENT' && (await prisma.family.count({ where: { id: p.familyId, parentUserId: u.id } })) > 0;
    if (!isParent && !can(req, 'fees.collect') && !can(req, 'fees.reports')) throw notFound('Receipt not found');
    const [family, collector, school] = await Promise.all([
      prisma.family.findUniqueOrThrow({ where: { id: p.familyId }, select: { familyNo: true, guardians: { where: { relation: 'FATHER' }, select: { fullName: true }, take: 1 }, students: { select: { id: true, fullName: true, admissionNo: true, class: { select: { name: true, stream: true } }, section: { select: { name: true } } } } } }),
      p.collectedById ? prisma.user.findUnique({ where: { id: p.collectedById }, select: { fullName: true } }) : null,
      prisma.school.findUniqueOrThrow({ where: { id: schoolId } }),
    ]);
    const balance = round2((await openInvoices(prisma, { familyId: p.familyId })).reduce((a, i) => a + i.balance, 0));
    const allocated = round2(p.allocations.reduce((a, x) => a + num(x.amount), 0));
    res.json({
      receipt: {
        ...p,
        amount: num(p.amount),
        allocations: p.allocations.map((a) => ({ amount: num(a.amount), invoice: { ...a.invoice, total: num(a.invoice.total), paidAmount: num(a.invoice.paidAmount), student: family.students.find((s) => s.id === a.invoice.studentId) } })),
        credit: round2(num(p.amount) - allocated),
        collectedBy: collector?.fullName ?? (p.source === 'ONLINE' ? 'Online payment' : null),
      },
      family: { familyNo: family.familyNo, fatherName: family.guardians[0]?.fullName ?? null, students: family.students },
      familyBalance: balance,
      school: { name: school.name, address: school.address, city: school.city, phone: school.phone, logoFileId: school.logoFileId, currency: school.currency },
    });
  }),
);

/** Principal cancels a receipt; staff can only ask for it to be cancelled. */
router.post(
  '/payments/:id/cancel',
  ah(async (req, res) => {
    need(req, 'fees.collect');
    const schoolId = tenantId(req);
    const body = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    const p = await prisma.feePayment.findFirst({ where: { id: req.params.id, schoolId }, include: { handover: true } });
    if (!p) throw notFound('Receipt not found');
    if (p.status === 'CANCELLED') throw badRequest('Already cancelled');
    if (p.source === 'ONLINE' && req.user!.role !== 'PRINCIPAL') throw forbidden('Only the principal can cancel online payments');
    if (req.user!.role === 'PRINCIPAL') {
      await prisma.$transaction(async (tx) => {
        await cancelPayment(tx, p.id, req.user!.id, body.reason);
        if (p.handover?.status === 'PENDING') {
          // Keep the pending hand-over's expected total right.
          await tx.feePayment.update({ where: { id: p.id }, data: { handoverId: null } });
          await refreshHandover(tx, p.handover.id);
        }
      });
      await audit(req, { action: 'fees.receipt_cancel', entityType: 'FeePayment', entityId: p.id, before: { receiptNo: p.receiptNo, amount: num(p.amount) }, reason: body.reason });
      return res.json({ status: 'CANCELLED' });
    }
    if (p.collectedById !== req.user!.id) throw forbidden('You can only ask to cancel your own receipts');
    await prisma.feePayment.update({ where: { id: p.id }, data: { status: 'CANCEL_REQUESTED', cancelReason: body.reason, cancelRequestedById: req.user!.id } });
    await audit(req, { action: 'fees.receipt_cancel_request', entityType: 'FeePayment', entityId: p.id, reason: body.reason });
    res.json({ status: 'CANCEL_REQUESTED' });
  }),
);

router.post(
  '/payments/:id/cancel-decision',
  ah(async (req, res) => {
    assertPrincipal(req);
    const body = parse(z.object({ approve: z.boolean(), note: optStr(300) }), req.body);
    const p = await prisma.feePayment.findFirst({ where: { id: req.params.id, schoolId: tenantId(req), status: 'CANCEL_REQUESTED' }, include: { handover: true } });
    if (!p) throw notFound('No pending cancellation for this receipt');
    await prisma.$transaction(async (tx) => {
      if (body.approve) {
        await cancelPayment(tx, p.id, req.user!.id, p.cancelReason ?? body.note ?? 'Approved');
        if (p.handover?.status === 'PENDING') {
          await tx.feePayment.update({ where: { id: p.id }, data: { handoverId: null } });
          await refreshHandover(tx, p.handover.id);
        }
      } else await tx.feePayment.update({ where: { id: p.id }, data: { status: 'VALID' } });
    });
    await audit(req, { action: body.approve ? 'fees.receipt_cancel_approve' : 'fees.receipt_cancel_reject', entityType: 'FeePayment', entityId: p.id, reason: body.note });
    res.json({ ok: true });
  }),
);

// ---------- Hand-over of collected money ----------

async function refreshHandover(tx: Prisma.TransactionClient, id: string) {
  const payments = await tx.feePayment.findMany({ where: { handoverId: id, status: { not: 'CANCELLED' } }, select: { amount: true, method: true } });
  const byMethod: Record<string, number> = {};
  for (const p of payments) byMethod[p.method] = round2((byMethod[p.method] ?? 0) + num(p.amount));
  await tx.feeHandover.update({ where: { id }, data: { expectedAmount: round2(payments.reduce((a, p) => a + num(p.amount), 0)), byMethod } });
}

/** Money a collector has received that has not been handed over yet. */
async function cashInHand(schoolId: string, userId: string) {
  const payments = await prisma.feePayment.findMany({
    where: { schoolId, collectedById: userId, source: 'COUNTER', handoverId: null, status: { not: 'CANCELLED' } },
    select: { id: true, receiptNo: true, amount: true, method: true, receivedAt: true, status: true, familyId: true },
    orderBy: { receivedAt: 'asc' },
  });
  const byMethod: Record<string, number> = {};
  for (const p of payments) byMethod[p.method] = round2((byMethod[p.method] ?? 0) + num(p.amount));
  return { payments: payments.map((p) => ({ ...p, amount: num(p.amount) })), byMethod, total: round2(payments.reduce((a, p) => a + num(p.amount), 0)) };
}

router.get(
  '/handover/mine',
  ah(async (req, res) => {
    need(req, 'fees.collect');
    const schoolId = tenantId(req);
    const [inHand, history] = await Promise.all([
      cashInHand(schoolId, req.user!.id),
      prisma.feeHandover.findMany({ where: { schoolId, staffId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 30, include: { _count: { select: { payments: true } } } }),
    ]);
    res.json({ isPrincipal: req.user!.role === 'PRINCIPAL', inHand, history: history.map((h) => ({ ...h, expectedAmount: num(h.expectedAmount), declaredAmount: num(h.declaredAmount) })) });
  }),
);

router.post(
  '/handover',
  ah(async (req, res) => {
    need(req, 'fees.collect');
    if (req.user!.role === 'PRINCIPAL') throw badRequest('Money collected by the principal does not need a hand-over');
    const schoolId = tenantId(req);
    const body = parse(z.object({ declaredAmount: money, note: optStr(300) }), req.body);
    const inHand = await cashInHand(schoolId, req.user!.id);
    if (!inHand.payments.length) throw badRequest('You have no receipts to hand over');
    if (inHand.payments.some((p) => p.status === 'CANCEL_REQUESTED')) throw badRequest('Some receipts are waiting for a cancellation decision. Ask the principal to decide first.');
    const h = await prisma.$transaction(async (tx) => {
      const created = await tx.feeHandover.create({
        data: { schoolId, staffId: req.user!.id, expectedAmount: inHand.total, declaredAmount: body.declaredAmount, byMethod: inHand.byMethod, note: body.note ?? null },
      });
      await tx.feePayment.updateMany({ where: { id: { in: inHand.payments.map((p) => p.id) } }, data: { handoverId: created.id } });
      return created;
    });
    const principals = await prisma.user.findMany({ where: { schoolId, role: 'PRINCIPAL', isActive: true, deletedAt: null }, select: { id: true } });
    const cur = req.user!.school!.currency;
    await notify(
      schoolId,
      principals.map((p) => ({ userId: p.id, type: 'HANDOVER', title: `Fee hand-over from ${req.user!.fullName}`, body: `${cur} ${body.declaredAmount.toLocaleString('en-US')} handed over (${inHand.payments.length} receipts). Please review and approve.`, link: '/school/fees?tab=handovers' })),
    );
    await audit(req, { action: 'fees.handover_create', entityType: 'FeeHandover', entityId: h.id, after: { expected: inHand.total, declared: body.declaredAmount, receipts: inHand.payments.length } });
    res.status(201).json({ handoverId: h.id, expected: inHand.total, declared: body.declaredAmount, difference: round2(body.declaredAmount - inHand.total) });
  }),
);

router.get(
  '/handovers',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const q = parse(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }), req.query);
    const rows = await prisma.feeHandover.findMany({ where: { schoolId, ...(q.status ? { status: q.status } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, include: { _count: { select: { payments: true } } } });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.staffId, r.reviewedById].filter(Boolean) as string[]))] } }, select: { id: true, fullName: true } });
    // Collectors still holding money (not handed over yet).
    const holding = await prisma.feePayment.groupBy({ by: ['collectedById'], where: { schoolId, source: 'COUNTER', handoverId: null, status: { not: 'CANCELLED' } }, _sum: { amount: true }, _count: { _all: true } });
    const holders = await prisma.user.findMany({ where: { id: { in: holding.map((h) => h.collectedById!).filter(Boolean) } }, select: { id: true, fullName: true, role: true } });
    res.json({
      handovers: rows.map((r) => ({
        ...r,
        expectedAmount: num(r.expectedAmount),
        declaredAmount: num(r.declaredAmount),
        difference: round2(num(r.declaredAmount) - num(r.expectedAmount)),
        staff: users.find((u) => u.id === r.staffId)?.fullName ?? null,
        reviewedBy: users.find((u) => u.id === r.reviewedById)?.fullName ?? null,
      })),
      notHandedOver: holding
        .map((h) => ({ user: holders.find((u) => u.id === h.collectedById), amount: num(h._sum.amount), receipts: h._count._all }))
        .filter((h) => h.user && h.user.role !== 'PRINCIPAL'),
      pendingCancellations: await prisma.feePayment.count({ where: { schoolId, status: 'CANCEL_REQUESTED' } }),
    });
  }),
);

router.get(
  '/handovers/:id',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const h = await prisma.feeHandover.findFirst({ where: { id: req.params.id, schoolId } });
    if (!h) throw notFound('Hand-over not found');
    if (req.user!.role !== 'PRINCIPAL' && h.staffId !== req.user!.id) throw forbidden();
    const payments = await prisma.feePayment.findMany({ where: { handoverId: h.id }, select: paymentSelect, orderBy: { receivedAt: 'asc' } });
    const families = await prisma.family.findMany({ where: { id: { in: payments.map((p) => p.familyId) } }, select: { id: true, familyNo: true, students: { where: { deletedAt: null }, select: { fullName: true } } } });
    res.json({
      handover: { ...h, expectedAmount: num(h.expectedAmount), declaredAmount: num(h.declaredAmount) },
      payments: payments.map((p) => ({ ...p, amount: num(p.amount), family: families.find((f) => f.id === p.familyId) })),
    });
  }),
);

router.post(
  '/handovers/:id/review',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const body = parse(z.object({ approve: z.boolean(), note: optStr(300) }), req.body);
    const h = await prisma.feeHandover.findFirst({ where: { id: req.params.id, schoolId, status: 'PENDING' } });
    if (!h) throw notFound('No pending hand-over');
    if (!body.approve && !body.note) throw badRequest('Write why it is rejected');
    await prisma.$transaction(async (tx) => {
      await tx.feeHandover.update({ where: { id: h.id }, data: { status: body.approve ? 'APPROVED' : 'REJECTED', reviewedById: req.user!.id, reviewedAt: new Date(), reviewNote: body.note ?? null } });
      // Rejected: receipts go back to the staff member's cash in hand so they can hand over again.
      if (!body.approve) await tx.feePayment.updateMany({ where: { handoverId: h.id }, data: { handoverId: null } });
    });
    await notify(schoolId, [
      {
        userId: h.staffId,
        type: 'HANDOVER',
        title: body.approve ? 'Hand-over approved' : 'Hand-over rejected',
        body: body.approve ? `Your hand-over of ${num(h.declaredAmount).toLocaleString('en-US')} was approved.` : `Your hand-over was rejected: ${body.note}`,
        link: '/school/fees?tab=handover',
      },
    ]);
    await audit(req, { action: body.approve ? 'fees.handover_approve' : 'fees.handover_reject', entityType: 'FeeHandover', entityId: h.id, after: { expected: num(h.expectedAmount), declared: num(h.declaredAmount) }, reason: body.note });
    res.json({ ok: true });
  }),
);

export default router;


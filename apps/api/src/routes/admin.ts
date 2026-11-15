import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, SchoolStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optEmail, optStr, parse, patchOf } from '../lib/validate';
import { badRequest, conflict, notFound } from '../lib/errors';
import { generateTempPassword, hashPassword } from '../lib/password';
import { round2, toNum } from '../lib/money';
import { addMonths, periodOf, periodRange } from '../lib/dates';
import { MODULE_KEYS, MODULES } from '../config/modules';
import { PERMISSIONS } from '../config/permissions';
import { audit } from '../services/audit';
import { effectiveLimits, usageSummary } from '../services/limits';
import { effectiveSchoolStatus } from '../services/schoolStatus';
import {
  applyOverduePolicy,
  generateInvoice,
  generateInvoicesForPeriod,
  previewInvoice,
  restoreIfCleared,
} from '../services/billing';

const router = Router();

const money = z.coerce.number().min(0).max(100_000_000);
const optInt = z.coerce.number().int().min(0).nullable().optional();
const username = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Only letters, numbers, dot, dash and underscore');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

// ---------- Reference data ----------

router.get('/meta', (_req, res) => {
  res.json({ modules: MODULES, permissions: PERMISSIONS });
});

// ---------- Dashboard ----------

router.get(
  '/dashboard',
  ah(async (_req, res) => {
    const now = new Date();
    const thisPeriod = periodOf(now);
    const schools = await prisma.school.findMany({ where: { deletedAt: null }, include: { plan: true } });
    const byStatus: Record<SchoolStatus, number> = { TRIAL: 0, ACTIVE: 0, READ_ONLY: 0, SUSPENDED: 0 };
    for (const s of schools) byStatus[effectiveSchoolStatus(s, now)]++;

    const totalStudents = await prisma.user.count({
      where: { role: 'STUDENT', isActive: true, deletedAt: null, school: { deletedAt: null } },
    });

    // Revenue = payments received, grouped by the month they were received.
    const yearAgo = periodRange(addMonths(thisPeriod, -12)).start;
    const paid = await prisma.schoolInvoice.findMany({
      where: { status: 'PAID', paidAt: { gte: yearAgo } },
      select: { paidAt: true, paidAmount: true, amount: true },
    });
    const monthly = new Map<string, number>();
    for (let i = 12; i >= 0; i--) monthly.set(addMonths(thisPeriod, -i), 0);
    for (const p of paid) {
      const key = periodOf(p.paidAt!);
      if (monthly.has(key)) monthly.set(key, round2(monthly.get(key)! + Number(p.paidAmount ?? p.amount)));
    }
    const series = [...monthly.entries()].map(([month, amount]) => ({ month, amount }));
    const sumLast = (n: number) => round2(series.slice(-n).reduce((a, b) => a + b.amount, 0));

    const unpaid = await prisma.schoolInvoice.findMany({
      where: { status: 'UNPAID', school: { deletedAt: null } },
      include: { school: { select: { id: true, name: true, status: true } } },
      orderBy: { dueDate: 'asc' },
    });
    const overdue = unpaid.filter((i) => i.dueDate < now);

    const upgradeRequests = await prisma.auditLog.findMany({
      where: { action: 'school.upgrade_request' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { school: { select: { id: true, name: true } } },
    });

    res.json({
      schools: { total: schools.length, byStatus },
      totalStudents,
      revenue: {
        thisMonth: monthly.get(thisPeriod) ?? 0,
        lastMonth: monthly.get(addMonths(thisPeriod, -1)) ?? 0,
        last6Months: sumLast(6),
        last12Months: sumLast(12),
        sameMonthLastYear: monthly.get(addMonths(thisPeriod, -12)) ?? 0,
        series,
      },
      dues: {
        outstanding: round2(unpaid.reduce((a, i) => a + Number(i.amount), 0)),
        overdueCount: overdue.length,
        overdue: overdue.slice(0, 10).map((i) => ({
          invoiceId: i.id,
          period: i.period,
          amount: toNum(i.amount),
          dueDate: i.dueDate,
          school: i.school,
        })),
      },
      upgradeRequests: upgradeRequests.map((r) => ({
        id: r.id,
        school: r.school,
        message: r.reason,
        createdAt: r.createdAt,
      })),
    });
  }),
);

// ---------- Plans ----------

const planBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: optStr(500),
  monthlyPrice: money,
  includedStudents: z.coerce.number().int().min(0),
  perStudentPrice: money,
  maxStudents: optInt,
  maxStaff: optInt,
  maxCampuses: z.coerce.number().int().min(1).default(1),
  storageLimitMb: z.coerce.number().int().min(10),
  maxFileSizeMb: z.coerce.number().int().min(1).max(500),
  modules: z.array(z.enum(MODULE_KEYS as [string, ...string[]])).default([]),
  isActive: z.boolean().default(true),
});

const serializePlan = (p: Prisma.PlanGetPayload<{ include: { _count: { select: { schools: true } } } }>) => ({
  ...p,
  monthlyPrice: toNum(p.monthlyPrice),
  perStudentPrice: toNum(p.perStudentPrice),
  schoolCount: p._count.schools,
  _count: undefined,
});

router.get(
  '/plans',
  ah(async (_req, res) => {
    const plans = await prisma.plan.findMany({
      orderBy: { monthlyPrice: 'asc' },
      include: { _count: { select: { schools: { where: { deletedAt: null } } } } },
    });
    res.json({ plans: plans.map(serializePlan) });
  }),
);

router.post(
  '/plans',
  ah(async (req, res) => {
    const body = parse(planBody, req.body);
    const plan = await prisma.plan.create({ data: body, include: { _count: { select: { schools: true } } } });
    await audit(req, { action: 'plan.create', entityType: 'Plan', entityId: plan.id, after: body });
    res.status(201).json({ plan: serializePlan(plan) });
  }),
);

router.patch(
  '/plans/:id',
  ah(async (req, res) => {
    const body = parse(patchOf(planBody), req.body);
    const before = await prisma.plan.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Plan not found');
    const plan = await prisma.plan.update({
      where: { id: before.id },
      data: body,
      include: { _count: { select: { schools: true } } },
    });
    await audit(req, { action: 'plan.update', entityType: 'Plan', entityId: plan.id, before, after: body });
    res.json({ plan: serializePlan(plan) });
  }),
);

// ---------- Schools ----------

const schoolFields = {
  name: z.string().trim().min(2).max(160),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers and dashes'),
  address: optStr(300),
  city: optStr(80),
  phone: optStr(40),
  email: optEmail,
  planId: z.string().min(1),
  billingDay: z.coerce.number().int().min(1).max(28).default(10),
  timezone: z.string().max(60).default('Asia/Karachi'),
  currency: z.string().trim().toUpperCase().max(8).default('PKR'),
  customStorageLimitMb: optInt,
  customMaxStudents: optInt,
  customMaxStaff: optInt,
};

const createSchoolBody = z.object({
  school: z.object({
    ...schoolFields,
    status: z.enum(['TRIAL', 'ACTIVE']).default('TRIAL'),
    trialDays: z.coerce.number().int().min(1).max(90).default(14),
    mainCampusName: optStr(120),
  }),
  principal: z.object({
    fullName: z.string().trim().min(2).max(160),
    username,
    email: optEmail,
    phone: optStr(40),
  }),
});

async function schoolStats(ids: string[]) {
  if (ids.length === 0) return { storage: new Map<string, number>(), students: new Map<string, number>() };
  const [storage, students] = await Promise.all([
    prisma.storedFile.groupBy({
      by: ['schoolId'],
      where: { schoolId: { in: ids }, deletedAt: null },
      _sum: { sizeBytes: true },
    }),
    prisma.user.groupBy({
      by: ['schoolId'],
      where: { schoolId: { in: ids }, role: 'STUDENT', isActive: true, deletedAt: null },
      _count: { _all: true },
    }),
  ]);
  return {
    storage: new Map(storage.map((r) => [r.schoolId, r._sum.sizeBytes ?? 0])),
    students: new Map(students.map((r) => [r.schoolId!, r._count._all])),
  };
}

router.get(
  '/schools',
  ah(async (req, res) => {
    const q = parse(
      z.object({
        search: z.string().trim().max(100).optional(),
        status: z.enum(['TRIAL', 'ACTIVE', 'READ_ONLY', 'SUSPENDED']).optional(),
        nearLimit: z.enum(['true', 'false']).optional(),
      }),
      req.query,
    );
    const schools = await prisma.school.findMany({
      where: {
        deletedAt: null,
        ...(q.search ? { OR: [{ name: { contains: q.search } }, { code: { contains: q.search } }, { city: { contains: q.search } }] } : {}),
      },
      include: {
        plan: true,
        users: { where: { role: 'PRINCIPAL', deletedAt: null }, select: { id: true, fullName: true, username: true, phone: true }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    const stats = await schoolStats(schools.map((s) => s.id));
    let rows = schools.map((s) => {
      const limits = effectiveLimits(s);
      const used = stats.storage.get(s.id) ?? 0;
      const students = stats.students.get(s.id) ?? 0;
      return {
        id: s.id,
        name: s.name,
        code: s.code,
        city: s.city,
        status: s.status,
        effectiveStatus: effectiveSchoolStatus(s),
        trialEndsAt: s.trialEndsAt,
        plan: { id: s.plan.id, name: s.plan.name },
        principal: s.users[0] ?? null,
        storage: { usedBytes: used, limitBytes: limits.storageBytes, percent: Math.round((used / limits.storageBytes) * 1000) / 10 },
        students: {
          used: students,
          limit: limits.maxStudents,
          percent: limits.maxStudents ? Math.round((students / limits.maxStudents) * 1000) / 10 : null,
        },
        createdAt: s.createdAt,
      };
    });
    if (q.status) rows = rows.filter((r) => r.effectiveStatus === q.status);
    if (q.nearLimit === 'true') rows = rows.filter((r) => r.storage.percent >= 80 || (r.students.percent ?? 0) >= 90);
    res.json({ schools: rows });
  }),
);

router.post(
  '/schools',
  ah(async (req, res) => {
    const { school: s, principal: p } = parse(createSchoolBody, req.body);
    const plan = await prisma.plan.findUnique({ where: { id: s.planId } });
    if (!plan || !plan.isActive) throw badRequest('Choose an active plan');
    if (await prisma.school.findUnique({ where: { code: s.code } })) throw conflict('School code is already used');
    if (await prisma.user.findUnique({ where: { username: p.username } })) throw conflict('Username is already taken');
    if (p.email && (await prisma.user.findUnique({ where: { email: p.email } }))) throw conflict('Email is already used');

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    const { trialDays, mainCampusName, ...schoolData } = s;

    const result = await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          ...schoolData,
          trialEndsAt: s.status === 'TRIAL' ? new Date(Date.now() + trialDays * 24 * 3600 * 1000) : null,
        },
      });
      await tx.campus.create({ data: { schoolId: school.id, name: mainCampusName || 'Main Campus', isMain: true } });
      const principal = await tx.user.create({
        data: {
          schoolId: school.id,
          role: 'PRINCIPAL',
          username: p.username,
          email: p.email ?? null,
          phone: p.phone ?? null,
          fullName: p.fullName,
          passwordHash,
          mustChangePassword: true,
        },
      });
      return { school, principal };
    });

    await audit(req, {
      action: 'school.create',
      entityType: 'School',
      entityId: result.school.id,
      schoolId: result.school.id,
      after: { school: schoolData, principal: { ...p } },
    });
    res.status(201).json({
      school: { id: result.school.id, name: result.school.name, code: result.school.code },
      principal: { id: result.principal.id, username: result.principal.username, fullName: result.principal.fullName },
      // Shown once so the super admin can share it. The principal must change it at first login.
      tempPassword,
    });
  }),
);

async function loadSchool(id: string) {
  const school = await prisma.school.findFirst({ where: { id, deletedAt: null }, include: { plan: true } });
  if (!school) throw notFound('School not found');
  return school;
}

router.get(
  '/schools/:id',
  ah(async (req, res) => {
    const school = await loadSchool(req.params.id);
    const [principals, campuses, invoices, usage, preview, recentAudit] = await Promise.all([
      prisma.user.findMany({
        where: { schoolId: school.id, role: 'PRINCIPAL', deletedAt: null },
        select: { id: true, fullName: true, username: true, email: true, phone: true, isActive: true, lastLoginAt: true, mustChangePassword: true },
      }),
      prisma.campus.findMany({ where: { schoolId: school.id }, orderBy: { createdAt: 'asc' } }),
      prisma.schoolInvoice.findMany({ where: { schoolId: school.id }, orderBy: { period: 'desc' }, take: 24 }),
      usageSummary(school),
      previewInvoice(school),
      prisma.auditLog.findMany({ where: { schoolId: school.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    res.json({
      school: {
        ...school,
        effectiveStatus: effectiveSchoolStatus(school),
        plan: { ...school.plan, monthlyPrice: toNum(school.plan.monthlyPrice), perStudentPrice: toNum(school.plan.perStudentPrice) },
      },
      principals,
      campuses,
      usage,
      nextInvoicePreview: preview,
      invoices: invoices.map(serializeInvoice),
      recentAudit,
    });
  }),
);

router.patch(
  '/schools/:id',
  ah(async (req, res) => {
    const before = await loadSchool(req.params.id);
    const body = parse(patchOf(z.object(schoolFields)), req.body);
    if (body.planId) {
      const plan = await prisma.plan.findUnique({ where: { id: body.planId } });
      if (!plan) throw badRequest('Plan not found');
    }
    if (body.code && body.code !== before.code && (await prisma.school.findUnique({ where: { code: body.code } }))) {
      throw conflict('School code is already used');
    }
    const school = await prisma.school.update({ where: { id: before.id }, data: body });
    const { plan: _plan, ...beforeData } = before;
    await audit(req, { action: 'school.update', entityType: 'School', entityId: school.id, schoolId: school.id, before: beforeData, after: body });
    res.json({ school });
  }),
);

router.post(
  '/schools/:id/status',
  ah(async (req, res) => {
    const before = await loadSchool(req.params.id);
    const body = parse(
      z.object({
        status: z.enum(['TRIAL', 'ACTIVE', 'READ_ONLY', 'SUSPENDED']),
        reason: optStr(500),
        trialDays: z.coerce.number().int().min(1).max(90).optional(),
      }),
      req.body,
    );
    const data: Prisma.SchoolUpdateInput = { status: body.status };
    if (body.status === 'TRIAL') data.trialEndsAt = new Date(Date.now() + (body.trialDays ?? 14) * 24 * 3600 * 1000);
    const school = await prisma.school.update({ where: { id: before.id }, data });
    await audit(req, {
      action: 'school.status',
      entityType: 'School',
      entityId: school.id,
      schoolId: school.id,
      before: { status: before.status },
      after: { status: school.status, trialEndsAt: school.trialEndsAt },
      reason: body.reason,
    });
    res.json({ school: { id: school.id, status: school.status, effectiveStatus: effectiveSchoolStatus(school), trialEndsAt: school.trialEndsAt } });
  }),
);

router.delete(
  '/schools/:id',
  ah(async (req, res) => {
    const school = await loadSchool(req.params.id);
    const body = parse(z.object({ confirmCode: z.string(), reason: optStr(500) }), req.body ?? {});
    if (body.confirmCode !== school.code) throw badRequest('Type the school code to confirm');
    await prisma.$transaction([
      prisma.school.update({ where: { id: school.id }, data: { deletedAt: new Date(), status: 'SUSPENDED' } }),
      prisma.refreshSession.updateMany({ where: { user: { schoolId: school.id }, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit(req, { action: 'school.delete', entityType: 'School', entityId: school.id, schoolId: school.id, reason: body.reason });
    res.json({ ok: true });
  }),
);

router.post(
  '/schools/:id/principal/reset-password',
  ah(async (req, res) => {
    const school = await loadSchool(req.params.id);
    const body = parse(z.object({ userId: z.string().optional() }), req.body ?? {});
    const principal = await prisma.user.findFirst({
      where: { schoolId: school.id, role: 'PRINCIPAL', deletedAt: null, ...(body.userId ? { id: body.userId } : {}) },
    });
    if (!principal) throw notFound('Principal not found');
    const tempPassword = generateTempPassword();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: principal.id },
        data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true, tokenVersion: { increment: 1 } },
      }),
      prisma.refreshSession.updateMany({ where: { userId: principal.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit(req, { action: 'user.reset_password', entityType: 'User', entityId: principal.id, schoolId: school.id });
    res.json({ username: principal.username, tempPassword });
  }),
);

router.post(
  '/schools/:id/principals',
  ah(async (req, res) => {
    const school = await loadSchool(req.params.id);
    const p = parse(
      z.object({ fullName: z.string().trim().min(2).max(160), username, email: optEmail, phone: optStr(40) }),
      req.body,
    );
    const tempPassword = generateTempPassword();
    const user = await prisma.user.create({
      data: {
        schoolId: school.id,
        role: 'PRINCIPAL',
        username: p.username,
        email: p.email ?? null,
        phone: p.phone ?? null,
        fullName: p.fullName,
        passwordHash: await hashPassword(tempPassword),
      },
    });
    await audit(req, { action: 'user.create', entityType: 'User', entityId: user.id, schoolId: school.id, after: { role: 'PRINCIPAL', ...p } });
    res.status(201).json({ principal: { id: user.id, username: user.username, fullName: user.fullName }, tempPassword });
  }),
);

router.post(
  '/schools/:id/principals/:userId/active',
  ah(async (req, res) => {
    const school = await loadSchool(req.params.id);
    const body = parse(z.object({ isActive: z.boolean() }), req.body);
    const user = await prisma.user.findFirst({ where: { id: req.params.userId, schoolId: school.id, role: 'PRINCIPAL', deletedAt: null } });
    if (!user) throw notFound('Principal not found');
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: body.isActive, ...(body.isActive ? {} : { tokenVersion: { increment: 1 } }) },
    });
    if (!body.isActive) {
      await prisma.refreshSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(req, { action: body.isActive ? 'user.activate' : 'user.deactivate', entityType: 'User', entityId: user.id, schoolId: school.id });
    res.json({ ok: true });
  }),
);

// ---------- Subscription invoices ----------

type InvoiceRow = Prisma.SchoolInvoiceGetPayload<object> & { school?: { id: string; name: string; code: string } };
function serializeInvoice(i: InvoiceRow) {
  return {
    ...i,
    basePrice: toNum(i.basePrice),
    perStudentPrice: toNum(i.perStudentPrice),
    amount: toNum(i.amount),
    paidAmount: toNum(i.paidAmount),
    overdue: i.status === 'UNPAID' && i.dueDate < new Date(),
  };
}

router.get(
  '/invoices',
  ah(async (req, res) => {
    const q = parse(
      z.object({
        status: z.enum(['UNPAID', 'PAID', 'VOID']).optional(),
        schoolId: z.string().optional(),
        period: period.optional(),
      }),
      req.query,
    );
    const invoices = await prisma.schoolInvoice.findMany({
      where: { status: q.status, schoolId: q.schoolId, period: q.period, school: { deletedAt: null } },
      include: { school: { select: { id: true, name: true, code: true } } },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    res.json({ invoices: invoices.map(serializeInvoice) });
  }),
);

router.post(
  '/invoices/generate',
  ah(async (req, res) => {
    const body = parse(z.object({ period: period.optional(), schoolId: z.string().optional() }), req.body ?? {});
    const p = body.period ?? periodOf(new Date());
    if (body.schoolId) {
      const school = await loadSchool(body.schoolId);
      const inv = await generateInvoice(school, p);
      if (!inv) throw conflict(`Invoice for ${p} already exists`);
      await audit(req, { action: 'invoice.create', entityType: 'SchoolInvoice', entityId: inv.id, schoolId: school.id });
      return res.status(201).json({ invoice: serializeInvoice(inv) });
    }
    const result = await generateInvoicesForPeriod(p);
    await audit(req, { action: 'invoice.generate_all', entityType: 'SchoolInvoice', after: { period: p, ...result } });
    res.json({ period: p, ...result });
  }),
);

router.post(
  '/invoices/:id/pay',
  ah(async (req, res) => {
    const body = parse(
      z.object({
        amount: z.coerce.number().positive(),
        method: z.string().trim().min(1).max(40),
        reference: optStr(120),
        paidAt: z.coerce.date().optional(),
        notes: optStr(500),
      }),
      req.body,
    );
    const inv = await prisma.schoolInvoice.findUnique({ where: { id: req.params.id } });
    if (!inv) throw notFound('Invoice not found');
    if (inv.status !== 'UNPAID') throw badRequest('Invoice is not unpaid');
    const updated = await prisma.schoolInvoice.update({
      where: { id: inv.id },
      data: {
        status: 'PAID',
        paidAmount: body.amount,
        paidAt: body.paidAt ?? new Date(),
        paymentMethod: body.method,
        paymentRef: body.reference ?? null,
        notes: body.notes ?? inv.notes,
      },
    });
    const restored = await restoreIfCleared(inv.schoolId);
    await audit(req, {
      action: 'invoice.pay',
      entityType: 'SchoolInvoice',
      entityId: inv.id,
      schoolId: inv.schoolId,
      after: { ...body, restoredToActive: restored },
    });
    res.json({ invoice: serializeInvoice(updated), schoolRestored: restored });
  }),
);

router.post(
  '/invoices/:id/void',
  ah(async (req, res) => {
    const body = parse(z.object({ reason: z.string().trim().min(2).max(500) }), req.body);
    const inv = await prisma.schoolInvoice.findUnique({ where: { id: req.params.id } });
    if (!inv) throw notFound('Invoice not found');
    if (inv.status !== 'UNPAID') throw badRequest('Only unpaid invoices can be voided');
    const updated = await prisma.schoolInvoice.update({ where: { id: inv.id }, data: { status: 'VOID', notes: body.reason } });
    await restoreIfCleared(inv.schoolId);
    await audit(req, { action: 'invoice.void', entityType: 'SchoolInvoice', entityId: inv.id, schoolId: inv.schoolId, reason: body.reason });
    res.json({ invoice: serializeInvoice(updated) });
  }),
);

router.post(
  '/jobs/overdue',
  ah(async (req, res) => {
    const changes = await applyOverduePolicy();
    await audit(req, { action: 'job.overdue', entityType: 'System', after: { changes } });
    res.json({ changes });
  }),
);

// ---------- Audit ----------

router.get(
  '/audit',
  ah(async (req, res) => {
    const q = parse(
      z.object({
        schoolId: z.string().optional(),
        action: z.string().max(80).optional(),
        page: z.coerce.number().int().min(1).default(1),
      }),
      req.query,
    );
    const where: Prisma.AuditLogWhereInput = {
      schoolId: q.schoolId,
      ...(q.action ? { action: { startsWith: q.action } } : {}),
    };
    const pageSize = 50;
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * pageSize,
        take: pageSize,
        include: { school: { select: { id: true, name: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))] as string[];
    const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, username: true } });
    const actorMap = new Map(actors.map((a) => [a.id, a]));
    res.json({
      rows: rows.map((r) => ({ ...r, actor: r.actorId ? actorMap.get(r.actorId) ?? null : null })),
      total,
      page: q.page,
      pageSize,
    });
  }),
);

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optEmail, optStr, parse } from '../lib/validate';
import { badRequest } from '../lib/errors';
import { requireRole, tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { storageByCategory, usageSummary } from '../services/limits';
import { previewInvoice } from '../services/billing';
import { toNum } from '../lib/money';
import { MODULES } from '../config/modules';

/** Routes for the logged-in school (all queries scoped by tenantId). */
const router = Router();


router.get(
  '/overview',
  ah(async (req, res) => {
    const school = req.user!.school!;
    const usage = await usageSummary(school);
    res.json({
      school: {
        id: school.id,
        name: school.name,
        code: school.code,
        address: school.address,
        city: school.city,
        phone: school.phone,
        email: school.email,
        logoFileId: school.logoFileId,
        status: school.status,
        effectiveStatus: school.effectiveStatus,
        trialEndsAt: school.trialEndsAt,
        timezone: school.timezone,
        currency: school.currency,
      },
      usage,
    });
  }),
);

router.patch(
  '/profile',
  requireRole('PRINCIPAL'),
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const body = parse(
      z.object({
        address: optStr(300),
        city: optStr(80),
        phone: optStr(40),
        email: optEmail,
        logoFileId: z.string().nullable().optional(),
      }),
      req.body,
    );
    if (body.logoFileId) {
      const file = await prisma.storedFile.findFirst({
        where: { id: body.logoFileId, schoolId, deletedAt: null, mimeType: { startsWith: 'image/' } },
      });
      if (!file) throw badRequest('Logo must be an uploaded image');
    }
    const before = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const school = await prisma.school.update({ where: { id: schoolId }, data: body });
    await audit(req, {
      action: 'school.profile_update',
      entityType: 'School',
      entityId: schoolId,
      before: { address: before.address, city: before.city, phone: before.phone, email: before.email, logoFileId: before.logoFileId },
      after: body,
    });
    res.json({ school });
  }),
);

/** "Plan and usage" page for the principal. */
router.get(
  '/usage',
  requireRole('PRINCIPAL', 'STAFF'),
  ah(async (req, res) => {
    const school = req.user!.school!;
    const [usage, byCategory, largest, preview] = await Promise.all([
      usageSummary(school),
      storageByCategory(school.id),
      prisma.storedFile.findMany({
        where: { schoolId: school.id, deletedAt: null },
        orderBy: { sizeBytes: 'desc' },
        take: 10,
        select: { id: true, originalName: true, category: true, sizeBytes: true, mimeType: true, createdAt: true },
      }),
      previewInvoice(school),
    ]);
    res.json({
      plan: {
        name: school.plan.name,
        monthlyPrice: toNum(school.plan.monthlyPrice),
        includedStudents: school.plan.includedStudents,
        perStudentPrice: toNum(school.plan.perStudentPrice),
        modules: (school.plan.modules as string[]).map((k) => ({ key: k, name: MODULES[k as keyof typeof MODULES] ?? k })),
      },
      currency: school.currency,
      estimatedMonthlyBill: preview.amount,
      usage,
      byCategory,
      largest,
    });
  }),
);

router.post(
  '/upgrade-request',
  requireRole('PRINCIPAL'),
  ah(async (req, res) => {
    const body = parse(z.object({ message: z.string().trim().min(2).max(500) }), req.body);
    await audit(req, { action: 'school.upgrade_request', entityType: 'School', entityId: tenantId(req), reason: body.message });
    res.status(201).json({ ok: true });
  }),
);

router.get(
  '/invoices',
  requireRole('PRINCIPAL'),
  ah(async (req, res) => {
    const invoices = await prisma.schoolInvoice.findMany({
      where: { schoolId: tenantId(req) },
      orderBy: { period: 'desc' },
      take: 24,
    });
    res.json({
      invoices: invoices.map((i) => ({
        id: i.id,
        period: i.period,
        amount: toNum(i.amount),
        activeStudents: i.activeStudents,
        extraStudents: i.extraStudents,
        status: i.status,
        dueDate: i.dueDate,
        paidAt: i.paidAt,
        overdue: i.status === 'UNPAID' && i.dueDate < new Date(),
      })),
    });
  }),
);

export default router;

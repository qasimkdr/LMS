import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { Prisma, prisma } from '@nexora/database';
import { z } from 'zod';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { MODULE_KEYS } from '../middleware/entitlements.js';
import { routeParam } from '../utils/http.js';

const router = Router();
router.use(requireAuth, requireRoles('SUPER_ADMIN'));

const modulesSchema = z.array(z.enum(MODULE_KEYS)).max(MODULE_KEYS.length);
const planSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/),
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional().nullable(),
  priceMonthly: z.coerce.number().min(0).max(100000000),
  currency: z.string().min(3).max(6).default('PKR'),
  modules: modulesSchema,
  studentLimit: z.coerce.number().int().min(1).max(1000000),
  teacherLimit: z.coerce.number().int().min(1).max(100000),
  storageLimitMb: z.coerce.number().int().min(100).max(1024 * 1024),
  isActive: z.boolean().default(true),
});

router.get('/', async (_req, res) => {
  const plans = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT p.*,
      (SELECT COUNT(*)::int FROM "SchoolSubscription" ss WHERE ss."planId" = p.id) AS "schoolCount"
    FROM "SubscriptionPlan" p
    ORDER BY p."priceMonthly" ASC, p.name ASC
  `);
  res.json(plans.map((p) => ({ ...p, priceMonthly: Number(p.priceMonthly), schoolCount: Number(p.schoolCount ?? 0) })));
});

router.post('/', async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid plan', issues: parsed.error.flatten() });
  const id = randomUUID();
  const d = parsed.data;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "SubscriptionPlan"
          (id,code,name,description,"priceMonthly",currency,modules,"studentLimit","teacherLimit","storageLimitMb","isActive","createdAt","updatedAt")
        VALUES
          (${id},${d.code},${d.name},${d.description ?? null},${d.priceMonthly},${d.currency.toUpperCase()},${d.modules},${d.studentLimit},${d.teacherLimit},${d.storageLimitMb},${d.isActive},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      `);
      await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'SUBSCRIPTION_PLAN_CREATED', entityType: 'SubscriptionPlan', entityId: id, afterData: d } });
    });
    res.status(201).json({ id, ...d });
  } catch (error: any) {
    if (String(error?.message ?? '').includes('SubscriptionPlan_code_key')) return res.status(409).json({ message: 'Plan code already exists' });
    throw error;
  }
});

router.patch('/:planId', async (req, res) => {
  const id = routeParam(req.params.planId);
  const parsed = planSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid plan update', issues: parsed.error.flatten() });
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "SubscriptionPlan" WHERE id=${id} LIMIT 1`);
  const before = rows[0];
  if (!before) return res.status(404).json({ message: 'Plan not found' });
  const d = parsed.data;
  const next = {
    code: d.code ?? before.code,
    name: d.name ?? before.name,
    description: d.description === undefined ? before.description : d.description,
    priceMonthly: d.priceMonthly ?? Number(before.priceMonthly),
    currency: (d.currency ?? before.currency).toUpperCase(),
    modules: d.modules ?? before.modules,
    studentLimit: d.studentLimit ?? before.studentLimit,
    teacherLimit: d.teacherLimit ?? before.teacherLimit,
    storageLimitMb: d.storageLimitMb ?? before.storageLimitMb,
    isActive: d.isActive ?? before.isActive,
  };
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "SubscriptionPlan" SET
        code=${next.code},name=${next.name},description=${next.description},"priceMonthly"=${next.priceMonthly},currency=${next.currency},
        modules=${next.modules},"studentLimit"=${next.studentLimit},"teacherLimit"=${next.teacherLimit},"storageLimitMb"=${next.storageLimitMb},
        "isActive"=${next.isActive},"updatedAt"=CURRENT_TIMESTAMP
      WHERE id=${id}
    `);
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'SUBSCRIPTION_PLAN_UPDATED', entityType: 'SubscriptionPlan', entityId: id, beforeData: { code: before.code, modules: before.modules, isActive: before.isActive }, afterData: next } });
  });
  res.json({ id, ...next });
});

const assignmentSchema = z.object({
  planId: z.string().min(1),
  moduleOverrides: modulesSchema.nullable().optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  applyPlanQuotas: z.boolean().default(true),
});

router.patch('/schools/:schoolId/assignment', async (req, res) => {
  const schoolId = routeParam(req.params.schoolId);
  const parsed = assignmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid plan assignment', issues: parsed.error.flatten() });
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) return res.status(404).json({ message: 'School not found' });
  const plans = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "SubscriptionPlan" WHERE id=${parsed.data.planId} AND "isActive"=true LIMIT 1`);
  const plan = plans[0];
  if (!plan) return res.status(404).json({ message: 'Active plan not found' });
  const startsAt = parsed.data.startsAt ?? new Date();
  const endsAt = parsed.data.endsAt ?? null;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "SchoolSubscription" ("schoolId","planId","moduleOverrides","startsAt","endsAt","createdAt","updatedAt")
      VALUES (${schoolId},${plan.id},${parsed.data.moduleOverrides ?? null},${startsAt},${endsAt},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT ("schoolId") DO UPDATE SET
        "planId"=EXCLUDED."planId","moduleOverrides"=EXCLUDED."moduleOverrides","startsAt"=EXCLUDED."startsAt","endsAt"=EXCLUDED."endsAt","updatedAt"=CURRENT_TIMESTAMP
    `);
    if (parsed.data.applyPlanQuotas) {
      await tx.school.update({ where: { id: schoolId }, data: { studentLimit: plan.studentLimit, teacherLimit: plan.teacherLimit, storageLimitMb: plan.storageLimitMb } });
    }
    await tx.auditLog.create({ data: { schoolId, actorId: req.auth!.userId, action: 'SCHOOL_PLAN_ASSIGNED', entityType: 'School', entityId: schoolId, beforeData: { studentLimit: school.studentLimit, teacherLimit: school.teacherLimit, storageLimitMb: school.storageLimitMb }, afterData: { planId: plan.id, planCode: plan.code, moduleOverrides: parsed.data.moduleOverrides ?? null, startsAt, endsAt, applyPlanQuotas: parsed.data.applyPlanQuotas } } });
  });
  res.json({ ok: true, schoolId, plan: { id: plan.id, code: plan.code, name: plan.name, modules: parsed.data.moduleOverrides ?? plan.modules }, startsAt, endsAt });
});

router.get('/schools/:schoolId/assignment', async (req, res) => {
  const schoolId = routeParam(req.params.schoolId);
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT ss.*,p.code AS "planCode",p.name AS "planName",p.modules AS "planModules",p."priceMonthly",p.currency
    FROM "SchoolSubscription" ss JOIN "SubscriptionPlan" p ON p.id=ss."planId"
    WHERE ss."schoolId"=${schoolId} LIMIT 1
  `);
  if (!rows[0]) return res.json(null);
  res.json({ ...rows[0], priceMonthly: Number(rows[0].priceMonthly) });
});

export default router;

import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { Prisma, prisma } from '@nexora/database';
import { z } from 'zod';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';
import { routeParam } from '../utils/http.js';

const router = Router();
router.use(requireAuth, requireTenant, requireRoles('PRINCIPAL'));

const structureSchema = z.object({
  monthlyAmount: z.coerce.number().min(0),
  currency: z.string().trim().min(3).max(8).default('PKR'),
  dueDay: z.coerce.number().int().min(1).max(28).default(10),
  lateFineAmount: z.coerce.number().min(0).default(0),
  lateFineGraceDays: z.coerce.number().int().min(0).max(30).default(0),
});

router.get('/structures', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT c.id AS "classId", c.name AS "className", c.section, c."academicYear",
           fs.id AS "structureId", fs."monthlyAmount", fs.currency, fs."dueDay",
           fs."lateFineAmount", fs."lateFineGraceDays", fs."updatedAt"
    FROM "Class" c
    LEFT JOIN "FeeStructure" fs ON fs."classId"=c.id AND fs."schoolId"=${schoolId}
    WHERE c."schoolId"=${schoolId}
    ORDER BY c.name, c.section NULLS FIRST
  `);
  res.json(rows.map((row) => ({
    classId: row.classId,
    className: row.className,
    section: row.section,
    academicYear: row.academicYear,
    configured: Boolean(row.structureId),
    structureId: row.structureId ?? null,
    monthlyAmount: Number(row.monthlyAmount ?? 0),
    currency: row.currency ?? 'PKR',
    dueDay: Number(row.dueDay ?? 10),
    lateFineAmount: Number(row.lateFineAmount ?? 0),
    lateFineGraceDays: Number(row.lateFineGraceDays ?? 0),
    updatedAt: row.updatedAt ?? null,
  })));
});

router.put('/structures/:classId', async (req, res) => {
  const parsed = structureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid fee structure', issues: parsed.error.flatten() });

  const schoolId = req.auth!.schoolId!;
  const classId = routeParam(req.params.classId);
  const klass = await prisma.class.findFirst({ where: { id: classId, schoolId } });
  if (!klass) return res.status(404).json({ message: 'Class not found' });

  const beforeRows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT * FROM "FeeStructure" WHERE "schoolId"=${schoolId} AND "classId"=${classId} LIMIT 1
  `);
  const before = beforeRows[0] ?? null;
  const now = new Date();
  const id = before?.id ?? randomUUID();
  const data = parsed.data;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "FeeStructure"
        (id,"schoolId","classId","monthlyAmount",currency,"dueDay","lateFineAmount","lateFineGraceDays","createdAt","updatedAt")
      VALUES
        (${id},${schoolId},${classId},${data.monthlyAmount},${data.currency.toUpperCase()},${data.dueDay},${data.lateFineAmount},${data.lateFineGraceDays},${now},${now})
      ON CONFLICT ("schoolId","classId") DO UPDATE SET
        "monthlyAmount"=EXCLUDED."monthlyAmount",
        currency=EXCLUDED.currency,
        "dueDay"=EXCLUDED."dueDay",
        "lateFineAmount"=EXCLUDED."lateFineAmount",
        "lateFineGraceDays"=EXCLUDED."lateFineGraceDays",
        "updatedAt"=EXCLUDED."updatedAt"
    `);
    await tx.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: before ? 'FEE_STRUCTURE_UPDATED' : 'FEE_STRUCTURE_CREATED',
        entityType: 'FeeStructure',
        entityId: id,
        beforeData: before ? {
          monthlyAmount: Number(before.monthlyAmount),
          currency: before.currency,
          dueDay: before.dueDay,
          lateFineAmount: Number(before.lateFineAmount),
          lateFineGraceDays: before.lateFineGraceDays,
        } : undefined,
        afterData: { ...data, currency: data.currency.toUpperCase(), classId },
      },
    });
  });

  res.json({ id, classId, ...data, currency: data.currency.toUpperCase(), configured: true });
});

export default router;

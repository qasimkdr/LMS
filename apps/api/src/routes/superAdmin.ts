import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma, SchoolStatus } from '@nexora/database';
import { requireAuth, requireRoles } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRoles('SUPER_ADMIN'));

const schoolSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  description: z.string().optional(),
  logoUrl: z.string().url().optional(),
  studentLimit: z.number().int().positive().default(1000),
  teacherLimit: z.number().int().positive().default(100),
  storageLimitMb: z.number().int().positive().default(1024),
  principal: z.object({
    firstName: z.string().min(2),
    lastName: z.string().min(1),
    email: z.string().email(),
    username: z.string().min(3),
    password: z.string().min(8),
  }),
});

router.get('/schools', async (_req, res) => {
  const schools = await prisma.school.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { users: true, classes: true, exams: true } },
      users: { where: { role: 'PRINCIPAL' }, select: { id: true, firstName: true, lastName: true, email: true, isActive: true } },
    },
  });
  res.json(schools);
});

router.post('/schools', async (req, res) => {
  const parsed = schoolSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid school data', issues: parsed.error.flatten() });
  const { principal, ...schoolData } = parsed.data;

  const passwordHash = await bcrypt.hash(principal.password, 12);
  const school = await prisma.$transaction(async (tx) => {
    const created = await tx.school.create({ data: schoolData });
    const principalUser = await tx.user.create({
      data: { schoolId: created.id, role: 'PRINCIPAL', email: principal.email.toLowerCase(), username: principal.username, passwordHash, firstName: principal.firstName, lastName: principal.lastName },
    });
    await tx.auditLog.create({ data: { schoolId: created.id, actorId: req.auth!.userId, action: 'SCHOOL_CREATED', entityType: 'School', entityId: created.id, afterData: { name: created.name, principalId: principalUser.id } } });
    return created;
  });

  res.status(201).json(school);
});

const lifecycleSchema = z.object({
  status: z.nativeEnum(SchoolStatus),
  subscriptionEnd: z.coerce.date().optional(),
  graceEndsAt: z.coerce.date().optional(),
  reason: z.string().max(500).optional(),
});

router.patch('/schools/:schoolId/status', async (req, res) => {
  const parsed = lifecycleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid lifecycle update' });
  const before = await prisma.school.findUnique({ where: { id: req.params.schoolId } });
  if (!before) return res.status(404).json({ message: 'School not found' });

  const updated = await prisma.$transaction(async (tx) => {
    const school = await tx.school.update({ where: { id: before.id }, data: { status: parsed.data.status, subscriptionEnd: parsed.data.subscriptionEnd, graceEndsAt: parsed.data.graceEndsAt } });
    await tx.auditLog.create({ data: { schoolId: school.id, actorId: req.auth!.userId, action: 'SCHOOL_STATUS_CHANGED', entityType: 'School', entityId: school.id, beforeData: { status: before.status }, afterData: { status: school.status, reason: parsed.data.reason ?? null } } });
    return school;
  });

  res.json(updated);
});

export default router;

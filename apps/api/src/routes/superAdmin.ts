import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma, prisma, SchoolStatus } from '@nexora/database';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { routeParam } from '../utils/http.js';
import { setRefreshCookie, signAccessToken, signRefreshToken } from '../lib/tokens.js';
import { rotateRefreshSessionFromAccess } from '../services/refreshSessions.js';

const router = Router();
router.use(requireAuth, requireRoles('SUPER_ADMIN'));

router.get('/dashboard', async (_req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const [
    schools,
    users,
    activeSchools,
    attentionSchools,
    newSchools,
    recentSchools,
    studentCount,
    teacherCount,
    storage,
  ] = await Promise.all([
    prisma.school.count(),
    prisma.user.count({
      where: { role: { in: ['STUDENT', 'TEACHER', 'STAFF', 'PRINCIPAL', 'PARENT'] } },
    }),
    prisma.school.count({ where: { status: 'ACTIVE' } }),
    prisma.school.count({
      where: { status: { in: ['TRIAL', 'GRACE_PERIOD', 'READ_ONLY', 'SUSPENDED'] } },
    }),
    prisma.school.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.school.findMany({
      where: { createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true },
    }),
    prisma.user.count({ where: { role: 'STUDENT' } }),
    prisma.user.count({ where: { role: 'TEACHER' } }),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(SUM("sizeBytes"),0) bytes,COUNT(*) files FROM "StorageObject"
    `),
  ]);

  const monthly = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      month: date.toLocaleString('en', { month: 'short' }),
      schools: recentSchools.filter((school) => school.createdAt >= date && school.createdAt < next).length,
    };
  });

  res.json({
    metrics: {
      schools,
      activeSchools,
      students: studentCount,
      teachers: teacherCount,
      users,
      attentionSchools,
      newSchools,
      storageBytes: Number(storage[0]?.bytes ?? 0),
      storageFiles: Number(storage[0]?.files ?? 0),
    },
    trend: monthly,
  });
});

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
      users: {
        where: { role: 'PRINCIPAL' },
        select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
      },
    },
  });
  const storage = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT "schoolId",COALESCE(SUM("sizeBytes"),0) bytes,COUNT(*) files
    FROM "StorageObject"
    GROUP BY "schoolId"
  `);
  const usage = new Map(
    storage.map((row) => [
      row.schoolId,
      { storageUsedBytes: Number(row.bytes ?? 0), storageFiles: Number(row.files ?? 0) },
    ]),
  );
  res.json(
    schools.map((school) => ({
      ...school,
      ...(usage.get(school.id) ?? { storageUsedBytes: 0, storageFiles: 0 }),
    })),
  );
});

router.post('/schools', async (req, res) => {
  const parsed = schoolSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid school data', issues: parsed.error.flatten() });
  }
  const { principal, ...schoolData } = parsed.data;
  const passwordHash = await bcrypt.hash(principal.password, 12);
  const school = await prisma.$transaction(async (tx) => {
    const created = await tx.school.create({ data: schoolData });
    const principalUser = await tx.user.create({
      data: {
        schoolId: created.id,
        role: 'PRINCIPAL',
        email: principal.email.toLowerCase(),
        username: principal.username,
        passwordHash,
        firstName: principal.firstName,
        lastName: principal.lastName,
      },
    });
    await tx.auditLog.create({
      data: {
        schoolId: created.id,
        actorId: req.auth!.userId,
        action: 'SCHOOL_CREATED',
        entityType: 'School',
        entityId: created.id,
        afterData: { name: created.name, principalId: principalUser.id },
      },
    });
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
  const schoolId = routeParam(req.params.schoolId);
  const before = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!before) return res.status(404).json({ message: 'School not found' });

  const updated = await prisma.$transaction(async (tx) => {
    const school = await tx.school.update({
      where: { id: before.id },
      data: {
        status: parsed.data.status,
        subscriptionEnd: parsed.data.subscriptionEnd,
        graceEndsAt: parsed.data.graceEndsAt,
      },
    });
    await tx.auditLog.create({
      data: {
        schoolId: school.id,
        actorId: req.auth!.userId,
        action: 'SCHOOL_STATUS_CHANGED',
        entityType: 'School',
        entityId: school.id,
        beforeData: { status: before.status },
        afterData: { status: school.status, reason: parsed.data.reason ?? null },
      },
    });
    return school;
  });
  res.json(updated);
});

const quotaSchema = z.object({
  studentLimit: z.coerce.number().int().min(1).max(1_000_000),
  teacherLimit: z.coerce.number().int().min(1).max(100_000),
  storageLimitMb: z.coerce.number().int().min(100).max(1024 * 1024),
});

router.patch('/schools/:schoolId/quotas', async (req, res) => {
  const parsed = quotaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid school quotas' });
  const id = routeParam(req.params.schoolId);
  const before = await prisma.school.findUnique({ where: { id } });
  if (!before) return res.status(404).json({ message: 'School not found' });

  const usage = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT COALESCE(SUM("sizeBytes"),0) bytes FROM "StorageObject" WHERE "schoolId"=${id}
  `);
  const used = Number(usage[0]?.bytes ?? 0);
  const limitBytes = parsed.data.storageLimitMb * 1024 * 1024;
  if (limitBytes < used) {
    return res.status(409).json({
      message: 'Storage quota cannot be lower than current usage',
      usedBytes: used,
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const school = await tx.school.update({ where: { id }, data: parsed.data });
    await tx.auditLog.create({
      data: {
        schoolId: id,
        actorId: req.auth!.userId,
        action: 'SCHOOL_QUOTAS_CHANGED',
        entityType: 'School',
        entityId: id,
        beforeData: {
          studentLimit: before.studentLimit,
          teacherLimit: before.teacherLimit,
          storageLimitMb: before.storageLimitMb,
        },
        afterData: parsed.data,
      },
    });
    return school;
  });
  res.json({ ...updated, storageUsedBytes: used });
});

router.post('/schools/:schoolId/impersonate', async (req, res) => {
  const schoolId = routeParam(req.params.schoolId);
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) return res.status(404).json({ message: 'School not found' });
  if (school.status === 'CANCELLED') {
    return res.status(409).json({ message: 'Cancelled schools cannot be impersonated' });
  }
  if (!req.auth!.sessionId) {
    return res.status(401).json({ message: 'Your Super Admin session must be refreshed before impersonation.' });
  }

  const principal = await prisma.user.findFirst({
    where: { schoolId, role: 'PRINCIPAL', isActive: true },
    include: { school: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!principal) return res.status(404).json({ message: 'No active Principal account found' });

  const payload = {
    userId: principal.id,
    role: 'PRINCIPAL' as const,
    schoolId,
    impersonatedById: req.auth!.userId,
    sessionId: req.auth!.sessionId,
  };
  const refreshToken = signRefreshToken(payload);
  const rotated = await rotateRefreshSessionFromAccess({
    sessionId: req.auth!.sessionId,
    ownerUserId: req.auth!.userId,
    expectedCurrentUserId: req.auth!.userId,
    nextCurrentUserId: principal.id,
    nextToken: refreshToken,
  });
  if (!rotated) {
    return res.status(401).json({ message: 'Your Super Admin session is no longer active.' });
  }

  setRefreshCookie(res, refreshToken);
  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: 'SUPPORT_IMPERSONATION_STARTED',
      entityType: 'User',
      entityId: principal.id,
      afterData: { schoolId, principalId: principal.id, sessionId: req.auth!.sessionId },
    },
  });
  res.json({
    accessToken: signAccessToken(payload),
    user: {
      id: principal.id,
      role: principal.role,
      firstName: principal.firstName,
      lastName: principal.lastName,
      avatarUrl: principal.avatarUrl,
      schoolId,
      school: {
        id: school.id,
        name: school.name,
        logoUrl: school.logoUrl,
        status: school.status,
      },
      impersonating: true,
      impersonatedById: req.auth!.userId,
    },
  });
});

export default router;

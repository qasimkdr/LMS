import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optEmail, optStr, parse } from '../lib/validate';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { assertCan, assertPrincipal, can } from '../lib/http';
import { generateTempPassword, hashPassword, prepareSecrets, type LoginSecret } from '../lib/password';
import { toNum } from '../lib/money';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { nextNumber } from '../services/counters';
import { effectiveLimits } from '../services/limits';
import { deleteSchoolFile } from '../services/files';
import { PERMISSION_KEYS } from '../config/permissions';

const router = Router();
const RESTORE_DAYS = 30;

const optDate = z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.date().nullish());
const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9._-]+$/, 'Only letters, numbers, dot, dash and underscore');

export const profileSchema = z.object({
  employeeNo: optStr(30),
  designation: optStr(80),
  cnic: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{5}-?\d{7}-?\d$/.test(v), 'CNIC must be 13 digits')
    .transform((v) => (v === '' ? null : v.replace(/^(\d{5})-?(\d{7})-?(\d)$/, '$1-$2-$3')))
    .nullish(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullish(),
  dob: optDate,
  qualification: optStr(160),
  joiningDate: optDate,
  salary: z.coerce.number().min(0).max(100_000_000).nullish(),
  address: optStr(300),
  campusId: z.string().nullish(),
  emergency: z.object({ name: optStr(160), relation: optStr(40), phone: optStr(30) }).nullish(),
  notes: optStr(5000),
});

export const staffSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  role: z.enum(['TEACHER', 'STAFF']),
  username: username.optional().or(z.literal('').transform(() => undefined)),
  email: optEmail,
  phone: optStr(30),
  photoFileId: z.string().nullish(),
  permissions: z.array(z.enum(PERMISSION_KEYS as [string, ...string[]])).default([]),
  profile: profileSchema.default({}),
});

export async function assertStaffCapacity(schoolId: string, adding: number) {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, include: { plan: true } });
  const limit = effectiveLimits(school).maxStaff;
  if (limit === null) return;
  const count = await prisma.user.count({ where: { schoolId, role: { in: ['TEACHER', 'STAFF'] }, isActive: true, deletedAt: null } });
  if (count + adding > limit) {
    throw forbidden(`Your plan allows ${limit} staff and teacher accounts (you have ${count}). Request an upgrade to add more.`, 'PLAN_LIMIT');
  }
}

/** Creates a teacher/staff account with profile. Call inside a transaction. */
export async function createStaff(
  tx: Prisma.TransactionClient,
  school: { id: string; code: string },
  input: z.infer<typeof staffSchema>,
  secret?: LoginSecret,
) {
  let employeeNo = input.profile.employeeNo ?? null;
  if (employeeNo) {
    if (await tx.staffProfile.findUnique({ where: { schoolId_employeeNo: { schoolId: school.id, employeeNo } } })) throw conflict(`Employee number ${employeeNo} is already used`);
  } else {
    do employeeNo = `E${String(await nextNumber(tx, school.id, 'employee')).padStart(3, '0')}`;
    while (await tx.staffProfile.findUnique({ where: { schoolId_employeeNo: { schoolId: school.id, employeeNo } } }));
  }
  let uname = input.username ?? `${school.code}.${employeeNo.toLowerCase()}`;
  if (input.username) {
    if (await tx.user.findUnique({ where: { username: uname } })) throw conflict('Username is already taken');
  } else {
    for (let i = 2; await tx.user.findUnique({ where: { username: uname } }); i++) uname = `${school.code}.${employeeNo.toLowerCase()}-${i}`;
  }
  if (input.email && (await tx.user.findUnique({ where: { email: input.email } }))) throw conflict('Email is already used by another account');
  const tempPassword = secret?.tempPassword ?? generateTempPassword();
  const passwordHash = secret?.hash ?? (await hashPassword(tempPassword));
  const { employeeNo: _e, ...profile } = input.profile;
  const user = await tx.user.create({
    data: {
      schoolId: school.id,
      role: input.role,
      username: uname,
      email: input.email ?? null,
      phone: input.phone ?? null,
      fullName: input.fullName,
      photoFileId: input.photoFileId ?? null,
      passwordHash,
      permissions: input.role === 'STAFF' ? input.permissions : [],
      staffProfile: { create: { ...profile, emergency: profile.emergency ?? undefined, schoolId: school.id, employeeNo } },
    },
  });
  return { userId: user.id, username: uname, employeeNo, tempPassword };
}

async function checkRefs(schoolId: string, input: { photoFileId?: string | null; profile?: { campusId?: string | null } }) {
  if (input.profile?.campusId && !(await prisma.campus.findFirst({ where: { id: input.profile.campusId, schoolId } }))) throw badRequest('Unknown campus');
  if (input.photoFileId && !(await prisma.storedFile.findFirst({ where: { id: input.photoFileId, schoolId, deletedAt: null, mimeType: { startsWith: 'image/' } } }))) {
    throw badRequest('Photo must be an uploaded image');
  }
}

async function loadStaff(req: Request, id: string, includeDeleted = false) {
  const user = await prisma.user.findFirst({
    where: { id, schoolId: tenantId(req), role: { in: ['TEACHER', 'STAFF'] }, ...(includeDeleted ? {} : { deletedAt: null }) },
  });
  if (!user) throw notFound('Staff member not found');
  return user;
}

router.get(
  '/',
  ah(async (req, res) => {
    assertCan(req, 'staff.view');
    const q = parse(
      z.object({
        q: z.string().trim().max(100).optional(),
        role: z.enum(['TEACHER', 'STAFF']).optional(),
        active: z.enum(['true', 'false', 'all']).default('true'),
      }),
      req.query,
    );
    const users = await prisma.user.findMany({
      where: {
        schoolId: tenantId(req),
        deletedAt: null,
        role: q.role ?? { in: ['TEACHER', 'STAFF'] },
        ...(q.active === 'all' ? {} : { isActive: q.active === 'true' }),
        ...(q.q
          ? { OR: [{ fullName: { contains: q.q } }, { username: { contains: q.q } }, { phone: { contains: q.q } }, { staffProfile: { employeeNo: { contains: q.q } } }] }
          : {}),
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        role: true,
        phone: true,
        email: true,
        isActive: true,
        photoFileId: true,
        lastLoginAt: true,
        mustChangePassword: true,
        staffProfile: { select: { employeeNo: true, designation: true, joiningDate: true } },
        _count: { select: { classTeacherOf: { where: { deletedAt: null } }, teachingSubjects: true } },
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });
    res.json({ staff: users });
  }),
);

router.post(
  '/',
  ah(async (req, res) => {
    assertCan(req, 'staff.manage');
    const schoolId = tenantId(req);
    const input = parse(staffSchema, req.body);
    // Only the principal may hand out permissions.
    if (req.user!.role !== 'PRINCIPAL') input.permissions = [];
    await checkRefs(schoolId, input);
    await assertStaffCapacity(schoolId, 1);
    const school = req.user!.school!;
    const [secret] = await prepareSecrets(1);
    const result = await prisma.$transaction((tx) => createStaff(tx, school, input, secret));
    await audit(req, { action: 'staff.create', entityType: 'User', entityId: result.userId, after: { ...input, username: result.username } });
    res.status(201).json(result);
  }),
);

router.get(
  '/:id',
  ah(async (req, res) => {
    assertCan(req, 'staff.view');
    const base = await loadStaff(req, req.params.id);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: base.id },
      select: {
        id: true,
        fullName: true,
        username: true,
        role: true,
        email: true,
        phone: true,
        isActive: true,
        photoFileId: true,
        permissions: true,
        lastLoginAt: true,
        mustChangePassword: true,
        createdAt: true,
        staffProfile: true,
        classTeacherOf: { where: { deletedAt: null }, select: { id: true, name: true, class: { select: { name: true, stream: true } } } },
        teachingSubjects: {
          where: { section: { deletedAt: null } },
          select: { id: true, subject: { select: { name: true } }, section: { select: { id: true, name: true, class: { select: { name: true, stream: true } } } } },
        },
      },
    });
    const showSalary = req.user!.role === 'PRINCIPAL';
    res.json({
      staff: {
        ...user,
        staffProfile: user.staffProfile ? { ...user.staffProfile, salary: showSalary ? toNum(user.staffProfile.salary) : null } : null,
      },
    });
  }),
);

router.patch(
  '/:id',
  ah(async (req, res) => {
    assertCan(req, 'staff.manage');
    const schoolId = tenantId(req);
    const before = await loadStaff(req, req.params.id);
    const beforeProfile = await prisma.staffProfile.findUnique({ where: { userId: before.id } });
    const body = parse(staffSchema.omit({ username: true }).partial().extend({ profile: profileSchema.partial().optional(), reason: optStr(500) }), req.body);
    const { reason, profile, permissions, ...data } = body;
    if (req.user!.role !== 'PRINCIPAL' && (permissions || profile?.salary !== undefined || data.role)) {
      throw forbidden('Only the principal can change roles, permissions or salary');
    }
    await checkRefs(schoolId, body);
    if (data.email && data.email !== before.email && (await prisma.user.findUnique({ where: { email: data.email } }))) throw conflict('Email already used');
    if (profile?.employeeNo && profile.employeeNo !== beforeProfile?.employeeNo) {
      if (await prisma.staffProfile.findUnique({ where: { schoolId_employeeNo: { schoolId, employeeNo: profile.employeeNo } } })) throw conflict('Employee number already used');
    }
    const role = data.role ?? before.role;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: before.id },
        data: {
          ...data,
          ...(permissions !== undefined || data.role ? { permissions: role === 'STAFF' ? (permissions ?? (before.permissions as string[]) ?? []) : [] } : {}),
        },
      });
      if (profile) {
        const { employeeNo, emergency, ...rest } = profile;
        await tx.staffProfile.upsert({
          where: { userId: before.id },
          create: { ...rest, emergency: emergency ?? undefined, schoolId, userId: before.id, employeeNo: employeeNo ?? `E${before.id.slice(-5)}` },
          update: { ...rest, ...(employeeNo ? { employeeNo } : {}), ...(emergency !== undefined ? { emergency: emergency ?? undefined } : {}) },
        });
      }
      // A teacher who becomes office staff stops being class teacher / subject teacher.
      if (data.role === 'STAFF' && before.role === 'TEACHER') {
        await tx.section.updateMany({ where: { classTeacherId: before.id }, data: { classTeacherId: null } });
        await tx.teachingAssignment.deleteMany({ where: { teacherId: before.id } });
      }
    });
    if (data.photoFileId !== undefined && before.photoFileId && before.photoFileId !== data.photoFileId) await deleteSchoolFile(schoolId, before.photoFileId);
    await audit(req, { action: 'staff.update', entityType: 'User', entityId: before.id, before: { ...before, profile: beforeProfile }, after: body, reason });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    assertPrincipal(req);
    const user = await loadStaff(req, req.params.id);
    const body = parse(z.object({ reason: optStr(300) }), req.body ?? {});
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date(), isActive: false, tokenVersion: { increment: 1 } } }),
      prisma.refreshSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.section.updateMany({ where: { classTeacherId: user.id }, data: { classTeacherId: null } }),
      prisma.teachingAssignment.deleteMany({ where: { teacherId: user.id } }),
    ]);
    await audit(req, { action: 'staff.delete', entityType: 'User', entityId: user.id, before: { fullName: user.fullName, username: user.username }, reason: body.reason });
    res.json({ ok: true, restorableDays: RESTORE_DAYS });
  }),
);

router.post(
  '/:id/restore',
  ah(async (req, res) => {
    assertPrincipal(req);
    const user = await loadStaff(req, req.params.id, true);
    if (!user.deletedAt) return res.json({ ok: true });
    if (user.deletedAt.getTime() < Date.now() - RESTORE_DAYS * 86400000) throw badRequest(`Can only restore within ${RESTORE_DAYS} days`);
    await assertStaffCapacity(tenantId(req), 1);
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: null, isActive: true } });
    await audit(req, { action: 'staff.restore', entityType: 'User', entityId: user.id });
    res.json({ ok: true });
  }),
);

export default router;

// ---------- Account actions for any user in the school ----------

export const usersRouter = Router();

/** Principal manages everyone; staff with students.manage manage student and parent accounts. */
async function loadManagedUser(req: Request, id: string) {
  const user = await prisma.user.findFirst({ where: { id, schoolId: tenantId(req), deletedAt: null } });
  if (!user) throw notFound('Account not found');
  if (user.id === req.user!.id) throw badRequest('Use "Change password" for your own account');
  if (user.role === 'PRINCIPAL' || user.role === 'SUPER_ADMIN') throw forbidden('Principal accounts are managed by the platform admin');
  const ok = req.user!.role === 'PRINCIPAL' || (['STUDENT', 'PARENT'].includes(user.role) && can(req, 'students.manage'));
  if (!ok) throw forbidden();
  return user;
}

usersRouter.post(
  '/:id/reset-password',
  ah(async (req, res) => {
    const user = await loadManagedUser(req, req.params.id);
    const tempPassword = generateTempPassword();
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true, tokenVersion: { increment: 1 } } }),
      prisma.refreshSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit(req, { action: 'user.reset_password', entityType: 'User', entityId: user.id });
    res.json({ username: user.username, fullName: user.fullName, tempPassword });
  }),
);

usersRouter.post(
  '/:id/active',
  ah(async (req, res) => {
    const user = await loadManagedUser(req, req.params.id);
    const body = parse(z.object({ isActive: z.boolean() }), req.body);
    if (body.isActive && !user.isActive && ['TEACHER', 'STAFF'].includes(user.role)) await assertStaffCapacity(tenantId(req), 1);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { isActive: body.isActive, ...(body.isActive ? {} : { tokenVersion: { increment: 1 } }) } }),
      ...(body.isActive ? [] : [prisma.refreshSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })]),
    ]);
    await audit(req, { action: body.isActive ? 'user.activate' : 'user.deactivate', entityType: 'User', entityId: user.id });
    res.json({ ok: true });
  }),
);

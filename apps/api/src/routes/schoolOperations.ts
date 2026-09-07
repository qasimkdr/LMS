import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant, requireRoles('PRINCIPAL'));

router.get('/overview', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const [school, users, students, classes, subjects] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true, slug: true, logoUrl: true, description: true, phone: true, email: true, address: true, timezone: true, primaryColor: true, secondaryColor: true, status: true } }),
    prisma.user.findMany({ where: { schoolId, role: { in: ['PRINCIPAL','STAFF','TEACHER'] } }, select: { id: true, role: true, firstName: true, lastName: true, email: true, username: true, isActive: true, avatarUrl: true }, orderBy: [{ role: 'asc' }, { firstName: 'asc' }] }),
    prisma.studentProfile.findMany({ where: { schoolId }, include: { user: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true } }, class: { select: { id: true, name: true, section: true } } }, orderBy: { admissionNo: 'asc' } }),
    prisma.class.findMany({ where: { schoolId }, orderBy: [{ name: 'asc' }, { section: 'asc' }] }),
    prisma.subject.findMany({ where: { schoolId }, orderBy: { name: 'asc' } }),
  ]);
  res.json({ school, users, students, classes, subjects });
});

const personSchema = z.object({ role: z.enum(['STAFF','TEACHER']), firstName: z.string().min(2), lastName: z.string().min(1), email: z.string().email(), username: z.string().min(3), password: z.string().min(8) });
router.post('/users', async (req, res) => {
  const schoolId = req.auth!.schoolId!; const parsed = personSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid user data', issues: parsed.error.flatten() });
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = await prisma.user.create({ data: { schoolId, role: parsed.data.role, firstName: parsed.data.firstName, lastName: parsed.data.lastName, email: parsed.data.email.toLowerCase(), username: parsed.data.username, passwordHash } });
  await prisma.auditLog.create({ data: { schoolId, actorId: req.auth!.userId, action: 'SCHOOL_USER_CREATED', entityType: 'User', entityId: user.id, afterData: { role: user.role, email: user.email } } });
  res.status(201).json(user);
});

const classSchema = z.object({ name: z.string().min(1), section: z.string().optional(), academicYear: z.string().optional() });
router.post('/classes', async (req, res) => { const schoolId = req.auth!.schoolId!; const parsed = classSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ message: 'Invalid class data' }); const row = await prisma.class.create({ data: { schoolId, ...parsed.data } }); res.status(201).json(row); });

const subjectSchema = z.object({ name: z.string().min(2), code: z.string().optional() });
router.post('/subjects', async (req, res) => { const schoolId = req.auth!.schoolId!; const parsed = subjectSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ message: 'Invalid subject data' }); const row = await prisma.subject.create({ data: { schoolId, ...parsed.data } }); res.status(201).json(row); });

const studentSchema = z.object({ firstName: z.string().min(2), lastName: z.string().min(1), email: z.string().email(), username: z.string().min(3), password: z.string().min(8), admissionNo: z.string().min(1), classId: z.string().uuid().optional(), section: z.string().optional(), guardianPhone: z.string().optional() });
router.post('/students', async (req, res) => {
  const schoolId = req.auth!.schoolId!; const parsed = studentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid student data', issues: parsed.error.flatten() });
  const { admissionNo, classId, section, guardianPhone, password, ...userData } = parsed.data; const passwordHash = await bcrypt.hash(password, 12);
  const student = await prisma.$transaction(async (tx) => { const user = await tx.user.create({ data: { schoolId, role: 'STUDENT', ...userData, email: userData.email.toLowerCase(), passwordHash } }); const profile = await tx.studentProfile.create({ data: { schoolId, userId: user.id, admissionNo, classId, section, guardianPhone } }); await tx.auditLog.create({ data: { schoolId, actorId: req.auth!.userId, action: 'STUDENT_CREATED', entityType: 'StudentProfile', entityId: profile.id, afterData: { admissionNo, classId: classId ?? null } } }); return profile; });
  res.status(201).json(student);
});

const logoRef=z.string().refine(v=>v.startsWith('storage://')||/^https?:\/\//i.test(v),'Logo must be a secure storage reference or http(s) URL');
const brandingSchema = z.object({
  name: z.string().min(2).optional(), logoUrl: logoRef.nullable().optional(), description: z.string().max(1000).nullable().optional(), phone: z.string().nullable().optional(), email: z.string().email().nullable().optional(), address: z.string().max(500).nullable().optional(), timezone: z.string().min(2).optional(), primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()
});
router.patch('/school', async (req, res) => {
  const schoolId = req.auth!.schoolId!; const parsed = brandingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid school settings', issues: parsed.error.flatten() });
  const before = await prisma.school.findUnique({ where: { id: schoolId } });
  const school = await prisma.school.update({ where: { id: schoolId }, data: parsed.data });
  await prisma.auditLog.create({ data: { schoolId, actorId: req.auth!.userId, action: 'SCHOOL_PROFILE_UPDATED', entityType: 'School', entityId: schoolId, beforeData: before ? { name: before.name, logoUrl: before.logoUrl, primaryColor: before.primaryColor, secondaryColor: before.secondaryColor } : undefined, afterData: parsed.data } });
  res.json(school);
});

export default router;
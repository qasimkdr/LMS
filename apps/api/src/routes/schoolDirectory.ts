import { Router } from 'express';
import { prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant, requireRoles('PRINCIPAL', 'STAFF', 'TEACHER'));

router.get('/', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const [school, teachers, classes, subjects] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true, logoUrl: true, description: true, status: true } }),
    prisma.user.findMany({ where: { schoolId, role: 'TEACHER', isActive: true }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }], select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } }),
    prisma.class.findMany({ where: { schoolId }, orderBy: [{ name: 'asc' }, { section: 'asc' }], select: { id: true, name: true, section: true, academicYear: true } }),
    prisma.subject.findMany({ where: { schoolId }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } }),
  ]);
  res.json({ school, teachers, classes, subjects });
});

export default router;

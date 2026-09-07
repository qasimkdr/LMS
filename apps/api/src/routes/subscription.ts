import { Router } from 'express';
import { prisma } from '@nexora/database';
import { requireAuth, requireTenant } from '../middleware/auth.js';
import { getSchoolEntitlements } from '../middleware/entitlements.js';

const router = Router();
router.use(requireAuth, requireTenant);

router.get('/current', async (req, res) => {
  if (req.auth!.role === 'SUPER_ADMIN') return res.json({ unrestricted: true, modules: [], planCode: 'PLATFORM' });
  const schoolId = req.auth!.schoolId!;
  const [school, entitlement] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { status: true, trialEndsAt: true, subscriptionEnd: true, graceEndsAt: true, studentLimit: true, teacherLimit: true, storageLimitMb: true } }),
    getSchoolEntitlements(schoolId),
  ]);
  if (!school) return res.status(404).json({ message: 'School not found' });
  res.json({
    schoolStatus: school.status,
    trialEndsAt: school.trialEndsAt,
    subscriptionEnd: school.subscriptionEnd,
    graceEndsAt: school.graceEndsAt,
    studentLimit: school.studentLimit,
    teacherLimit: school.teacherLimit,
    storageLimitMb: school.storageLimitMb,
    ...entitlement,
  });
});

export default router;

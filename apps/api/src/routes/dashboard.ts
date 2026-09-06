import { Router } from 'express';
import { prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant);

router.get('/principal', requireRoles('PRINCIPAL'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const [students, teachers, pendingApprovals, classes] = await Promise.all([
    prisma.user.count({ where: { schoolId, role: 'STUDENT', isActive: true } }),
    prisma.user.count({ where: { schoolId, role: 'TEACHER', isActive: true } }),
    prisma.approvalRequest.count({ where: { schoolId, status: { in: ['PENDING', 'RESUBMITTED'] } } }),
    prisma.class.count({ where: { schoolId } }),
  ]);

  const recentApprovals = await prisma.approvalRequest.findMany({
    where: { schoolId },
    orderBy: { updatedAt: 'desc' },
    take: 5,
    select: { id: true, requestType: true, status: true, revision: true, updatedAt: true },
  });

  res.json({ students, teachers, pendingApprovals, classes, recentApprovals });
});

export default router;

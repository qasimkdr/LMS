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

router.get('/teacher', requireRoles('TEACHER'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const teacherId = req.auth!.userId;
  const assignments = await prisma.teacherAssignment.findMany({
    where: { schoolId, teacherId },
    include: { class: { select: { id: true, name: true, section: true, _count: { select: { students: true } } } }, subject: { select: { id: true, name: true, code: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const classIds = [...new Set(assignments.map(a => a.classId))];
  const [examCount, pendingReviews, attendanceSessions] = await Promise.all([
    prisma.exam.count({ where: { schoolId, createdById: teacherId } }),
    prisma.examAttempt.count({ where: { schoolId, status: 'PENDING_REVIEW', exam: { createdById: teacherId } } }),
    prisma.attendanceSession.count({ where: { schoolId, markedById: teacherId } }),
  ]);
  const studentCount = assignments.reduce((sum, a) => sum + a.class._count.students, 0);
  res.json({ assignmentCount: assignments.length, studentCount, examCount, pendingReviews, attendanceSessions, assignments, classIds });
});

export default router;

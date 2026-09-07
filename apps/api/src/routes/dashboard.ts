import { Router } from 'express';
import { Prisma, prisma } from '@nexora/database';
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

router.get('/staff', requireRoles('STAFF'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const staffId = req.auth!.userId;
  const [students, classes, myPendingRequests, unreadNotifications, announcements, openBatchRows] = await Promise.all([
    prisma.user.count({ where: { schoolId, role: 'STUDENT', isActive: true } }),
    prisma.class.count({ where: { schoolId } }),
    prisma.approvalRequest.count({ where: { schoolId, requesterId: staffId, status: { in: ['PENDING', 'RESUBMITTED', 'REVISION_REQUIRED'] } } }),
    prisma.notification.count({ where: { schoolId, userId: staffId, readAt: null } }),
    prisma.announcement.findMany({
      where: {
        schoolId,
        audience: { has: 'STAFF' },
        AND: [
          { OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
        ],
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: 4,
      select: { id: true, title: true, body: true, isPinned: true, createdAt: true },
    }),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id,status,"totalAmount","studentCount","createdAt","submittedAt"
      FROM "FeeRecoveryBatch"
      WHERE "schoolId"=${schoolId} AND "staffId"=${staffId} AND status IN ('OPEN','SUBMITTED')
      ORDER BY CASE WHEN status='SUBMITTED' THEN 0 ELSE 1 END,"createdAt" DESC
      LIMIT 1
    `),
  ]);

  const recentRequests = await prisma.approvalRequest.findMany({
    where: { schoolId, requesterId: staffId },
    orderBy: { updatedAt: 'desc' },
    take: 5,
    select: { id: true, requestType: true, status: true, principalRemark: true, updatedAt: true },
  });

  const openBatch = openBatchRows[0] ? {
    id: openBatchRows[0].id,
    status: openBatchRows[0].status,
    totalAmount: Number(openBatchRows[0].totalAmount ?? 0),
    studentCount: Number(openBatchRows[0].studentCount ?? 0),
    createdAt: openBatchRows[0].createdAt,
    submittedAt: openBatchRows[0].submittedAt,
  } : null;

  res.json({ students, classes, myPendingRequests, unreadNotifications, announcements, recentRequests, openBatch });
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

import { Router } from 'express';
import { prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';
import { routeParam } from '../utils/http.js';

const router = Router();
router.use(requireAuth, requireTenant, requireRoles('PARENT'));

router.get('/:studentId', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const studentId = routeParam(req.params.studentId);
  const parent = await prisma.parentProfile.findFirst({ where: { schoolId, userId: req.auth!.userId } });
  if (!parent) return res.status(404).json({ message: 'Parent profile not found' });

  const link = await prisma.studentParent.findFirst({
    where: { parentId: parent.id, studentId },
    include: {
      student: {
        include: {
          user: { select: { firstName: true, lastName: true } },
          class: true,
        },
      },
    },
  });
  if (!link || link.student.schoolId !== schoolId) return res.status(403).json({ message: 'Student is not linked to this parent' });
  if (!link.student.classId) return res.json({ student: link.student, assignments: [], materials: [], syllabus: [] });

  const [assignments, materials, syllabus] = await Promise.all([
    prisma.assignment.findMany({
      where: { schoolId, classId: link.student.classId },
      orderBy: { publishedAt: 'desc' },
      include: {
        subject: { select: { id: true, name: true, code: true } },
        submissions: {
          where: { studentUserId: link.student.userId },
          select: { id: true, status: true, submittedAt: true, score: true, feedback: true, gradedAt: true },
        },
      },
    }),
    prisma.courseMaterial.findMany({
      where: { schoolId, classId: link.student.classId },
      orderBy: { createdAt: 'desc' },
      include: { subject: { select: { id: true, name: true, code: true } } },
    }),
    prisma.syllabusItem.findMany({
      where: { schoolId, classId: link.student.classId },
      orderBy: [{ subjectId: 'asc' }, { sortOrder: 'asc' }],
      include: { subject: { select: { id: true, name: true, code: true } } },
    }),
  ]);

  res.json({
    student: link.student,
    relation: link.relation,
    assignments: assignments.map((assignment) => ({
      ...assignment,
      submission: assignment.submissions[0] ?? null,
      submissions: undefined,
    })),
    materials,
    syllabus,
  });
});

export default router;

import { Router } from 'express';
import { prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';
import { routeParam } from '../utils/http.js';

const router = Router();
router.use(requireAuth, requireTenant);

router.get('/student', requireRoles('STUDENT'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const profile = await prisma.studentProfile.findFirst({ where: { userId: req.auth!.userId, schoolId }, include: { user: { select: { firstName: true, lastName: true } }, class: true } });
  if (!profile) return res.status(404).json({ message: 'Student profile not found' });
  const [attendance, attempts, announcements] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { studentProfileId: profile.id, attendance: { schoolId } }, select: { status: true, attendance: { select: { date: true } } }, orderBy: { attendance: { date: 'desc' } } }),
    prisma.examAttempt.findMany({ where: { schoolId, studentUserId: req.auth!.userId }, include: { exam: { select: { title: true, totalMarks: true, showResults: true, subject: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.announcement.findMany({ where: { schoolId, audience: { has: 'STUDENT' }, OR: [{ classId: null }, { classId: profile.classId ?? '__none__' }], AND: [{ OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }] }, { OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] }] }, orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }], take: 10 }),
  ]);
  const present = attendance.filter(x => x.status === 'PRESENT' || x.status === 'LATE').length;
  const attendanceRate = attendance.length ? Math.round((present / attendance.length) * 1000) / 10 : 0;
  const graded = attempts.filter(x => x.status === 'GRADED');
  const averageScore = graded.length ? Math.round((graded.reduce((s, x) => s + Number(x.percentage ?? 0), 0) / graded.length) * 10) / 10 : 0;
  res.json({ profile, attendanceRate, averageScore, examsTaken: attempts.length, recentResults: attempts, announcements });
});

router.get('/parent/children', requireRoles('PARENT'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const parent = await prisma.parentProfile.findFirst({ where: { userId: req.auth!.userId, schoolId }, include: { students: { include: { student: { include: { user: { select: { firstName: true, lastName: true } }, class: true } } } } } });
  if (!parent) return res.status(404).json({ message: 'Parent profile not found' });
  res.json(parent.students.map(link => ({ relation: link.relation, ...link.student })));
});

router.get('/parent/children/:studentId', requireRoles('PARENT'), async (req, res) => {
  const schoolId = req.auth!.schoolId!, studentId = routeParam(req.params.studentId);
  const parent = await prisma.parentProfile.findFirst({ where: { userId: req.auth!.userId, schoolId } });
  if (!parent) return res.status(404).json({ message: 'Parent profile not found' });
  const link = await prisma.studentParent.findFirst({ where: { parentId: parent.id, studentId }, include: { student: { include: { user: { select: { firstName: true, lastName: true } }, class: true } } } });
  if (!link || link.student.schoolId !== schoolId) return res.status(404).json({ message: 'Linked student not found' });
  const [attendance, attempts, announcements] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { studentProfileId: link.student.id, attendance: { schoolId } }, select: { status: true, attendance: { select: { date: true } } } }),
    prisma.examAttempt.findMany({ where: { schoolId, studentUserId: link.student.userId, status: 'GRADED' }, include: { exam: { select: { title: true, totalMarks: true, showResults: true, subject: { select: { name: true } } } } }, orderBy: { gradedAt: 'desc' }, take: 10 }),
    prisma.announcement.findMany({ where: { schoolId, audience: { has: 'PARENT' }, OR: [{ classId: null }, { classId: link.student.classId ?? '__none__' }], AND: [{ OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }] }, { OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] }] }, orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }], take: 10 }),
  ]);
  const present = attendance.filter(x => x.status === 'PRESENT' || x.status === 'LATE').length;
  const attendanceRate = attendance.length ? Math.round((present / attendance.length) * 1000) / 10 : 0;
  const averageScore = attempts.length ? Math.round((attempts.reduce((s, x) => s + Number(x.percentage ?? 0), 0) / attempts.length) * 10) / 10 : 0;
  res.json({ student: link.student, relation: link.relation, attendanceRate, averageScore, results: attempts, announcements });
});

export default router;

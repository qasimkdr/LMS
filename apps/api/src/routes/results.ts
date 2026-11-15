import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { parse } from '../lib/validate';
import { forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import { round2 } from '../lib/money';
import { tenantId } from '../middleware/auth';
import { num } from '../services/exams';
import { reportCards } from './exams';
import { teacherSectionIds } from '../services/teacherScope';

/** Results as students, parents and the student profile see them (published only for families). */
const router = Router();

async function familyStudents(req: Request) {
  const u = req.user!;
  if (u.role === 'PARENT') return prisma.student.findMany({ where: { family: { parentUserId: u.id }, deletedAt: null }, select: { id: true, fullName: true, classId: true, sectionId: true }, orderBy: { dob: 'asc' } });
  if (u.role === 'STUDENT') return prisma.student.findMany({ where: { userId: u.id, deletedAt: null }, select: { id: true, fullName: true, classId: true, sectionId: true } });
  throw forbidden();
}

/** List of a student's published results with per-subject marks and a monthly average of tests. */
async function studentResults(studentId: string, includeDrafts: boolean) {
  const results = await prisma.studentResult.findMany({
    where: { studentId, ...(includeDrafts ? {} : { assessment: { status: 'PUBLISHED' } }) },
    include: { assessment: { include: { type: true, papers: { include: { marks: { where: { studentId } } } } } } },
  });
  const subjectIds = [...new Set(results.flatMap((r) => r.assessment.papers.map((p) => p.subjectId)))];
  const subjects = await prisma.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, name: true } });
  const rows = results
    .map((r) => {
      const date = r.assessment.papers.map((p) => p.date).filter(Boolean).sort().pop() ?? r.assessment.publishedAt ?? r.assessment.createdAt;
      return {
        assessmentId: r.assessment.id,
        kind: r.assessment.kind,
        type: r.assessment.type.name,
        title: r.assessment.title,
        status: r.assessment.status,
        date,
        obtained: num(r.obtained),
        total: num(r.total),
        percent: num(r.percent),
        grade: r.grade,
        passed: r.passed,
        positionSection: r.positionSection,
        positionClass: r.positionClass,
        subjects: r.assessment.papers.map((p) => ({ subject: subjects.find((s) => s.id === p.subjectId)?.name ?? '', totalMarks: num(p.totalMarks), obtained: p.marks[0] ? (p.marks[0].isAbsent ? null : num(p.marks[0].marks)) : null, absent: p.marks[0]?.isAbsent ?? false, remark: p.marks[0]?.remark ?? null })),
      };
    })
    .sort((a, b) => new Date(b.date as Date).getTime() - new Date(a.date as Date).getTime());
  // Monthly average of class tests (for the "monthly test summary").
  const months = new Map<string, { sum: number; n: number }>();
  for (const r of rows.filter((x) => x.kind === 'TEST')) {
    const k = new Date(r.date as Date).toISOString().slice(0, 7);
    const m = months.get(k) ?? { sum: 0, n: 0 };
    m.sum += r.percent;
    m.n++;
    months.set(k, m);
  }
  return { rows, testMonths: [...months.entries()].sort().reverse().map(([month, m]) => ({ month, tests: m.n, average: round2(m.sum / m.n) })) };
}

router.get(
  '/my',
  ah(async (req, res) => {
    const kids = await familyStudents(req);
    const today = new Date(new Date().toISOString().slice(0, 10));
    const out = [];
    for (const k of kids) {
      const upcoming = await prisma.assessment.findMany({
        where: { classId: k.classId, kind: 'EXAM', announced: true, status: 'DRAFT', papers: { some: { date: { gte: today } } } },
        include: { papers: { orderBy: { date: 'asc' } } },
      });
      const subjects = await prisma.subject.findMany({ where: { id: { in: upcoming.flatMap((u) => u.papers.map((p) => p.subjectId)) } }, select: { id: true, name: true } });
      out.push({
        student: { id: k.id, fullName: k.fullName },
        ...(await studentResults(k.id, false)),
        dateSheets: upcoming.map((u) => ({ id: u.id, title: u.title, papers: u.papers.map((p) => ({ subject: subjects.find((s) => s.id === p.subjectId)?.name ?? '', date: p.date, startTime: p.startTime, totalMarks: num(p.totalMarks) })) })),
      });
    }
    res.json({ children: out });
  }),
);

router.get(
  '/my/:assessmentId/:studentId',
  ah(async (req, res) => {
    const kids = await familyStudents(req);
    if (!kids.some((k) => k.id === req.params.studentId)) throw notFound('Result not found');
    const a = await prisma.assessment.findFirst({ where: { id: req.params.assessmentId, schoolId: tenantId(req), status: 'PUBLISHED' } });
    if (!a) throw notFound('Result not found');
    res.json(await reportCards(tenantId(req), a.id, { id: req.params.studentId }));
  }),
);

/** Results tab of the student profile. */
router.get(
  '/students/:id',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const st = await prisma.student.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
    if (!st) throw notFound('Student not found');
    const u = req.user!;
    const staff = can(req, 'students.view') || can(req, 'exams.manage');
    if (!staff) {
      if (u.role !== 'TEACHER' || !st.sectionId || !(await teacherSectionIds(schoolId, u.id)).includes(st.sectionId)) throw notFound('Student not found');
    }
    res.json(await studentResults(st.id, can(req, 'exams.manage')));
  }),
);

export default router;

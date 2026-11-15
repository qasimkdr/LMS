import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optStr, parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { teacherSectionIds } from '../services/teacherScope';
import { generateReports, sendReports, type ReportData } from '../services/monthlyReports';
import { isPeriod } from '../services/rankings';

/** Monthly progress reports for parents. */
const router = Router();

/** Principal and staff with reports.view generate and send; teachers see and comment on their sections. */
const isManager = (req: Request) => can(req, 'reports.view');
const period = z.string().refine(isPeriod, 'Month must be YYYY-MM');

async function scope(req: Request): Promise<string[] | null> {
  if (isManager(req) || can(req, 'students.view')) return null;
  if (req.user!.role === 'TEACHER') return teacherSectionIds(tenantId(req), req.user!.id);
  throw forbidden();
}

function summary(r: { id: string; studentId: string; status: string; comment: string | null; sentAt: Date | null; generatedAt: Date; data: unknown; sectionId: string | null }) {
  const d = r.data as ReportData;
  return {
    id: r.id,
    studentId: r.studentId,
    student: { fullName: d.student.fullName, rollNo: d.student.rollNo, classLabel: d.student.classLabel },
    sectionId: r.sectionId,
    status: r.status,
    comment: r.comment,
    sentAt: r.sentAt,
    generatedAt: r.generatedAt,
    attendance: d.attendance?.days ? d.attendance.percent : null,
    tests: d.tests.length,
    average: d.average,
    balance: d.fees?.balance ?? null,
    remarks: d.remarks.length,
    honors: d.honors.length,
  };
}

router.get(
  '/',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const sections = await scope(req);
    const q = parse(z.object({ period, classId: z.string().optional(), sectionId: z.string().optional() }), req.query);
    if (q.sectionId && sections && !sections.includes(q.sectionId)) throw forbidden();
    const rows = await prisma.monthlyReport.findMany({
      where: { schoolId, period: q.period, ...(q.classId ? { classId: q.classId } : {}), ...(q.sectionId ? { sectionId: q.sectionId } : sections ? { sectionId: { in: sections } } : {}) },
    });
    const list = rows.map(summary).sort((a, b) => a.student.classLabel.localeCompare(b.student.classLabel, undefined, { numeric: true }) || (a.student.rollNo ?? '').localeCompare(b.student.rollNo ?? '', undefined, { numeric: true }) || a.student.fullName.localeCompare(b.student.fullName));
    res.json({ reports: list, canManage: isManager(req) });
  }),
);

router.post(
  '/generate',
  ah(async (req, res) => {
    if (!isManager(req)) throw forbidden();
    const body = parse(z.object({ period, classId: z.string().nullish(), studentIds: z.array(z.string()).max(2000).nullish() }), req.body);
    if (body.period > new Date().toISOString().slice(0, 7)) throw badRequest('That month has not started yet');
    const r = await generateReports(tenantId(req), body.period, { ...(body.classId ? { classId: body.classId } : {}), ...(body.studentIds ? { id: { in: body.studentIds } } : {}) }, { includeSent: Boolean(body.studentIds) });
    await audit(req, { action: 'monthly_report.generate', entityType: 'MonthlyReport', entityId: body.period, after: { ...r, classId: body.classId ?? null } });
    res.json(r);
  }),
);

router.post(
  '/send',
  ah(async (req, res) => {
    if (!isManager(req)) throw forbidden();
    const body = parse(z.object({ period, ids: z.array(z.string()).max(3000).nullish(), classId: z.string().nullish(), onlyNew: z.boolean().default(true) }), req.body);
    const rows = await prisma.monthlyReport.findMany({
      where: { schoolId: tenantId(req), period: body.period, ...(body.ids ? { id: { in: body.ids } } : {}), ...(body.classId ? { classId: body.classId } : {}), ...(body.onlyNew && !body.ids ? { status: 'DRAFT' } : {}) },
      select: { id: true },
    });
    if (!rows.length) throw badRequest('No reports to send. Generate them first.');
    const r = await sendReports(tenantId(req), rows.map((x) => x.id), req.user!.id);
    await audit(req, { action: 'monthly_report.send', entityType: 'MonthlyReport', entityId: body.period, after: r });
    res.json(r);
  }),
);

/** Parents' and students' own reports (sent ones only). */
router.get(
  '/my',
  ah(async (req, res) => {
    const u = req.user!;
    const where = u.role === 'PARENT' ? { family: { parentUserId: u.id } } : u.role === 'STUDENT' ? { userId: u.id } : null;
    if (!where) throw forbidden();
    const kids = await prisma.student.findMany({ where: { ...where, deletedAt: null }, select: { id: true, fullName: true }, orderBy: { dob: 'asc' } });
    const rows = await prisma.monthlyReport.findMany({ where: { schoolId: tenantId(req), studentId: { in: kids.map((k) => k.id) }, status: 'SENT' }, orderBy: { period: 'desc' } });
    res.json({ children: kids.map((k) => ({ student: k, reports: rows.filter((r) => r.studentId === k.id).map((r) => ({ ...summary(r), period: r.period })) })) });
  }),
);

/** Reports of one student (student profile). */
router.get(
  '/students/:id',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const sections = await scope(req);
    const st = await prisma.student.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
    if (!st || (sections && (!st.sectionId || !sections.includes(st.sectionId)))) throw notFound('Student not found');
    const rows = await prisma.monthlyReport.findMany({ where: { schoolId, studentId: st.id }, orderBy: { period: 'desc' } });
    res.json({ reports: rows.map((r) => ({ ...summary(r), period: r.period })) });
  }),
);

async function load(req: Request, id: string) {
  const r = await prisma.monthlyReport.findFirst({ where: { id, schoolId: tenantId(req) } });
  if (!r) throw notFound('Report not found');
  const u = req.user!;
  if (u.role === 'PARENT' || u.role === 'STUDENT') {
    const st = await prisma.student.findUnique({ where: { id: r.studentId }, include: { family: true } });
    const mine = st && ((u.role === 'STUDENT' && st.userId === u.id) || (u.role === 'PARENT' && st.family.parentUserId === u.id));
    if (!mine || r.status !== 'SENT') throw notFound('Report not found');
  } else {
    const sections = await scope(req);
    if (sections && (!r.sectionId || !sections.includes(r.sectionId))) throw notFound('Report not found');
  }
  return r;
}

router.get(
  '/:id',
  ah(async (req, res) => {
    const r = await load(req, req.params.id);
    const commentBy = r.commentById ? await prisma.user.findUnique({ where: { id: r.commentById }, select: { fullName: true } }) : null;
    const section = r.sectionId ? await prisma.section.findUnique({ where: { id: r.sectionId }, select: { classTeacherId: true } }) : null;
    const u = req.user!;
    res.json({
      report: { id: r.id, period: r.period, status: r.status, sentAt: r.sentAt, generatedAt: r.generatedAt, comment: r.comment, commentBy: commentBy?.fullName ?? null, data: r.data },
      canComment: r.status === 'DRAFT' && (u.role === 'PRINCIPAL' || (u.role === 'TEACHER' && section?.classTeacherId === u.id) || isManager(req)),
    });
  }),
);

/** Class teacher's comment (before the report is sent). */
router.put(
  '/:id/comment',
  ah(async (req, res) => {
    const r = await load(req, req.params.id);
    const u = req.user!;
    const section = r.sectionId ? await prisma.section.findUnique({ where: { id: r.sectionId }, select: { classTeacherId: true } }) : null;
    if (!(u.role === 'PRINCIPAL' || isManager(req) || (u.role === 'TEACHER' && section?.classTeacherId === u.id))) throw forbidden('Only the class teacher or the principal can comment');
    if (r.status === 'SENT' && u.role !== 'PRINCIPAL') throw badRequest('This report has already been sent');
    const { comment } = parse(z.object({ comment: optStr(600) }), req.body);
    await prisma.monthlyReport.update({ where: { id: r.id }, data: { comment: comment ?? null, commentById: comment ? u.id : null } });
    res.json({ ok: true });
  }),
);

export default router;

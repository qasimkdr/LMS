import { Router, type Request } from 'express';
import { z } from 'zod';
import type { StudentRemark } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { enqueue, getSettings, notify, ruleFor, studentsWithContacts, whatsappReady } from '../services/messaging';
import { teacherSectionIds } from '../services/teacherScope';
import { MESSAGE_TYPES, renderTemplate } from '../config/messageTypes';

/** Remarks about students by teachers and the principal. */
const router = Router();

export const CATEGORY_LABEL: Record<string, string> = { ACADEMIC: 'Academic', BEHAVIOR: 'Behavior', DISCIPLINE: 'Discipline', APPRECIATION: 'Appreciation', HEALTH: 'Health', OTHER: 'Other' };
const CATEGORIES = ['ACADEMIC', 'BEHAVIOR', 'DISCIPLINE', 'APPRECIATION', 'HEALTH', 'OTHER'] as const;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

const isStaffViewer = (req: Request) => can(req, 'students.view');

/** Sections the user may see remarks of (null = all). */
async function scope(req: Request): Promise<string[] | null> {
  if (isStaffViewer(req)) return null;
  if (req.user!.role === 'TEACHER') return teacherSectionIds(tenantId(req), req.user!.id);
  throw forbidden();
}

const canWrite = (req: Request) => req.user!.role === 'PRINCIPAL' || req.user!.role === 'TEACHER' || can(req, 'students.manage');

async function present(rows: StudentRemark[], meId: string) {
  const [users, students] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, fullName: true, role: true } }),
    prisma.student.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } }, select: { id: true, fullName: true, rollNo: true, class: { select: { name: true, stream: true } }, section: { select: { name: true } } } }),
  ]);
  return rows.map((r) => {
    const s = students.find((x) => x.id === r.studentId);
    const u = users.find((x) => x.id === r.createdById);
    return {
      id: r.id,
      studentId: r.studentId,
      student: s ? { id: s.id, fullName: s.fullName, rollNo: s.rollNo, classLabel: `${s.class.name}${s.class.stream ? ` ${s.class.stream}` : ''}${s.section ? ` ${s.section.name}` : ''}` } : null,
      category: r.category,
      text: r.text,
      date: ymd(r.date),
      shared: r.shared,
      sentAt: r.sentAt,
      createdAt: r.createdAt,
      by: u ? { id: u.id, fullName: u.fullName, role: u.role } : null,
      mine: r.createdById === meId,
    };
  });
}

/** Tell parents (and the student) about shared remarks. WhatsApp only if allowed by the school's rule. */
async function tellParents(req: Request, remarks: StudentRemark[], whatsapp: boolean) {
  const shared = remarks.filter((r) => r.shared);
  if (!shared.length) return { whatsapp: 0, inApp: 0 };
  const schoolId = tenantId(req);
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
  const settings = await getSettings(schoolId);
  const rule = ruleFor(settings, 'REMARK');
  const useWa = whatsappReady(settings) && (rule === 'auto' || (rule === 'manual' && whatsapp));
  const contacts = await studentsWithContacts(schoolId, { id: { in: shared.map((r) => r.studentId) } });
  const users = await prisma.student.findMany({ where: { id: { in: shared.map((r) => r.studentId) } }, select: { id: true, userId: true } });
  let queued = 0;
  const notices: Parameters<typeof notify>[1] = [];
  for (const r of shared) {
    const st = contacts.find((c) => c.id === r.studentId);
    if (!st) continue;
    const params = [st.fullName, req.user!.fullName, CATEGORY_LABEL[r.category], r.text, school.name];
    const body = renderTemplate(MESSAGE_TYPES.REMARK.suggestedTemplate.text, params);
    if (useWa) queued += await enqueue(schoolId, settings, st.guardians.map((g) => ({ to: { phone: g.phone ?? '', name: g.name, studentId: st.id }, type: 'REMARK', params, body })));
    if (st.parentUserId) notices.push({ userId: st.parentUserId, type: 'REMARK', title: `${CATEGORY_LABEL[r.category]} remark: ${st.fullName}`, body: r.text.slice(0, 200), link: '/home/remarks' });
    const su = users.find((u) => u.id === r.studentId)?.userId;
    if (su) notices.push({ userId: su, type: 'REMARK', title: `${CATEGORY_LABEL[r.category]} remark from ${req.user!.fullName}`, body: r.text.slice(0, 200), link: '/home/remarks' });
  }
  await notify(schoolId, notices);
  if (useWa) await prisma.studentRemark.updateMany({ where: { id: { in: shared.map((r) => r.id) } }, data: { sentAt: new Date() } });
  return { whatsapp: queued, inApp: notices.length };
}

router.get(
  '/',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const sections = await scope(req);
    const q = parse(
      z.object({ studentId: z.string().optional(), sectionId: z.string().optional(), category: z.enum(CATEGORIES).optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), mine: z.enum(['true', 'false']).optional() }),
      req.query,
    );
    if (q.sectionId && sections && !sections.includes(q.sectionId)) throw forbidden();
    const sectionFilter = q.sectionId ? [q.sectionId] : sections;
    // Teachers also see remarks they wrote themselves, and every remark of a student they can open.
    const rows = await prisma.studentRemark.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(q.studentId ? { studentId: q.studentId } : {}),
        ...(q.category ? { category: q.category } : {}),
        ...(q.from || q.to ? { date: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
        ...(q.mine === 'true' ? { createdById: req.user!.id } : {}),
        ...(sectionFilter ? { OR: [{ sectionId: { in: sectionFilter } }, ...(q.sectionId ? [] : [{ createdById: req.user!.id }])] } : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
    res.json({ remarks: await present(rows, req.user!.id) });
  }),
);

const remarkBody = z.object({
  category: z.enum(CATEGORIES),
  text: z.string().trim().min(2).max(1000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  shared: z.boolean().default(true),
});

/** One remark for one or many students (e.g. the whole class). */
router.post(
  '/',
  ah(async (req, res) => {
    if (!canWrite(req)) throw forbidden();
    const schoolId = tenantId(req);
    const body = parse(remarkBody.extend({ studentIds: z.array(z.string()).min(1).max(200), whatsapp: z.boolean().default(false) }), req.body);
    const students = await prisma.student.findMany({ where: { schoolId, id: { in: body.studentIds }, deletedAt: null }, select: { id: true, sectionId: true } });
    if (students.length !== new Set(body.studentIds).size) throw badRequest('Unknown student');
    if (req.user!.role === 'TEACHER') {
      const mine = await teacherSectionIds(schoolId, req.user!.id);
      if (students.some((s) => !s.sectionId || !mine.includes(s.sectionId))) throw forbidden('You can only write remarks for students of your classes');
    }
    const date = new Date(body.date ?? new Date().toISOString().slice(0, 10));
    const created: StudentRemark[] = [];
    for (const s of students) {
      created.push(await prisma.studentRemark.create({ data: { schoolId, studentId: s.id, sectionId: s.sectionId, category: body.category, text: body.text, date, shared: body.shared, createdById: req.user!.id } }));
    }
    const sent = await tellParents(req, created, body.whatsapp);
    await audit(req, { action: 'remark.create', entityType: 'StudentRemark', entityId: created[0].id, after: { students: created.length, category: body.category, shared: body.shared } });
    res.status(201).json({ created: created.length, ...sent });
  }),
);

async function own(req: Request, id: string) {
  const r = await prisma.studentRemark.findFirst({ where: { id, schoolId: tenantId(req), deletedAt: null } });
  if (!r) throw notFound('Remark not found');
  if (r.createdById !== req.user!.id && req.user!.role !== 'PRINCIPAL') throw forbidden('Only the writer or the principal can change this remark');
  return r;
}

router.patch(
  '/:id',
  ah(async (req, res) => {
    const r = await own(req, req.params.id);
    const body = parse(remarkBody.partial().omit({ shared: true }).extend({ shared: z.boolean().optional() }), req.body);
    const updated = await prisma.studentRemark.update({ where: { id: r.id }, data: { ...(body.category ? { category: body.category } : {}), ...(body.text ? { text: body.text } : {}), ...(body.date ? { date: new Date(body.date) } : {}), ...(body.shared !== undefined ? { shared: body.shared } : {}) } });
    await audit(req, { action: 'remark.update', entityType: 'StudentRemark', entityId: r.id, before: { text: r.text, shared: r.shared }, after: { text: updated.text, shared: updated.shared } });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const r = await own(req, req.params.id);
    await prisma.studentRemark.update({ where: { id: r.id }, data: { deletedAt: new Date() } });
    await audit(req, { action: 'remark.delete', entityType: 'StudentRemark', entityId: r.id, before: { text: r.text } });
    res.json({ ok: true });
  }),
);

/** Send (again) to parents on WhatsApp. */
router.post(
  '/:id/send',
  ah(async (req, res) => {
    const r = await own(req, req.params.id);
    if (!r.shared) throw badRequest('This remark is internal. Share it with parents first.');
    res.json(await tellParents(req, [r], true));
  }),
);

/** Shared remarks for parents and students. */
router.get(
  '/my',
  ah(async (req, res) => {
    const u = req.user!;
    const where = u.role === 'PARENT' ? { family: { parentUserId: u.id } } : u.role === 'STUDENT' ? { userId: u.id } : null;
    if (!where) throw forbidden();
    const kids = await prisma.student.findMany({ where: { ...where, deletedAt: null }, select: { id: true, fullName: true }, orderBy: { dob: 'asc' } });
    const rows = await prisma.studentRemark.findMany({ where: { schoolId: tenantId(req), studentId: { in: kids.map((k) => k.id) }, shared: true, deletedAt: null }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 });
    const list = await present(rows, u.id);
    res.json({ children: kids.map((k) => ({ student: k, remarks: list.filter((r) => r.studentId === k.id).map(({ mine: _m, ...r }) => r) })) });
  }),
);

export default router;

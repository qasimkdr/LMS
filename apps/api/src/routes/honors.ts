import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Honor, HonorType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optStr, parse, patchOf } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { enqueue, getSettings, notify, ruleFor, studentsWithContacts, whatsappReady } from '../services/messaging';
import { teacherSectionIds } from '../services/teacherScope';
import { ensureHonorTypes, honorSuggestions, isPeriod, periodLabel, rankings, studentsLite } from '../services/rankings';
import { MESSAGE_TYPES, renderTemplate } from '../config/messageTypes';

// ---------- Rankings ----------

export const rankingsRouter = Router();

/** Principal and staff see the whole school; teachers see the sections they teach. */
async function rankScope(req: Request): Promise<string[] | null> {
  if (can(req, 'exams.manage') || can(req, 'students.view') || can(req, 'honors.manage')) return null;
  if (req.user!.role === 'TEACHER') return teacherSectionIds(tenantId(req), req.user!.id);
  throw forbidden();
}

rankingsRouter.get(
  '/',
  ah(async (req, res) => {
    const sections = await rankScope(req);
    const q = parse(z.object({ scope: z.enum(['month', 'session', 'exam']).default('month'), period: z.string().optional(), exam: z.string().optional() }), req.query);
    if (q.scope === 'month' && !(q.period && isPeriod(q.period))) throw badRequest('Choose a month');
    if (q.scope === 'exam' && !q.exam) throw badRequest('Choose an exam');
    res.json(await rankings(tenantId(req), { scope: q.scope, period: q.period, examKey: q.exam, sectionIds: sections }));
  }),
);

/** Published term exams to rank by (one entry per school-wide exam). */
rankingsRouter.get(
  '/exams',
  ah(async (req, res) => {
    await rankScope(req);
    const list = await prisma.assessment.findMany({ where: { schoolId: tenantId(req), kind: 'EXAM', status: 'PUBLISHED' }, select: { id: true, groupKey: true, title: true, publishedAt: true }, orderBy: { publishedAt: 'desc' }, take: 200 });
    const seen = new Map<string, { key: string; title: string; publishedAt: Date | null; classes: number }>();
    for (const a of list) {
      const key = a.groupKey ?? a.id;
      const x = seen.get(key) ?? { key, title: a.title, publishedAt: a.publishedAt, classes: 0 };
      x.classes++;
      seen.set(key, x);
    }
    res.json({ exams: [...seen.values()] });
  }),
);

// ---------- Honors ----------

const router = Router();
const isManager = (req: Request) => can(req, 'honors.manage');
const assertManager = (req: Request) => {
  if (!isManager(req)) throw forbidden('Only the principal (or staff allowed to give honors) can do this');
};

async function present(rows: (Honor & { type: HonorType })[]) {
  const students = await studentsLite(rows[0]?.schoolId ?? '', { id: { in: [...new Set(rows.map((r) => r.studentId))] } });
  // Withdrawn students keep their honors in the history, so fall back to a plain lookup.
  const missing = rows.map((r) => r.studentId).filter((id) => !students.has(id));
  const others = missing.length ? await prisma.student.findMany({ where: { id: { in: missing } }, select: { id: true, fullName: true, photoFileId: true } }) : [];
  return rows.map((r) => {
    const s = students.get(r.studentId);
    const o = others.find((x) => x.id === r.studentId);
    return {
      id: r.id,
      type: { id: r.type.id, name: r.type.name, icon: r.type.icon, scope: r.type.scope },
      student: s ? { id: s.id, fullName: s.fullName, classLabel: s.classLabel, photoFileId: s.photoFileId } : { id: r.studentId, fullName: o?.fullName ?? 'Former student', classLabel: '', photoFileId: o?.photoFileId ?? null },
      period: r.period,
      periodLabel: periodLabel(r.period),
      citation: r.citation,
      isPublic: r.isPublic,
      createdAt: r.createdAt,
      notifiedAt: r.notifiedAt,
    };
  });
}

router.get(
  '/types',
  ah(async (req, res) => {
    await ensureHonorTypes(tenantId(req));
    const types = await prisma.honorType.findMany({ where: { schoolId: tenantId(req), ...(isManager(req) ? {} : { isActive: true }) }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    res.json({ types });
  }),
);

const typeBody = z.object({
  name: z.string().trim().min(2).max(60),
  icon: z.string().trim().min(1).max(8).default('🏅'),
  scope: z.enum(['CLASS', 'SCHOOL']).default('CLASS'),
  publicDefault: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

router.post(
  '/types',
  ah(async (req, res) => {
    assertManager(req);
    const schoolId = tenantId(req);
    const body = parse(typeBody, req.body);
    if (await prisma.honorType.findFirst({ where: { schoolId, name: body.name } })) throw badRequest('An honor with this name already exists');
    const max = await prisma.honorType.aggregate({ where: { schoolId }, _max: { sortOrder: true } });
    const t = await prisma.honorType.create({ data: { ...body, schoolId, sortOrder: (max._max.sortOrder ?? 0) + 10 } });
    await audit(req, { action: 'honor_type.create', entityType: 'HonorType', entityId: t.id, after: body });
    res.status(201).json({ type: t });
  }),
);

router.patch(
  '/types/:id',
  ah(async (req, res) => {
    assertManager(req);
    const t = await prisma.honorType.findFirst({ where: { id: req.params.id, schoolId: tenantId(req) } });
    if (!t) throw notFound('Honor not found');
    const body = parse(patchOf(typeBody), req.body);
    if (body.name && body.name !== t.name && (await prisma.honorType.findFirst({ where: { schoolId: t.schoolId, name: body.name } }))) throw badRequest('An honor with this name already exists');
    await prisma.honorType.update({ where: { id: t.id }, data: body });
    await audit(req, { action: 'honor_type.update', entityType: 'HonorType', entityId: t.id, before: t, after: body });
    res.json({ ok: true });
  }),
);

/** All honors (managers), for the honors page. */
router.get(
  '/',
  ah(async (req, res) => {
    assertManager(req);
    const q = parse(z.object({ period: z.string().max(30).optional(), typeId: z.string().optional() }), req.query);
    const rows = await prisma.honor.findMany({ where: { schoolId: tenantId(req), ...(q.period ? { period: q.period } : {}), ...(q.typeId ? { typeId: q.typeId } : {}) }, include: { type: true }, orderBy: [{ createdAt: 'desc' }], take: 500 });
    res.json({ honors: await present(rows) });
  }),
);

/** The honor board: public honors, visible to everyone in the school. */
router.get(
  '/board',
  ah(async (req, res) => {
    const rows = await prisma.honor.findMany({ where: { schoolId: tenantId(req), isPublic: true, type: { isActive: true } }, include: { type: true }, orderBy: [{ createdAt: 'desc' }], take: 300 });
    const list = await present(rows);
    // Group by period, newest first.
    const groups = new Map<string, { period: string; label: string; latest: number; honors: typeof list }>();
    for (const h of list) {
      const g = groups.get(h.period) ?? { period: h.period, label: h.periodLabel, latest: 0, honors: [] };
      g.honors.push(h);
      g.latest = Math.max(g.latest, new Date(h.createdAt).getTime());
      groups.set(h.period, g);
    }
    const typeOrder = await prisma.honorType.findMany({ where: { schoolId: tenantId(req) }, select: { id: true, sortOrder: true } });
    const order = (id: string) => typeOrder.find((t) => t.id === id)?.sortOrder ?? 0;
    res.json({
      periods: [...groups.values()]
        .sort((a, b) => (isPeriod(a.period) && isPeriod(b.period) ? b.period.localeCompare(a.period) : b.latest - a.latest))
        .map(({ latest: _l, ...g }) => ({ ...g, honors: g.honors.sort((x, y) => order(x.type.id) - order(y.type.id) || x.student.classLabel.localeCompare(y.student.classLabel, undefined, { numeric: true })) })),
    });
  }),
);

router.get(
  '/suggestions',
  ah(async (req, res) => {
    assertManager(req);
    const { period } = parse(z.object({ period: z.string().refine(isPeriod, 'Month must be YYYY-MM') }), req.query);
    res.json({ suggestions: await honorSuggestions(tenantId(req), period) });
  }),
);

/** Honors of one student (profile) or of the logged-in family. */
router.get(
  '/students/:id',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const st = await prisma.student.findFirst({ where: { id: req.params.id, schoolId } });
    if (!st) throw notFound('Student not found');
    const u = req.user!;
    let allowed = can(req, 'students.view') || isManager(req);
    if (!allowed && u.role === 'TEACHER') allowed = Boolean(st.sectionId && (await teacherSectionIds(schoolId, u.id)).includes(st.sectionId));
    if (!allowed && u.role === 'STUDENT') allowed = st.userId === u.id;
    if (!allowed && u.role === 'PARENT') allowed = Boolean(await prisma.family.findFirst({ where: { id: st.familyId, parentUserId: u.id } }));
    if (!allowed) throw notFound('Student not found');
    const rows = await prisma.honor.findMany({ where: { schoolId, studentId: st.id }, include: { type: true }, orderBy: { createdAt: 'desc' } });
    res.json({ honors: await present(rows) });
  }),
);

async function congratulate(req: Request, honors: (Honor & { type: HonorType })[], whatsapp: boolean) {
  if (!honors.length) return { whatsapp: 0, inApp: 0 };
  const schoolId = tenantId(req);
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
  const settings = await getSettings(schoolId);
  const rule = ruleFor(settings, 'HONOR');
  const useWa = whatsappReady(settings) && (rule === 'auto' || (rule === 'manual' && whatsapp));
  const contacts = await studentsWithContacts(schoolId, { id: { in: honors.map((h) => h.studentId) } });
  const users = await prisma.student.findMany({ where: { id: { in: honors.map((h) => h.studentId) } }, select: { id: true, userId: true } });
  let queued = 0;
  const notices: Parameters<typeof notify>[1] = [];
  for (const h of honors) {
    const st = contacts.find((c) => c.id === h.studentId);
    if (!st) continue;
    const params = [st.fullName, h.type.name, periodLabel(h.period), school.name];
    const body = renderTemplate(MESSAGE_TYPES.HONOR.suggestedTemplate.text, params);
    if (useWa) queued += await enqueue(schoolId, settings, st.guardians.map((g) => ({ to: { phone: g.phone ?? '', name: g.name, studentId: st.id }, type: 'HONOR', params, body })));
    if (st.parentUserId) notices.push({ userId: st.parentUserId, type: 'HONOR', title: `${h.type.icon} ${st.fullName}: ${h.type.name}`, body: `Congratulations! ${st.fullName} has been awarded ${h.type.name} (${periodLabel(h.period)}).`, link: '/honors' });
    const su = users.find((u) => u.id === h.studentId)?.userId;
    if (su) notices.push({ userId: su, type: 'HONOR', title: `${h.type.icon} Congratulations! ${h.type.name}`, body: `You have been awarded ${h.type.name} (${periodLabel(h.period)}).`, link: '/honors' });
  }
  await notify(schoolId, notices);
  await prisma.honor.updateMany({ where: { id: { in: honors.map((h) => h.id) } }, data: { notifiedAt: new Date() } });
  return { whatsapp: queued, inApp: notices.length };
}

router.post(
  '/',
  ah(async (req, res) => {
    assertManager(req);
    const schoolId = tenantId(req);
    const body = parse(
      z.object({
        typeId: z.string(),
        studentIds: z.array(z.string()).min(1).max(100),
        period: z.string().trim().min(2).max(30),
        citation: optStr(300),
        isPublic: z.boolean().optional(),
        notify: z.boolean().default(true),
        whatsapp: z.boolean().default(true),
      }),
      req.body,
    );
    const type = await prisma.honorType.findFirst({ where: { id: body.typeId, schoolId } });
    if (!type) throw badRequest('Unknown honor');
    const students = await prisma.student.findMany({ where: { schoolId, id: { in: body.studentIds }, deletedAt: null, status: 'ACTIVE' }, select: { id: true, classId: true } });
    if (students.length !== new Set(body.studentIds).size) throw badRequest('Unknown student');
    const already = await prisma.honor.findMany({ where: { schoolId, typeId: type.id, period: body.period, studentId: { in: students.map((s) => s.id) } }, select: { studentId: true } });
    const fresh = students.filter((s) => !already.some((a) => a.studentId === s.id));
    if (!fresh.length) throw badRequest('Already awarded for this period');
    const created = [];
    for (const s of fresh) {
      created.push(
        await prisma.honor.create({
          data: { schoolId, typeId: type.id, studentId: s.id, classId: s.classId, period: body.period, citation: body.citation ?? null, isPublic: body.isPublic ?? type.publicDefault, createdById: req.user!.id },
          include: { type: true },
        }),
      );
    }
    const sent = body.notify ? await congratulate(req, created, body.whatsapp) : { whatsapp: 0, inApp: 0 };
    await audit(req, { action: 'honor.create', entityType: 'Honor', entityId: created[0].id, after: { type: type.name, period: body.period, students: created.length } });
    res.status(201).json({ created: created.length, skipped: students.length - fresh.length, ...sent });
  }),
);

router.patch(
  '/:id',
  ah(async (req, res) => {
    assertManager(req);
    const h = await prisma.honor.findFirst({ where: { id: req.params.id, schoolId: tenantId(req) } });
    if (!h) throw notFound('Honor not found');
    const body = parse(z.object({ isPublic: z.boolean().optional(), citation: optStr(300), period: z.string().trim().min(2).max(30).optional() }), req.body);
    await prisma.honor.update({ where: { id: h.id }, data: { ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}), ...(body.citation !== undefined ? { citation: body.citation } : {}), ...(body.period ? { period: body.period } : {}) } });
    await audit(req, { action: 'honor.update', entityType: 'Honor', entityId: h.id, before: { isPublic: h.isPublic, citation: h.citation }, after: body });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    assertManager(req);
    const h = await prisma.honor.findFirst({ where: { id: req.params.id, schoolId: tenantId(req) } });
    if (!h) throw notFound('Honor not found');
    const { reason } = parse(z.object({ reason: optStr(300) }), req.body ?? {});
    await prisma.honor.delete({ where: { id: h.id } });
    await audit(req, { action: 'honor.delete', entityType: 'Honor', entityId: h.id, before: h, reason: reason ?? undefined });
    res.json({ ok: true });
  }),
);

export default router;

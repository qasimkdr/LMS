import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optStr, parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { canEditSyllabus, canTeach, getLmsSettings, isLmsManager, sendDigest, teacherScope } from '../services/lms';
import { schoolToday } from './attendance';

/** Syllabus and progress, study material, school documents, homework / diary. */
const router = Router();

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const classLabel = (c: { name: string; stream: string | null }, s?: { name: string } | null) => `${c.name}${c.stream ? ` ${c.stream}` : ''}${s ? ` ${s.name}` : ''}`;
const staffViewer = (req: Request) => isLmsManager(req) || can(req, 'students.view');
const isFamily = (req: Request) => req.user!.role === 'PARENT' || req.user!.role === 'STUDENT';

async function familyStudents(req: Request) {
  const u = req.user!;
  const where = u.role === 'PARENT' ? { family: { parentUserId: u.id } } : u.role === 'STUDENT' ? { userId: u.id } : null;
  if (!where) throw forbidden();
  return prisma.student.findMany({
    where: { ...where, schoolId: tenantId(req), deletedAt: null, status: 'ACTIVE' },
    select: { id: true, fullName: true, classId: true, sectionId: true, class: { select: { name: true, stream: true } }, section: { select: { name: true } } },
    orderBy: { dob: 'asc' },
  });
}

async function checkFiles(schoolId: string, ids: string[]) {
  if (!ids.length) return;
  const n = await prisma.storedFile.count({ where: { schoolId, id: { in: ids }, deletedAt: null } });
  if (n !== new Set(ids).size) throw badRequest('Unknown file');
}

async function filesInfo(ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; name: string; mimeType: string; sizeBytes: number }>();
  const files = await prisma.storedFile.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true } });
  return new Map(files.map((f) => [f.id, { id: f.id, name: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes }]));
}

async function userNames(ids: string[]) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

// ---------- Classes and subjects the user works with ----------

/** Sections (with subjects) the user can post to; managers get every section with every class subject. */
router.get(
  '/my-classes',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const u = req.user!;
    if (!(isLmsManager(req) || u.role === 'TEACHER' || can(req, 'students.view'))) throw forbidden();
    const sections = await prisma.section.findMany({
      where: { schoolId, deletedAt: null, class: { deletedAt: null } },
      select: { id: true, name: true, classId: true, classTeacherId: true, class: { select: { name: true, stream: true, sortOrder: true, subjects: { select: { subject: { select: { id: true, name: true } } } } } } },
    });
    const settings = await getLmsSettings(schoolId);
    const scope = u.role === 'TEACHER' ? await teacherScope(schoolId, u.id) : null;
    const out = sections
      .map((s) => {
        const all = s.class.subjects.map((x) => x.subject).sort((a, b) => a.name.localeCompare(b.name));
        let subjects = all;
        let classTeacher = false;
        if (scope) {
          classTeacher = s.classTeacherId === u.id;
          const taught = scope.taught.filter((t) => t.sectionId === s.id).map((t) => t.subjectId);
          subjects = classTeacher && settings.classTeacherAllSubjects ? all : all.filter((x) => taught.includes(x.id));
          if (!classTeacher && !subjects.length) return null;
        }
        return { sectionId: s.id, classId: s.classId, label: classLabel(s.class, s), sort: s.class.sortOrder, subjects, classTeacher: scope ? classTeacher : true, manager: !scope && isLmsManager(req) };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, undefined, { numeric: true }));
    res.json({ sections: out.map(({ sort: _s, ...x }) => x) });
  }),
);

// ---------- Syllabus ----------

async function loadSyllabus(schoolId: string, classId: string, subjectId: string, sectionId: string | null) {
  const items = await prisma.syllabusItem.findMany({ where: { schoolId, classId, subjectId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  const progress = sectionId ? await prisma.syllabusProgress.findMany({ where: { sectionId, itemId: { in: items.map((i) => i.id) } } }) : [];
  const names = await userNames(progress.map((p) => p.completedById));
  const doneOf = (id: string) => {
    const p = progress.find((x) => x.itemId === id);
    return p ? { completedOn: ymd(p.completedOn), by: names.get(p.completedById) ?? '' } : null;
  };
  const chapters = items
    .filter((i) => !i.parentId)
    .map((c) => {
      const topics = items.filter((t) => t.parentId === c.id).map((t) => ({ id: t.id, title: t.title, done: doneOf(t.id) }));
      const leaves = topics.length ? topics.map((t) => t.done) : [doneOf(c.id)];
      return { id: c.id, title: c.title, term: c.term, topics, done: topics.length ? null : doneOf(c.id), total: leaves.length, completed: leaves.filter(Boolean).length };
    });
  const total = chapters.reduce((s, c) => s + c.total, 0);
  const completed = chapters.reduce((s, c) => s + c.completed, 0);
  return { chapters, total, completed, percent: total ? Math.round((completed / total) * 1000) / 10 : 0 };
}

router.get(
  '/syllabus',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const q = parse(z.object({ classId: z.string(), subjectId: z.string(), sectionId: z.string().optional() }), req.query);
    if (isFamily(req)) throw forbidden();
    if (q.sectionId && !(await prisma.section.findFirst({ where: { id: q.sectionId, schoolId, classId: q.classId } }))) throw badRequest('Section is not in this class');
    const data = await loadSyllabus(schoolId, q.classId, q.subjectId, q.sectionId ?? null);
    const files = await prisma.studyMaterial.findMany({ where: { schoolId, classId: q.classId, subjectId: q.subjectId, kind: 'SYLLABUS', deletedAt: null }, orderBy: { createdAt: 'desc' } });
    const info = await filesInfo(files.flatMap((f) => f.fileIds as string[]));
    res.json({
      ...data,
      documents: files.map((f) => ({ id: f.id, title: f.title, files: (f.fileIds as string[]).map((id) => info.get(id)).filter(Boolean) })),
      canEdit: await canEditSyllabus(req, q.classId, q.subjectId),
      canMark: q.sectionId ? await canTeach(req, q.sectionId, q.subjectId) : false,
    });
  }),
);

const syllabusBody = z.object({
  classId: z.string(),
  subjectId: z.string(),
  chapters: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().trim().min(1).max(200),
        term: optStr(40),
        topics: z.array(z.object({ id: z.string().optional(), title: z.string().trim().min(1).max(200) })).max(100).default([]),
      }),
    )
    .max(100),
});

/** Saves the whole chapter/topic list. Items keep their id (and progress) when sent back with it. */
router.put(
  '/syllabus',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const body = parse(syllabusBody, req.body);
    const cs = await prisma.classSubject.findFirst({ where: { classId: body.classId, subjectId: body.subjectId, class: { schoolId } } });
    if (!cs) throw badRequest('This subject is not taught in this class');
    if (!(await canEditSyllabus(req, body.classId, body.subjectId))) throw forbidden('Only the principal or a teacher of this subject can change its syllabus');
    const existing = await prisma.syllabusItem.findMany({ where: { schoolId, classId: body.classId, subjectId: body.subjectId } });
    const known = new Set(existing.map((e) => e.id));
    const sent = body.chapters.flatMap((c) => [c.id, ...c.topics.map((t) => t.id)]).filter((x): x is string => Boolean(x));
    if (sent.some((id) => !known.has(id))) throw badRequest('Unknown syllabus item');
    await prisma.$transaction(async (tx) => {
      const keep = new Set<string>();
      for (const [ci, c] of body.chapters.entries()) {
        const data = { title: c.title, term: c.term ?? null, sortOrder: ci, parentId: null };
        const ch = c.id ? await tx.syllabusItem.update({ where: { id: c.id }, data }) : await tx.syllabusItem.create({ data: { ...data, schoolId, classId: body.classId, subjectId: body.subjectId } });
        keep.add(ch.id);
        for (const [ti, t] of c.topics.entries()) {
          const td = { title: t.title, sortOrder: ti, parentId: ch.id, term: null };
          const tp = t.id ? await tx.syllabusItem.update({ where: { id: t.id }, data: td }) : await tx.syllabusItem.create({ data: { ...td, schoolId, classId: body.classId, subjectId: body.subjectId } });
          keep.add(tp.id);
        }
        // A chapter that now has topics is no longer itself a checkbox.
        if (c.topics.length) await tx.syllabusProgress.deleteMany({ where: { itemId: ch.id } });
      }
      const gone = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
      if (gone.length) {
        await tx.syllabusProgress.deleteMany({ where: { itemId: { in: gone } } });
        await tx.syllabusItem.deleteMany({ where: { id: { in: gone } } });
      }
    });
    await audit(req, { action: 'syllabus.save', entityType: 'ClassSubject', entityId: `${body.classId}:${body.subjectId}`, after: { chapters: body.chapters.length } });
    res.json(await loadSyllabus(schoolId, body.classId, body.subjectId, null));
  }),
);

router.put(
  '/syllabus/progress',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const body = parse(z.object({ sectionId: z.string(), subjectId: z.string(), itemIds: z.array(z.string()).min(1).max(300), done: z.boolean(), date: isoDate.optional() }), req.body);
    const section = await prisma.section.findFirst({ where: { id: body.sectionId, schoolId, deletedAt: null } });
    if (!section) throw notFound('Section not found');
    if (!(await canTeach(req, section.id, body.subjectId))) throw forbidden('Only the teacher of this subject can mark progress');
    const items = await prisma.syllabusItem.findMany({ where: { schoolId, classId: section.classId, subjectId: body.subjectId } });
    const parents = new Set(items.map((i) => i.parentId).filter(Boolean));
    const leaves = body.itemIds.filter((id) => items.some((i) => i.id === id) && !parents.has(id));
    if (leaves.length !== body.itemIds.length) throw badRequest('Choose topics of this syllabus');
    if (body.done) {
      const on = asDate(body.date ?? new Date().toISOString().slice(0, 10));
      await prisma.syllabusProgress.createMany({ data: leaves.map((itemId) => ({ schoolId, sectionId: section.id, itemId, completedOn: on, completedById: req.user!.id })), skipDuplicates: true });
    } else await prisma.syllabusProgress.deleteMany({ where: { sectionId: section.id, itemId: { in: leaves } } });
    const data = await loadSyllabus(schoolId, section.classId, body.subjectId, section.id);
    res.json({ total: data.total, completed: data.completed, percent: data.percent });
  }),
);

/** Coverage % for every section and subject (teachers: their own). */
router.get(
  '/syllabus/coverage',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const u = req.user!;
    if (!(staffViewer(req) || u.role === 'TEACHER')) throw forbidden();
    const scope = staffViewer(req) ? null : await teacherScope(schoolId, u.id);
    const sections = await prisma.section.findMany({
      where: { schoolId, deletedAt: null, class: { deletedAt: null } },
      select: { id: true, name: true, classId: true, classTeacherId: true, class: { select: { name: true, stream: true, sortOrder: true, subjects: { select: { subject: { select: { id: true, name: true } } } } } } },
    });
    const items = await prisma.syllabusItem.findMany({ where: { schoolId }, select: { id: true, classId: true, subjectId: true, parentId: true } });
    const parents = new Set(items.map((i) => i.parentId).filter(Boolean));
    const leaves = items.filter((i) => !parents.has(i.id));
    const progress = await prisma.syllabusProgress.findMany({ where: { schoolId }, select: { sectionId: true, itemId: true, completedOn: true } });
    const assignments = await prisma.teachingAssignment.findMany({ where: { schoolId }, select: { sectionId: true, subjectId: true, teacher: { select: { fullName: true } } } });
    const rows = [];
    for (const s of sections.sort((a, b) => a.class.sortOrder - b.class.sortOrder || classLabel(a.class, a).localeCompare(classLabel(b.class, b), undefined, { numeric: true }))) {
      for (const { subject } of s.class.subjects) {
        if (scope && !scope.taught.some((t) => t.sectionId === s.id && t.subjectId === subject.id) && s.classTeacherId !== u.id) continue;
        const mine = leaves.filter((l) => l.classId === s.classId && l.subjectId === subject.id);
        const done = progress.filter((p) => p.sectionId === s.id && mine.some((m) => m.id === p.itemId));
        const last = done.map((d) => d.completedOn).sort((a, b) => b.getTime() - a.getTime())[0];
        rows.push({
          sectionId: s.id,
          classId: s.classId,
          classLabel: classLabel(s.class, s),
          subjectId: subject.id,
          subject: subject.name,
          teacher: assignments.find((a) => a.sectionId === s.id && a.subjectId === subject.id)?.teacher.fullName ?? null,
          total: mine.length,
          completed: done.length,
          percent: mine.length ? Math.round((done.length / mine.length) * 1000) / 10 : null,
          lastOn: last ? ymd(last) : null,
        });
      }
    }
    res.json({ rows });
  }),
);

/** Families: syllabus and progress of each child's subjects. */
router.get(
  '/syllabus/my',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const kids = await familyStudents(req);
    const out = [];
    for (const k of kids) {
      const subjects = await prisma.classSubject.findMany({ where: { classId: k.classId }, select: { subject: { select: { id: true, name: true } } } });
      const list = [];
      for (const { subject } of subjects.sort((a, b) => a.subject.name.localeCompare(b.subject.name))) {
        const data = await loadSyllabus(schoolId, k.classId, subject.id, k.sectionId);
        const docs = await prisma.studyMaterial.findMany({ where: { schoolId, classId: k.classId, subjectId: subject.id, kind: 'SYLLABUS', deletedAt: null } });
        const info = await filesInfo(docs.flatMap((d) => d.fileIds as string[]));
        if (!data.total && !docs.length) continue;
        list.push({ subject, ...data, chapters: data.chapters.map((c) => ({ ...c, topics: c.topics.map((t) => ({ ...t, done: t.done ? { completedOn: t.done.completedOn } : null })) })), documents: docs.map((d) => ({ id: d.id, title: d.title, files: (d.fileIds as string[]).map((id) => info.get(id)).filter(Boolean) })) });
      }
      out.push({ student: { id: k.id, fullName: k.fullName, classLabel: classLabel(k.class, k.section) }, subjects: list });
    }
    res.json({ children: out });
  }),
);

// ---------- Study material ----------

const KINDS = ['NOTES', 'WORKSHEET', 'BOOK', 'VIDEO', 'LINK', 'SYLLABUS', 'OTHER'] as const;

async function presentMaterial(rows: Awaited<ReturnType<typeof prisma.studyMaterial.findMany>>, meId: string, manager: boolean) {
  const info = await filesInfo(rows.flatMap((r) => r.fileIds as string[]));
  const names = await userNames(rows.map((r) => r.createdById));
  const [subjects, classes, chapters] = await Promise.all([
    prisma.subject.findMany({ where: { id: { in: rows.map((r) => r.subjectId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
    prisma.classLevel.findMany({ where: { id: { in: rows.map((r) => r.classId) } }, select: { id: true, name: true, stream: true } }),
    prisma.syllabusItem.findMany({ where: { id: { in: rows.map((r) => r.chapterId).filter((x): x is string => Boolean(x)) } }, select: { id: true, title: true } }),
  ]);
  return rows.map((r) => {
    const c = classes.find((x) => x.id === r.classId);
    return {
      id: r.id,
      classId: r.classId,
      classLabel: c ? classLabel(c) : '',
      subjectId: r.subjectId,
      subject: subjects.find((s) => s.id === r.subjectId)?.name ?? null,
      sectionIds: (r.sectionIds as string[] | null) ?? null,
      chapterId: r.chapterId,
      chapter: chapters.find((x) => x.id === r.chapterId)?.title ?? null,
      kind: r.kind,
      title: r.title,
      description: r.description,
      url: r.url,
      files: (r.fileIds as string[]).map((id) => info.get(id)).filter(Boolean),
      createdBy: names.get(r.createdById) ?? '',
      createdAt: r.createdAt,
      canEdit: manager || r.createdById === meId,
    };
  });
}

router.get(
  '/material',
  ah(async (req, res) => {
    if (isFamily(req)) throw forbidden();
    if (!(staffViewer(req) || req.user!.role === 'TEACHER')) throw forbidden();
    const q = parse(z.object({ classId: z.string().optional(), subjectId: z.string().optional(), kind: z.enum(KINDS).optional(), q: z.string().max(100).optional(), mine: z.enum(['true', 'false']).optional() }), req.query);
    const rows = await prisma.studyMaterial.findMany({
      where: {
        schoolId: tenantId(req),
        deletedAt: null,
        ...(q.classId ? { classId: q.classId } : {}),
        ...(q.subjectId ? { subjectId: q.subjectId } : {}),
        ...(q.kind ? { kind: q.kind } : { kind: { not: 'SYLLABUS' } }),
        ...(q.q ? { OR: [{ title: { contains: q.q } }, { description: { contains: q.q } }] } : {}),
        ...(q.mine === 'true' ? { createdById: req.user!.id } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    res.json({ material: await presentMaterial(rows, req.user!.id, isLmsManager(req)) });
  }),
);

router.get(
  '/material/my',
  ah(async (req, res) => {
    const kids = await familyStudents(req);
    const q = parse(z.object({ subjectId: z.string().optional() }), req.query);
    const out = [];
    for (const k of kids) {
      const rows = await prisma.studyMaterial.findMany({ where: { schoolId: tenantId(req), classId: k.classId, deletedAt: null, kind: { not: 'SYLLABUS' }, ...(q.subjectId ? { subjectId: q.subjectId } : {}) }, orderBy: { createdAt: 'desc' }, take: 300 });
      const visible = rows.filter((r) => !r.sectionIds || (k.sectionId && (r.sectionIds as string[]).includes(k.sectionId)));
      const list = await presentMaterial(visible, req.user!.id, false);
      out.push({ student: { id: k.id, fullName: k.fullName, classLabel: classLabel(k.class, k.section) }, material: list.map(({ canEdit: _c, sectionIds: _s, ...m }) => m) });
    }
    res.json({ children: out });
  }),
);

const materialBody = z.object({
  classId: z.string(),
  subjectId: z.string().nullish(),
  sectionIds: z.array(z.string()).max(30).nullish(),
  chapterId: z.string().nullish(),
  kind: z.enum(KINDS),
  title: z.string().trim().min(2).max(200),
  description: optStr(2000),
  fileIds: z.array(z.string()).max(10).default([]),
  url: z.string().trim().url('Enter a full link starting with https://').max(500).refine((u) => /^https?:\/\//i.test(u), 'Only web links are allowed').nullish().or(z.literal('').transform(() => null)),
});

async function checkMaterialAccess(req: Request, b: z.infer<typeof materialBody>) {
  const schoolId = tenantId(req);
  const cls = await prisma.classLevel.findFirst({ where: { id: b.classId, schoolId, deletedAt: null }, include: { sections: { where: { deletedAt: null } }, subjects: true } });
  if (!cls) throw badRequest('Unknown class');
  if (b.subjectId && !cls.subjects.some((s) => s.subjectId === b.subjectId)) throw badRequest('This subject is not taught in this class');
  if (b.sectionIds?.some((id) => !cls.sections.some((s) => s.id === id))) throw badRequest('Unknown section');
  if (b.chapterId && !(await prisma.syllabusItem.findFirst({ where: { id: b.chapterId, schoolId, classId: b.classId } }))) throw badRequest('Unknown chapter');
  if (!b.fileIds.length && !b.url && !b.description) throw badRequest('Add a file, a link or some text');
  await checkFiles(schoolId, b.fileIds);
  if (isLmsManager(req)) return;
  if (req.user!.role !== 'TEACHER') throw forbidden();
  const targets = b.sectionIds?.length ? b.sectionIds : cls.sections.map((s) => s.id);
  let ok = false;
  for (const sid of targets) if (await canTeach(req, sid, b.subjectId ?? null)) ok = true;
  if (!ok) throw forbidden('You can only share material with classes you teach');
}

router.post(
  '/material',
  ah(async (req, res) => {
    const body = parse(materialBody, req.body);
    await checkMaterialAccess(req, body);
    const m = await prisma.studyMaterial.create({
      data: { schoolId: tenantId(req), classId: body.classId, subjectId: body.subjectId ?? null, sectionIds: body.sectionIds?.length ? body.sectionIds : undefined, chapterId: body.chapterId ?? null, kind: body.kind, title: body.title, description: body.description ?? null, fileIds: body.fileIds, url: body.url ?? null, createdById: req.user!.id },
    });
    await audit(req, { action: 'material.create', entityType: 'StudyMaterial', entityId: m.id, after: { title: m.title, kind: m.kind } });
    res.status(201).json({ id: m.id });
  }),
);

async function ownMaterial(req: Request, id: string) {
  const m = await prisma.studyMaterial.findFirst({ where: { id, schoolId: tenantId(req), deletedAt: null } });
  if (!m) throw notFound('Material not found');
  if (!(isLmsManager(req) || m.createdById === req.user!.id)) throw forbidden('Only the person who shared it or the principal can change it');
  return m;
}

router.put(
  '/material/:id',
  ah(async (req, res) => {
    const m = await ownMaterial(req, req.params.id);
    const body = parse(materialBody, req.body);
    await checkMaterialAccess(req, body);
    await prisma.studyMaterial.update({
      where: { id: m.id },
      data: { classId: body.classId, subjectId: body.subjectId ?? null, sectionIds: body.sectionIds?.length ? body.sectionIds : undefined, chapterId: body.chapterId ?? null, kind: body.kind, title: body.title, description: body.description ?? null, fileIds: body.fileIds, url: body.url ?? null },
    });
    if (!body.sectionIds?.length) await prisma.$executeRaw`UPDATE StudyMaterial SET sectionIds = NULL WHERE id = ${m.id}`;
    res.json({ ok: true });
  }),
);

router.delete(
  '/material/:id',
  ah(async (req, res) => {
    const m = await ownMaterial(req, req.params.id);
    await prisma.studyMaterial.update({ where: { id: m.id }, data: { deletedAt: new Date() } });
    await audit(req, { action: 'material.delete', entityType: 'StudyMaterial', entityId: m.id, before: { title: m.title } });
    res.json({ ok: true });
  }),
);

// ---------- School documents ----------

const AUDIENCES = ['STAFF', 'TEACHER', 'PARENT', 'STUDENT'] as const;

router.get(
  '/documents',
  ah(async (req, res) => {
    const u = req.user!;
    const manager = isLmsManager(req);
    const rows = await prisma.schoolDocument.findMany({ where: { schoolId: tenantId(req), deletedAt: null }, orderBy: { createdAt: 'desc' } });
    const visible = manager ? rows : rows.filter((r) => (r.audience as string[]).includes(u.role));
    const info = await filesInfo(visible.map((r) => r.fileId));
    res.json({
      documents: visible.map((r) => ({ id: r.id, title: r.title, description: r.description, category: r.category, file: info.get(r.fileId) ?? null, audience: manager ? r.audience : undefined, createdAt: r.createdAt })),
      canManage: manager,
    });
  }),
);

router.post(
  '/documents',
  ah(async (req, res) => {
    if (!isLmsManager(req)) throw forbidden();
    const body = parse(z.object({ title: z.string().trim().min(2).max(200), description: optStr(1000), category: optStr(60), fileId: z.string(), audience: z.array(z.enum(AUDIENCES)).min(1) }), req.body);
    await checkFiles(tenantId(req), [body.fileId]);
    const d = await prisma.schoolDocument.create({ data: { schoolId: tenantId(req), title: body.title, description: body.description ?? null, category: body.category ?? null, fileId: body.fileId, audience: body.audience, createdById: req.user!.id } });
    await audit(req, { action: 'document.create', entityType: 'SchoolDocument', entityId: d.id, after: { title: d.title, audience: body.audience } });
    res.status(201).json({ id: d.id });
  }),
);

router.patch(
  '/documents/:id',
  ah(async (req, res) => {
    if (!isLmsManager(req)) throw forbidden();
    const d = await prisma.schoolDocument.findFirst({ where: { id: req.params.id, schoolId: tenantId(req), deletedAt: null } });
    if (!d) throw notFound('Document not found');
    const body = parse(z.object({ title: z.string().trim().min(2).max(200).optional(), description: optStr(1000), category: optStr(60), audience: z.array(z.enum(AUDIENCES)).min(1).optional() }), req.body);
    await prisma.schoolDocument.update({ where: { id: d.id }, data: body });
    res.json({ ok: true });
  }),
);

router.delete(
  '/documents/:id',
  ah(async (req, res) => {
    if (!isLmsManager(req)) throw forbidden();
    const d = await prisma.schoolDocument.findFirst({ where: { id: req.params.id, schoolId: tenantId(req), deletedAt: null } });
    if (!d) throw notFound('Document not found');
    await prisma.schoolDocument.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
    await audit(req, { action: 'document.delete', entityType: 'SchoolDocument', entityId: d.id, before: { title: d.title } });
    res.json({ ok: true });
  }),
);

// ---------- Homework / diary ----------

async function presentHomework(rows: Awaited<ReturnType<typeof prisma.homework.findMany>>, meId: string, manager: boolean) {
  const info = await filesInfo(rows.flatMap((r) => r.fileIds as string[]));
  const names = await userNames(rows.map((r) => r.createdById));
  const subjects = await prisma.subject.findMany({ where: { id: { in: rows.map((r) => r.subjectId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  return rows.map((r) => ({
    id: r.id,
    sectionId: r.sectionId,
    subjectId: r.subjectId,
    subject: subjects.find((s) => s.id === r.subjectId)?.name ?? null,
    date: ymd(r.date),
    dueDate: r.dueDate ? ymd(r.dueDate) : null,
    text: r.text,
    files: (r.fileIds as string[]).map((id) => info.get(id)).filter(Boolean),
    createdBy: names.get(r.createdById) ?? '',
    canEdit: manager || r.createdById === meId,
  }));
}

async function canSeeSection(req: Request, sectionId: string) {
  if (staffViewer(req)) return true;
  if (req.user!.role !== 'TEACHER') return false;
  const scope = await teacherScope(tenantId(req), req.user!.id);
  return scope.classTeacherOf.some((s) => s.id === sectionId) || scope.taught.some((t) => t.sectionId === sectionId);
}

router.get(
  '/homework',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const school = req.user!.school!;
    const q = parse(z.object({ sectionId: z.string(), date: isoDate.optional() }), req.query);
    if (!(await canSeeSection(req, q.sectionId))) throw forbidden();
    const date = q.date ?? schoolToday(school.timezone);
    const rows = await prisma.homework.findMany({ where: { schoolId, sectionId: q.sectionId, date: asDate(date), deletedAt: null }, orderBy: { createdAt: 'asc' } });
    const digest = await prisma.homeworkDigest.findUnique({ where: { sectionId_date: { sectionId: q.sectionId, date: asDate(date) } } });
    const section = await prisma.section.findUnique({ where: { id: q.sectionId }, select: { classTeacherId: true } });
    const settings = await getLmsSettings(schoolId);
    res.json({
      date,
      homework: await presentHomework(rows, req.user!.id, isLmsManager(req)),
      digest: digest ? { sentAt: digest.sentAt, items: digest.items } : null,
      digestTime: settings.digestTime,
      canSend: isLmsManager(req) || section?.classTeacherId === req.user!.id,
    });
  }),
);

/** Families: homework of a day (default today) for each child, plus which recent days have homework. */
router.get(
  '/homework/my',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const kids = await familyStudents(req);
    const school = req.user!.school!;
    const q = parse(z.object({ date: isoDate.optional() }), req.query);
    const date = q.date ?? schoolToday(school.timezone);
    const from = new Date(asDate(date).getTime() - 13 * 86400000);
    const out = [];
    for (const k of kids) {
      if (!k.sectionId) {
        out.push({ student: { id: k.id, fullName: k.fullName, classLabel: classLabel(k.class, k.section) }, homework: [], days: [] });
        continue;
      }
      const rows = await prisma.homework.findMany({ where: { schoolId, sectionId: k.sectionId, date: asDate(date), deletedAt: null }, orderBy: { createdAt: 'asc' } });
      const days = await prisma.homework.groupBy({ by: ['date'], where: { schoolId, sectionId: k.sectionId, deletedAt: null, date: { gte: from, lte: asDate(date) } }, _count: { _all: true } });
      const list = await presentHomework(rows, req.user!.id, false);
      out.push({
        student: { id: k.id, fullName: k.fullName, classLabel: classLabel(k.class, k.section) },
        homework: list.map(({ canEdit: _c, ...h }) => h),
        days: days.map((d) => ({ date: ymd(d.date), count: d._count._all })).sort((a, b) => b.date.localeCompare(a.date)),
      });
    }
    res.json({ date, children: out });
  }),
);

const homeworkBody = z.object({
  sectionId: z.string(),
  subjectId: z.string().nullish(),
  date: isoDate,
  dueDate: isoDate.nullish(),
  text: z.string().trim().min(2).max(3000),
  fileIds: z.array(z.string()).max(5).default([]),
});

async function checkHomework(req: Request, b: z.infer<typeof homeworkBody>) {
  const schoolId = tenantId(req);
  const section = await prisma.section.findFirst({ where: { id: b.sectionId, schoolId, deletedAt: null }, include: { class: { include: { subjects: true } } } });
  if (!section) throw badRequest('Unknown section');
  if (b.subjectId && !section.class.subjects.some((s) => s.subjectId === b.subjectId)) throw badRequest('This subject is not taught in this class');
  if (b.dueDate && b.dueDate < b.date) throw badRequest('The due date cannot be before the homework date');
  if (!(await canTeach(req, section.id, b.subjectId ?? null))) throw forbidden('You can only give homework for subjects you teach in this class');
  await checkFiles(schoolId, b.fileIds);
}

router.post(
  '/homework',
  ah(async (req, res) => {
    const body = parse(homeworkBody, req.body);
    await checkHomework(req, body);
    const h = await prisma.homework.create({ data: { schoolId: tenantId(req), sectionId: body.sectionId, subjectId: body.subjectId ?? null, date: asDate(body.date), dueDate: body.dueDate ? asDate(body.dueDate) : null, text: body.text, fileIds: body.fileIds, createdById: req.user!.id } });
    await audit(req, { action: 'homework.create', entityType: 'Homework', entityId: h.id, after: { sectionId: h.sectionId, date: body.date } });
    res.status(201).json({ id: h.id });
  }),
);

async function ownHomework(req: Request, id: string) {
  const h = await prisma.homework.findFirst({ where: { id, schoolId: tenantId(req), deletedAt: null } });
  if (!h) throw notFound('Homework not found');
  if (!(isLmsManager(req) || h.createdById === req.user!.id)) throw forbidden('Only the teacher who posted it or the principal can change it');
  return h;
}

router.put(
  '/homework/:id',
  ah(async (req, res) => {
    const h = await ownHomework(req, req.params.id);
    const body = parse(homeworkBody, req.body);
    await checkHomework(req, body);
    await prisma.homework.update({ where: { id: h.id }, data: { sectionId: body.sectionId, subjectId: body.subjectId ?? null, date: asDate(body.date), dueDate: body.dueDate ? asDate(body.dueDate) : null, text: body.text, fileIds: body.fileIds } });
    res.json({ ok: true });
  }),
);

router.delete(
  '/homework/:id',
  ah(async (req, res) => {
    const h = await ownHomework(req, req.params.id);
    await prisma.homework.update({ where: { id: h.id }, data: { deletedAt: new Date() } });
    await audit(req, { action: 'homework.delete', entityType: 'Homework', entityId: h.id, before: { text: h.text } });
    res.json({ ok: true });
  }),
);

/** Send the day's diary of a section to parents now (class teacher or principal). */
router.post(
  '/homework/send',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const body = parse(z.object({ sectionId: z.string(), date: isoDate }), req.body);
    const section = await prisma.section.findFirst({ where: { id: body.sectionId, schoolId, deletedAt: null } });
    if (!section) throw notFound('Section not found');
    if (!(isLmsManager(req) || section.classTeacherId === req.user!.id)) throw forbidden('Only the class teacher or the principal can send the diary');
    const r = await sendDigest(schoolId, section.id, body.date, { byUserId: req.user!.id, whatsapp: true });
    if (!r.items) throw badRequest('There is no homework for this day');
    await audit(req, { action: 'homework.digest', entityType: 'Section', entityId: section.id, after: { date: body.date, ...r } });
    res.json(r);
  }),
);

router.get(
  '/settings',
  ah(async (req, res) => {
    res.json({ settings: await getLmsSettings(tenantId(req)) });
  }),
);

router.put(
  '/settings',
  ah(async (req, res) => {
    if (!isLmsManager(req)) throw forbidden();
    const body = parse(z.object({ digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM').optional(), classTeacherAllSubjects: z.boolean().optional() }), req.body);
    await getLmsSettings(tenantId(req));
    const s = await prisma.lmsSettings.update({ where: { schoolId: tenantId(req) }, data: body });
    await audit(req, { action: 'lms.settings', entityType: 'LmsSettings', entityId: s.schoolId, after: body });
    res.json({ settings: s });
  }),
);

export default router;

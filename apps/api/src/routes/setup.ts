import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optStr, parse } from '../lib/validate';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { assertPrincipal } from '../lib/http';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { effectiveLimits } from '../services/limits';
import { DEFAULT_REQUIRED_FIELDS, OPTIONAL_STUDENT_FIELDS, STUDENT_DOCUMENT_TYPES } from '../config/studentFields';

/** School setup: sessions, classes, sections, subjects, campuses, teacher assignments, form settings. */
const router = Router();

const isoDate = z.coerce.date();

// ---------- Settings: required enrollment fields ----------

export function requiredFieldsOf(settings: unknown): string[] {
  const s = settings as { requiredStudentFields?: string[] } | null;
  return Array.isArray(s?.requiredStudentFields) ? s!.requiredStudentFields : DEFAULT_REQUIRED_FIELDS;
}

router.get(
  '/meta',
  ah(async (req, res) => {
    const school = await prisma.school.findUniqueOrThrow({ where: { id: tenantId(req) } });
    res.json({
      optionalStudentFields: OPTIONAL_STUDENT_FIELDS,
      requiredStudentFields: requiredFieldsOf(school.settings),
      documentTypes: STUDENT_DOCUMENT_TYPES,
    });
  }),
);

router.put(
  '/required-fields',
  ah(async (req, res) => {
    assertPrincipal(req);
    const keys = Object.keys(OPTIONAL_STUDENT_FIELDS) as [string, ...string[]];
    const body = parse(z.object({ fields: z.array(z.enum(keys)) }), req.body);
    const schoolId = tenantId(req);
    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const settings = { ...((school.settings as object) ?? {}), requiredStudentFields: body.fields };
    await prisma.school.update({ where: { id: schoolId }, data: { settings } });
    await audit(req, { action: 'settings.required_fields', entityType: 'School', entityId: schoolId, before: requiredFieldsOf(school.settings), after: body.fields });
    res.json({ requiredStudentFields: body.fields });
  }),
);

// ---------- Everything a form needs in one call ----------

router.get(
  '/structure',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const [sessions, classes, subjects, campuses, teachers] = await Promise.all([
      prisma.academicSession.findMany({ where: { schoolId }, orderBy: { startDate: 'desc' } }),
      prisma.classLevel.findMany({
        where: { schoolId, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          sections: {
            where: { deletedAt: null },
            orderBy: { name: 'asc' },
            include: {
              classTeacher: { select: { id: true, fullName: true } },
              _count: { select: { students: { where: { status: 'ACTIVE', deletedAt: null } } } },
            },
          },
          subjects: { include: { subject: { select: { id: true, name: true, code: true } } } },
          _count: { select: { students: { where: { status: 'ACTIVE', deletedAt: null } } } },
        },
      }),
      prisma.subject.findMany({ where: { schoolId, deletedAt: null }, orderBy: { name: 'asc' } }),
      prisma.campus.findMany({ where: { schoolId }, orderBy: [{ isMain: 'desc' }, { name: 'asc' }] }),
      prisma.user.findMany({
        where: { schoolId, role: 'TEACHER', deletedAt: null, isActive: true },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      }),
    ]);
    res.json({
      sessions,
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        stream: c.stream,
        sortOrder: c.sortOrder,
        studentCount: c._count.students,
        subjects: c.subjects.map((cs) => ({ ...cs.subject, isOptional: cs.isOptional })),
        sections: c.sections.map((s) => ({
          id: s.id,
          name: s.name,
          campusId: s.campusId,
          capacity: s.capacity,
          room: s.room,
          classTeacher: s.classTeacher,
          studentCount: s._count.students,
        })),
      })),
      subjects,
      campuses,
      teachers,
    });
  }),
);

// ---------- Sessions ----------

const sessionBody = z
  .object({ name: z.string().trim().min(2).max(40), startDate: isoDate, endDate: isoDate, isCurrent: z.boolean().default(false) })
  .refine((v) => v.endDate > v.startDate, { message: 'End date must be after start date', path: ['endDate'] });

router.post(
  '/sessions',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const body = parse(sessionBody, req.body);
    const count = await prisma.academicSession.count({ where: { schoolId } });
    const session = await prisma.$transaction(async (tx) => {
      const makeCurrent = body.isCurrent || count === 0;
      if (makeCurrent) await tx.academicSession.updateMany({ where: { schoolId }, data: { isCurrent: false } });
      return tx.academicSession.create({ data: { ...body, isCurrent: makeCurrent, schoolId } });
    });
    await audit(req, { action: 'session.create', entityType: 'AcademicSession', entityId: session.id, after: body });
    res.status(201).json({ session });
  }),
);

router.patch(
  '/sessions/:id',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const before = await prisma.academicSession.findFirst({ where: { id: req.params.id, schoolId } });
    if (!before) throw notFound('Session not found');
    const body = parse(z.object({ name: z.string().trim().min(2).max(40), startDate: isoDate, endDate: isoDate, isCurrent: z.boolean() }).partial(), req.body);
    const session = await prisma.$transaction(async (tx) => {
      if (body.isCurrent) await tx.academicSession.updateMany({ where: { schoolId }, data: { isCurrent: false } });
      return tx.academicSession.update({ where: { id: before.id }, data: body });
    });
    await audit(req, { action: 'session.update', entityType: 'AcademicSession', entityId: session.id, before, after: body });
    res.json({ session });
  }),
);

// ---------- Classes ----------

const classBody = z.object({
  name: z.string().trim().min(1).max(60),
  stream: optStr(60),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  sections: z.array(z.string().trim().min(1).max(20)).optional(),
});

router.post(
  '/classes',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const body = parse(classBody, req.body);
    const dup = await prisma.classLevel.findFirst({ where: { schoolId, name: body.name, stream: body.stream ?? null, deletedAt: null } });
    if (dup) throw conflict('This class already exists');
    const main = await prisma.campus.findFirst({ where: { schoolId, isMain: true } });
    const cls = await prisma.classLevel.create({
      data: {
        schoolId,
        name: body.name,
        stream: body.stream ?? null,
        sortOrder: body.sortOrder,
        sections: { create: [...new Set(body.sections ?? ['A'])].map((name) => ({ schoolId, name, campusId: main?.id ?? null })) },
      },
    });
    await audit(req, { action: 'class.create', entityType: 'ClassLevel', entityId: cls.id, after: body });
    res.status(201).json({ class: cls });
  }),
);

/** Quick start: create the usual Pakistani class list in one click. */
router.post(
  '/classes/presets',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const body = parse(z.object({ upTo: z.enum(['matric', 'intermediate']).default('matric'), sections: z.array(z.string().trim().min(1).max(20)).default(['A']) }), req.body);
    const names = ['Playgroup', 'Nursery', 'Prep', ...Array.from({ length: 10 }, (_, i) => `Class ${i + 1}`)];
    const list: { name: string; stream: string | null }[] = names.map((n) => ({ name: n, stream: null }));
    if (body.upTo === 'intermediate') {
      for (const year of ['1st Year', '2nd Year']) {
        for (const stream of ['Pre-Medical', 'Pre-Engineering', 'ICS', 'I.Com', 'FA']) list.push({ name: year, stream });
      }
    }
    const existing = await prisma.classLevel.findMany({ where: { schoolId, deletedAt: null } });
    const key = (n: string, s: string | null) => `${n.toLowerCase()}|${(s ?? '').toLowerCase()}`;
    const have = new Set(existing.map((c) => key(c.name, c.stream)));
    const main = await prisma.campus.findFirst({ where: { schoolId, isMain: true } });
    let created = 0;
    for (const [i, c] of list.entries()) {
      if (have.has(key(c.name, c.stream))) continue;
      await prisma.classLevel.create({
        data: { schoolId, name: c.name, stream: c.stream, sortOrder: (i + 1) * 10, sections: { create: body.sections.map((name) => ({ schoolId, name, campusId: main?.id ?? null })) } },
      });
      created++;
    }
    await audit(req, { action: 'class.presets', entityType: 'ClassLevel', after: { ...body, created } });
    res.json({ created, skipped: list.length - created });
  }),
);

router.patch(
  '/classes/:id',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const before = await prisma.classLevel.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
    if (!before) throw notFound('Class not found');
    const body = parse(classBody.omit({ sections: true }).partial(), req.body);
    const cls = await prisma.classLevel.update({ where: { id: before.id }, data: body });
    await audit(req, { action: 'class.update', entityType: 'ClassLevel', entityId: cls.id, before, after: body });
    res.json({ class: cls });
  }),
);

router.delete(
  '/classes/:id',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const cls = await prisma.classLevel.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
    if (!cls) throw notFound('Class not found');
    const students = await prisma.student.count({ where: { classId: cls.id, deletedAt: null, status: 'ACTIVE' } });
    if (students) throw badRequest(`Move the ${students} student(s) in this class first`);
    await prisma.$transaction([
      prisma.classLevel.update({ where: { id: cls.id }, data: { deletedAt: new Date() } }),
      prisma.section.updateMany({ where: { classId: cls.id }, data: { deletedAt: new Date() } }),
      prisma.timetableEntry.deleteMany({ where: { section: { classId: cls.id } } }),
    ]);
    await audit(req, { action: 'class.delete', entityType: 'ClassLevel', entityId: cls.id, before: cls });
    res.json({ ok: true });
  }),
);

/** Replace the subject list of a class. */
router.put(
  '/classes/:id/subjects',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const cls = await prisma.classLevel.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
    if (!cls) throw notFound('Class not found');
    const body = parse(z.object({ subjects: z.array(z.object({ subjectId: z.string(), isOptional: z.boolean().default(false) })) }), req.body);
    const ids = body.subjects.map((s) => s.subjectId);
    const valid = await prisma.subject.count({ where: { id: { in: ids }, schoolId, deletedAt: null } });
    if (valid !== new Set(ids).size) throw badRequest('Unknown subject');
    await prisma.$transaction([
      prisma.classSubject.deleteMany({ where: { classId: cls.id } }),
      prisma.classSubject.createMany({ data: body.subjects.map((s) => ({ classId: cls.id, ...s })), skipDuplicates: true }),
      // Remove teacher assignments for subjects no longer taught in this class.
      prisma.teachingAssignment.deleteMany({ where: { section: { classId: cls.id }, subjectId: { notIn: ids } } }),
      prisma.timetableEntry.deleteMany({ where: { section: { classId: cls.id }, subjectId: { notIn: ids } } }),
    ]);
    await audit(req, { action: 'class.subjects', entityType: 'ClassLevel', entityId: cls.id, after: body.subjects });
    res.json({ ok: true });
  }),
);

// ---------- Sections ----------

const sectionBody = z.object({
  name: z.string().trim().min(1).max(20),
  campusId: z.string().nullish(),
  capacity: z.coerce.number().int().min(1).max(500).nullish(),
  room: optStr(40),
  classTeacherId: z.string().nullish(),
});

async function checkSectionRefs(schoolId: string, body: { campusId?: string | null; classTeacherId?: string | null }) {
  if (body.campusId && !(await prisma.campus.findFirst({ where: { id: body.campusId, schoolId } }))) throw badRequest('Unknown campus');
  if (body.classTeacherId && !(await prisma.user.findFirst({ where: { id: body.classTeacherId, schoolId, role: 'TEACHER', deletedAt: null } }))) {
    throw badRequest('Class teacher must be a teacher of this school');
  }
}

router.post(
  '/classes/:id/sections',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const cls = await prisma.classLevel.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
    if (!cls) throw notFound('Class not found');
    const body = parse(sectionBody, req.body);
    await checkSectionRefs(schoolId, body);
    if (await prisma.section.findFirst({ where: { classId: cls.id, name: body.name, deletedAt: null } })) throw conflict('Section already exists');
    const main = body.campusId ? null : await prisma.campus.findFirst({ where: { schoolId, isMain: true } });
    const section = await prisma.section.create({ data: { ...body, campusId: body.campusId ?? main?.id ?? null, classId: cls.id, schoolId } });
    await audit(req, { action: 'section.create', entityType: 'Section', entityId: section.id, after: body });
    res.status(201).json({ section });
  }),
);

router.patch(
  '/sections/:id',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const before = await prisma.section.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
    if (!before) throw notFound('Section not found');
    const body = parse(sectionBody.partial(), req.body);
    await checkSectionRefs(schoolId, body);
    const section = await prisma.section.update({ where: { id: before.id }, data: body });
    await audit(req, { action: 'section.update', entityType: 'Section', entityId: section.id, before, after: body });
    res.json({ section });
  }),
);

router.delete(
  '/sections/:id',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const section = await prisma.section.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
    if (!section) throw notFound('Section not found');
    const students = await prisma.student.count({ where: { sectionId: section.id, deletedAt: null, status: 'ACTIVE' } });
    if (students) throw badRequest(`Move the ${students} student(s) in this section first`);
    await prisma.$transaction([
      prisma.section.update({ where: { id: section.id }, data: { deletedAt: new Date() } }),
      prisma.teachingAssignment.deleteMany({ where: { sectionId: section.id } }),
      prisma.timetableEntry.deleteMany({ where: { sectionId: section.id } }),
    ]);
    await audit(req, { action: 'section.delete', entityType: 'Section', entityId: section.id, before: section });
    res.json({ ok: true });
  }),
);

// ---------- Subjects ----------

const subjectBody = z.object({ name: z.string().trim().min(1).max(80), code: optStr(20) });

router.post(
  '/subjects',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const body = parse(z.union([subjectBody, z.object({ names: z.array(z.string().trim().min(1).max(80)).min(1) })]), req.body);
    const names = 'names' in body ? body.names : [body.name];
    const existing = new Set((await prisma.subject.findMany({ where: { schoolId, deletedAt: null } })).map((s) => s.name.toLowerCase()));
    const fresh = [...new Set(names)].filter((n) => !existing.has(n.toLowerCase()));
    if ('name' in body && fresh.length === 0) throw conflict('Subject already exists');
    await prisma.subject.createMany({ data: fresh.map((name) => ({ schoolId, name, code: 'code' in body ? (body.code ?? null) : null })) });
    await audit(req, { action: 'subject.create', entityType: 'Subject', after: { names: fresh } });
    res.status(201).json({ created: fresh.length });
  }),
);

router.patch(
  '/subjects/:id',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const before = await prisma.subject.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
    if (!before) throw notFound('Subject not found');
    const body = parse(subjectBody.partial(), req.body);
    const subject = await prisma.subject.update({ where: { id: before.id }, data: body });
    await audit(req, { action: 'subject.update', entityType: 'Subject', entityId: subject.id, before, after: body });
    res.json({ subject });
  }),
);

router.delete(
  '/subjects/:id',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const subject = await prisma.subject.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
    if (!subject) throw notFound('Subject not found');
    await prisma.$transaction([
      prisma.subject.update({ where: { id: subject.id }, data: { deletedAt: new Date() } }),
      prisma.classSubject.deleteMany({ where: { subjectId: subject.id } }),
      prisma.teachingAssignment.deleteMany({ where: { subjectId: subject.id } }),
      prisma.timetableEntry.deleteMany({ where: { subjectId: subject.id } }),
    ]);
    await audit(req, { action: 'subject.delete', entityType: 'Subject', entityId: subject.id, before: subject });
    res.json({ ok: true });
  }),
);

// ---------- Campuses ----------

const campusBody = z.object({ name: z.string().trim().min(2).max(120), address: optStr(300) });

router.post(
  '/campuses',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const body = parse(campusBody, req.body);
    const limit = effectiveLimits(req.user!.school!).maxCampuses;
    if ((await prisma.campus.count({ where: { schoolId } })) >= limit) {
      throw forbidden(`Your plan allows ${limit} campus(es). Request an upgrade to add more.`, 'PLAN_LIMIT');
    }
    const campus = await prisma.campus.create({ data: { ...body, schoolId } });
    await audit(req, { action: 'campus.create', entityType: 'Campus', entityId: campus.id, after: body });
    res.status(201).json({ campus });
  }),
);

router.patch(
  '/campuses/:id',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const before = await prisma.campus.findFirst({ where: { id: req.params.id, schoolId } });
    if (!before) throw notFound('Campus not found');
    const body = parse(campusBody.partial(), req.body);
    const campus = await prisma.campus.update({ where: { id: before.id }, data: body });
    await audit(req, { action: 'campus.update', entityType: 'Campus', entityId: campus.id, before, after: body });
    res.json({ campus });
  }),
);

// ---------- Teacher assignments ----------

router.get(
  '/assignments',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const rows = await prisma.teachingAssignment.findMany({
      where: { schoolId, section: { deletedAt: null } },
      select: { id: true, sectionId: true, subjectId: true, teacher: { select: { id: true, fullName: true } } },
    });
    res.json({ assignments: rows });
  }),
);

/** Set (or clear with teacherId null) the teacher of one subject in one section. */
router.put(
  '/assignments',
  ah(async (req, res) => {
    assertPrincipal(req);
    const schoolId = tenantId(req);
    const body = parse(z.object({ sectionId: z.string(), subjectId: z.string(), teacherId: z.string().nullable() }), req.body);
    const section = await prisma.section.findFirst({ where: { id: body.sectionId, schoolId, deletedAt: null } });
    if (!section) throw notFound('Section not found');
    const taught = await prisma.classSubject.findUnique({ where: { classId_subjectId: { classId: section.classId, subjectId: body.subjectId } } });
    if (!taught) throw badRequest('This subject is not taught in this class');
    if (body.teacherId === null) {
      await prisma.teachingAssignment.deleteMany({ where: { sectionId: section.id, subjectId: body.subjectId } });
    } else {
      const teacher = await prisma.user.findFirst({ where: { id: body.teacherId, schoolId, role: 'TEACHER', deletedAt: null } });
      if (!teacher) throw badRequest('Choose a teacher of this school');
      await prisma.teachingAssignment.upsert({
        where: { sectionId_subjectId: { sectionId: section.id, subjectId: body.subjectId } },
        create: { schoolId, sectionId: section.id, subjectId: body.subjectId, teacherId: teacher.id },
        update: { teacherId: teacher.id },
      });
    }
    await audit(req, { action: 'assignment.set', entityType: 'Section', entityId: section.id, after: body });
    res.json({ ok: true });
  }),
);

// ---------- Setup checklist (dashboard wizard) ----------

router.get(
  '/checklist',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const [school, sessions, classes, subjects, classSubjects, teachers, students, sectionsNoTeacher] = await Promise.all([
      prisma.school.findUniqueOrThrow({ where: { id: schoolId } }),
      prisma.academicSession.count({ where: { schoolId } }),
      prisma.classLevel.count({ where: { schoolId, deletedAt: null } }),
      prisma.subject.count({ where: { schoolId, deletedAt: null } }),
      prisma.classSubject.count({ where: { class: { schoolId, deletedAt: null } } }),
      prisma.user.count({ where: { schoolId, role: { in: ['TEACHER', 'STAFF'] }, deletedAt: null } }),
      prisma.student.count({ where: { schoolId, deletedAt: null } }),
      prisma.section.count({ where: { schoolId, deletedAt: null, classTeacherId: null } }),
    ]);
    const steps = [
      { key: 'profile', label: 'Add school logo and contact details', done: Boolean(school.logoFileId && school.phone), href: '/school/settings' },
      { key: 'session', label: 'Create the academic session', done: sessions > 0, href: '/school/setup?tab=sessions' },
      { key: 'classes', label: 'Add classes and sections', done: classes > 0, href: '/school/setup?tab=classes' },
      { key: 'subjects', label: 'Add subjects and link them to classes', done: subjects > 0 && classSubjects > 0, href: '/school/setup?tab=subjects' },
      { key: 'staff', label: 'Add teachers and staff', done: teachers > 0, href: '/school/staff' },
      { key: 'teachers', label: 'Assign class teachers and subject teachers', done: classes > 0 && sectionsNoTeacher === 0, href: '/school/assignments' },
      { key: 'students', label: 'Enroll or import students', done: students > 0, href: '/school/students' },
    ];
    res.json({ steps, done: steps.filter((s) => s.done).length, total: steps.length });
  }),
);

export default router;

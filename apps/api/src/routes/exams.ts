import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optStr, parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import { round2 } from '../lib/money';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { MESSAGE_TYPES, renderTemplate } from '../config/messageTypes';
import { enqueue, getSettings, notify, ruleFor, studentsWithContacts, whatsappReady } from '../services/messaging';
import { bandsOf, computeResults, ensureDefaultTypes, getExamSettings, gradeFor, num } from '../services/exams';
import { percent as attendancePercent } from './attendance';

const router = Router();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const marksNum = z.coerce.number().min(0).max(10000);
const classLabel = (c: { name: string; stream: string | null }, s?: { name: string } | null) => `${c.name}${c.stream ? ` ${c.stream}` : ''}${s ? ` ${s.name}` : ''}`;

const isManager = (req: Request) => can(req, 'exams.manage');
const assertManager = (req: Request) => {
  if (!isManager(req)) throw forbidden('Only the principal (or staff with exam rights) can do this');
};

// ---------- Settings and types ----------

router.get(
  '/settings',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    await ensureDefaultTypes(schoolId);
    const [settings, types] = await Promise.all([getExamSettings(schoolId), prisma.assessmentType.findMany({ where: { schoolId }, orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] })]);
    res.json({ settings: { ...settings, passPercent: num(settings.passPercent), gradeBands: bandsOf(settings) }, types });
  }),
);

router.put(
  '/settings',
  ah(async (req, res) => {
    assertManager(req);
    const schoolId = tenantId(req);
    const body = parse(
      z.object({
        gradeBands: z.array(z.object({ grade: z.string().trim().min(1).max(5), min: z.coerce.number().min(0).max(100), remark: optStr(60) })).min(2).max(15).optional(),
        passPercent: z.coerce.number().min(0).max(100).optional(),
        testsNeedApproval: z.boolean().optional(),
        showPositions: z.boolean().optional(),
      }),
      req.body,
    );
    if (body.gradeBands && !body.gradeBands.some((b) => b.min === 0)) throw badRequest('One grade must start at 0%');
    await getExamSettings(schoolId);
    const s = await prisma.examSettings.update({ where: { schoolId }, data: { ...body, gradeBands: body.gradeBands ? (body.gradeBands.sort((a, b) => b.min - a.min) as never) : undefined } });
    // Grades and pass/fail of published results follow the new rules.
    const published = await prisma.assessment.findMany({ where: { schoolId, status: 'PUBLISHED' }, select: { id: true } });
    for (const a of published) await prisma.$transaction((tx) => computeResults(tx, a.id));
    await audit(req, { action: 'exams.settings', entityType: 'School', entityId: schoolId, after: body });
    res.json({ settings: s });
  }),
);

router.post(
  '/types',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const body = parse(z.object({ name: z.string().trim().min(2).max(60), kind: z.enum(['TEST', 'EXAM']) }), req.body);
    // Teachers may add their own test names; exam types belong to the principal.
    if (body.kind === 'EXAM') assertManager(req);
    else if (!(isManager(req) || req.user!.role === 'TEACHER')) throw forbidden();
    const existing = await prisma.assessmentType.findFirst({ where: { schoolId, kind: body.kind, name: body.name } });
    if (existing) return res.json({ type: existing });
    const type = await prisma.assessmentType.create({ data: { ...body, schoolId, sortOrder: 500, createdById: req.user!.id } });
    await audit(req, { action: 'exams.type_create', entityType: 'AssessmentType', entityId: type.id, after: body });
    res.status(201).json({ type });
  }),
);

router.patch(
  '/types/:id',
  ah(async (req, res) => {
    assertManager(req);
    const t = await prisma.assessmentType.findFirst({ where: { id: req.params.id, schoolId: tenantId(req) } });
    if (!t) throw notFound('Type not found');
    const body = parse(z.object({ name: z.string().trim().min(2).max(60), isActive: z.boolean() }).partial(), req.body);
    res.json({ type: await prisma.assessmentType.update({ where: { id: t.id }, data: body }) });
  }),
);

// ---------- Access helpers ----------

async function loadAssessment(req: Request, id: string) {
  const a = await prisma.assessment.findFirst({
    where: { id, schoolId: tenantId(req) },
    include: { type: true, papers: { orderBy: [{ sortOrder: 'asc' }, { date: 'asc' }] } },
  });
  if (!a) throw notFound('Test or exam not found');
  return a;
}

/** Sections of the assessment (a test has one; an exam has all sections of the class). */
async function sectionsOf(a: { classId: string; sectionId: string | null }) {
  return prisma.section.findMany({
    where: { classId: a.classId, deletedAt: null, ...(a.sectionId ? { id: a.sectionId } : {}) },
    select: { id: true, name: true, classTeacherId: true },
    orderBy: { name: 'asc' },
  });
}

/** Can this user enter marks for this paper in this section? */
async function canEnter(req: Request, a: { kind: string; createdById: string }, paper: { subjectId: string }, sectionId: string) {
  if (isManager(req)) return true;
  const u = req.user!;
  if (u.role !== 'TEACHER') return false;
  if (a.kind === 'TEST' && a.createdById === u.id) return true;
  return (await prisma.teachingAssignment.count({ where: { sectionId, subjectId: paper.subjectId, teacherId: u.id } })) > 0;
}

/** Can view an assessment's marks: managers, its teachers, class teachers of its sections. */
async function canView(req: Request, a: { id: string; kind: string; createdById: string; classId: string; sectionId: string | null }) {
  if (isManager(req) || can(req, 'students.view')) return true;
  const u = req.user!;
  if (u.role !== 'TEACHER') return false;
  if (a.createdById === u.id) return true;
  const secs = await sectionsOf(a);
  if (secs.some((s) => s.classTeacherId === u.id)) return true;
  const papers = await prisma.assessmentPaper.findMany({ where: { assessmentId: a.id }, select: { subjectId: true } });
  return (await prisma.teachingAssignment.count({ where: { teacherId: u.id, sectionId: { in: secs.map((s) => s.id) }, subjectId: { in: papers.map((p) => p.subjectId) } } })) > 0;
}

// ---------- Tests (teachers) ----------

router.post(
  '/tests',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const body = parse(
      z.object({
        typeId: z.string().optional(),
        newTypeName: z.string().trim().min(2).max(60).optional(),
        sectionId: z.string(),
        subjectId: z.string(),
        title: z.string().trim().min(2).max(120),
        topic: optStr(300),
        date: dateStr,
        totalMarks: marksNum.refine((v) => v > 0, 'Total marks must be more than 0'),
        passMarks: marksNum.optional(),
      }),
      req.body,
    );
    const section = await prisma.section.findFirst({ where: { id: body.sectionId, schoolId, deletedAt: null }, include: { class: { include: { subjects: true } } } });
    if (!section) throw notFound('Section not found');
    if (!section.class.subjects.some((s) => s.subjectId === body.subjectId)) throw badRequest('This subject is not taught in this class');
    const u = req.user!;
    if (!isManager(req)) {
      if (u.role !== 'TEACHER') throw forbidden();
      const teaches = await prisma.teachingAssignment.count({ where: { sectionId: section.id, subjectId: body.subjectId, teacherId: u.id } });
      if (!teaches && section.classTeacherId !== u.id) throw forbidden('You do not teach this subject in this class');
    }
    let typeId = body.typeId;
    if (!typeId) {
      if (!body.newTypeName) throw badRequest('Choose a test type or type a new name');
      const t =
        (await prisma.assessmentType.findFirst({ where: { schoolId, kind: 'TEST', name: body.newTypeName } })) ??
        (await prisma.assessmentType.create({ data: { schoolId, kind: 'TEST', name: body.newTypeName, sortOrder: 500, createdById: u.id } }));
      typeId = t.id;
    } else if (!(await prisma.assessmentType.findFirst({ where: { id: typeId, schoolId, kind: 'TEST' } }))) throw badRequest('Unknown test type');
    const settings = await getExamSettings(schoolId);
    const session = await prisma.academicSession.findFirst({ where: { schoolId, isCurrent: true } });
    const a = await prisma.assessment.create({
      data: {
        schoolId,
        kind: 'TEST',
        typeId,
        title: body.title,
        topic: body.topic ?? null,
        sessionId: session?.id ?? null,
        classId: section.classId,
        sectionId: section.id,
        createdById: u.id,
        papers: {
          create: {
            subjectId: body.subjectId,
            date: new Date(`${body.date}T00:00:00Z`),
            totalMarks: body.totalMarks,
            passMarks: body.passMarks ?? round2((body.totalMarks * num(settings.passPercent)) / 100),
            sheets: { create: { sectionId: section.id } },
          },
        },
      },
    });
    await audit(req, { action: 'exams.test_create', entityType: 'Assessment', entityId: a.id, after: body });
    res.status(201).json({ id: a.id, paperId: (await prisma.assessmentPaper.findFirstOrThrow({ where: { assessmentId: a.id } })).id });
  }),
);

/** A teacher's work: tests they made and exam papers they must enter marks for. */
router.get(
  '/mine',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const u = req.user!;
    const assignments = await prisma.teachingAssignment.findMany({ where: { schoolId, teacherId: u.id }, select: { sectionId: true, subjectId: true } });
    const papers = await prisma.assessmentPaper.findMany({
      where: {
        assessment: { schoolId },
        OR: [{ assessment: { createdById: u.id, kind: 'TEST' } }, ...assignments.map((x) => ({ subjectId: x.subjectId, sheets: { some: { sectionId: x.sectionId } } }))],
      },
      include: { assessment: { include: { type: true } }, sheets: true },
      orderBy: { date: 'desc' },
      take: 200,
    });
    const subjects = await prisma.subject.findMany({ where: { id: { in: papers.map((p) => p.subjectId) } }, select: { id: true, name: true } });
    const sections = await prisma.section.findMany({ where: { id: { in: papers.flatMap((p) => p.sheets.map((s) => s.sectionId)) } }, select: { id: true, name: true, class: { select: { name: true, stream: true } } } });
    const rows = papers.flatMap((p) =>
      p.sheets
        .filter((sh) => (p.assessment.kind === 'TEST' && p.assessment.createdById === u.id) || assignments.some((x) => x.sectionId === sh.sectionId && x.subjectId === p.subjectId))
        .map((sh) => {
          const sec = sections.find((s) => s.id === sh.sectionId);
          return {
            assessmentId: p.assessmentId,
            paperId: p.id,
            sectionId: sh.sectionId,
            kind: p.assessment.kind,
            type: p.assessment.type.name,
            title: p.assessment.title,
            subject: subjects.find((s) => s.id === p.subjectId)?.name ?? '',
            classLabel: sec ? classLabel(sec.class, sec) : '',
            date: p.date,
            totalMarks: num(p.totalMarks),
            sheetStatus: sh.status,
            returnNote: sh.returnNote,
            published: p.assessment.status === 'PUBLISHED',
          };
        }),
    );
    res.json({ rows });
  }),
);

// ---------- Exams (principal) ----------

router.post(
  '/',
  ah(async (req, res) => {
    assertManager(req);
    const schoolId = tenantId(req);
    const body = parse(
      z.object({
        typeId: z.string(),
        title: z.string().trim().min(2).max(120),
        classIds: z.array(z.string()).min(1),
        totalMarks: marksNum.default(100),
        passPercent: z.coerce.number().min(0).max(100).optional(),
        startDate: dateStr.optional(),
      }),
      req.body,
    );
    if (!(await prisma.assessmentType.findFirst({ where: { id: body.typeId, schoolId, kind: 'EXAM' } }))) throw badRequest('Choose an exam type');
    const settings = await getExamSettings(schoolId);
    const passPct = body.passPercent ?? num(settings.passPercent);
    const session = await prisma.academicSession.findFirst({ where: { schoolId, isCurrent: true } });
    const classes = await prisma.classLevel.findMany({ where: { id: { in: body.classIds }, schoolId, deletedAt: null }, include: { subjects: { include: { subject: true } }, sections: { where: { deletedAt: null } } } });
    if (classes.length !== body.classIds.length) throw badRequest('Unknown class');
    const noSubjects = classes.filter((c) => c.subjects.length === 0);
    if (noSubjects.length) throw badRequest(`Add subjects to ${noSubjects.map((c) => c.name).join(', ')} first`);
    const groupKey = crypto.randomUUID().slice(0, 12);
    const ids: string[] = [];
    for (const c of classes) {
      const a = await prisma.assessment.create({
        data: {
          schoolId,
          kind: 'EXAM',
          typeId: body.typeId,
          title: body.title,
          groupKey,
          sessionId: session?.id ?? null,
          classId: c.id,
          createdById: req.user!.id,
          papers: {
            create: c.subjects
              .sort((x, y) => x.subject.name.localeCompare(y.subject.name))
              .map((cs, i) => ({
                subjectId: cs.subjectId,
                sortOrder: i,
                date: body.startDate ? new Date(new Date(`${body.startDate}T00:00:00Z`).getTime() + i * 86400000) : null,
                totalMarks: body.totalMarks,
                passMarks: round2((body.totalMarks * passPct) / 100),
                sheets: { create: c.sections.map((s) => ({ sectionId: s.id })) },
              })),
          },
        },
      });
      ids.push(a.id);
    }
    await audit(req, { action: 'exams.exam_create', entityType: 'Assessment', after: { ...body, created: ids.length } });
    res.status(201).json({ groupKey, ids });
  }),
);

/** List of tests and exams with marks-entry progress. */
router.get(
  '/',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const q = parse(z.object({ kind: z.enum(['TEST', 'EXAM']).optional(), status: z.enum(['DRAFT', 'PUBLISHED']).optional(), classId: z.string().optional(), groupKey: z.string().optional() }), req.query);
    if (!(isManager(req) || can(req, 'students.view'))) throw forbidden();
    const rows = await prisma.assessment.findMany({
      where: { schoolId, ...(q.kind ? { kind: q.kind } : {}), ...(q.status ? { status: q.status } : {}), ...(q.classId ? { classId: q.classId } : {}), ...(q.groupKey ? { groupKey: q.groupKey } : {}) },
      include: { type: true, papers: { include: { sheets: { select: { status: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const classes = await prisma.classLevel.findMany({ where: { id: { in: rows.map((r) => r.classId) } }, select: { id: true, name: true, stream: true, sortOrder: true } });
    const sections = await prisma.section.findMany({ where: { id: { in: rows.map((r) => r.sectionId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
    const subjects = await prisma.subject.findMany({ where: { id: { in: rows.flatMap((r) => r.papers.map((p) => p.subjectId)) } }, select: { id: true, name: true } });
    res.json({
      assessments: rows.map((r) => {
        const sheets = r.papers.flatMap((p) => p.sheets);
        const c = classes.find((x) => x.id === r.classId);
        return {
          id: r.id,
          kind: r.kind,
          type: r.type.name,
          title: r.title,
          groupKey: r.groupKey,
          status: r.status,
          announced: r.announced,
          classLabel: c ? classLabel(c, sections.find((s) => s.id === r.sectionId)) : '',
          classSort: c?.sortOrder ?? 0,
          subject: r.kind === 'TEST' ? subjects.find((s) => s.id === r.papers[0]?.subjectId)?.name : undefined,
          date: r.papers.map((p) => p.date).filter(Boolean).sort()[0] ?? null,
          papers: r.papers.length,
          sheets: { total: sheets.length, submitted: sheets.filter((s) => s.status === 'SUBMITTED').length, approved: sheets.filter((s) => s.status === 'APPROVED').length, returned: sheets.filter((s) => s.status === 'RETURNED').length },
          publishedAt: r.publishedAt,
          createdAt: r.createdAt,
        };
      }),
    });
  }),
);

router.get(
  '/:id',
  ah(async (req, res) => {
    const a = await loadAssessment(req, req.params.id);
    if (!(await canView(req, a))) throw forbidden();
    const [cls, sections, subjects, sheets] = await Promise.all([
      prisma.classLevel.findUniqueOrThrow({ where: { id: a.classId }, select: { id: true, name: true, stream: true } }),
      sectionsOf(a),
      prisma.subject.findMany({ where: { id: { in: a.papers.map((p) => p.subjectId) } }, select: { id: true, name: true } }),
      prisma.markSheet.findMany({ where: { paperId: { in: a.papers.map((p) => p.id) } } }),
    ]);
    const assignments = await prisma.teachingAssignment.findMany({ where: { sectionId: { in: sections.map((s) => s.id) } }, include: { teacher: { select: { id: true, fullName: true } } } });
    const markCounts = await prisma.mark.groupBy({ by: ['paperId'], where: { paperId: { in: a.papers.map((p) => p.id) } }, _count: { _all: true } });
    const creator = await prisma.user.findUnique({ where: { id: a.createdById }, select: { fullName: true } });
    res.json({
      assessment: {
        id: a.id,
        kind: a.kind,
        type: a.type.name,
        title: a.title,
        topic: a.topic,
        status: a.status,
        announced: a.announced,
        publishedAt: a.publishedAt,
        groupKey: a.groupKey,
        createdBy: creator?.fullName ?? null,
        class: cls,
        classLabel: classLabel(cls, a.sectionId ? sections[0] : null),
      },
      sections: sections.map((s) => ({ id: s.id, name: s.name })),
      papers: a.papers.map((p) => ({
        id: p.id,
        subjectId: p.subjectId,
        subject: subjects.find((s) => s.id === p.subjectId)?.name ?? '',
        date: p.date,
        startTime: p.startTime,
        totalMarks: num(p.totalMarks),
        passMarks: num(p.passMarks),
        marksEntered: markCounts.find((m) => m.paperId === p.id)?._count._all ?? 0,
        sheets: sections.map((s) => {
          const sh = sheets.find((x) => x.paperId === p.id && x.sectionId === s.id);
          return {
            sectionId: s.id,
            section: s.name,
            status: sh?.status ?? 'DRAFT',
            returnNote: sh?.returnNote ?? null,
            submittedAt: sh?.submittedAt ?? null,
            teacher: a.kind === 'TEST' ? { id: a.createdById, fullName: creator?.fullName ?? '' } : (assignments.find((x) => x.sectionId === s.id && x.subjectId === p.subjectId)?.teacher ?? null),
          };
        }),
      })),
      canManage: isManager(req),
    });
  }),
);

router.patch(
  '/:id',
  ah(async (req, res) => {
    const a = await loadAssessment(req, req.params.id);
    if (!(isManager(req) || (a.kind === 'TEST' && a.createdById === req.user!.id && a.status === 'DRAFT'))) throw forbidden();
    const body = parse(z.object({ title: z.string().trim().min(2).max(120), topic: optStr(300), announced: z.boolean() }).partial(), req.body);
    await prisma.assessment.update({ where: { id: a.id }, data: body });
    if (body.announced && a.kind === 'EXAM') {
      // Tell families the date sheet is out.
      const students = await studentsWithContacts(a.schoolId, { classId: a.classId });
      await notify(
        a.schoolId,
        [...new Set(students.map((s) => s.parentUserId).filter(Boolean) as string[])].map((userId) => ({ userId, type: 'DATESHEET', title: `Date sheet: ${a.title}`, body: `The date sheet for ${a.title} is out.`, link: '/home/results' })),
      );
    }
    await audit(req, { action: 'exams.update', entityType: 'Assessment', entityId: a.id, after: body });
    res.json({ ok: true });
  }),
);

/** Date sheet and marks of each paper. */
router.put(
  '/:id/papers',
  ah(async (req, res) => {
    const a = await loadAssessment(req, req.params.id);
    if (!(isManager(req) || (a.kind === 'TEST' && a.createdById === req.user!.id && a.status === 'DRAFT'))) throw forbidden();
    const body = parse(
      z.object({ papers: z.array(z.object({ id: z.string(), date: dateStr.nullish(), startTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(), totalMarks: marksNum.refine((v) => v > 0), passMarks: marksNum, sortOrder: z.number().int().optional() })) }),
      req.body,
    );
    for (const p of body.papers) {
      if (!a.papers.some((x) => x.id === p.id)) throw badRequest('Unknown paper');
      if (p.passMarks > p.totalMarks) throw badRequest('Pass marks cannot be more than total marks');
      const over = await prisma.mark.count({ where: { paperId: p.id, marks: { gt: p.totalMarks } } });
      if (over) throw badRequest(`${over} student(s) already have more marks than the new total`);
    }
    await prisma.$transaction(async (tx) => {
      for (const p of body.papers) {
        await tx.assessmentPaper.update({ where: { id: p.id }, data: { date: p.date ? new Date(`${p.date}T00:00:00Z`) : null, startTime: p.startTime ?? null, totalMarks: p.totalMarks, passMarks: p.passMarks, ...(p.sortOrder !== undefined ? { sortOrder: p.sortOrder } : {}) } });
      }
      if (a.status === 'PUBLISHED') await computeResults(tx, a.id);
    });
    await audit(req, { action: 'exams.papers', entityType: 'Assessment', entityId: a.id, after: body });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const a = await loadAssessment(req, req.params.id);
    if (!(isManager(req) || (a.kind === 'TEST' && a.createdById === req.user!.id && a.status === 'DRAFT'))) throw forbidden();
    if (a.status === 'PUBLISHED' && req.user!.role !== 'PRINCIPAL') throw forbidden('Only the principal can delete published results');
    await prisma.assessment.delete({ where: { id: a.id } });
    await audit(req, { action: 'exams.delete', entityType: 'Assessment', entityId: a.id, before: { title: a.title, kind: a.kind, status: a.status } });
    res.json({ ok: true });
  }),
);

// ---------- Marks entry ----------

async function loadPaper(req: Request, paperId: string) {
  const p = await prisma.assessmentPaper.findFirst({ where: { id: paperId, assessment: { schoolId: tenantId(req) } }, include: { assessment: true } });
  if (!p) throw notFound('Paper not found');
  return p;
}

router.get(
  '/papers/:paperId/sheet',
  ah(async (req, res) => {
    const p = await loadPaper(req, req.params.paperId);
    const { sectionId } = parse(z.object({ sectionId: z.string() }), req.query);
    const sheet = await prisma.markSheet.findUnique({ where: { paperId_sectionId: { paperId: p.id, sectionId } } });
    if (!sheet) throw notFound('This section is not part of the paper');
    const enter = await canEnter(req, p.assessment, p, sectionId);
    if (!enter && !(await canView(req, p.assessment))) throw forbidden();
    const [students, marks, subject, section] = await Promise.all([
      prisma.student.findMany({ where: { sectionId, status: 'ACTIVE', deletedAt: null }, select: { id: true, fullName: true, rollNo: true, admissionNo: true, photoFileId: true }, orderBy: [{ rollNo: 'asc' }, { fullName: 'asc' }] }),
      prisma.mark.findMany({ where: { paperId: p.id } }),
      prisma.subject.findUniqueOrThrow({ where: { id: p.subjectId }, select: { name: true } }),
      prisma.section.findUniqueOrThrow({ where: { id: sectionId }, select: { name: true, class: { select: { name: true, stream: true } } } }),
    ]);
    // Students who have marks here but have since left or moved keep their row.
    const extraIds = marks.map((m) => m.studentId).filter((id) => !students.some((s) => s.id === id));
    const extra = extraIds.length ? await prisma.student.findMany({ where: { id: { in: extraIds }, sectionId }, select: { id: true, fullName: true, rollNo: true, admissionNo: true, photoFileId: true } }) : [];
    const published = p.assessment.status === 'PUBLISHED';
    const editable = isManager(req) || (enter && !published && ['DRAFT', 'RETURNED'].includes(sheet.status));
    res.json({
      paper: { id: p.id, subject: subject.name, totalMarks: num(p.totalMarks), passMarks: num(p.passMarks), date: p.date },
      assessment: { id: p.assessment.id, title: p.assessment.title, kind: p.assessment.kind, status: p.assessment.status },
      section: { id: sectionId, label: classLabel(section.class, section) },
      sheet: { status: sheet.status, returnNote: sheet.returnNote, submittedAt: sheet.submittedAt },
      canEdit: editable,
      canSubmit: enter && !published && ['DRAFT', 'RETURNED'].includes(sheet.status),
      canReview: isManager(req) && sheet.status === 'SUBMITTED',
      students: [...students, ...extra].map((s) => {
        const m = marks.find((x) => x.studentId === s.id);
        return { ...s, marks: m?.marks !== null && m?.marks !== undefined ? num(m.marks) : null, isAbsent: m?.isAbsent ?? false, remark: m?.remark ?? null };
      }),
    });
  }),
);

router.put(
  '/papers/:paperId/sheet',
  ah(async (req, res) => {
    const p = await loadPaper(req, req.params.paperId);
    const body = parse(
      z.object({
        sectionId: z.string(),
        marks: z.array(z.object({ studentId: z.string(), marks: marksNum.nullable(), isAbsent: z.boolean().default(false), remark: optStr(200) })).max(500),
        reason: optStr(300),
        notifyCorrection: z.boolean().default(false),
      }),
      req.body,
    );
    const sheet = await prisma.markSheet.findUnique({ where: { paperId_sectionId: { paperId: p.id, sectionId: body.sectionId } } });
    if (!sheet) throw notFound('This section is not part of the paper');
    const published = p.assessment.status === 'PUBLISHED';
    if (!isManager(req)) {
      if (!(await canEnter(req, p.assessment, p, body.sectionId))) throw forbidden('You cannot enter marks for this paper');
      if (published) throw forbidden('Results are published. Only the principal can correct them.');
      if (!['DRAFT', 'RETURNED'].includes(sheet.status)) throw forbidden('These marks are with the principal for approval');
    }
    if (published && !body.reason) throw badRequest('Give a reason for changing published results');
    const total = num(p.totalMarks);
    const bad = body.marks.find((m) => m.marks !== null && m.marks > total);
    if (bad) throw badRequest(`Marks cannot be more than ${total}`);
    const valid = new Set((await prisma.student.findMany({ where: { id: { in: body.marks.map((m) => m.studentId) }, sectionId: body.sectionId }, select: { id: true } })).map((s) => s.id));
    if (body.marks.some((m) => !valid.has(m.studentId))) throw badRequest('A student is not in this section');
    const before = await prisma.mark.findMany({ where: { paperId: p.id, studentId: { in: body.marks.map((m) => m.studentId) } } });
    await prisma.$transaction(async (tx) => {
      for (const m of body.marks) {
        const data = { marks: m.isAbsent ? null : m.marks, isAbsent: m.isAbsent, remark: m.remark ?? null, updatedById: req.user!.id };
        if (m.marks === null && !m.isAbsent && !m.remark) await tx.mark.deleteMany({ where: { paperId: p.id, studentId: m.studentId } });
        else await tx.mark.upsert({ where: { paperId_studentId: { paperId: p.id, studentId: m.studentId } }, create: { ...data, paperId: p.id, studentId: m.studentId }, update: data });
      }
      if (published) await computeResults(tx, p.assessmentId);
    });
    const changed = body.marks.filter((m) => {
      const b = before.find((x) => x.studentId === m.studentId);
      return !b || num(b.marks) !== (m.marks ?? 0) || b.isAbsent !== m.isAbsent;
    });
    if (published && body.notifyCorrection && changed.length) {
      const students = await studentsWithContacts(p.assessment.schoolId, { id: { in: changed.map((c) => c.studentId) } });
      await notify(p.assessment.schoolId, students.filter((s) => s.parentUserId).map((s) => ({ userId: s.parentUserId!, type: 'RESULT', title: `Result corrected: ${p.assessment.title}`, body: `${s.fullName}'s result for ${p.assessment.title} was corrected by the school.`, link: '/home/results' })));
    }
    await audit(req, {
      action: published ? 'exams.marks_correct' : 'exams.marks_save',
      entityType: 'AssessmentPaper',
      entityId: p.id,
      before: published ? before.map((b) => ({ studentId: b.studentId, marks: num(b.marks), isAbsent: b.isAbsent })) : undefined,
      after: { sectionId: body.sectionId, changed: changed.map((c) => ({ studentId: c.studentId, marks: c.marks, isAbsent: c.isAbsent })) },
      reason: body.reason,
    });
    res.json({ ok: true, changed: changed.length });
  }),
);

/** Teacher sends the marks to the principal (or publishes a test directly if the school allows). */
router.post(
  '/papers/:paperId/sheet/submit',
  ah(async (req, res) => {
    const p = await loadPaper(req, req.params.paperId);
    const { sectionId } = parse(z.object({ sectionId: z.string() }), req.body);
    if (!(await canEnter(req, p.assessment, p, sectionId))) throw forbidden();
    const sheet = await prisma.markSheet.findUnique({ where: { paperId_sectionId: { paperId: p.id, sectionId } } });
    if (!sheet || !['DRAFT', 'RETURNED'].includes(sheet.status)) throw badRequest('These marks are already submitted');
    const students = await prisma.student.findMany({ where: { sectionId, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    const marks = await prisma.mark.findMany({ where: { paperId: p.id, studentId: { in: students.map((s) => s.id) } } });
    const missing = students.length - marks.filter((m) => m.isAbsent || m.marks !== null).length;
    if (missing > 0) throw badRequest(`Enter marks (or mark absent) for all students. ${missing} missing.`);
    const settings = await getExamSettings(p.assessment.schoolId);
    const direct = p.assessment.kind === 'TEST' && !settings.testsNeedApproval;
    await prisma.markSheet.update({ where: { id: sheet.id }, data: { status: direct ? 'APPROVED' : 'SUBMITTED', submittedById: req.user!.id, submittedAt: new Date(), returnNote: null } });
    let published = false;
    if (direct) {
      await publish(p.assessmentId, req.user!.id);
      published = true;
    } else {
      const principals = await prisma.user.findMany({ where: { schoolId: p.assessment.schoolId, role: 'PRINCIPAL', isActive: true, deletedAt: null }, select: { id: true } });
      const subject = await prisma.subject.findUnique({ where: { id: p.subjectId }, select: { name: true } });
      await notify(p.assessment.schoolId, principals.map((x) => ({ userId: x.id, type: 'MARKS', title: `Marks to approve: ${p.assessment.title}`, body: `${req.user!.fullName} submitted ${subject?.name ?? ''} marks.`, link: `/school/exams/${p.assessmentId}` })));
    }
    await audit(req, { action: 'exams.sheet_submit', entityType: 'AssessmentPaper', entityId: p.id, after: { sectionId, published } });
    res.json({ status: direct ? 'APPROVED' : 'SUBMITTED', published });
  }),
);

router.post(
  '/papers/:paperId/sheet/review',
  ah(async (req, res) => {
    assertManager(req);
    const p = await loadPaper(req, req.params.paperId);
    const body = parse(z.object({ sectionId: z.string(), approve: z.boolean(), note: optStr(500) }), req.body);
    const sheet = await prisma.markSheet.findUnique({ where: { paperId_sectionId: { paperId: p.id, sectionId: body.sectionId } } });
    if (!sheet || sheet.status !== 'SUBMITTED') throw badRequest('These marks are not waiting for approval');
    if (!body.approve && !body.note) throw badRequest('Write what needs fixing');
    await prisma.markSheet.update({ where: { id: sheet.id }, data: { status: body.approve ? 'APPROVED' : 'RETURNED', reviewedById: req.user!.id, reviewedAt: new Date(), returnNote: body.approve ? null : body.note } });
    if (sheet.submittedById) {
      await notify(p.assessment.schoolId, [{ userId: sheet.submittedById, type: 'MARKS', title: body.approve ? `Marks approved: ${p.assessment.title}` : `Marks sent back: ${p.assessment.title}`, body: body.approve ? 'The principal approved your marks.' : `Please fix: ${body.note}`, link: '/home/marks' }]);
    }
    await audit(req, { action: body.approve ? 'exams.sheet_approve' : 'exams.sheet_return', entityType: 'AssessmentPaper', entityId: p.id, after: { sectionId: body.sectionId }, reason: body.note });
    res.json({ ok: true });
  }),
);

// ---------- Publishing ----------

async function publish(assessmentId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.markSheet.updateMany({ where: { paper: { assessmentId }, status: 'SUBMITTED' }, data: { status: 'APPROVED', reviewedById: userId, reviewedAt: new Date() } });
    await computeResults(tx, assessmentId);
    await tx.assessment.update({ where: { id: assessmentId }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: userId } });
  });
  const a = await prisma.assessment.findUniqueOrThrow({ where: { id: assessmentId } });
  const s = await getSettings(a.schoolId);
  await sendResults(a.id, null, ruleFor(s, 'RESULT') === 'auto');
}

/** In-app notice to parents and students; WhatsApp when `whatsapp` is true and connected. */
async function sendResults(assessmentId: string, studentIds: string[] | null, whatsapp: boolean) {
  const a = await prisma.assessment.findUniqueOrThrow({ where: { id: assessmentId } });
  const school = await prisma.school.findUniqueOrThrow({ where: { id: a.schoolId } });
  const results = await prisma.studentResult.findMany({ where: { assessmentId, ...(studentIds ? { studentId: { in: studentIds } } : {}) } });
  const students = await studentsWithContacts(a.schoolId, { id: { in: results.map((r) => r.studentId) } });
  const users = await prisma.student.findMany({ where: { id: { in: results.map((r) => r.studentId) } }, select: { id: true, userId: true } });
  const settings = await getSettings(a.schoolId);
  const examSettings = await getExamSettings(a.schoolId);
  const useWa = whatsapp && whatsappReady(settings) && ruleFor(settings, 'RESULT') !== 'off';
  let queued = 0;
  const notices: Parameters<typeof notify>[1] = [];
  for (const r of results) {
    const st = students.find((s) => s.id === r.studentId);
    if (!st) continue;
    const summary = `${round2(num(r.obtained))}/${round2(num(r.total))} (${num(r.percent)}%), grade ${r.grade}${examSettings.showPositions && r.positionSection ? `, position ${r.positionSection}` : ''}${r.passed ? '' : ', not passed'}`;
    const params = [a.title, st.fullName, summary, school.name];
    const body = renderTemplate(MESSAGE_TYPES.RESULT.suggestedTemplate.text, params);
    if (useWa) queued += await enqueue(a.schoolId, settings, st.guardians.map((g) => ({ to: { phone: g.phone ?? '', name: g.name, studentId: st.id }, type: 'RESULT', params, body })));
    if (st.parentUserId) notices.push({ userId: st.parentUserId, type: 'RESULT', title: `Result: ${a.title}`, body: `${st.fullName}: ${summary}`, link: '/home/results' });
    const su = users.find((u) => u.id === st.id)?.userId;
    if (su) notices.push({ userId: su, type: 'RESULT', title: `Result: ${a.title}`, body: summary, link: '/home/results' });
  }
  await notify(a.schoolId, notices);
  return { whatsapp: queued, inApp: notices.length };
}

router.post(
  '/:id/publish',
  ah(async (req, res) => {
    assertManager(req);
    const a = await loadAssessment(req, req.params.id);
    const body = parse(z.object({ force: z.boolean().default(false) }), req.body ?? {});
    const sheets = await prisma.markSheet.findMany({ where: { paperId: { in: a.papers.map((p) => p.id) } } });
    // Sections with no students do not block publishing.
    const withStudents = new Set((await prisma.student.groupBy({ by: ['sectionId'], where: { classId: a.classId, status: 'ACTIVE', deletedAt: null } })).map((g) => g.sectionId));
    const pending = sheets.filter((s) => withStudents.has(s.sectionId) && !['SUBMITTED', 'APPROVED'].includes(s.status));
    if (pending.length && !body.force) throw badRequest(`${pending.length} marks sheet(s) are not submitted yet. Publish anyway?`, { pending: pending.length });
    await publish(a.id, req.user!.id);
    await audit(req, { action: 'exams.publish', entityType: 'Assessment', entityId: a.id, after: { title: a.title, forced: Boolean(pending.length) } });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/unpublish',
  ah(async (req, res) => {
    if (req.user!.role !== 'PRINCIPAL') throw forbidden('Only the principal can hide published results');
    const a = await loadAssessment(req, req.params.id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(2).max(300) }), req.body);
    await prisma.assessment.update({ where: { id: a.id }, data: { status: 'DRAFT', publishedAt: null } });
    await audit(req, { action: 'exams.unpublish', entityType: 'Assessment', entityId: a.id, reason });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/send',
  ah(async (req, res) => {
    if (!(isManager(req) || can(req, 'messages.send'))) throw forbidden();
    const a = await loadAssessment(req, req.params.id);
    if (a.status !== 'PUBLISHED') throw badRequest('Publish the results first');
    const body = parse(z.object({ studentIds: z.array(z.string()).optional() }), req.body ?? {});
    const r = await sendResults(a.id, body.studentIds ?? null, true);
    await audit(req, { action: 'exams.send', entityType: 'Assessment', entityId: a.id, after: { ...r, students: body.studentIds?.length ?? 'all' } });
    res.json(r);
  }),
);

// ---------- Results ----------

/** Tabulation sheet: every student × every paper, with totals, grade and positions. */
router.get(
  '/:id/results',
  ah(async (req, res) => {
    const a = await loadAssessment(req, req.params.id);
    if (!(await canView(req, a))) throw forbidden();
    const q = parse(z.object({ sectionId: z.string().optional() }), req.query);
    const [results, marks, subjects, settings] = await Promise.all([
      prisma.studentResult.findMany({ where: { assessmentId: a.id, ...(q.sectionId ? { sectionId: q.sectionId } : {}) } }),
      prisma.mark.findMany({ where: { paperId: { in: a.papers.map((p) => p.id) } } }),
      prisma.subject.findMany({ where: { id: { in: a.papers.map((p) => p.subjectId) } }, select: { id: true, name: true } }),
      getExamSettings(a.schoolId),
    ]);
    const bands = bandsOf(settings);
    const students = await prisma.student.findMany({ where: { id: { in: results.map((r) => r.studentId) } }, select: { id: true, fullName: true, rollNo: true, admissionNo: true, section: { select: { id: true, name: true } } } });
    const rows = results
      .map((r) => {
        const st = students.find((s) => s.id === r.studentId)!;
        return {
          student: st,
          marks: Object.fromEntries(a.papers.map((p) => {
            const m = marks.find((x) => x.paperId === p.id && x.studentId === r.studentId);
            return [p.id, m ? (m.isAbsent ? 'A' : num(m.marks)) : null];
          })),
          obtained: num(r.obtained),
          total: num(r.total),
          percent: num(r.percent),
          grade: r.grade,
          passed: r.passed,
          positionClass: r.positionClass,
          positionSection: r.positionSection,
        };
      })
      .sort((x, y) => (x.positionClass ?? 999) - (y.positionClass ?? 999));
    const paperStats = a.papers.map((p) => {
      const vals = marks.filter((m) => m.paperId === p.id && !m.isAbsent && m.marks !== null).map((m) => num(m.marks));
      const avg = vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
      return {
        id: p.id,
        subject: subjects.find((s) => s.id === p.subjectId)?.name ?? '',
        totalMarks: num(p.totalMarks),
        passMarks: num(p.passMarks),
        average: avg,
        highest: vals.length ? Math.max(...vals) : null,
        passed: vals.filter((v) => v >= num(p.passMarks)).length,
        appeared: vals.length,
        averageGrade: avg !== null ? gradeFor(bands, (avg / num(p.totalMarks)) * 100).grade : null,
      };
    });
    res.json({
      status: a.status,
      title: a.title,
      papers: paperStats,
      rows,
      summary: {
        students: rows.length,
        passed: rows.filter((r) => r.passed).length,
        average: rows.length ? round2(rows.reduce((s, r) => s + r.percent, 0) / rows.length) : null,
        highest: rows.length ? Math.max(...rows.map((r) => r.percent)) : null,
        grades: Object.fromEntries(bands.map((b) => [b.grade, rows.filter((r) => r.grade === b.grade).length])),
      },
      showPositions: settings.showPositions,
    });
  }),
);

/** Preview results before publishing (calculated on the fly, nothing saved). */
router.post(
  '/:id/calculate',
  ah(async (req, res) => {
    assertManager(req);
    const a = await loadAssessment(req, req.params.id);
    if (a.status === 'PUBLISHED') return res.json({ ok: true });
    await prisma.$transaction((tx) => computeResults(tx, a.id));
    res.json({ ok: true });
  }),
);

router.put(
  '/:id/remarks',
  ah(async (req, res) => {
    const a = await loadAssessment(req, req.params.id);
    const body = parse(z.object({ remarks: z.array(z.object({ studentId: z.string(), teacherRemark: optStr(500), principalRemark: optStr(500) })).max(500) }), req.body);
    const secs = await sectionsOf(a);
    const u = req.user!;
    const students = await prisma.student.findMany({ where: { id: { in: body.remarks.map((r) => r.studentId) }, classId: a.classId }, select: { id: true, sectionId: true } });
    if (students.length !== body.remarks.length) throw badRequest('A student is not in this class');
    for (const r of body.remarks) {
      const st = students.find((s) => s.id === r.studentId)!;
      const isClassTeacher = secs.some((s) => s.id === st.sectionId && s.classTeacherId === u.id);
      if (!isManager(req) && !isClassTeacher) throw forbidden('Only the class teacher or principal can write report card remarks');
      const data: Prisma.ResultRemarkUpdateInput = {};
      if (r.teacherRemark !== undefined && (isClassTeacher || isManager(req))) data.teacherRemark = r.teacherRemark;
      if (r.principalRemark !== undefined && u.role === 'PRINCIPAL') data.principalRemark = r.principalRemark;
      await prisma.resultRemark.upsert({
        where: { assessmentId_studentId: { assessmentId: a.id, studentId: r.studentId } },
        create: { assessmentId: a.id, studentId: r.studentId, teacherRemark: (data.teacherRemark as string) ?? null, principalRemark: (data.principalRemark as string) ?? null },
        update: data,
      });
    }
    await audit(req, { action: 'exams.remarks', entityType: 'Assessment', entityId: a.id, after: { count: body.remarks.length } });
    res.json({ ok: true });
  }),
);

/** Everything a report card shows, for one student or a whole section. */
export async function reportCards(schoolId: string, assessmentId: string, where: Prisma.StudentWhereInput) {
  const a = await prisma.assessment.findFirstOrThrow({ where: { id: assessmentId, schoolId }, include: { type: true, papers: { orderBy: [{ sortOrder: 'asc' }, { date: 'asc' }] } } });
  const [school, settings, subjects, results] = await Promise.all([
    prisma.school.findUniqueOrThrow({ where: { id: schoolId } }),
    getExamSettings(schoolId),
    prisma.subject.findMany({ where: { id: { in: a.papers.map((p) => p.subjectId) } }, select: { id: true, name: true } }),
    prisma.studentResult.findMany({ where: { assessmentId } }),
  ]);
  const bands = bandsOf(settings);
  const students = await prisma.student.findMany({
    where: { ...where, id: { in: results.map((r) => r.studentId) } },
    select: { id: true, fullName: true, admissionNo: true, rollNo: true, photoFileId: true, dob: true, class: { select: { name: true, stream: true } }, section: { select: { name: true, classTeacher: { select: { fullName: true } } } }, family: { select: { guardians: { where: { relation: 'FATHER' }, select: { fullName: true }, take: 1 } } } },
    orderBy: [{ rollNo: 'asc' }, { fullName: 'asc' }],
  });
  const [marks, remarks] = await Promise.all([
    prisma.mark.findMany({ where: { paperId: { in: a.papers.map((p) => p.id) }, studentId: { in: students.map((s) => s.id) } } }),
    prisma.resultRemark.findMany({ where: { assessmentId, studentId: { in: students.map((s) => s.id) } } }),
  ]);
  // Attendance for the session up to the last paper.
  const session = a.sessionId ? await prisma.academicSession.findUnique({ where: { id: a.sessionId } }) : null;
  const lastDate = a.papers.map((p) => p.date).filter(Boolean).sort().pop() ?? new Date();
  const att = await prisma.attendanceRecord.groupBy({
    by: ['studentId', 'status'],
    where: { studentId: { in: students.map((s) => s.id) }, date: { ...(session ? { gte: session.startDate } : {}), lte: lastDate } },
    _count: { _all: true },
  });
  const classSize = results.length;
  return {
    school: { name: school.name, address: school.address, city: school.city, phone: school.phone, logoFileId: school.logoFileId },
    assessment: { id: a.id, title: a.title, type: a.type.name, kind: a.kind, status: a.status, session: session?.name ?? null },
    gradeBands: bands,
    showPositions: settings.showPositions,
    cards: students.map((st) => {
      const r = results.find((x) => x.studentId === st.id)!;
      const c: Record<string, number> = {};
      for (const x of att.filter((y) => y.studentId === st.id)) c[x.status] = x._count._all;
      const rm = remarks.find((x) => x.studentId === st.id);
      return {
        student: { ...st, fatherName: st.family.guardians[0]?.fullName ?? null, classLabel: classLabel(st.class, st.section), classTeacher: st.section?.classTeacher?.fullName ?? null },
        subjects: a.papers.map((p) => {
          const m = marks.find((x) => x.paperId === p.id && x.studentId === st.id);
          const v = m && !m.isAbsent ? num(m.marks) : 0;
          const pct = num(p.totalMarks) ? (v / num(p.totalMarks)) * 100 : 0;
          return { subject: subjects.find((s) => s.id === p.subjectId)?.name ?? '', totalMarks: num(p.totalMarks), passMarks: num(p.passMarks), obtained: m ? (m.isAbsent ? null : num(m.marks)) : null, absent: m?.isAbsent ?? false, grade: m && !m.isAbsent ? gradeFor(bands, pct).grade : '—', passed: v >= num(p.passMarks), remark: m?.remark ?? null };
        }),
        result: { obtained: num(r.obtained), total: num(r.total), percent: num(r.percent), grade: r.grade, gradeRemark: gradeFor(bands, num(r.percent)).remark ?? null, passed: r.passed, positionClass: r.positionClass, positionSection: r.positionSection, classSize },
        attendance: { counts: c, percent: attendancePercent(c) },
        remarks: { teacher: rm?.teacherRemark ?? null, principal: rm?.principalRemark ?? null },
      };
    }),
  };
}

router.get(
  '/:id/report-cards',
  ah(async (req, res) => {
    const a = await loadAssessment(req, req.params.id);
    if (!(await canView(req, a))) throw forbidden();
    const q = parse(z.object({ sectionId: z.string().optional(), studentId: z.string().optional() }), req.query);
    if (!(await prisma.studentResult.count({ where: { assessmentId: a.id } }))) await prisma.$transaction((tx) => computeResults(tx, a.id));
    res.json(await reportCards(tenantId(req), a.id, { ...(q.sectionId ? { sectionId: q.sectionId } : {}), ...(q.studentId ? { id: q.studentId } : {}) }));
  }),
);

export default router;


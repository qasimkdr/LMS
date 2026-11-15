import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { OnlineAttempt, OnlinePaper, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optStr, parse, patchOf } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import { round2 } from '../lib/money';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { notify } from '../services/messaging';
import { saveSchoolFile } from '../services/files';
import { computeResults, getExamSettings } from '../services/exams';
import { getSettings, ruleFor } from '../services/messaging';
import { sendResults } from './exams';
import {
  autoMark,
  finalMark,
  makeOrder,
  normalizeQuestion,
  num,
  OBJECTIVE,
  paperTotal,
  questionSchema,
  scoreAttempt,
  studentQuestion,
  type MarkEntry,
} from '../services/onlineExams';

const router = Router();
const GRACE_MS = 30_000; // late autosaves allowed this long after the deadline (slow networks)

const isManager = (req: Request) => can(req, 'exams.manage');

/** May this user create/mark papers for this subject and class? */
async function teaches(req: Request, classId: string, subjectId: string, sectionIds: string[]) {
  if (isManager(req)) return true;
  const u = req.user!;
  if (u.role !== 'TEACHER') return false;
  for (const sectionId of sectionIds) {
    const ok =
      (await prisma.teachingAssignment.count({ where: { sectionId, subjectId, teacherId: u.id } })) > 0 ||
      (await prisma.section.count({ where: { id: sectionId, classId, classTeacherId: u.id } })) > 0;
    if (!ok) return false;
  }
  return true;
}

async function loadPaper(req: Request, id: string) {
  const p = await prisma.onlinePaper.findFirst({
    where: { id, schoolId: tenantId(req) },
    include: { sections: { orderBy: { sortOrder: 'asc' } }, questions: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!p) throw notFound('Online exam not found');
  return p;
}

/** Owner teacher or manager. */
async function loadOwnPaper(req: Request, id: string) {
  const p = await loadPaper(req, id);
  if (!(isManager(req) || p.createdById === req.user!.id)) throw forbidden();
  return p;
}

type FullPaper = Awaited<ReturnType<typeof loadPaper>>;

const live = (p: OnlinePaper, now = new Date()) => p.status === 'SCHEDULED' && p.startAt && p.endAt && p.startAt <= now && now < p.endAt;
const ended = (p: OnlinePaper, now = new Date()) => Boolean(p.endAt && now >= p.endAt);

/** Submits attempts whose time is up (also runs every minute in the background). */
export async function closeExpiredAttempts(now = new Date()) {
  const expired = await prisma.onlineAttempt.findMany({ where: { submittedAt: null, deadline: { lt: new Date(now.getTime() - GRACE_MS) } }, select: { id: true } });
  for (const a of expired) await finishAttempt(a.id, true);
  return expired.length;
}

/** Marks objective questions and stores the score (null while short/long answers wait for the teacher). */
async function finishAttempt(attemptId: string, auto: boolean) {
  const a = await prisma.onlineAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { paper: { include: { sections: true, questions: true } } } });
  if (a.submittedAt) return a;
  const answers = (a.answers as Record<string, unknown>) ?? {};
  const neg = num(a.paper.negativeMarking);
  const marking: Record<string, MarkEntry> = {};
  for (const q of a.paper.questions) marking[q.id] = { auto: autoMark(q, answers[q.id], neg), manual: null, remark: null };
  const { score, pending } = scoreAttempt(a.paper.sections, a.paper.questions, marking, answers);
  return prisma.onlineAttempt.update({
    where: { id: a.id },
    data: { submittedAt: auto ? a.deadline : new Date(), autoSubmitted: auto, marking: marking as never, score: pending ? null : score },
  });
}

// ---------- Question bank ----------

router.get(
  '/bank',
  ah(async (req, res) => {
    if (!(isManager(req) || req.user!.role === 'TEACHER')) throw forbidden();
    const q = parse(z.object({ subjectId: z.string().optional(), classId: z.string().optional(), type: z.string().optional(), q: z.string().max(100).optional(), mine: z.enum(['true', 'false']).optional() }), req.query);
    const rows = await prisma.bankQuestion.findMany({
      where: {
        schoolId: tenantId(req),
        ...(q.subjectId ? { subjectId: q.subjectId } : {}),
        ...(q.classId ? { OR: [{ classId: q.classId }, { classId: null }] } : {}),
        ...(q.type ? { type: q.type as never } : {}),
        ...(q.q ? { OR: [{ text: { contains: q.q } }, { chapter: { contains: q.q } }] } : {}),
        ...(q.mine === 'true' ? { createdById: req.user!.id } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, fullName: true } });
    res.json({ questions: rows.map((r) => ({ ...r, marks: num(r.marks), createdBy: users.find((u) => u.id === r.createdById)?.fullName ?? null, mine: r.createdById === req.user!.id })) });
  }),
);

const bankBody = questionSchema.extend({ subjectId: z.string(), classId: z.string().nullish(), chapter: optStr(120) });

router.post(
  '/bank',
  ah(async (req, res) => {
    if (!(isManager(req) || req.user!.role === 'TEACHER')) throw forbidden();
    const schoolId = tenantId(req);
    const body = parse(bankBody, req.body);
    if (!(await prisma.subject.findFirst({ where: { id: body.subjectId, schoolId } }))) throw badRequest('Unknown subject');
    const { options, answer } = normalizeQuestion(body);
    const q = await prisma.bankQuestion.create({
      data: { schoolId, subjectId: body.subjectId, classId: body.classId ?? null, chapter: body.chapter ?? null, type: body.type, text: body.text, imageFileId: body.imageFileId ?? null, options: options as never, answer: answer as never, marks: body.marks, createdById: req.user!.id },
    });
    res.status(201).json({ question: q });
  }),
);

router.patch(
  '/bank/:id',
  ah(async (req, res) => {
    const q = await prisma.bankQuestion.findFirst({ where: { id: req.params.id, schoolId: tenantId(req) } });
    if (!q) throw notFound('Question not found');
    if (!(isManager(req) || q.createdById === req.user!.id)) throw forbidden('You can only edit your own questions');
    const body = parse(bankBody, req.body);
    const { options, answer } = normalizeQuestion(body);
    const updated = await prisma.bankQuestion.update({
      where: { id: q.id },
      data: { subjectId: body.subjectId, classId: body.classId ?? null, chapter: body.chapter ?? null, type: body.type, text: body.text, imageFileId: body.imageFileId ?? null, options: options as never, answer: answer as never, marks: body.marks },
    });
    res.json({ question: updated });
  }),
);

router.delete(
  '/bank/:id',
  ah(async (req, res) => {
    const q = await prisma.bankQuestion.findFirst({ where: { id: req.params.id, schoolId: tenantId(req) } });
    if (!q) throw notFound('Question not found');
    if (!(isManager(req) || q.createdById === req.user!.id)) throw forbidden();
    await prisma.bankQuestion.delete({ where: { id: q.id } });
    res.json({ ok: true });
  }),
);

// ---------- Papers ----------

const paperSettings = z.object({
  title: z.string().trim().min(2).max(160),
  subjectId: z.string(),
  classId: z.string(),
  sectionIds: z.array(z.string()).min(1),
  instructions: optStr(3000),
  startAt: z.coerce.date().nullish(),
  endAt: z.coerce.date().nullish(),
  durationMinutes: z.coerce.number().int().min(1).max(600).default(30),
  shuffleQuestions: z.boolean().default(true),
  shuffleOptions: z.boolean().default(true),
  negativeMarking: z.coerce.number().min(0).max(1).default(0),
  showAnswers: z.boolean().default(true),
  passMarks: z.coerce.number().min(0).nullish(),
});

async function checkPaperRefs(req: Request, b: { subjectId: string; classId: string; sectionIds: string[] }) {
  const schoolId = tenantId(req);
  const cls = await prisma.classLevel.findFirst({ where: { id: b.classId, schoolId, deletedAt: null }, include: { subjects: true, sections: { where: { deletedAt: null } } } });
  if (!cls) throw badRequest('Unknown class');
  if (!cls.subjects.some((s) => s.subjectId === b.subjectId)) throw badRequest('This subject is not taught in this class');
  if (b.sectionIds.some((id) => !cls.sections.some((s) => s.id === id))) throw badRequest('Choose sections of this class');
  if (!(await teaches(req, b.classId, b.subjectId, b.sectionIds))) throw forbidden('You do not teach this subject in all chosen sections');
}

function paperSummary(p: FullPaper | (OnlinePaper & { sections: { id: string; attemptAny: number | null }[]; questions: { sectionId: string; marks: Prisma.Decimal }[] })) {
  const now = new Date();
  return {
    ...p,
    negativeMarking: num(p.negativeMarking),
    passMarks: p.passMarks === null ? null : num(p.passMarks),
    totalMarks: paperTotal(p.sections, p.questions),
    phase: p.status !== 'SCHEDULED' ? p.status : live(p, now) ? 'LIVE' : ended(p, now) ? 'ENDED' : 'UPCOMING',
  };
}

router.get(
  '/',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    if (!(isManager(req) || req.user!.role === 'TEACHER')) throw forbidden();
    const papers = await prisma.onlinePaper.findMany({
      where: { schoolId, ...(isManager(req) ? {} : { createdById: req.user!.id }) },
      include: { sections: { select: { id: true, attemptAny: true } }, questions: { select: { sectionId: true, marks: true } }, _count: { select: { attempts: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const [subjects, classes, users, submitted] = await Promise.all([
      prisma.subject.findMany({ where: { id: { in: papers.map((p) => p.subjectId) } }, select: { id: true, name: true } }),
      prisma.classLevel.findMany({ where: { id: { in: papers.map((p) => p.classId) } }, select: { id: true, name: true, stream: true } }),
      prisma.user.findMany({ where: { id: { in: papers.map((p) => p.createdById) } }, select: { id: true, fullName: true } }),
      prisma.onlineAttempt.groupBy({ by: ['paperId'], where: { paperId: { in: papers.map((p) => p.id) }, submittedAt: { not: null } }, _count: { _all: true } }),
    ]);
    res.json({
      papers: papers.map((p) => {
        const c = classes.find((x) => x.id === p.classId);
        return {
          ...paperSummary(p),
          sections: undefined,
          questions: p.questions.length,
          subject: subjects.find((s) => s.id === p.subjectId)?.name ?? '',
          classLabel: c ? `${c.name}${c.stream ? ` ${c.stream}` : ''}` : '',
          createdBy: users.find((u) => u.id === p.createdById)?.fullName ?? '',
          attempts: p._count.attempts,
          submitted: submitted.find((s) => s.paperId === p.id)?._count._all ?? 0,
        };
      }),
    });
  }),
);

router.post(
  '/',
  ah(async (req, res) => {
    const body = parse(paperSettings, req.body);
    await checkPaperRefs(req, body);
    const p = await prisma.onlinePaper.create({
      data: { ...body, schoolId: tenantId(req), createdById: req.user!.id, sections: { create: [{ title: 'Section A', sortOrder: 0 }] } },
    });
    await audit(req, { action: 'online.paper_create', entityType: 'OnlinePaper', entityId: p.id, after: body });
    res.status(201).json({ id: p.id });
  }),
);

router.get(
  '/:id',
  ah(async (req, res) => {
    const p = await loadOwnPaper(req, req.params.id);
    const [subject, cls] = await Promise.all([
      prisma.subject.findUnique({ where: { id: p.subjectId }, select: { name: true } }),
      prisma.classLevel.findUnique({ where: { id: p.classId }, select: { name: true, stream: true, sections: { where: { deletedAt: null }, select: { id: true, name: true } } } }),
    ]);
    const attempts = await prisma.onlineAttempt.count({ where: { paperId: p.id } });
    res.json({
      paper: { ...paperSummary(p), questions: undefined, sections: undefined },
      sections: p.sections.map((s) => ({ ...s, questions: p.questions.filter((q) => q.sectionId === s.id).map((q) => ({ ...q, marks: num(q.marks) })) })),
      subject: subject?.name ?? '',
      classLabel: cls ? `${cls.name}${cls.stream ? ` ${cls.stream}` : ''}` : '',
      classSections: cls?.sections ?? [],
      attempts,
      editable: ['DRAFT', 'AWAITING_APPROVAL'].includes(p.status) || (p.status === 'SCHEDULED' && attempts === 0 && !live(p)),
    });
  }),
);

router.patch(
  '/:id',
  ah(async (req, res) => {
    const p = await loadOwnPaper(req, req.params.id);
    if (await prisma.onlineAttempt.count({ where: { paperId: p.id } })) throw badRequest('Students have already started. Settings can no longer change.');
    const body = parse(patchOf(paperSettings), req.body);
    await checkPaperRefs(req, { subjectId: body.subjectId ?? p.subjectId, classId: body.classId ?? p.classId, sectionIds: body.sectionIds ?? (p.sectionIds as string[]) });
    await prisma.onlinePaper.update({ where: { id: p.id }, data: body });
    res.json({ ok: true });
  }),
);

const structureBody = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        instructions: optStr(500),
        attemptAny: z.coerce.number().int().min(1).nullish(),
        questions: z.array(questionSchema.extend({ bankId: z.string().nullish(), saveToBank: z.boolean().default(true), chapter: optStr(120) })).max(200),
      }),
    )
    .min(1)
    .max(10),
});

/** Saves all sections and questions of the paper at once. New questions are also added to the question bank. */
router.put(
  '/:id/structure',
  ah(async (req, res) => {
    const p = await loadOwnPaper(req, req.params.id);
    if (await prisma.onlineAttempt.count({ where: { paperId: p.id } })) throw badRequest('Students have already started. Questions can no longer change.');
    const body = parse(structureBody, req.body);
    const cleaned = body.sections.map((s) => {
      if (s.attemptAny && s.attemptAny > s.questions.length) throw badRequest(`"${s.title}": attempt-any is more than the number of questions`);
      return { ...s, questions: s.questions.map((q) => ({ ...q, ...normalizeQuestion(q) })) };
    });
    await prisma.$transaction(async (tx) => {
      await tx.onlinePaperSection.deleteMany({ where: { paperId: p.id } });
      for (const [si, s] of cleaned.entries()) {
        const sec = await tx.onlinePaperSection.create({ data: { paperId: p.id, title: s.title, instructions: s.instructions ?? null, attemptAny: s.attemptAny ?? null, sortOrder: si } });
        for (const [qi, q] of s.questions.entries()) {
          let bankId = q.bankId ?? null;
          if (bankId) {
            await tx.bankQuestion.updateMany({ where: { id: bankId, schoolId: p.schoolId }, data: { usedCount: { increment: 1 } } });
          } else if (q.saveToBank) {
            const b = await tx.bankQuestion.create({
              data: { schoolId: p.schoolId, subjectId: p.subjectId, classId: p.classId, chapter: q.chapter ?? null, type: q.type, text: q.text, imageFileId: q.imageFileId ?? null, options: q.options as never, answer: q.answer as never, marks: q.marks, createdById: req.user!.id, usedCount: 1 },
            });
            bankId = b.id;
          }
          await tx.onlinePaperQuestion.create({
            data: { paperId: p.id, sectionId: sec.id, bankId, type: q.type, text: q.text, imageFileId: q.imageFileId ?? null, options: q.options as never, answer: q.answer as never, marks: q.marks, sortOrder: qi },
          });
        }
      }
    });
    const fresh = await loadPaper(req, p.id);
    res.json({ ok: true, totalMarks: paperTotal(fresh.sections, fresh.questions), questions: fresh.questions.length });
  }),
);

router.post(
  '/:id/duplicate',
  ah(async (req, res) => {
    const p = await loadOwnPaper(req, req.params.id);
    const copy = await prisma.onlinePaper.create({
      data: {
        schoolId: p.schoolId,
        title: `${p.title} (copy)`,
        subjectId: p.subjectId,
        classId: p.classId,
        sectionIds: p.sectionIds as string[],
        instructions: p.instructions,
        durationMinutes: p.durationMinutes,
        shuffleQuestions: p.shuffleQuestions,
        shuffleOptions: p.shuffleOptions,
        negativeMarking: p.negativeMarking,
        showAnswers: p.showAnswers,
        passMarks: p.passMarks,
        createdById: req.user!.id,
      },
    });
    for (const s of p.sections) {
      const sec = await prisma.onlinePaperSection.create({ data: { paperId: copy.id, title: s.title, instructions: s.instructions, attemptAny: s.attemptAny, sortOrder: s.sortOrder } });
      await prisma.onlinePaperQuestion.createMany({
        data: p.questions.filter((q) => q.sectionId === s.id).map((q) => ({ paperId: copy.id, sectionId: sec.id, bankId: q.bankId, type: q.type, text: q.text, imageFileId: q.imageFileId, options: q.options as never, answer: q.answer as never, marks: q.marks, sortOrder: q.sortOrder })),
      });
    }
    res.status(201).json({ id: copy.id });
  }),
);

/** Make the paper available to students in the time window (or send it for approval first). */
router.post(
  '/:id/schedule',
  ah(async (req, res) => {
    const p = await loadOwnPaper(req, req.params.id);
    if (!['DRAFT', 'AWAITING_APPROVAL'].includes(p.status)) throw badRequest('Already scheduled');
    if (!p.questions.length) throw badRequest('Add at least one question');
    if (!p.startAt || !p.endAt) throw badRequest('Set the start and end time');
    if (p.endAt <= p.startAt) throw badRequest('End time must be after start time');
    if (p.endAt <= new Date()) throw badRequest('The end time has already passed');
    if (p.durationMinutes * 60000 > p.endAt.getTime() - p.startAt.getTime()) throw badRequest('The duration is longer than the time window');
    const settings = await getExamSettings(p.schoolId);
    const needsApproval = settings.onlinePaperApproval && !isManager(req);
    await prisma.onlinePaper.update({ where: { id: p.id }, data: { status: needsApproval ? 'AWAITING_APPROVAL' : 'SCHEDULED', reviewNote: null } });
    if (needsApproval) {
      const principals = await prisma.user.findMany({ where: { schoolId: p.schoolId, role: 'PRINCIPAL', isActive: true, deletedAt: null }, select: { id: true } });
      await notify(p.schoolId, principals.map((x) => ({ userId: x.id, type: 'ONLINE_EXAM', title: `Online exam to approve: ${p.title}`, body: `${req.user!.fullName} made an online exam.`, link: `/online-exams/${p.id}` })));
    } else await announce(p);
    await audit(req, { action: needsApproval ? 'online.paper_submit' : 'online.paper_schedule', entityType: 'OnlinePaper', entityId: p.id });
    res.json({ status: needsApproval ? 'AWAITING_APPROVAL' : 'SCHEDULED' });
  }),
);

/** Tell students and parents about a scheduled online exam. */
async function announce(p: OnlinePaper) {
  const students = await prisma.student.findMany({ where: { sectionId: { in: p.sectionIds as string[] }, status: 'ACTIVE', deletedAt: null }, select: { userId: true, family: { select: { parentUserId: true } } } });
  const when = p.startAt!.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
  const items = [
    ...students.filter((s) => s.userId).map((s) => ({ userId: s.userId!, type: 'ONLINE_EXAM', title: `Online exam: ${p.title}`, body: `Starts ${when}. You have ${p.durationMinutes} minutes once you begin.`, link: '/home/online-exams' })),
    ...[...new Set(students.map((s) => s.family.parentUserId).filter(Boolean) as string[])].map((userId) => ({ userId, type: 'ONLINE_EXAM', title: `Online exam: ${p.title}`, body: `Your child has an online exam starting ${when}.`, link: '/home/results' })),
  ];
  await notify(p.schoolId, items);
}

router.post(
  '/:id/approve-paper',
  ah(async (req, res) => {
    if (!isManager(req)) throw forbidden();
    const p = await loadPaper(req, req.params.id);
    if (p.status !== 'AWAITING_APPROVAL') throw badRequest('This paper is not waiting for approval');
    const body = parse(z.object({ approve: z.boolean(), note: optStr(500) }), req.body);
    if (!body.approve && !body.note) throw badRequest('Write what needs changing');
    await prisma.onlinePaper.update({ where: { id: p.id }, data: { status: body.approve ? 'SCHEDULED' : 'DRAFT', reviewNote: body.approve ? null : body.note } });
    if (body.approve) await announce(p);
    await notify(p.schoolId, [{ userId: p.createdById, type: 'ONLINE_EXAM', title: body.approve ? `Approved: ${p.title}` : `Changes needed: ${p.title}`, body: body.approve ? 'Your online exam is scheduled.' : (body.note ?? ''), link: `/online-exams/${p.id}` }]);
    await audit(req, { action: body.approve ? 'online.paper_approve' : 'online.paper_return', entityType: 'OnlinePaper', entityId: p.id, reason: body.note });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/unschedule',
  ah(async (req, res) => {
    const p = await loadOwnPaper(req, req.params.id);
    if (await prisma.onlineAttempt.count({ where: { paperId: p.id } })) throw badRequest('Students have already started');
    await prisma.onlinePaper.update({ where: { id: p.id }, data: { status: 'DRAFT' } });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const p = await loadOwnPaper(req, req.params.id);
    if (p.status === 'PUBLISHED' || (await prisma.onlineAttempt.count({ where: { paperId: p.id } }))) {
      if (req.user!.role !== 'PRINCIPAL') throw forbidden('Only the principal can delete an exam students have taken');
    }
    await prisma.onlinePaper.delete({ where: { id: p.id } });
    await audit(req, { action: 'online.paper_delete', entityType: 'OnlinePaper', entityId: p.id, before: { title: p.title } });
    res.json({ ok: true });
  }),
);

// ---------- Taking the exam (students) ----------

async function myStudent(req: Request) {
  if (req.user!.role !== 'STUDENT') throw forbidden('Only students take online exams');
  const st = await prisma.student.findFirst({ where: { userId: req.user!.id, deletedAt: null, status: 'ACTIVE' } });
  if (!st) throw forbidden();
  return st;
}

router.get(
  '/student/list',
  ah(async (req, res) => {
    const st = await myStudent(req);
    await closeExpiredAttempts();
    const papers = await prisma.onlinePaper.findMany({
      where: { schoolId: tenantId(req), classId: st.classId, status: { in: ['SCHEDULED', 'RESULTS_SUBMITTED', 'RESULTS_RETURNED', 'PUBLISHED'] } },
      include: { sections: { select: { id: true, attemptAny: true } }, questions: { select: { sectionId: true, marks: true } } },
      orderBy: { startAt: 'desc' },
    });
    const mine = papers.filter((p) => st.sectionId && (p.sectionIds as string[]).includes(st.sectionId));
    const attempts = await prisma.onlineAttempt.findMany({ where: { studentId: st.id, paperId: { in: mine.map((p) => p.id) } } });
    const subjects = await prisma.subject.findMany({ where: { id: { in: mine.map((p) => p.subjectId) } }, select: { id: true, name: true } });
    res.json({
      papers: mine.map((p) => {
        const a = attempts.find((x) => x.paperId === p.id);
        return {
          id: p.id,
          title: p.title,
          subject: subjects.find((s) => s.id === p.subjectId)?.name ?? '',
          startAt: p.startAt,
          endAt: p.endAt,
          durationMinutes: p.durationMinutes,
          totalMarks: paperTotal(p.sections, p.questions),
          questions: p.questions.length,
          phase: paperSummary(p).phase,
          attempt: a ? { id: a.id, submitted: Boolean(a.submittedAt), deadline: a.deadline } : null,
          published: p.status === 'PUBLISHED',
          score: p.status === 'PUBLISHED' && a ? num(a.score) : null,
        };
      }),
    });
  }),
);

function attemptView(p: FullPaper, a: OnlineAttempt) {
  const order = a.questionOrder as string[];
  const qs = order.map((id) => p.questions.find((q) => q.id === id)).filter(Boolean) as FullPaper['questions'];
  return {
    attempt: { id: a.id, startedAt: a.startedAt, deadline: a.deadline, submitted: Boolean(a.submittedAt), answers: a.answers, serverNow: new Date() },
    paper: { id: p.id, title: p.title, instructions: p.instructions, totalMarks: paperTotal(p.sections, p.questions), negativeMarking: num(p.negativeMarking) },
    sections: p.sections.map((s) => ({ id: s.id, title: s.title, instructions: s.instructions, attemptAny: s.attemptAny })),
    questions: qs.map((q) => studentQuestion(q, a.optionOrder as Record<string, (string | number)[]>)),
  };
}

/** Starts the attempt (or resumes it after a dropped connection). */
router.post(
  '/:id/start',
  ah(async (req, res) => {
    const st = await myStudent(req);
    const p = await loadPaper(req, req.params.id);
    if (!st.sectionId || !(p.sectionIds as string[]).includes(st.sectionId)) throw notFound('Online exam not found');
    const existing = await prisma.onlineAttempt.findUnique({ where: { paperId_studentId: { paperId: p.id, studentId: st.id } } });
    if (existing) {
      if (!existing.submittedAt && existing.deadline.getTime() + GRACE_MS < Date.now()) await finishAttempt(existing.id, true);
      const fresh = await prisma.onlineAttempt.findUniqueOrThrow({ where: { id: existing.id } });
      if (fresh.submittedAt) throw badRequest('You have already finished this exam');
      return res.json(attemptView(p, fresh));
    }
    if (!live(p)) throw badRequest(p.startAt && new Date() < p.startAt ? 'This exam has not started yet' : 'This exam is closed');
    const { order, optionOrder } = makeOrder(p.sections, p.questions, p.shuffleQuestions, p.shuffleOptions);
    const deadline = new Date(Math.min(Date.now() + p.durationMinutes * 60000, p.endAt!.getTime()));
    const a = await prisma.onlineAttempt.create({ data: { schoolId: p.schoolId, paperId: p.id, studentId: st.id, deadline, questionOrder: order, optionOrder, answers: {} } });
    await audit(req, { action: 'online.attempt_start', entityType: 'OnlineAttempt', entityId: a.id });
    res.status(201).json(attemptView(p, a));
  }),
);

async function myAttempt(req: Request, id: string) {
  const st = await myStudent(req);
  const a = await prisma.onlineAttempt.findFirst({ where: { id, studentId: st.id } });
  if (!a) throw notFound('Attempt not found');
  return a;
}

/** Autosave: merges the answers sent (every few seconds and on every change). */
router.put(
  '/attempts/:attemptId/answers',
  ah(async (req, res) => {
    const a = await myAttempt(req, req.params.attemptId);
    const body = parse(z.object({ answers: z.record(z.string(), z.unknown()).default({}), tabSwitches: z.coerce.number().int().min(0).max(1000).optional() }), req.body);
    if (a.submittedAt) throw badRequest('This exam is already submitted');
    if (Date.now() > a.deadline.getTime() + GRACE_MS) {
      await finishAttempt(a.id, true);
      throw badRequest('Time is up. Your answers were submitted.');
    }
    const valid = new Set(a.questionOrder as string[]);
    const clean = Object.fromEntries(Object.entries(body.answers).filter(([k]) => valid.has(k)).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 20000) : v]));
    await prisma.onlineAttempt.update({
      where: { id: a.id },
      data: { answers: { ...((a.answers as object) ?? {}), ...clean } as never, lastSavedAt: new Date(), ...(body.tabSwitches !== undefined ? { tabSwitches: Math.max(a.tabSwitches, body.tabSwitches) } : {}) },
    });
    res.json({ ok: true, savedAt: new Date(), deadline: a.deadline });
  }),
);

/** Photo of a handwritten long answer. */
router.post(
  '/attempts/:attemptId/upload',
  ah(async (req, res) => {
    const a = await myAttempt(req, req.params.attemptId);
    if (a.submittedAt || Date.now() > a.deadline.getTime() + GRACE_MS) throw badRequest('Time is up');
    const school = req.user!.school!;
    await new Promise<void>((resolve, reject) =>
      multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } }).single('file')(req, {} as never, (err) => (err ? reject(err) : resolve())),
    );
    if (!req.file || !req.file.mimetype.startsWith('image/')) throw badRequest('Upload a photo');
    const f = await saveSchoolFile({ school, uploadedById: req.user!.id, category: 'EXAM', file: req.file });
    res.status(201).json({ fileId: f.id });
  }),
);

router.post(
  '/attempts/:attemptId/submit',
  ah(async (req, res) => {
    const a = await myAttempt(req, req.params.attemptId);
    if (a.submittedAt) return res.json({ ok: true });
    const late = Date.now() > a.deadline.getTime() + GRACE_MS;
    await finishAttempt(a.id, late);
    await audit(req, { action: 'online.attempt_submit', entityType: 'OnlineAttempt', entityId: a.id, after: { late } });
    res.json({ ok: true });
  }),
);

/** The student's result after publishing: marks per question, remarks and (if allowed) correct answers. */
router.get(
  '/attempts/:attemptId/result',
  ah(async (req, res) => {
    const u = req.user!;
    const a = await prisma.onlineAttempt.findFirst({ where: { id: req.params.attemptId, schoolId: tenantId(req) } });
    if (!a) throw notFound('Result not found');
    const st = await prisma.student.findUniqueOrThrow({ where: { id: a.studentId }, include: { family: true } });
    const isOwner = (u.role === 'STUDENT' && st.userId === u.id) || (u.role === 'PARENT' && st.family.parentUserId === u.id);
    if (!isOwner) throw notFound('Result not found');
    const p = await loadPaper(req, a.paperId);
    if (p.status !== 'PUBLISHED') throw badRequest('Results are not published yet');
    const marking = (a.marking as unknown as Record<string, MarkEntry>) ?? {};
    const answers = (a.answers as Record<string, unknown>) ?? {};
    res.json({
      paper: { title: p.title, totalMarks: paperTotal(p.sections, p.questions), showAnswers: p.showAnswers },
      score: num(a.score),
      overallRemark: a.overallRemark,
      sections: p.sections.map((s) => ({ id: s.id, title: s.title, attemptAny: s.attemptAny })),
      questions: p.questions.map((q) => ({
        id: q.id,
        sectionId: q.sectionId,
        type: q.type,
        text: q.text,
        imageFileId: q.imageFileId,
        options: q.options,
        marks: num(q.marks),
        yourAnswer: answers[q.id] ?? null,
        awarded: finalMark(marking[q.id]),
        remark: marking[q.id]?.remark ?? null,
        correctAnswer: p.showAnswers ? q.answer : undefined,
      })),
    });
  }),
);

// ---------- Marking (teacher) ----------

router.get(
  '/:id/attempts',
  ah(async (req, res) => {
    const p = await loadOwnPaper(req, req.params.id);
    await closeExpiredAttempts();
    const students = await prisma.student.findMany({ where: { sectionId: { in: p.sectionIds as string[] }, status: 'ACTIVE', deletedAt: null }, select: { id: true, fullName: true, rollNo: true, section: { select: { name: true } } }, orderBy: [{ rollNo: 'asc' }, { fullName: 'asc' }] });
    const attempts = await prisma.onlineAttempt.findMany({ where: { paperId: p.id } });
    const subjective = p.questions.filter((q) => !OBJECTIVE.includes(q.type));
    res.json({
      paper: { ...paperSummary(p), questions: undefined, sections: undefined },
      questions: p.questions.map((q) => ({ id: q.id, type: q.type, text: q.text.slice(0, 120), marks: num(q.marks), subjective: !OBJECTIVE.includes(q.type) })),
      rows: students.map((s) => {
        const a = attempts.find((x) => x.studentId === s.id);
        const marking = (a?.marking as unknown as Record<string, MarkEntry>) ?? {};
        const answers = (a?.answers as Record<string, unknown>) ?? {};
        const toCheck = a?.submittedAt ? subjective.filter((q) => answers[q.id] !== undefined && answers[q.id] !== '' && marking[q.id]?.manual === null).length : 0;
        return {
          student: s,
          attemptId: a?.id ?? null,
          status: !a ? (ended(p) ? 'ABSENT' : 'NOT_STARTED') : a.submittedAt ? 'SUBMITTED' : 'IN_PROGRESS',
          autoSubmitted: a?.autoSubmitted ?? false,
          tabSwitches: a?.tabSwitches ?? 0,
          score: a?.score === null || a?.score === undefined ? null : num(a.score),
          toCheck,
          submittedAt: a?.submittedAt ?? null,
        };
      }),
    });
  }),
);

/** One student's answers with automatic and teacher marks. */
router.get(
  '/attempts/:attemptId',
  ah(async (req, res) => {
    const a = await prisma.onlineAttempt.findFirst({ where: { id: req.params.attemptId, schoolId: tenantId(req) } });
    if (!a) throw notFound('Attempt not found');
    const p = await loadOwnPaper(req, a.paperId);
    const st = await prisma.student.findUniqueOrThrow({ where: { id: a.studentId }, select: { id: true, fullName: true, rollNo: true } });
    const marking = (a.marking as unknown as Record<string, MarkEntry>) ?? {};
    res.json({
      student: st,
      attempt: { id: a.id, startedAt: a.startedAt, submittedAt: a.submittedAt, autoSubmitted: a.autoSubmitted, tabSwitches: a.tabSwitches, score: a.score === null ? null : num(a.score), overallRemark: a.overallRemark },
      paper: { id: p.id, title: p.title, status: p.status, totalMarks: paperTotal(p.sections, p.questions) },
      sections: p.sections.map((s) => ({ id: s.id, title: s.title, attemptAny: s.attemptAny })),
      questions: p.questions.map((q) => ({ id: q.id, sectionId: q.sectionId, type: q.type, text: q.text, imageFileId: q.imageFileId, options: q.options, answer: q.answer, marks: num(q.marks), given: (a.answers as Record<string, unknown>)[q.id] ?? null, mark: marking[q.id] ?? null })),
    });
  }),
);

const canMark = (p: OnlinePaper) => ['SCHEDULED', 'RESULTS_RETURNED', 'RESULTS_SUBMITTED', 'PUBLISHED'].includes(p.status);

/** Apply teacher marks/remarks to attempts and recompute their scores. */
async function applyMarks(req: Request, p: FullPaper, items: { attemptId: string; questionId: string; marks: number | null; remark: string | null }[], overall?: { attemptId: string; remark: string | null }) {
  if (!canMark(p)) throw badRequest('This exam cannot be marked now');
  if (['RESULTS_SUBMITTED', 'PUBLISHED'].includes(p.status) && !isManager(req)) throw forbidden('Results are with the principal. Only the principal can change marks now.');
  const byAttempt = new Map<string, typeof items>();
  for (const it of items) byAttempt.set(it.attemptId, [...(byAttempt.get(it.attemptId) ?? []), it]);
  if (overall && !byAttempt.has(overall.attemptId)) byAttempt.set(overall.attemptId, []);
  for (const [attemptId, list] of byAttempt) {
    const a = await prisma.onlineAttempt.findFirst({ where: { id: attemptId, paperId: p.id } });
    if (!a || !a.submittedAt) throw badRequest('This student has not submitted yet');
    const marking = { ...((a.marking as unknown as Record<string, MarkEntry>) ?? {}) };
    for (const it of list) {
      const q = p.questions.find((x) => x.id === it.questionId);
      if (!q) throw badRequest('Unknown question');
      if (it.marks !== null && (it.marks < -num(q.marks) || it.marks > num(q.marks))) throw badRequest(`Marks must be between 0 and ${num(q.marks)}`);
      marking[q.id] = { auto: marking[q.id]?.auto ?? null, manual: it.marks, remark: it.remark };
    }
    const { score, pending } = scoreAttempt(p.sections, p.questions, marking, (a.answers as Record<string, unknown>) ?? {});
    await prisma.onlineAttempt.update({ where: { id: a.id }, data: { marking: marking as never, score: pending ? null : score, ...(overall?.attemptId === a.id ? { overallRemark: overall.remark } : {}) } });
  }
  if (p.status === 'PUBLISHED') await publishResults(p.id, req.user!.id, false);
}

router.put(
  '/attempts/:attemptId/marking',
  ah(async (req, res) => {
    const a = await prisma.onlineAttempt.findFirst({ where: { id: req.params.attemptId, schoolId: tenantId(req) } });
    if (!a) throw notFound('Attempt not found');
    const p = await loadOwnPaper(req, a.paperId);
    const body = parse(z.object({ marks: z.record(z.string(), z.object({ marks: z.coerce.number().nullable(), remark: optStr(300) })).default({}), overallRemark: optStr(500) }), req.body);
    await applyMarks(
      req,
      p,
      Object.entries(body.marks).map(([questionId, m]) => ({ attemptId: a.id, questionId, marks: m.marks, remark: m.remark ?? null })),
      body.overallRemark !== undefined ? { attemptId: a.id, remark: body.overallRemark ?? null } : undefined,
    );
    const fresh = await prisma.onlineAttempt.findUniqueOrThrow({ where: { id: a.id } });
    res.json({ ok: true, score: fresh.score === null ? null : num(fresh.score) });
  }),
);

/** Checking one question for the whole class. */
router.get(
  '/:id/questions/:questionId/answers',
  ah(async (req, res) => {
    const p = await loadOwnPaper(req, req.params.id);
    const q = p.questions.find((x) => x.id === req.params.questionId);
    if (!q) throw notFound('Question not found');
    const attempts = await prisma.onlineAttempt.findMany({ where: { paperId: p.id, submittedAt: { not: null } } });
    const students = await prisma.student.findMany({ where: { id: { in: attempts.map((a) => a.studentId) } }, select: { id: true, fullName: true, rollNo: true } });
    res.json({
      question: { ...q, marks: num(q.marks) },
      answers: attempts
        .map((a) => ({ attemptId: a.id, student: students.find((s) => s.id === a.studentId), given: (a.answers as Record<string, unknown>)[q.id] ?? null, mark: ((a.marking as unknown as Record<string, MarkEntry>) ?? {})[q.id] ?? null }))
        .sort((x, y) => (x.student?.rollNo ?? '').localeCompare(y.student?.rollNo ?? '', undefined, { numeric: true })),
    });
  }),
);

router.put(
  '/:id/questions/:questionId/marking',
  ah(async (req, res) => {
    const p = await loadOwnPaper(req, req.params.id);
    const body = parse(z.object({ marks: z.array(z.object({ attemptId: z.string(), marks: z.coerce.number().nullable(), remark: optStr(300) })).max(500) }), req.body);
    await applyMarks(req, p, body.marks.map((m) => ({ attemptId: m.attemptId, questionId: req.params.questionId, marks: m.marks, remark: m.remark ?? null })));
    res.json({ ok: true });
  }),
);

/** Let a student take the exam again (e.g. power cut). */
router.post(
  '/attempts/:attemptId/reset',
  ah(async (req, res) => {
    const a = await prisma.onlineAttempt.findFirst({ where: { id: req.params.attemptId, schoolId: tenantId(req) } });
    if (!a) throw notFound('Attempt not found');
    const p = await loadOwnPaper(req, a.paperId);
    if (!live(p)) throw badRequest('A new attempt is only possible while the exam is open');
    const { reason } = parse(z.object({ reason: z.string().trim().min(2).max(300) }), req.body);
    await prisma.onlineAttempt.delete({ where: { id: a.id } });
    await audit(req, { action: 'online.attempt_reset', entityType: 'OnlineAttempt', entityId: a.id, before: { studentId: a.studentId }, reason });
    res.json({ ok: true });
  }),
);

/** Teacher sends the checked results to the principal. */
router.post(
  '/:id/submit-results',
  ah(async (req, res) => {
    const p = await loadOwnPaper(req, req.params.id);
    if (!['SCHEDULED', 'RESULTS_RETURNED'].includes(p.status)) throw badRequest('Results cannot be submitted now');
    if (!ended(p)) throw badRequest('Wait until the exam closes');
    await closeExpiredAttempts();
    const unchecked = await prisma.onlineAttempt.count({ where: { paperId: p.id, submittedAt: { not: null }, score: null } });
    if (unchecked) throw badRequest(`${unchecked} paper(s) still have answers to check`);
    await prisma.onlinePaper.update({ where: { id: p.id }, data: { status: 'RESULTS_SUBMITTED', reviewNote: null } });
    const principals = await prisma.user.findMany({ where: { schoolId: p.schoolId, role: 'PRINCIPAL', isActive: true, deletedAt: null }, select: { id: true } });
    await notify(p.schoolId, principals.map((x) => ({ userId: x.id, type: 'ONLINE_EXAM', title: `Online exam results to approve: ${p.title}`, body: `${req.user!.fullName} has checked the papers.`, link: `/online-exams/${p.id}/marking` })));
    await audit(req, { action: 'online.results_submit', entityType: 'OnlinePaper', entityId: p.id });
    res.json({ ok: true });
  }),
);

/** Principal approves (publishes) or sends back the results. */
router.post(
  '/:id/review-results',
  ah(async (req, res) => {
    if (!isManager(req)) throw forbidden();
    const p = await loadPaper(req, req.params.id);
    if (p.status !== 'RESULTS_SUBMITTED') throw badRequest('Results are not waiting for approval');
    const body = parse(z.object({ approve: z.boolean(), note: optStr(500), linkPaperId: z.string().nullish() }), req.body);
    if (!body.approve) {
      if (!body.note) throw badRequest('Write what needs fixing');
      await prisma.onlinePaper.update({ where: { id: p.id }, data: { status: 'RESULTS_RETURNED', reviewNote: body.note } });
      await notify(p.schoolId, [{ userId: p.createdById, type: 'ONLINE_EXAM', title: `Results sent back: ${p.title}`, body: body.note, link: `/online-exams/${p.id}/marking` }]);
      await audit(req, { action: 'online.results_return', entityType: 'OnlinePaper', entityId: p.id, reason: body.note });
      return res.json({ ok: true });
    }
    if (body.linkPaperId) {
      const lp = await prisma.assessmentPaper.findFirst({ where: { id: body.linkPaperId, subjectId: p.subjectId, assessment: { schoolId: p.schoolId, classId: p.classId, kind: 'EXAM' } } });
      if (!lp) throw badRequest('Choose a term-exam paper of the same class and subject');
      await prisma.onlinePaper.update({ where: { id: p.id }, data: { linkPaperId: lp.id } });
    }
    const warning = await publishResults(p.id, req.user!.id, true);
    await audit(req, { action: 'online.results_publish', entityType: 'OnlinePaper', entityId: p.id, after: { linkPaperId: body.linkPaperId } });
    res.json({ ok: true, warning });
  }),
);

/** Exam papers this online exam's marks can be copied into (same class and subject). */
router.get(
  '/:id/linkable-papers',
  ah(async (req, res) => {
    const p = await loadPaper(req, req.params.id);
    const papers = await prisma.assessmentPaper.findMany({ where: { subjectId: p.subjectId, assessment: { schoolId: p.schoolId, classId: p.classId, kind: 'EXAM', status: 'DRAFT' } }, include: { assessment: { select: { title: true } } } });
    res.json({ papers: papers.map((x) => ({ id: x.id, title: x.assessment.title, totalMarks: num(x.totalMarks) })) });
  }),
);

/**
 * Publishing creates (or refreshes) a normal test result, so online exams appear with every other
 * result, count in monthly averages and rankings, and reach parents the usual way.
 */
async function publishResults(paperId: string, userId: string, firstTime: boolean): Promise<string | null> {
  const p = await prisma.onlinePaper.findUniqueOrThrow({ where: { id: paperId }, include: { sections: true, questions: true } });
  const total = paperTotal(p.sections, p.questions);
  const attempts = await prisma.onlineAttempt.findMany({ where: { paperId, submittedAt: { not: null } } });
  const students = await prisma.student.findMany({ where: { sectionId: { in: p.sectionIds as string[] }, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
  let type = await prisma.assessmentType.findFirst({ where: { schoolId: p.schoolId, kind: 'TEST', name: 'Online test' } });
  type ??= await prisma.assessmentType.create({ data: { schoolId: p.schoolId, kind: 'TEST', name: 'Online test', sortOrder: 45 } });
  const settings = await getExamSettings(p.schoolId);
  const passMarks = p.passMarks !== null ? num(p.passMarks) : round2((total * num(settings.passPercent)) / 100);
  const sessionId = (await prisma.academicSession.findFirst({ where: { schoolId: p.schoolId, isCurrent: true } }))?.id ?? null;
  const assessmentId = await prisma.$transaction(async (tx) => {
    let a = p.assessmentId ? await tx.assessment.findUnique({ where: { id: p.assessmentId }, include: { papers: true } }) : null;
    if (!a) {
      a = await tx.assessment.create({
        data: {
          schoolId: p.schoolId,
          kind: 'TEST',
          typeId: type!.id,
          title: p.title,
          sessionId,
          classId: p.classId,
          sectionId: (p.sectionIds as string[]).length === 1 ? (p.sectionIds as string[])[0] : null,
          createdById: p.createdById,
          papers: { create: { subjectId: p.subjectId, date: p.startAt, totalMarks: total, passMarks } },
        },
        include: { papers: true },
      });
    }
    const paper = a.papers[0];
    await tx.assessmentPaper.update({ where: { id: paper.id }, data: { totalMarks: total, passMarks } });
    for (const s of students) {
      const at = attempts.find((x) => x.studentId === s.id);
      const data = at ? { marks: num(at.score), isAbsent: false, updatedById: userId } : { marks: null, isAbsent: true, updatedById: userId };
      await tx.mark.upsert({ where: { paperId_studentId: { paperId: paper.id, studentId: s.id } }, create: { ...data, paperId: paper.id, studentId: s.id }, update: data });
    }
    await computeResults(tx, a.id);
    await tx.assessment.update({ where: { id: a.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: userId } });
    await tx.onlinePaper.update({ where: { id: p.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), assessmentId: a.id } });
    return a.id;
  });

  // Copy marks into the linked term-exam paper (scaled to that paper's total).
  let warning: string | null = null;
  if (p.linkPaperId) {
    const lp = await prisma.assessmentPaper.findUnique({ where: { id: p.linkPaperId }, include: { assessment: true } });
    if (lp && lp.assessment.status === 'DRAFT') {
      for (const at of attempts) {
        const scaled = total ? round2((num(at.score) / total) * num(lp.totalMarks)) : 0;
        await prisma.mark.upsert({ where: { paperId_studentId: { paperId: lp.id, studentId: at.studentId } }, create: { paperId: lp.id, studentId: at.studentId, marks: scaled, updatedById: userId }, update: { marks: scaled, isAbsent: false, updatedById: userId } });
      }
    } else if (lp) warning = `${lp.assessment.title} is already published, so its marks were not changed.`;
  }
  if (firstTime) {
    const s = await getSettings(p.schoolId);
    await sendResults(assessmentId, null, ruleFor(s, 'RESULT') === 'auto');
  }
  return warning;
}

export default router;

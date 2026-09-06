import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant, requireRoles('TEACHER', 'PRINCIPAL'));

const questionSchema = z.object({
  type: z.enum(['MCQ','MULTI_SELECT','TRUE_FALSE','FILL_BLANK','SHORT_ANSWER','LONG_ANSWER','NUMERIC','MATCHING','ESSAY']),
  prompt: z.string().min(2),
  explanation: z.string().optional(),
  marks: z.coerce.number().positive(),
  correctAnswer: z.any().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string(), isCorrect: z.boolean().default(false) })).default([]),
});

const examSchema = z.object({
  classId: z.string().uuid(), subjectId: z.string().uuid(), title: z.string().min(3), instructions: z.string().optional(),
  durationMin: z.coerce.number().int().min(1).max(600), passingMarks: z.coerce.number().min(0).optional(),
  startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional(), randomizeQuestions: z.boolean().default(false),
  randomizeOptions: z.boolean().default(false), showResults: z.boolean().default(false), questions: z.array(questionSchema).min(1),
});

async function canTeach(userId: string, schoolId: string, classId: string, subjectId: string, role: string) {
  if (role === 'PRINCIPAL') return true;
  return Boolean(await prisma.teacherAssignment.findFirst({ where: { schoolId, teacherId: userId, classId, subjectId } }));
}

router.get('/', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const where = req.auth!.role === 'TEACHER' ? { schoolId, createdById: req.auth!.userId } : { schoolId };
  const exams = await prisma.exam.findMany({ where, orderBy: { createdAt: 'desc' }, include: { class: true, subject: true, _count: { select: { questions: true } } } });
  res.json(exams);
});

router.post('/', async (req, res) => {
  const parsed = examSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid exam', issues: parsed.error.flatten() });
  const schoolId = req.auth!.schoolId!;
  const d = parsed.data;
  if (d.endsAt && d.startsAt && d.endsAt <= d.startsAt) return res.status(400).json({ message: 'Exam end must be after start' });
  if (!(await canTeach(req.auth!.userId, schoolId, d.classId, d.subjectId, req.auth!.role))) return res.status(403).json({ message: 'You are not assigned to this class and subject' });
  const [klass, subject] = await Promise.all([prisma.class.findFirst({ where: { id: d.classId, schoolId } }), prisma.subject.findFirst({ where: { id: d.subjectId, schoolId } })]);
  if (!klass || !subject) return res.status(400).json({ message: 'Class or subject is outside your school' });
  const totalMarks = d.questions.reduce((sum, q) => sum + q.marks, 0);
  if (d.passingMarks != null && d.passingMarks > totalMarks) return res.status(400).json({ message: 'Passing marks cannot exceed total marks' });

  const exam = await prisma.$transaction(async tx => {
    const created = await tx.exam.create({ data: { schoolId, classId: d.classId, subjectId: d.subjectId, createdById: req.auth!.userId, title: d.title, instructions: d.instructions, durationMin: d.durationMin, totalMarks, passingMarks: d.passingMarks, startsAt: d.startsAt, endsAt: d.endsAt, randomizeQuestions: d.randomizeQuestions, randomizeOptions: d.randomizeOptions, showResults: d.showResults } });
    for (let i = 0; i < d.questions.length; i++) {
      const q = d.questions[i];
      const question = await tx.question.create({ data: { examId: created.id, type: q.type, prompt: q.prompt, explanation: q.explanation, marks: q.marks, correctAnswer: q.correctAnswer, orderIndex: i } });
      if (q.options.length) await tx.questionOption.createMany({ data: q.options.map((o, oi) => ({ questionId: question.id, label: o.label, value: o.value, isCorrect: o.isCorrect, orderIndex: oi })) });
    }
    await tx.auditLog.create({ data: { schoolId, actorId: req.auth!.userId, action: 'EXAM_CREATED', entityType: 'Exam', entityId: created.id, afterData: { title: created.title, totalMarks, questionCount: d.questions.length } } });
    return created;
  });
  res.status(201).json(exam);
});

router.get('/:id', async (req, res) => {
  const exam = await prisma.exam.findFirst({ where: { id: req.params.id, schoolId: req.auth!.schoolId!, ...(req.auth!.role === 'TEACHER' ? { createdById: req.auth!.userId } : {}) }, include: { class: true, subject: true, questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } } } });
  if (!exam) return res.status(404).json({ message: 'Exam not found' });
  res.json(exam);
});

export default router;

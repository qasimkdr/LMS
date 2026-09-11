import { Router } from "express";
import { z } from "zod";
import { prisma } from "@nexora/database";
import {
  requireAuth,
  requireRoles,
  requireTenant,
} from "../middleware/auth.js";
import { routeParam } from "../utils/http.js";

const router = Router();
router.use(requireAuth, requireTenant);

function normalize(value: unknown) {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (Array.isArray(value))
    return [...value].map(String).sort().join("|").toLowerCase();
  return JSON.stringify(value ?? null).toLowerCase();
}

router.get("/available", requireRoles("STUDENT"), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const profile = await prisma.studentProfile.findFirst({
    where: { schoolId, userId: req.auth!.userId },
  });
  if (!profile?.classId) return res.json([]);
  const now = new Date();
  const exams = await prisma.exam.findMany({
    where: {
      schoolId,
      classId: profile.classId,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { startsAt: "asc" },
    include: {
      subject: true,
      _count: { select: { questions: true } },
      attempts: {
        where: { studentUserId: req.auth!.userId },
        select: {
          id: true,
          status: true,
          score: true,
          percentage: true,
          passed: true,
        },
      },
    },
  });
  res.json(exams);
});

router.post("/:examId/start", requireRoles("STUDENT"), async (req, res) => {
  const schoolId = req.auth!.schoolId!,
    examId = routeParam(req.params.examId);
  const profile = await prisma.studentProfile.findFirst({
    where: { schoolId, userId: req.auth!.userId },
  });
  const exam = await prisma.exam.findFirst({
    where: { id: examId, schoolId, classId: profile?.classId ?? "__none__" },
    include: {
      questions: {
        orderBy: { orderIndex: "asc" },
        include: {
          options: {
            orderBy: { orderIndex: "asc" },
            select: { id: true, label: true, value: true, orderIndex: true },
          },
        },
      },
    },
  });
  if (!exam)
    return res
      .status(404)
      .json({ message: "Exam not available for this student" });
  const now = new Date();
  if (exam.startsAt && now < exam.startsAt)
    return res.status(403).json({ message: "Exam has not started yet" });
  if (exam.endsAt && now > exam.endsAt)
    return res.status(403).json({ message: "Exam has ended" });

  const existing = await prisma.examAttempt.findUnique({
    where: {
      examId_studentUserId: {
        examId: exam.id,
        studentUserId: req.auth!.userId,
      },
    },
  });
  if (existing && existing.status !== "IN_PROGRESS") {
    return res
      .status(409)
      .json({
        message: "Exam attempt is already completed",
        status: existing.status,
      });
  }
  const attempt =
    existing ??
    (await prisma.examAttempt.create({
      data: { schoolId, examId: exam.id, studentUserId: req.auth!.userId },
    }));
  const savedAnswers = await prisma.studentAnswer.findMany({
    where: { attemptId: attempt.id },
    select: { questionId: true, answer: true },
  });
  res.json({
    attempt,
    savedAnswers,
    exam: {
      id: exam.id,
      title: exam.title,
      instructions: exam.instructions,
      durationMin: exam.durationMin,
      totalMarks: exam.totalMarks,
      showResults: exam.showResults,
      endsAt: exam.endsAt,
      subject: exam.subjectId,
      questions: exam.questions.map((q) => ({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        marks: q.marks,
        options: q.options,
      })),
    },
  });
});

const saveSchema = z.object({
  questionId: z.string().uuid(),
  answer: z.any().nullable(),
});
router.patch(
  "/:attemptId/answer",
  requireRoles("STUDENT"),
  async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: "Invalid answer" });
    const attemptId = routeParam(req.params.attemptId);
    const attempt = await prisma.examAttempt.findFirst({
      where: {
        id: attemptId,
        schoolId: req.auth!.schoolId!,
        studentUserId: req.auth!.userId,
        status: "IN_PROGRESS",
      },
      include: { exam: true },
    });
    if (!attempt)
      return res.status(404).json({ message: "Active attempt not found" });
    const question = await prisma.question.findFirst({
      where: { id: parsed.data.questionId, examId: attempt.examId },
    });
    if (!question)
      return res
        .status(400)
        .json({ message: "Question does not belong to this exam" });
    const now = new Date();
    if (attempt.exam.endsAt && now > attempt.exam.endsAt)
      return res.status(403).json({ message: "Exam has ended" });
    if (
      now.getTime() - attempt.startedAt.getTime() >
      attempt.exam.durationMin * 60_000
    )
      return res.status(403).json({ message: "Exam duration has expired" });
    const autoGradable = [
      "MCQ",
      "MULTI_SELECT",
      "TRUE_FALSE",
      "FILL_BLANK",
      "NUMERIC",
    ].includes(question.type);
    const autoScore =
      autoGradable &&
      question.correctAnswer != null &&
      normalize(parsed.data.answer) === normalize(question.correctAnswer)
        ? Number(question.marks)
        : autoGradable
          ? 0
          : null;
    const row = await prisma.studentAnswer.upsert({
      where: {
        attemptId_questionId: {
          attemptId: attempt.id,
          questionId: question.id,
        },
      },
      create: {
        attemptId: attempt.id,
        questionId: question.id,
        answer: parsed.data.answer,
        autoScore,
      },
      update: { answer: parsed.data.answer, autoScore },
    });
    res.json(row);
  },
);

router.post("/:attemptId/submit", requireRoles("STUDENT"), async (req, res) => {
  const attemptId = routeParam(req.params.attemptId);
  const attempt = await prisma.examAttempt.findFirst({
    where: {
      id: attemptId,
      schoolId: req.auth!.schoolId!,
      studentUserId: req.auth!.userId,
      status: "IN_PROGRESS",
    },
    include: { exam: { include: { questions: true } }, answers: true },
  });
  if (!attempt)
    return res.status(404).json({ message: "Active attempt not found" });
  const now = new Date();
  if (attempt.exam.endsAt && now > attempt.exam.endsAt)
    return res.status(403).json({ message: "Exam has ended" });
  if (
    now.getTime() - attempt.startedAt.getTime() >
    attempt.exam.durationMin * 60_000
  )
    return res.status(403).json({ message: "Exam duration has expired" });
  const manualNeeded = attempt.exam.questions.some(
    (q) =>
      !["MCQ", "MULTI_SELECT", "TRUE_FALSE", "FILL_BLANK", "NUMERIC"].includes(
        q.type,
      ),
  );
  const score = attempt.answers.reduce(
    (sum, a) => sum + Number(a.autoScore ?? 0),
    0,
  );
  const percentage =
    Number(attempt.exam.totalMarks) > 0
      ? (score / Number(attempt.exam.totalMarks)) * 100
      : 0;
  const passed =
    attempt.exam.passingMarks != null
      ? score >= Number(attempt.exam.passingMarks)
      : null;
  const status = manualNeeded ? "PENDING_REVIEW" : "GRADED";
  const updated = await prisma.examAttempt.update({
    where: { id: attempt.id },
    data: {
      status,
      submittedAt: new Date(),
      score,
      percentage,
      passed,
      gradedAt: manualNeeded ? null : new Date(),
    },
  });
  res.json(updated);
});

router.get(
  "/review",
  requireRoles("TEACHER", "PRINCIPAL"),
  async (req, res) => {
    const schoolId = req.auth!.schoolId!;
    const attempts = await prisma.examAttempt.findMany({
      where: {
        schoolId,
        status: "PENDING_REVIEW",
        ...(req.auth!.role === "TEACHER"
          ? { exam: { createdById: req.auth!.userId } }
          : {}),
      },
      orderBy: { submittedAt: "asc" },
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        exam: {
          select: {
            id: true,
            title: true,
            totalMarks: true,
            passingMarks: true,
            subject: { select: { name: true } },
          },
        },
        answers: { include: { question: true } },
      },
    });
    res.json(attempts);
  },
);

const gradeSchema = z.object({
  answers: z.array(
    z.object({
      answerId: z.string().uuid(),
      score: z.coerce.number().min(0),
      feedback: z.string().max(1000).optional(),
    }),
  ),
  teacherFeedback: z.string().max(2000).optional(),
});
router.patch(
  "/:attemptId/grade",
  requireRoles("TEACHER", "PRINCIPAL"),
  async (req, res) => {
    const parsed = gradeSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({
          message: "Invalid grading payload",
          issues: parsed.error.flatten(),
        });
    const schoolId = req.auth!.schoolId!,
      attemptId = routeParam(req.params.attemptId);
    const attempt = await prisma.examAttempt.findFirst({
      where: {
        id: attemptId,
        schoolId,
        ...(req.auth!.role === "TEACHER"
          ? { exam: { createdById: req.auth!.userId } }
          : {}),
      },
      include: { exam: true, answers: { include: { question: true } } },
    });
    if (!attempt) return res.status(404).json({ message: "Attempt not found" });
    for (const grade of parsed.data.answers) {
      const answer = attempt.answers.find((a) => a.id === grade.answerId);
      if (!answer)
        return res
          .status(400)
          .json({ message: "Answer does not belong to this attempt" });
      if (grade.score > Number(answer.question.marks))
        return res
          .status(400)
          .json({ message: "Score exceeds question marks" });
    }
    const updated = await prisma.$transaction(async (tx) => {
      for (const grade of parsed.data.answers)
        await tx.studentAnswer.update({
          where: { id: grade.answerId },
          data: { manualScore: grade.score, feedback: grade.feedback },
        });
      const fresh = await tx.studentAnswer.findMany({
        where: { attemptId: attempt.id },
      });
      const score = fresh.reduce(
        (sum, a) => sum + Number(a.manualScore ?? a.autoScore ?? 0),
        0,
      );
      const percentage =
        Number(attempt.exam.totalMarks) > 0
          ? (score / Number(attempt.exam.totalMarks)) * 100
          : 0;
      const passed =
        attempt.exam.passingMarks != null
          ? score >= Number(attempt.exam.passingMarks)
          : null;
      const row = await tx.examAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "GRADED",
          score,
          percentage,
          passed,
          teacherFeedback: parsed.data.teacherFeedback,
          gradedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          schoolId,
          actorId: req.auth!.userId,
          action: "EXAM_ATTEMPT_GRADED",
          entityType: "ExamAttempt",
          entityId: attempt.id,
          afterData: { score, percentage },
        },
      });
      return row;
    });
    res.json(updated);
  },
);

router.get(
  "/:attemptId/result",
  requireRoles("STUDENT", "PARENT", "TEACHER", "PRINCIPAL"),
  async (req, res) => {
    const schoolId = req.auth!.schoolId!,
      attemptId = routeParam(req.params.attemptId);
    const attempt = await prisma.examAttempt.findFirst({
      where: { id: attemptId, schoolId },
      include: {
        exam: { include: { subject: true, questions: true } },
        student: { select: { id: true, firstName: true, lastName: true } },
        answers: { include: { question: true } },
      },
    });
    if (!attempt) return res.status(404).json({ message: "Result not found" });
    if (
      req.auth!.role === "STUDENT" &&
      attempt.studentUserId !== req.auth!.userId
    )
      return res.status(403).json({ message: "Not your result" });
    if (req.auth!.role === "PARENT") {
      const parent = await prisma.parentProfile.findFirst({
        where: { schoolId, userId: req.auth!.userId },
        include: { students: { include: { student: true } } },
      });
      const allowed = parent?.students.some(
        (link) => link.student.userId === attempt.studentUserId,
      );
      if (!allowed)
        return res
          .status(403)
          .json({ message: "Student is not linked to this parent" });
    }
    if (
      attempt.status !== "GRADED" &&
      ["STUDENT", "PARENT"].includes(req.auth!.role)
    )
      return res.status(403).json({ message: "Result is not ready yet" });
    if (
      !attempt.exam.showResults &&
      ["STUDENT", "PARENT"].includes(req.auth!.role)
    )
      return res
        .status(403)
        .json({ message: "Results are hidden for this exam" });
    res.json(attempt);
  },
);

export default router;

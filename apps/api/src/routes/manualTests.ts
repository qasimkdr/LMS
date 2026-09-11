import { Router } from "express";
import { z } from "zod";
import { prisma } from "@nexora/database";
import { requireAuth, requireRoles, requireTenant } from "../middleware/auth.js";
import { routeParam } from "../utils/http.js";

const router = Router();
router.use(requireAuth, requireTenant);

const resultSchema = z.object({
  studentUserId: z.string().uuid(),
  questionMarks: z.array(z.coerce.number().min(0)).min(1).max(50),
  remarks: z.string().max(1000).optional(),
});
const testSchema = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  title: z.string().min(2).max(160),
  testType: z.enum(["WEEKLY", "MONTHLY"]),
  heldAt: z.coerce.date(),
  questionCount: z.coerce.number().int().min(1).max(50),
  marksPerQuestion: z.coerce.number().positive().max(100),
  results: z.array(resultSchema).min(1),
});

async function canManage(userId: string, role: string, schoolId: string, classId: string, subjectId: string) {
  const [klass, subject] = await Promise.all([
    prisma.class.findFirst({ where: { id: classId, schoolId }, select: { id: true } }),
    prisma.subject.findFirst({ where: { id: subjectId, schoolId }, select: { id: true } }),
  ]);
  if (!klass || !subject) return false;
  if (role === "PRINCIPAL") return true;
  return Boolean(await prisma.teacherAssignment.findFirst({ where: { schoolId, teacherId: userId, classId, subjectId } }));
}

const includeTest = {
  class: { select: { id: true, name: true, section: true } },
  subject: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  results: {
    include: { student: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { student: { firstName: "asc" as const } },
  },
};

router.get("/", requireRoles("PRINCIPAL", "TEACHER", "STUDENT", "PARENT"), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  if (req.auth!.role === "STUDENT") {
    const rows = await prisma.manualTest.findMany({
      where: { schoolId, results: { some: { studentUserId: req.auth!.userId } } },
      include: { ...includeTest, results: { where: { studentUserId: req.auth!.userId } } },
      orderBy: { heldAt: "desc" },
    });
    return res.json(rows);
  }
  if (req.auth!.role === "PARENT") return res.status(403).json({ message: "Parent manual-test view is not available yet" });
  const where = req.auth!.role === "TEACHER" ? { schoolId, createdById: req.auth!.userId } : { schoolId };
  res.json(await prisma.manualTest.findMany({ where, include: includeTest, orderBy: { heldAt: "desc" } }));
});

router.get("/roster", requireRoles("PRINCIPAL", "TEACHER"), async (req, res) => {
  const classId = typeof req.query.classId === "string" ? req.query.classId : "";
  const subjectId = typeof req.query.subjectId === "string" ? req.query.subjectId : "";
  const schoolId = req.auth!.schoolId!;
  if (!classId || !subjectId || !(await canManage(req.auth!.userId, req.auth!.role, schoolId, classId, subjectId)))
    return res.status(403).json({ message: "You are not assigned to this class and subject" });
  const students = await prisma.studentProfile.findMany({
    where: { schoolId, classId, user: { isActive: true } },
    select: { admissionNo: true, user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { admissionNo: "asc" },
  });
  res.json(students.map((row) => ({ ...row.user, admissionNo: row.admissionNo })));
});

function normalizeResults(results: z.infer<typeof resultSchema>[], questionCount: number, marksPerQuestion: number) {
  return results.map((result) => {
    if (result.questionMarks.length !== questionCount) throw new Error("QUESTION_COUNT_MISMATCH");
    if (result.questionMarks.some((mark) => mark > marksPerQuestion)) throw new Error("QUESTION_MARKS_EXCEEDED");
    const score = result.questionMarks.reduce((sum, mark) => sum + mark, 0);
    return { ...result, score, correctAnswers: result.questionMarks.filter((mark) => mark === marksPerQuestion).length };
  });
}

router.post("/", requireRoles("PRINCIPAL", "TEACHER"), async (req, res) => {
  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid manual test", issues: parsed.error.flatten() });
  const d = parsed.data;
  const schoolId = req.auth!.schoolId!;
  if (!(await canManage(req.auth!.userId, req.auth!.role, schoolId, d.classId, d.subjectId)))
    return res.status(403).json({ message: "You are not assigned to this class and subject" });
  const roster = await prisma.studentProfile.findMany({ where: { schoolId, classId: d.classId, userId: { in: d.results.map((x) => x.studentUserId) } }, select: { userId: true } });
  if (roster.length !== new Set(d.results.map((x) => x.studentUserId)).size)
    return res.status(400).json({ message: "One or more students are outside this class" });
  let results;
  try { results = normalizeResults(d.results, d.questionCount, d.marksPerQuestion); }
  catch (error) {
    return res.status(400).json({ message: error instanceof Error && error.message === "QUESTION_COUNT_MISMATCH" ? "Every student must have marks for every question" : "A question mark exceeds the allowed maximum" });
  }
  const row = await prisma.$transaction(async (tx) => {
    const test = await tx.manualTest.create({ data: { schoolId, classId: d.classId, subjectId: d.subjectId, createdById: req.auth!.userId, title: d.title, testType: d.testType, heldAt: d.heldAt, questionCount: d.questionCount, marksPerQuestion: d.marksPerQuestion, totalMarks: d.questionCount * d.marksPerQuestion } });
    await tx.manualTestResult.createMany({ data: results.map((x) => ({ manualTestId: test.id, studentUserId: x.studentUserId, correctAnswers: x.correctAnswers, score: x.score, questionMarks: x.questionMarks, remarks: x.remarks })) });
    await tx.notification.createMany({ data: results.map((x) => ({ schoolId, userId: x.studentUserId, title: `${d.testType === "WEEKLY" ? "Weekly" : "Monthly"} test result`, body: d.title, link: "/student/manual-tests" })) });
    await tx.auditLog.create({ data: { schoolId, actorId: req.auth!.userId, action: "MANUAL_TEST_CREATED", entityType: "ManualTest", entityId: test.id, afterData: { title: d.title, testType: d.testType, questionCount: d.questionCount, totalMarks: d.questionCount * d.marksPerQuestion } } });
    return test;
  });
  res.status(201).json(row);
});

router.patch("/:id", requireRoles("PRINCIPAL", "TEACHER"), async (req, res) => {
  const id = routeParam(req.params.id);
  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid manual test update" });
  const schoolId = req.auth!.schoolId!, d = parsed.data;
  const existing = await prisma.manualTest.findFirst({ where: { id, schoolId } });
  if (!existing) return res.status(404).json({ message: "Manual test not found" });
  if (req.auth!.role === "TEACHER" && existing.createdById !== req.auth!.userId) return res.status(403).json({ message: "Teachers can edit only their own tests" });
  if (!(await canManage(req.auth!.userId, req.auth!.role, schoolId, d.classId, d.subjectId))) return res.status(403).json({ message: "Not allowed for this class and subject" });
  let results;
  try { results = normalizeResults(d.results, d.questionCount, d.marksPerQuestion); }
  catch { return res.status(400).json({ message: "Question marks are incomplete or exceed the allowed maximum" }); }
  await prisma.$transaction(async (tx) => {
    await tx.manualTest.update({ where: { id }, data: { classId: d.classId, subjectId: d.subjectId, title: d.title, testType: d.testType, heldAt: d.heldAt, questionCount: d.questionCount, marksPerQuestion: d.marksPerQuestion, totalMarks: d.questionCount * d.marksPerQuestion } });
    await tx.manualTestResult.deleteMany({ where: { manualTestId: id } });
    await tx.manualTestResult.createMany({ data: results.map((x) => ({ manualTestId: id, studentUserId: x.studentUserId, correctAnswers: x.correctAnswers, score: x.score, questionMarks: x.questionMarks, remarks: x.remarks })) });
    await tx.auditLog.create({ data: { schoolId, actorId: req.auth!.userId, action: "MANUAL_TEST_UPDATED", entityType: "ManualTest", entityId: id } });
  });
  res.json({ id });
});

router.delete("/:id", requireRoles("PRINCIPAL", "TEACHER"), async (req, res) => {
  const id = routeParam(req.params.id), schoolId = req.auth!.schoolId!;
  const row = await prisma.manualTest.findFirst({ where: { id, schoolId } });
  if (!row) return res.status(404).json({ message: "Manual test not found" });
  if (req.auth!.role === "TEACHER" && row.createdById !== req.auth!.userId) return res.status(403).json({ message: "Teachers can delete only their own tests" });
  await prisma.$transaction([prisma.manualTest.delete({ where: { id } }), prisma.auditLog.create({ data: { schoolId, actorId: req.auth!.userId, action: "MANUAL_TEST_DELETED", entityType: "ManualTest", entityId: id } })]);
  res.status(204).end();
});

export default router;

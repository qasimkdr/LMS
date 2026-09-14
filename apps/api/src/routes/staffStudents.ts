import { Router } from "express";
import { z } from "zod";
import { prisma } from "@nexora/database";
import {
  requireAuth,
  requireRoles,
  requireTenant,
} from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireTenant, requireRoles("STAFF"));

const updateSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(1),
  email: z.string().email(),
  admissionNo: z.string().min(1),
  classId: z.string().uuid(),
  guardianPhone: z.string().max(40).nullable().optional(),
  cnic: z.string().max(30).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  alternatePhone: z.string().max(40).nullable().optional(),
  whatsappNo: z.string().max(40).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).nullable().optional(),
  profileData: z.record(z.string(), z.unknown()).optional(),
  note: z.string().max(1000).optional(),
});

router.get("/", async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const [students, classes] = await Promise.all([
    prisma.studentProfile.findMany({
      where: { schoolId },
      orderBy: { user: { firstName: "asc" } },
      include: {
        user: true,
        class: {
          select: { id: true, name: true, section: true, academicYear: true },
        },
      },
    }),
    prisma.class.findMany({
      where: { schoolId },
      orderBy: [{ name: "asc" }, { section: "asc" }],
    }),
  ]);
  res.json({ students, classes });
});

router.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({
        message: "Invalid student update",
        issues: parsed.error.flatten(),
      });
  const schoolId = req.auth!.schoolId!;
  const student = await prisma.studentProfile.findFirst({
    where: { id: req.params.id as string, schoolId },
    include: { user: true },
  });
  if (!student) return res.status(404).json({ message: "Student not found" });
  const klass = await prisma.class.findFirst({
    where: { id: parsed.data.classId, schoolId },
  });
  if (!klass)
    return res
      .status(400)
      .json({ message: "Select a valid class from this school" });
  const duplicate = await prisma.studentProfile.findFirst({
    where: {
      schoolId,
      id: { not: student.id },
      OR: [
        { admissionNo: parsed.data.admissionNo },
        { user: { email: parsed.data.email.toLowerCase() } },
      ],
    },
  });
  if (duplicate)
    return res.status(409).json({ message: "Email or admission number is already in use" });
  const policy = await prisma.approvalPolicy.findUnique({
    where: { schoolId_actionKey: { schoolId, actionKey: "EDIT_STUDENT" } },
  });
  if (policy && !policy.staffAllowed)
    return res
      .status(403)
      .json({ message: "Staff student editing is disabled by the Principal" });
  const { note, ...proposedData } = parsed.data;
  const existing = await prisma.approvalRequest.findFirst({
    where: {
      schoolId,
      requesterId: req.auth!.userId,
      requestType: "STUDENT_UPDATE",
      entityId: student.id,
      status: { in: ["PENDING", "RESUBMITTED", "REVISION_REQUIRED"] },
    },
  });
  if (existing && existing.status !== "REVISION_REQUIRED")
    return res
      .status(409)
      .json({
        message:
          "An update for this student is already awaiting Principal review",
      });
  const request = await prisma.$transaction(async (tx) => {
    if (existing?.status === "REVISION_REQUIRED") {
      const revision = existing.revision + 1;
      const revised = await tx.approvalRequest.update({
        where: { id: existing.id },
        data: { proposedData: proposedData as any, revision, status: "RESUBMITTED", submittedAt: new Date(), principalRemark: null },
      });
      await tx.approvalVersion.create({ data: { approvalRequestId: existing.id, revision, proposedData: proposedData as any, note } });
      await tx.auditLog.create({ data: { schoolId, actorId: req.auth!.userId, action: "STUDENT_UPDATE_RESUBMITTED", entityType: "ApprovalRequest", entityId: existing.id, afterData: proposedData as any } });
      return revised;
    }
    const created = await tx.approvalRequest.create({
      data: {
        schoolId,
        requesterId: req.auth!.userId,
        requestType: "STUDENT_UPDATE",
        entityType: "StudentProfile",
        entityId: student.id,
        proposedData: proposedData as any,
        status: "PENDING",
        submittedAt: new Date(),
      },
    });
    await tx.approvalVersion.create({
      data: {
        approvalRequestId: created.id,
        revision: 1,
        proposedData: proposedData as any,
        note,
      },
    });
    await tx.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: "STUDENT_UPDATE_SUBMITTED",
        entityType: "ApprovalRequest",
        entityId: created.id,
        beforeData: {
          studentId: student.id,
          firstName: student.user.firstName,
          lastName: student.user.lastName,
        },
        afterData: proposedData as any,
      },
    });
    return created;
  });
  res.status(202).json({ approvalRequired: true, request });
});

export default router;

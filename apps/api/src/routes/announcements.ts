import { Router } from "express";
import { z } from "zod";
import { prisma } from "@nexora/database";
import {
  requireAuth,
  requireRoles,
  requireTenant,
} from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireTenant);

const createSchema = z.object({
  title: z.string().min(2),
  body: z.string().min(2).max(5000),
  audience: z
    .array(z.enum(["PRINCIPAL", "STAFF", "TEACHER", "STUDENT", "PARENT"]))
    .min(1),
  classId: z.string().uuid().optional(),
  publishAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  isPinned: z.boolean().optional(),
});

router.get("/manage", requireRoles("PRINCIPAL", "STAFF"), async (req, res) => {
  const rows = await prisma.announcement.findMany({
    where: { schoolId: req.auth!.schoolId! },
    include: { class: { select: { name: true, section: true } } },
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  res.json(rows);
});

router.get("/", async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const now = new Date();
  const role = req.auth!.role;
  const where: any = {
    schoolId,
    OR: [{ publishAt: null }, { publishAt: { lte: now } }],
    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }],
  };
  if (!["PRINCIPAL", "STAFF"].includes(role)) where.audience = { has: role };
  const rows = await prisma.announcement.findMany({
    where,
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
  res.json(rows);
});

router.post("/", requireRoles("PRINCIPAL", "STAFF"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({
        message: "Invalid announcement",
        issues: parsed.error.flatten(),
      });
  const schoolId = req.auth!.schoolId!;
  if (parsed.data.classId) {
    const classExists = await prisma.class.count({
      where: { id: parsed.data.classId, schoolId },
    });
    if (!classExists)
      return res
        .status(400)
        .json({ message: "Class target does not belong to this school" });
  }
  const policy = await prisma.approvalPolicy.findUnique({
    where: {
      schoolId_actionKey: { schoolId, actionKey: "ANNOUNCEMENT_PUBLISH" },
    },
  });
  if (req.auth!.role === "STAFF" && policy && !policy.staffAllowed)
    return res
      .status(403)
      .json({ message: "Staff are not allowed to publish announcements" });
  if (req.auth!.role === "STAFF" && policy?.requiresApproval) {
    const request = await prisma.$transaction(async (tx) => {
      const r = await tx.approvalRequest.create({
        data: {
          schoolId,
          requesterId: req.auth!.userId,
          requestType: "ANNOUNCEMENT_PUBLISH",
          entityType: "Announcement",
          proposedData: parsed.data,
          status: "PENDING",
          submittedAt: new Date(),
        },
      });
      await tx.approvalVersion.create({
        data: {
          approvalRequestId: r.id,
          revision: 1,
          proposedData: parsed.data,
        },
      });
      return r;
    });
    return res.status(202).json({ approvalRequired: true, request });
  }
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.announcement.create({
      data: { schoolId, createdById: req.auth!.userId, ...parsed.data },
    });
    const direct = await tx.user.findMany({
      where: { schoolId, isActive: true, role: { in: parsed.data.audience } },
      select: { id: true, role: true },
    });
    let recipientIds = direct
      .filter(
        (user) =>
          !parsed.data.classId || !["STUDENT", "PARENT"].includes(user.role),
      )
      .map((user) => user.id);
    if (parsed.data.classId) {
      const students = await tx.studentProfile.findMany({
        where: { schoolId, classId: parsed.data.classId },
        select: {
          userId: true,
          parentLinks: { select: { parent: { select: { userId: true } } } },
        },
      });
      if (parsed.data.audience.includes("STUDENT"))
        recipientIds.push(...students.map((student) => student.userId));
      if (parsed.data.audience.includes("PARENT"))
        recipientIds.push(
          ...students.flatMap((student) =>
            student.parentLinks.map((link) => link.parent.userId),
          ),
        );
    }
    recipientIds = [...new Set(recipientIds)].filter(
      (id) => id !== req.auth!.userId,
    );
    if (recipientIds.length)
      await tx.notification.createMany({
        data: recipientIds.map((userId) => ({
          schoolId,
          userId,
          title: parsed.data.title,
          body: parsed.data.body.slice(0, 500),
          link: `/${direct.find((user) => user.id === userId)?.role?.toLowerCase() ?? "student"}`,
        })),
      });
    await tx.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: "ANNOUNCEMENT_CREATED",
        entityType: "Announcement",
        entityId: created.id,
      },
    });
    return created;
  });
  res.status(201).json(row);
});

router.patch("/:id", requireRoles("PRINCIPAL", "STAFF"), async (req, res) => {
  const parsed = createSchema.partial().safeParse(req.body),
    schoolId = req.auth!.schoolId!,
    id = req.params.id as string;
  if (!parsed.success)
    return res
      .status(400)
      .json({
        message: "Invalid announcement update",
        issues: parsed.error.flatten(),
      });
  const before = await prisma.announcement.findFirst({
    where: { id, schoolId },
  });
  if (!before)
    return res.status(404).json({ message: "Announcement not found" });
  if (req.auth!.role === "STAFF" && before.createdById !== req.auth!.userId)
    return res
      .status(403)
      .json({ message: "Staff can edit only their own announcements" });
  if (
    parsed.data.classId &&
    !(await prisma.class.findFirst({
      where: { id: parsed.data.classId, schoolId },
    }))
  )
    return res.status(400).json({ message: "Invalid class target" });
  const row = await prisma.announcement.update({
    where: { id },
    data: parsed.data,
  });
  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: "ANNOUNCEMENT_UPDATED",
      entityType: "Announcement",
      entityId: id,
      beforeData: { title: before.title, audience: before.audience },
      afterData: parsed.data,
    },
  });
  res.json(row);
});

router.delete("/:id", requireRoles("PRINCIPAL", "STAFF"), async (req, res) => {
  const schoolId = req.auth!.schoolId!,
    id = req.params.id as string,
    before = await prisma.announcement.findFirst({ where: { id, schoolId } });
  if (!before)
    return res.status(404).json({ message: "Announcement not found" });
  if (req.auth!.role === "STAFF" && before.createdById !== req.auth!.userId)
    return res
      .status(403)
      .json({ message: "Staff can delete only their own announcements" });
  await prisma.$transaction([
    prisma.announcement.delete({ where: { id } }),
    prisma.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: "ANNOUNCEMENT_DELETED",
        entityType: "Announcement",
        entityId: id,
        beforeData: { title: before.title, audience: before.audience },
      },
    }),
  ]);
  res.status(204).end();
});

export default router;

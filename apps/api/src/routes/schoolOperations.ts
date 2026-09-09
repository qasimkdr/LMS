import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@nexora/database";
import {
  requireAuth,
  requireRoles,
  requireTenant,
} from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireTenant, requireRoles("PRINCIPAL"));

router.get("/overview", async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const [school, users, students, classes, subjects] = await Promise.all([
    prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        description: true,
        phone: true,
        email: true,
        address: true,
        timezone: true,
        primaryColor: true,
        secondaryColor: true,
        status: true,
      },
    }),
    prisma.user.findMany({
      where: { schoolId, role: { in: ["PRINCIPAL", "STAFF", "TEACHER"] } },
      select: {
        id: true,
        role: true,
        firstName: true,
        lastName: true,
        email: true,
        username: true,
        isActive: true,
        avatarUrl: true,
      },
      orderBy: [{ role: "asc" }, { firstName: "asc" }],
    }),
    prisma.studentProfile.findMany({
      where: { schoolId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            isActive: true,
          },
        },
        class: { select: { id: true, name: true, section: true } },
      },
      orderBy: { admissionNo: "asc" },
    }),
    prisma.class.findMany({
      where: { schoolId },
      orderBy: [{ name: "asc" }, { section: "asc" }],
    }),
    prisma.subject.findMany({ where: { schoolId }, orderBy: { name: "asc" } }),
  ]);
  res.json({ school, users, students, classes, subjects });
});

router.get("/people", async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const query = z
    .object({
      q: z.string().max(100).optional(),
      role: z.enum(["ALL", "STUDENT", "TEACHER", "STAFF"]).default("ALL"),
      status: z.enum(["ALL", "ACTIVE", "INACTIVE"]).default("ALL"),
      cursor: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(6).max(30).default(12),
    })
    .safeParse(req.query);
  if (!query.success)
    return res.status(400).json({ message: "Invalid people filters" });
  const { q, role, status, cursor, limit } = query.data;
  const rows = await prisma.user.findMany({
    where: {
      schoolId,
      role: { in: role === "ALL" ? ["STUDENT", "TEACHER", "STAFF"] : [role] },
      ...(status === "ALL" ? {} : { isActive: status === "ACTIVE" }),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
              { cnic: { contains: q, mode: "insensitive" } },
              {
                studentProfile: {
                  admissionNo: { contains: q, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      role: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      cnic: true,
      avatarUrl: true,
      isActive: true,
      createdAt: true,
      studentProfile: {
        select: {
          id: true,
          admissionNo: true,
          class: { select: { id: true, name: true, section: true } },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  res.json({ items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null });
});

router.get("/people/:id", async (req, res) => {
  const row = await prisma.user.findFirst({
    where: { id: req.params.id as string, schoolId: req.auth!.schoolId! },
    select: {
      id: true,
      role: true,
      firstName: true,
      lastName: true,
      email: true,
      username: true,
      avatarUrl: true,
      cnic: true,
      phone: true,
      alternatePhone: true,
      whatsappNo: true,
      address: true,
      dateOfBirth: true,
      gender: true,
      profileData: true,
      isActive: true,
      createdAt: true,
      studentProfile: {
        include: { class: { select: { id: true, name: true, section: true } } },
      },
    },
  });
  if (!row) return res.status(404).json({ message: "Person not found" });
  res.json(row);
});

const profileDataSchema = z.record(z.string(), z.unknown()).optional();
const commonPersonFields = {
  avatarUrl: z
    .string()
    .regex(/^storage:\/\/[0-9a-f-]+$/i)
    .optional(),
  cnic: z.string().max(30).optional(),
  phone: z.string().max(40).optional(),
  alternatePhone: z.string().max(40).optional(),
  whatsappNo: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.string().max(40).optional(),
  profileData: profileDataSchema,
};
const personSchema = z.object({
  role: z.enum(["STAFF", "TEACHER"]),
  firstName: z.string().min(2),
  lastName: z.string().min(1),
  email: z.string().email(),
  username: z.string().min(3),
  password: z.string().min(8),
  ...commonPersonFields,
});
const personUpdateSchema = personSchema
  .omit({ password: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });
router.post("/users", async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const parsed = personSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ message: "Invalid user data", issues: parsed.error.flatten() });
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = await prisma.user.create({
    data: {
      schoolId,
      role: parsed.data.role,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email.toLowerCase(),
      username: parsed.data.username,
      passwordHash,
    },
  });
  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: "SCHOOL_USER_CREATED",
      entityType: "User",
      entityId: user.id,
      afterData: { role: user.role, email: user.email },
    },
  });
  res.status(201).json(user);
});
router.patch("/users/:id", async (req, res) => {
  const schoolId = req.auth!.schoolId!,
    id = req.params.id as string,
    parsed = personUpdateSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ message: "Invalid user update", issues: parsed.error.flatten() });
  const before = await prisma.user.findFirst({
    where: { id, schoolId, role: { in: ["STAFF", "TEACHER"] } },
  });
  if (!before)
    return res
      .status(404)
      .json({ message: "Teacher or staff member not found" });
  const data = {
    ...parsed.data,
    ...(parsed.data.email ? { email: parsed.data.email.toLowerCase() } : {}),
  };
  const user = await prisma.user.update({ where: { id }, data: data as any });
  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: "SCHOOL_USER_UPDATED",
      entityType: "User",
      entityId: id,
      beforeData: {
        role: before.role,
        email: before.email,
        isActive: before.isActive,
      },
      afterData: data as any,
    },
  });
  res.json(user);
});
router.delete("/users/:id", async (req, res) => {
  const schoolId = req.auth!.schoolId!,
    id = req.params.id as string;
  const user = await prisma.user.findFirst({
    where: { id, schoolId, role: { in: ["STAFF", "TEACHER"] } },
  });
  if (!user)
    return res
      .status(404)
      .json({ message: "Teacher or staff member not found" });
  const [assignments, attendance, approvals] = await Promise.all([
    prisma.teacherAssignment.count({ where: { teacherId: id } }),
    prisma.attendanceSession.count({ where: { markedById: id } }),
    prisma.approvalRequest.count({ where: { requesterId: id } }),
  ]);
  if (assignments || attendance || approvals)
    return res.status(409).json({
      message:
        "This account has school records. Deactivate it instead of deleting it.",
    });
  await prisma.$transaction([
    prisma.user.delete({ where: { id } }),
    prisma.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: "SCHOOL_USER_DELETED",
        entityType: "User",
        entityId: id,
        beforeData: { role: user.role, email: user.email },
      },
    }),
  ]);
  res.status(204).end();
});

const classSchema = z.object({
  name: z.string().min(1),
  section: z.string().optional(),
  academicYear: z.string().optional(),
});
router.post("/classes", async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const parsed = classSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ message: "Invalid class data" });
  const row = await prisma.class.create({ data: { schoolId, ...parsed.data } });
  res.status(201).json(row);
});
router.patch("/classes/:id", async (req, res) => {
  const schoolId = req.auth!.schoolId!,
    id = req.params.id as string,
    p = classSchema.partial().safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ message: "Invalid class update" });
  const before = await prisma.class.findFirst({ where: { id, schoolId } });
  if (!before) return res.status(404).json({ message: "Class not found" });
  const row = await prisma.class.update({ where: { id }, data: p.data });
  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: "CLASS_UPDATED",
      entityType: "Class",
      entityId: id,
      beforeData: before,
      afterData: p.data,
    },
  });
  res.json(row);
});
router.delete("/classes/:id", async (req, res) => {
  const schoolId = req.auth!.schoolId!,
    id = req.params.id as string,
    row = await prisma.class.findFirst({
      where: { id, schoolId },
      include: {
        _count: {
          select: {
            students: true,
            assignments: true,
            attendanceSessions: true,
            exams: true,
            coursework: true,
          },
        },
      },
    });
  if (!row) return res.status(404).json({ message: "Class not found" });
  if (Object.values(row._count).some(Boolean))
    return res.status(409).json({
      message:
        "Class is in use. Move or remove its students and academic records first.",
    });
  await prisma.class.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: "CLASS_DELETED",
      entityType: "Class",
      entityId: id,
      beforeData: { name: row.name, section: row.section },
    },
  });
  res.status(204).end();
});

const subjectSchema = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
});
router.post("/subjects", async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const parsed = subjectSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ message: "Invalid subject data" });
  const row = await prisma.subject.create({
    data: { schoolId, ...parsed.data },
  });
  res.status(201).json(row);
});
router.patch("/subjects/:id", async (req, res) => {
  const schoolId = req.auth!.schoolId!,
    id = req.params.id as string,
    p = subjectSchema.partial().safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ message: "Invalid subject update" });
  const before = await prisma.subject.findFirst({ where: { id, schoolId } });
  if (!before) return res.status(404).json({ message: "Subject not found" });
  const row = await prisma.subject.update({ where: { id }, data: p.data });
  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: "SUBJECT_UPDATED",
      entityType: "Subject",
      entityId: id,
      beforeData: before,
      afterData: p.data,
    },
  });
  res.json(row);
});
router.delete("/subjects/:id", async (req, res) => {
  const schoolId = req.auth!.schoolId!,
    id = req.params.id as string,
    row = await prisma.subject.findFirst({
      where: { id, schoolId },
      include: {
        _count: {
          select: {
            assignments: true,
            exams: true,
            coursework: true,
            materials: true,
            syllabusItems: true,
          },
        },
      },
    });
  if (!row) return res.status(404).json({ message: "Subject not found" });
  if (Object.values(row._count).some(Boolean))
    return res.status(409).json({
      message:
        "Subject is in use. Remove its assignments and learning records first.",
    });
  await prisma.subject.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: "SUBJECT_DELETED",
      entityType: "Subject",
      entityId: id,
      beforeData: { name: row.name, code: row.code },
    },
  });
  res.status(204).end();
});

const studentSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(1),
  email: z.string().email(),
  username: z.string().min(3),
  password: z.string().min(8),
  admissionNo: z.string().min(1),
  classId: z.string().uuid().optional(),
  section: z.string().optional(),
  guardianPhone: z.string().optional(),
  ...commonPersonFields,
});
router.post("/students", async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const parsed = studentSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      message: "Invalid student data",
      issues: parsed.error.flatten(),
    });
  const {
    admissionNo,
    classId,
    section,
    guardianPhone,
    password,
    profileData,
    ...userData
  } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);
  const student = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        schoolId,
        role: "STUDENT",
        ...userData,
        email: userData.email.toLowerCase(),
        passwordHash,
        profileData: profileData as any,
      },
    });
    const profile = await tx.studentProfile.create({
      data: {
        schoolId,
        userId: user.id,
        admissionNo,
        classId,
        section,
        guardianPhone,
      },
    });
    await tx.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: "STUDENT_CREATED",
        entityType: "StudentProfile",
        entityId: profile.id,
        afterData: { admissionNo, classId: classId ?? null },
      },
    });
    return profile;
  });
  res.status(201).json(student);
});
const studentUpdateSchema = z.object({
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  admissionNo: z.string().min(1).optional(),
  classId: z.string().uuid().nullable().optional(),
  section: z.string().nullable().optional(),
  guardianPhone: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  ...commonPersonFields,
});
router.patch("/students/:id", async (req, res) => {
  const schoolId = req.auth!.schoolId!,
    id = req.params.id as string,
    p = studentUpdateSchema.safeParse(req.body);
  if (!p.success)
    return res
      .status(400)
      .json({ message: "Invalid student update", issues: p.error.flatten() });
  const before = await prisma.studentProfile.findFirst({
    where: { id, schoolId },
    include: { user: true },
  });
  if (!before) return res.status(404).json({ message: "Student not found" });
  if (
    p.data.classId &&
    !(await prisma.class.findFirst({ where: { id: p.data.classId, schoolId } }))
  )
    return res
      .status(400)
      .json({ message: "Class does not belong to this school" });
  const {
    firstName,
    lastName,
    email,
    isActive,
    avatarUrl,
    cnic,
    phone,
    alternatePhone,
    whatsappNo,
    address,
    dateOfBirth,
    gender,
    profileData,
    ...profile
  } = p.data;
  const row = await prisma.$transaction(async (tx) => {
    if (
      firstName !== undefined ||
      lastName !== undefined ||
      email !== undefined ||
      isActive !== undefined ||
      avatarUrl !== undefined ||
      cnic !== undefined ||
      phone !== undefined ||
      alternatePhone !== undefined ||
      whatsappNo !== undefined ||
      address !== undefined ||
      dateOfBirth !== undefined ||
      gender !== undefined ||
      profileData !== undefined
    )
      await tx.user.update({
        where: { id: before.userId },
        data: {
          firstName,
          lastName,
          email: email?.toLowerCase(),
          isActive,
          avatarUrl,
          cnic,
          phone,
          alternatePhone,
          whatsappNo,
          address,
          dateOfBirth,
          gender,
          profileData: profileData as any,
        },
      });
    const updated = await tx.studentProfile.update({
      where: { id },
      data: profile,
    });
    await tx.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: "STUDENT_UPDATED",
        entityType: "StudentProfile",
        entityId: id,
        beforeData: {
          admissionNo: before.admissionNo,
          classId: before.classId,
          isActive: before.user.isActive,
        },
        afterData: p.data as any,
      },
    });
    return updated;
  });
  res.json(row);
});
router.delete("/students/:id", async (req, res) => {
  const schoolId = req.auth!.schoolId!,
    id = req.params.id as string,
    row = await prisma.studentProfile.findFirst({
      where: { id, schoolId },
      include: {
        user: true,
        _count: { select: { attendanceRecords: true, parentLinks: true } },
      },
    });
  if (!row) return res.status(404).json({ message: "Student not found" });
  const attempts = await prisma.examAttempt.count({
      where: { studentUserId: row.userId },
    }),
    submissions = await prisma.assignmentSubmission.count({
      where: { studentUserId: row.userId },
    });
  if (attempts || submissions || row._count.attendanceRecords)
    return res.status(409).json({
      message:
        "Student has academic history. Deactivate the account instead of deleting it.",
    });
  await prisma.$transaction([
    prisma.user.delete({ where: { id: row.userId } }),
    prisma.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: "STUDENT_DELETED",
        entityType: "StudentProfile",
        entityId: id,
        beforeData: { admissionNo: row.admissionNo, email: row.user.email },
      },
    }),
  ]);
  res.status(204).end();
});

const logoRef = z
  .string()
  .refine(
    (v) => v.startsWith("storage://") || /^https?:\/\//i.test(v),
    "Logo must be a secure storage reference or http(s) URL",
  );
const brandingSchema = z.object({
  name: z.string().min(2).optional(),
  logoUrl: logoRef.nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  timezone: z.string().min(2).optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  secondaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});
router.patch("/school", async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const parsed = brandingSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      message: "Invalid school settings",
      issues: parsed.error.flatten(),
    });
  const before = await prisma.school.findUnique({ where: { id: schoolId } });
  const school = await prisma.school.update({
    where: { id: schoolId },
    data: parsed.data,
  });
  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: "SCHOOL_PROFILE_UPDATED",
      entityType: "School",
      entityId: schoolId,
      beforeData: before
        ? {
            name: before.name,
            logoUrl: before.logoUrl,
            primaryColor: before.primaryColor,
            secondaryColor: before.secondaryColor,
          }
        : undefined,
      afterData: parsed.data,
    },
  });
  res.json(school);
});

export default router;

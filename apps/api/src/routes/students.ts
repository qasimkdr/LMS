import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optStr, parse } from '../lib/validate';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { assertCan, can } from '../lib/http';
import { toNum } from '../lib/money';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { deleteSchoolFile } from '../services/files';
import { teacherSectionIds } from '../services/teacherScope';
import {
  assertStudentCapacity,
  checkRequiredFields,
  checkStudentRefs,
  createStudent,
  createStudentSchema,
  findFamilies,
  guardianSchema,
  normalizeGuardians,
  studentFieldsSchema,
  syncLoginsForStatus,
} from '../services/students';
import { requiredFieldsOf } from './setup';
import { prepareSecrets } from '../lib/password';
import { CHECKLIST_DOCUMENTS, STUDENT_DOCUMENT_TYPES } from '../config/studentFields';

const router = Router();
const RESTORE_DAYS = 30;

/** Principal/staff with students.view see everyone; teachers see only their sections. */
async function scopeWhere(req: Request): Promise<Prisma.StudentWhereInput> {
  const schoolId = tenantId(req);
  if (can(req, 'students.view')) return { schoolId };
  if (req.user!.role === 'TEACHER') return { schoolId, sectionId: { in: await teacherSectionIds(schoolId, req.user!.id) } };
  throw forbidden();
}

async function loadStudent(req: Request, id: string) {
  const student = await prisma.student.findFirst({ where: { id, deletedAt: null, ...(await scopeWhere(req)) } });
  if (!student) throw notFound('Student not found');
  return student;
}

const listSelect = {
  id: true,
  admissionNo: true,
  rollNo: true,
  fullName: true,
  gender: true,
  dob: true,
  status: true,
  photoFileId: true,
  admissionDate: true,
  class: { select: { id: true, name: true, stream: true } },
  section: { select: { id: true, name: true } },
  family: {
    select: {
      id: true,
      familyNo: true,
      guardians: { select: { relation: true, fullName: true, phone: true, whatsapp: true, receivesMessages: true } },
    },
  },
} satisfies Prisma.StudentSelect;

router.get(
  '/',
  ah(async (req, res) => {
    const q = parse(
      z.object({
        q: z.string().trim().max(100).optional(),
        classId: z.string().optional(),
        sectionId: z.string().optional(),
        status: z.enum(['ACTIVE', 'LEFT', 'STRUCK_OFF', 'GRADUATED', 'TRANSFERRED', 'ALL']).default('ACTIVE'),
        gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(10).max(200).default(50),
      }),
      req.query,
    );
    const scope = await scopeWhere(req);
    const where: Prisma.StudentWhereInput = {
      AND: [
        scope,
        { deletedAt: null },
        q.status === 'ALL' ? {} : { status: q.status },
        q.classId ? { classId: q.classId } : {},
        q.sectionId ? { sectionId: q.sectionId } : {},
        q.gender ? { gender: q.gender } : {},
        q.q
          ? {
              OR: [
                { fullName: { contains: q.q } },
                { admissionNo: { contains: q.q } },
                { rollNo: q.q },
                { bForm: { contains: q.q } },
                { family: { guardians: { some: { OR: [{ fullName: { contains: q.q } }, { phone: { contains: q.q } }, { whatsapp: { contains: q.q } }, { cnic: { contains: q.q } }] } } } },
              ],
            }
          : {},
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.student.findMany({
        where,
        select: listSelect,
        orderBy: [{ class: { sortOrder: 'asc' } }, { section: { name: 'asc' } }, { rollNo: 'asc' }, { fullName: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.student.count({ where }),
    ]);
    res.json({ students: rows, total, page: q.page, pageSize: q.pageSize });
  }),
);

router.get(
  '/sibling-lookup',
  ah(async (req, res) => {
    assertCan(req, 'students.manage');
    const q = parse(z.object({ cnic: z.string().trim().max(20).optional(), phone: z.string().trim().max(30).optional() }), req.query);
    const families = await findFamilies(tenantId(req), {
      cnic: q.cnic?.replace(/^(\d{5})-?(\d{7})-?(\d)$/, '$1-$2-$3'),
      phone: q.phone?.replace(/[ \-]/g, ''),
    });
    res.json({ families });
  }),
);

router.post(
  '/',
  ah(async (req, res) => {
    assertCan(req, 'students.manage');
    const schoolId = tenantId(req);
    const input = parse(createStudentSchema, req.body);
    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    checkRequiredFields(requiredFieldsOf(school.settings), input.student, input.guardians, Boolean(input.familyId));
    await checkStudentRefs(schoolId, input.student);
    await assertStudentCapacity(schoolId, 1);
    const secrets = await prepareSecrets(2);
    const result = await prisma.$transaction((tx) => createStudent(tx, school, input, secrets), { timeout: 20000 });
    await audit(req, { action: 'student.create', entityType: 'Student', entityId: result.studentId, after: { ...input.student, familyNo: result.familyNo } });
    res.status(201).json(result);
  }),
);

router.get(
  '/:id',
  ah(async (req, res) => {
    const base = await loadStudent(req, req.params.id);
    const full = await prisma.student.findUniqueOrThrow({
      where: { id: base.id },
      include: {
        class: { select: { id: true, name: true, stream: true } },
        section: { select: { id: true, name: true, classTeacher: { select: { id: true, fullName: true } } } },
        session: { select: { id: true, name: true } },
        user: { select: { id: true, username: true, isActive: true, mustChangePassword: true, lastLoginAt: true } },
        family: {
          include: {
            guardians: { orderBy: { relation: 'asc' } },
            parentUser: { select: { id: true, username: true, isActive: true, mustChangePassword: true, lastLoginAt: true } },
            students: {
              where: { deletedAt: null, id: { not: base.id } },
              select: { id: true, fullName: true, admissionNo: true, status: true, class: { select: { name: true } }, section: { select: { name: true } } },
            },
          },
        },
        documents: { orderBy: { createdAt: 'desc' } },
      },
    });
    const files = await prisma.storedFile.findMany({
      where: { id: { in: full.documents.map((d) => d.fileId) }, deletedAt: null },
      select: { id: true, originalName: true, mimeType: true, sizeBytes: true },
    });
    const fileMap = new Map(files.map((f) => [f.id, f]));
    const isStaffView = can(req, 'students.view');
    const uploaded = new Set(full.documents.map((d) => d.docType));
    res.json({
      student: {
        ...full,
        discountPercent: toNum(full.discountPercent),
        // Teachers see the profile but not family documents or login details.
        documents: isStaffView ? full.documents.map((d) => ({ ...d, file: fileMap.get(d.fileId) ?? null })) : [],
        user: isStaffView ? full.user : null,
        family: { ...full.family, parentUser: isStaffView ? full.family.parentUser : null },
      },
      missingDocuments: isStaffView ? CHECKLIST_DOCUMENTS.filter((d) => !uploaded.has(d)).map((d) => ({ type: d, label: STUDENT_DOCUMENT_TYPES[d] })) : [],
    });
  }),
);

router.patch(
  '/:id',
  ah(async (req, res) => {
    assertCan(req, 'students.manage');
    const schoolId = tenantId(req);
    const before = await loadStudent(req, req.params.id);
    const body = parse(studentFieldsSchema.partial().extend({ reason: optStr(500) }), req.body);
    const { reason, ...data } = body;
    if (data.sectionId && !data.classId) data.classId = before.classId;
    if (data.classId && data.classId !== before.classId && data.sectionId === undefined) data.sectionId = null;
    await checkStudentRefs(schoolId, data);
    if (data.admissionNo && data.admissionNo !== before.admissionNo) {
      if (await prisma.student.findUnique({ where: { schoolId_admissionNo: { schoolId, admissionNo: data.admissionNo } } })) {
        throw conflict('Admission number already used');
      }
    }
    const student = await prisma.student.update({
      where: { id: before.id },
      data: {
        ...data,
        admissionNo: data.admissionNo ?? undefined,
        emergencyContact: data.emergencyContact ?? undefined,
        previousSchool: data.previousSchool ?? undefined,
        health: data.health ?? undefined,
      },
    });
    if (data.fullName && student.userId) await prisma.user.update({ where: { id: student.userId }, data: { fullName: data.fullName } });
    // Replacing the photo frees the old file's storage.
    if (data.photoFileId !== undefined && before.photoFileId && before.photoFileId !== data.photoFileId) {
      await deleteSchoolFile(schoolId, before.photoFileId);
    }
    await audit(req, { action: 'student.update', entityType: 'Student', entityId: student.id, before, after: data, reason });
    res.json({ student });
  }),
);

/** Replace the guardians of the student's family (shared with siblings). */
router.put(
  '/:id/guardians',
  ah(async (req, res) => {
    assertCan(req, 'students.manage');
    const schoolId = tenantId(req);
    const st = await loadStudent(req, req.params.id);
    const body = parse(z.object({ guardians: z.array(guardianSchema).min(1).max(4) }), req.body);
    const guardians = normalizeGuardians(body.guardians);
    const before = await prisma.guardian.findMany({ where: { familyId: st.familyId } });
    const keepIds = guardians.map((g) => g.id).filter(Boolean) as string[];
    if (keepIds.some((id) => !before.find((b) => b.id === id))) throw badRequest('Unknown guardian');
    await prisma.$transaction(async (tx) => {
      await tx.guardian.deleteMany({ where: { familyId: st.familyId, id: { notIn: keepIds } } });
      for (const { id, ...g } of guardians) {
        if (id) await tx.guardian.update({ where: { id }, data: g });
        else await tx.guardian.create({ data: { ...g, schoolId, familyId: st.familyId } });
      }
      // Keep the parent login's name and phone in step with the primary guardian.
      const family = await tx.family.findUniqueOrThrow({ where: { id: st.familyId } });
      const primary = guardians.find((g) => g.receivesMessages) ?? guardians[0];
      if (family.parentUserId) {
        await tx.user.update({ where: { id: family.parentUserId }, data: { fullName: primary.fullName, phone: primary.whatsapp ?? primary.phone ?? null } });
      }
    });
    await audit(req, { action: 'family.guardians', entityType: 'Family', entityId: st.familyId, before, after: guardians });
    res.json({ ok: true });
  }),
);

/** Link a student to a sibling's family (or split them into a new family). */
router.post(
  '/:id/family',
  ah(async (req, res) => {
    assertCan(req, 'students.manage');
    const schoolId = tenantId(req);
    const st = await loadStudent(req, req.params.id);
    const body = parse(z.object({ familyId: z.string() }), req.body);
    const target = await prisma.family.findFirst({ where: { id: body.familyId, schoolId } });
    if (!target) throw notFound('Family not found');
    if (target.id === st.familyId) return res.json({ ok: true });
    await prisma.$transaction(async (tx) => {
      await tx.student.update({ where: { id: st.id }, data: { familyId: target.id } });
      const left = await tx.student.count({ where: { familyId: st.familyId } });
      if (left === 0) {
        // Old family is empty: retire its parent login.
        const old = await tx.family.findUniqueOrThrow({ where: { id: st.familyId } });
        if (old.parentUserId) await tx.user.update({ where: { id: old.parentUserId }, data: { isActive: false, tokenVersion: { increment: 1 } } });
      }
      await syncLoginsForStatus(tx, st.id);
    });
    await audit(req, { action: 'student.family', entityType: 'Student', entityId: st.id, before: { familyId: st.familyId }, after: body });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/status',
  ah(async (req, res) => {
    assertCan(req, 'students.manage');
    const schoolId = tenantId(req);
    const st = await loadStudent(req, req.params.id);
    const body = parse(
      z.object({
        status: z.enum(['ACTIVE', 'LEFT', 'STRUCK_OFF', 'GRADUATED', 'TRANSFERRED']),
        date: z.coerce.date().default(() => new Date()),
        reason: optStr(300),
      }),
      req.body,
    );
    if (body.status === 'ACTIVE' && st.status !== 'ACTIVE') await assertStudentCapacity(schoolId, 1);
    await prisma.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: st.id },
        data: { status: body.status, statusDate: body.status === 'ACTIVE' ? null : body.date, statusReason: body.status === 'ACTIVE' ? null : body.reason ?? null },
      });
      await syncLoginsForStatus(tx, st.id);
    });
    await audit(req, { action: 'student.status', entityType: 'Student', entityId: st.id, before: { status: st.status }, after: body, reason: body.reason });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    assertCan(req, 'students.manage');
    const st = await loadStudent(req, req.params.id);
    const body = parse(z.object({ reason: optStr(300) }), req.body ?? {});
    await prisma.$transaction(async (tx) => {
      await tx.student.update({ where: { id: st.id }, data: { deletedAt: new Date() } });
      await syncLoginsForStatus(tx, st.id);
    });
    await audit(req, { action: 'student.delete', entityType: 'Student', entityId: st.id, before: { fullName: st.fullName, admissionNo: st.admissionNo }, reason: body.reason });
    res.json({ ok: true, restorableDays: RESTORE_DAYS });
  }),
);

router.post(
  '/:id/restore',
  ah(async (req, res) => {
    assertCan(req, 'students.manage');
    const schoolId = tenantId(req);
    const st = await prisma.student.findFirst({ where: { id: req.params.id, schoolId, deletedAt: { not: null } } });
    if (!st) throw notFound('Deleted student not found');
    if (st.deletedAt!.getTime() < Date.now() - RESTORE_DAYS * 86400000) throw badRequest(`Can only restore within ${RESTORE_DAYS} days`);
    if (st.status === 'ACTIVE') await assertStudentCapacity(schoolId, 1);
    await prisma.$transaction(async (tx) => {
      await tx.student.update({ where: { id: st.id }, data: { deletedAt: null } });
      await syncLoginsForStatus(tx, st.id);
    });
    await audit(req, { action: 'student.restore', entityType: 'Student', entityId: st.id });
    res.json({ ok: true });
  }),
);

// ---------- Documents ----------

router.post(
  '/:id/documents',
  ah(async (req, res) => {
    assertCan(req, 'students.manage');
    const schoolId = tenantId(req);
    const st = await loadStudent(req, req.params.id);
    const keys = Object.keys(STUDENT_DOCUMENT_TYPES) as [string, ...string[]];
    const body = parse(z.object({ fileId: z.string(), docType: z.enum(keys) }), req.body);
    const file = await prisma.storedFile.findFirst({ where: { id: body.fileId, schoolId, deletedAt: null } });
    if (!file) throw badRequest('Upload the file first');
    if (file.category !== 'STUDENT_DOCUMENT') await prisma.storedFile.update({ where: { id: file.id }, data: { category: 'STUDENT_DOCUMENT' } });
    const doc = await prisma.studentDocument.create({ data: { schoolId, studentId: st.id, docType: body.docType, fileId: file.id } });
    await audit(req, { action: 'student.document_add', entityType: 'Student', entityId: st.id, after: { docType: body.docType, file: file.originalName } });
    res.status(201).json({ document: doc });
  }),
);

router.delete(
  '/:id/documents/:docId',
  ah(async (req, res) => {
    assertCan(req, 'students.manage');
    const schoolId = tenantId(req);
    const st = await loadStudent(req, req.params.id);
    const doc = await prisma.studentDocument.findFirst({ where: { id: req.params.docId, studentId: st.id } });
    if (!doc) throw notFound('Document not found');
    await prisma.studentDocument.delete({ where: { id: doc.id } });
    await deleteSchoolFile(schoolId, doc.fileId);
    await audit(req, { action: 'student.document_delete', entityType: 'Student', entityId: st.id, before: { docType: doc.docType } });
    res.json({ ok: true });
  }),
);

export default router;

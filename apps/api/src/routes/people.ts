import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { parse } from '../lib/validate';
import { forbidden } from '../lib/errors';
import { can } from '../lib/http';
import { tenantId } from '../middleware/auth';

// ---------- Global search (principal and office staff) ----------

export const searchRouter = Router();

searchRouter.get(
  '/',
  ah(async (req, res) => {
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query);
    const schoolId = tenantId(req);
    const canStudents = can(req, 'students.view');
    const canStaff = can(req, 'staff.view');
    if (!canStudents && !canStaff) throw forbidden();
    const digits = q.replace(/[ \-]/g, '');
    const [students, staff] = await Promise.all([
      canStudents
        ? prisma.student.findMany({
            where: {
              schoolId,
              deletedAt: null,
              OR: [
                { fullName: { contains: q } },
                { admissionNo: { contains: q } },
                { rollNo: q },
                { bForm: { contains: q } },
                { family: { familyNo: q } },
                { family: { guardians: { some: { OR: [{ fullName: { contains: q } }, { phone: { contains: digits } }, { whatsapp: { contains: digits } }, { cnic: { contains: q } }] } } } },
              ],
            },
            select: {
              id: true,
              fullName: true,
              admissionNo: true,
              status: true,
              photoFileId: true,
              class: { select: { name: true, stream: true } },
              section: { select: { name: true } },
              family: { select: { guardians: { where: { relation: 'FATHER' }, select: { fullName: true }, take: 1 } } },
            },
            orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
            take: 8,
          })
        : [],
      canStaff
        ? prisma.user.findMany({
            where: {
              schoolId,
              deletedAt: null,
              role: { in: ['TEACHER', 'STAFF'] },
              OR: [{ fullName: { contains: q } }, { username: { contains: q } }, { phone: { contains: digits } }, { staffProfile: { employeeNo: q } }, { staffProfile: { cnic: { contains: q } } }],
            },
            select: { id: true, fullName: true, role: true, photoFileId: true, isActive: true, staffProfile: { select: { designation: true, employeeNo: true } } },
            take: 6,
          })
        : [],
    ]);
    res.json({ students, staff });
  }),
);

// ---------- Recycle bin (deleted in the last 30 days) ----------

export const recycleRouter = Router();
const RESTORE_DAYS = 30;

recycleRouter.get(
  '/',
  ah(async (req, res) => {
    if (req.user!.role !== 'PRINCIPAL') throw forbidden('Only the principal can open the recycle bin');
    const schoolId = tenantId(req);
    const since = new Date(Date.now() - RESTORE_DAYS * 86400000);
    const [students, staff] = await Promise.all([
      prisma.student.findMany({
        where: { schoolId, deletedAt: { gte: since } },
        select: { id: true, fullName: true, admissionNo: true, deletedAt: true, class: { select: { name: true } } },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.user.findMany({
        where: { schoolId, role: { in: ['TEACHER', 'STAFF'] }, deletedAt: { gte: since } },
        select: { id: true, fullName: true, role: true, deletedAt: true },
        orderBy: { deletedAt: 'desc' },
      }),
    ]);
    res.json({ students, staff, restoreDays: RESTORE_DAYS });
  }),
);

// ---------- "My" area for teachers, students and parents ----------

export const myRouter = Router();

const studentCard = {
  id: true,
  fullName: true,
  admissionNo: true,
  rollNo: true,
  photoFileId: true,
  gender: true,
  dob: true,
  status: true,
  class: { select: { name: true, stream: true } },
  section: { select: { name: true, classTeacher: { select: { fullName: true } } } },
} as const;

myRouter.get(
  '/overview',
  ah(async (req, res) => {
    const u = req.user!;
    const schoolId = tenantId(req);
    if (u.role === 'TEACHER') {
      const [classTeacherOf, teaching] = await Promise.all([
        prisma.section.findMany({
          where: { schoolId, classTeacherId: u.id, deletedAt: null },
          select: { id: true, name: true, room: true, class: { select: { name: true, stream: true } }, _count: { select: { students: { where: { status: 'ACTIVE', deletedAt: null } } } } },
        }),
        prisma.teachingAssignment.findMany({
          where: { schoolId, teacherId: u.id, section: { deletedAt: null } },
          select: {
            id: true,
            subject: { select: { name: true } },
            section: { select: { id: true, name: true, class: { select: { name: true, stream: true } }, _count: { select: { students: { where: { status: 'ACTIVE', deletedAt: null } } } } } },
          },
        }),
      ]);
      return res.json({ role: u.role, classTeacherOf, teaching });
    }
    if (u.role === 'PARENT') {
      const family = await prisma.family.findFirst({
        where: { schoolId, parentUserId: u.id },
        select: { familyNo: true, students: { where: { deletedAt: null }, select: studentCard, orderBy: { dob: 'asc' } } },
      });
      return res.json({ role: u.role, familyNo: family?.familyNo ?? null, children: family?.students ?? [] });
    }
    if (u.role === 'STUDENT') {
      const student = await prisma.student.findFirst({ where: { schoolId, userId: u.id, deletedAt: null }, select: studentCard });
      return res.json({ role: u.role, student });
    }
    throw forbidden();
  }),
);

/** Teacher: students of one of their sections. */
myRouter.get(
  '/sections/:id/students',
  ah(async (req, res) => {
    const u = req.user!;
    const schoolId = tenantId(req);
    if (u.role !== 'TEACHER') throw forbidden();
    const allowed = await prisma.section.findFirst({
      where: { id: req.params.id, schoolId, deletedAt: null, OR: [{ classTeacherId: u.id }, { assignments: { some: { teacherId: u.id } } }] },
      select: { id: true, name: true, class: { select: { name: true, stream: true } } },
    });
    if (!allowed) throw forbidden('This is not one of your classes');
    const students = await prisma.student.findMany({
      where: { sectionId: allowed.id, status: 'ACTIVE', deletedAt: null },
      select: studentCard,
      orderBy: [{ rollNo: 'asc' }, { fullName: 'asc' }],
    });
    res.json({ section: allowed, students });
  }),
);

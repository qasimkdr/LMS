import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden } from '../lib/errors';
import { optEmail, optStr } from '../lib/validate';
import { generateTempPassword, hashPassword, type LoginSecret } from '../lib/password';
import { nextNumber } from './counters';
import { effectiveLimits } from './limits';
import { OPTIONAL_STUDENT_FIELDS } from '../config/studentFields';

// ---------- Validation schemas (shared by the form and the importer) ----------

const optDate = z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.date().nullish());
const cnic = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, ''))
  .refine((v) => v === '' || /^\d{5}-?\d{7}-?\d$/.test(v), 'CNIC / B-Form must be 13 digits (e.g. 35202-1234567-1)')
  .transform((v) => (v === '' ? null : v.replace(/^(\d{5})-?(\d{7})-?(\d)$/, '$1-$2-$3')))
  .nullish();
const phone = z
  .string()
  .trim()
  .refine((v) => v === '' || /^[+0-9][0-9 \-]{6,18}$/.test(v), 'Invalid phone number')
  .transform((v) => (v === '' ? null : v.replace(/[ \-]/g, '')))
  .nullish();

export const studentFieldsSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  nameUrdu: optStr(160),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  dob: optDate,
  placeOfBirth: optStr(80),
  bForm: cnic,
  religion: optStr(40),
  nationality: optStr(40),
  motherTongue: optStr(40),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', '']).transform((v) => v || null).nullish(),
  currentAddress: optStr(300),
  permanentAddress: optStr(300),
  city: optStr(80),
  area: optStr(80),
  phone,
  email: optEmail,
  photoFileId: z.string().nullish(),
  emergencyContact: z.object({ name: optStr(160), relation: optStr(40), phone }).nullish(),
  previousSchool: z
    .object({ schoolName: optStr(160), lastClass: optStr(40), year: optStr(10), marks: optStr(40), reasonForLeaving: optStr(300), slcNo: optStr(40) })
    .nullish(),
  health: z
    .object({ allergies: optStr(300), conditions: optStr(300), medicines: optStr(300), specialNeeds: optStr(300), doctorName: optStr(160), doctorPhone: phone })
    .nullish(),
  feeCategory: optStr(60),
  discountType: optStr(60),
  discountPercent: z.coerce.number().min(0).max(100).nullish(),
  discountAmount: z.coerce.number().min(0).max(10_000_000).nullish(),
  transportRequired: z.boolean().default(false),
  notes: optStr(5000),
  admissionNo: optStr(30),
  admissionDate: z.coerce.date().default(() => new Date()),
  admissionType: z.enum(['NEW', 'TRANSFER', 'READMISSION']).default('NEW'),
  sessionId: z.string().nullish(),
  classId: z.string().min(1, 'Choose a class'),
  sectionId: z.string().nullish(),
  rollNo: optStr(20),
});

export const guardianSchema = z.object({
  id: z.string().optional(),
  relation: z.enum(['FATHER', 'MOTHER', 'GUARDIAN']),
  relationDetail: optStr(40),
  fullName: z.string().trim().min(2).max(160),
  cnic,
  phone,
  whatsapp: phone,
  email: optEmail,
  occupation: optStr(100),
  organization: optStr(160),
  education: optStr(100),
  monthlyIncome: z.coerce.number().int().min(0).nullish(),
  officeAddress: optStr(300),
  address: optStr(300),
  isDeceased: z.boolean().default(false),
  receivesMessages: z.boolean().default(false),
});

export const createStudentSchema = z.object({
  student: studentFieldsSchema,
  familyId: z.string().nullish(),
  guardians: z.array(guardianSchema).max(4).default([]),
  createStudentLogin: z.boolean().default(true),
  createParentLogin: z.boolean().default(true),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type GuardianInput = z.infer<typeof guardianSchema>;
type StudentFields = z.infer<typeof studentFieldsSchema>;

// ---------- Helpers ----------

const usernamePart = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');

export async function assertStudentCapacity(schoolId: string, adding: number) {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, include: { plan: true } });
  const limit = effectiveLimits(school).maxStudents;
  if (limit === null) return;
  const active = await prisma.student.count({ where: { schoolId, status: 'ACTIVE', deletedAt: null } });
  if (active + adding > limit) {
    throw forbidden(
      `Your plan allows ${limit} active students (you have ${active}). Request an upgrade to add more.`,
      'PLAN_LIMIT',
    );
  }
}

/** Checks class/section/session/photo belong to this school. Returns the resolved session id. */
export async function checkStudentRefs(schoolId: string, s: Partial<StudentFields>, db: Prisma.TransactionClient = prisma) {
  let classId = s.classId;
  if (classId) {
    const cls = await db.classLevel.findFirst({ where: { id: classId, schoolId, deletedAt: null } });
    if (!cls) throw badRequest('Unknown class');
  }
  if (s.sectionId) {
    const sec = await db.section.findFirst({ where: { id: s.sectionId, schoolId, deletedAt: null } });
    if (!sec) throw badRequest('Unknown section');
    if (classId && sec.classId !== classId) throw badRequest('Section does not belong to the chosen class');
    classId ??= sec.classId;
  }
  if (s.sessionId && !(await db.academicSession.findFirst({ where: { id: s.sessionId, schoolId } }))) throw badRequest('Unknown session');
  if (s.photoFileId) {
    const f = await db.storedFile.findFirst({ where: { id: s.photoFileId, schoolId, deletedAt: null, mimeType: { startsWith: 'image/' } } });
    if (!f) throw badRequest('Photo must be an uploaded image');
  }
}

/** Enforces the principal's "required fields" setting on the enrollment form. */
export function checkRequiredFields(required: string[], s: StudentFields, guardians: GuardianInput[], existingFamily: boolean) {
  const father = guardians.find((g) => g.relation === 'FATHER');
  const mother = guardians.find((g) => g.relation === 'MOTHER');
  const has: Record<string, boolean> = {
    dob: Boolean(s.dob),
    bForm: Boolean(s.bForm),
    bloodGroup: Boolean(s.bloodGroup),
    religion: Boolean(s.religion),
    currentAddress: Boolean(s.currentAddress),
    city: Boolean(s.city),
    photo: Boolean(s.photoFileId),
    rollNo: Boolean(s.rollNo),
    section: Boolean(s.sectionId),
    fatherName: existingFamily || Boolean(father?.fullName),
    fatherCnic: existingFamily || Boolean(father?.cnic),
    fatherPhone: existingFamily || Boolean(father?.phone || father?.whatsapp),
    motherName: existingFamily || Boolean(mother?.fullName),
    motherPhone: existingFamily || Boolean(mother?.phone || mother?.whatsapp),
    emergencyContact: Boolean(s.emergencyContact?.name && s.emergencyContact?.phone),
    // Only asked for students transferring from another school.
    previousSchool: s.admissionType !== 'TRANSFER' || Boolean(s.previousSchool?.schoolName),
  };
  const missing = required.filter((k) => k in has && !has[k]);
  if (missing.length) {
    const labels = missing.map((k) => OPTIONAL_STUDENT_FIELDS[k as keyof typeof OPTIONAL_STUDENT_FIELDS] ?? k);
    throw badRequest(`Required: ${labels.join(', ')}`, { missing });
  }
}

/** Makes sure exactly the guardians flagged (or the first with a phone) receive messages. */
export function normalizeGuardians(guardians: GuardianInput[]): GuardianInput[] {
  if (guardians.some((g) => g.receivesMessages)) return guardians;
  const first = guardians.find((g) => !g.isDeceased && (g.whatsapp || g.phone));
  return guardians.map((g) => ({ ...g, receivesMessages: g === first }));
}

function primaryGuardian(guardians: { fullName: string; phone: string | null; whatsapp: string | null; receivesMessages: boolean; relation: string }[]) {
  return guardians.find((g) => g.receivesMessages) ?? guardians.find((g) => g.relation === 'FATHER') ?? guardians[0];
}

export interface NewLogin {
  role: 'STUDENT' | 'PARENT';
  username: string;
  tempPassword: string;
  fullName: string;
}

async function createLogin(
  tx: Prisma.TransactionClient,
  schoolId: string,
  role: 'STUDENT' | 'PARENT',
  username: string,
  fullName: string,
  phone: string | null,
  secrets: LoginSecret[],
): Promise<{ userId: string; login: NewLogin }> {
  let name = username;
  for (let i = 2; await tx.user.findUnique({ where: { username: name } }); i++) name = `${username}-${i}`;
  const secret = secrets.pop();
  const tempPassword = secret?.tempPassword ?? generateTempPassword();
  const passwordHash = secret?.hash ?? (await hashPassword(tempPassword));
  const user = await tx.user.create({
    data: { schoolId, role, username: name, fullName, phone, passwordHash, mustChangePassword: true },
  });
  return { userId: user.id, login: { role, username: name, tempPassword, fullName } };
}

/**
 * Enrolls one student: family (new or existing sibling family), guardians, student and parent logins.
 * Call inside a transaction.
 */
export async function createStudent(
  tx: Prisma.TransactionClient,
  school: { id: string; code: string },
  input: CreateStudentInput,
  /** Pre-hashed temporary passwords (see prepareSecrets); hashed inline when missing. */
  secrets: LoginSecret[] = [],
): Promise<{ studentId: string; familyId: string; admissionNo: string; familyNo: string; logins: NewLogin[] }> {
  const s = input.student;
  const logins: NewLogin[] = [];

  // Session defaults to the current one.
  let sessionId = s.sessionId ?? null;
  if (!sessionId) sessionId = (await tx.academicSession.findFirst({ where: { schoolId: school.id, isCurrent: true } }))?.id ?? null;

  // Admission number: given, or year + running number.
  let admissionNo = s.admissionNo ?? null;
  if (admissionNo) {
    if (await tx.student.findUnique({ where: { schoolId_admissionNo: { schoolId: school.id, admissionNo } } })) {
      throw conflict(`Admission number ${admissionNo} is already used`);
    }
  } else {
    do {
      const n = await nextNumber(tx, school.id, 'admission');
      admissionNo = `${s.admissionDate.getFullYear()}${String(n).padStart(4, '0')}`;
    } while (await tx.student.findUnique({ where: { schoolId_admissionNo: { schoolId: school.id, admissionNo } } }));
  }

  // Family
  let family;
  if (input.familyId) {
    family = await tx.family.findFirst({ where: { id: input.familyId, schoolId: school.id }, include: { guardians: true } });
    if (!family) throw badRequest('Sibling family not found');
  } else {
    if (input.guardians.length === 0) throw badRequest('Add at least one parent or guardian');
    const familyNo = String(await nextNumber(tx, school.id, 'family')).padStart(4, '0');
    const guardians = normalizeGuardians(input.guardians);
    family = await tx.family.create({
      data: {
        schoolId: school.id,
        familyNo,
        guardians: { create: guardians.map(({ id: _id, ...g }) => ({ ...g, schoolId: school.id })) },
      },
      include: { guardians: true },
    });
  }

  if (input.createParentLogin && !family.parentUserId && family.guardians.length) {
    const g = primaryGuardian(family.guardians);
    const { userId, login } = await createLogin(tx, school.id, 'PARENT', `${school.code}.p${family.familyNo}`, g.fullName, g.whatsapp ?? g.phone, secrets);
    await tx.family.update({ where: { id: family.id }, data: { parentUserId: userId } });
    logins.push(login);
  }

  let userId: string | null = null;
  if (input.createStudentLogin) {
    const r = await createLogin(tx, school.id, 'STUDENT', `${school.code}.${usernamePart(admissionNo)}`, s.fullName, s.phone ?? null, secrets);
    userId = r.userId;
    logins.push(r.login);
  }

  const { admissionNo: _a, sessionId: _s, ...fields } = s;
  const student = await tx.student.create({
    data: {
      ...fields,
      emergencyContact: fields.emergencyContact ?? undefined,
      previousSchool: fields.previousSchool ?? undefined,
      health: fields.health ?? undefined,
      schoolId: school.id,
      admissionNo,
      sessionId,
      familyId: family.id,
      userId,
    },
  });
  return { studentId: student.id, familyId: family.id, admissionNo, familyNo: family.familyNo, logins };
}

/** Families whose father/guardian CNIC or phone matches: used to suggest sibling links. */
export async function findFamilies(schoolId: string, q: { cnic?: string | null; phone?: string | null }) {
  const or: Prisma.GuardianWhereInput[] = [];
  if (q.cnic) or.push({ cnic: q.cnic });
  if (q.phone) or.push({ phone: q.phone }, { whatsapp: q.phone });
  if (!or.length) return [];
  const guardians = await prisma.guardian.findMany({ where: { schoolId, OR: or }, select: { familyId: true }, take: 20 });
  const ids = [...new Set(guardians.map((g) => g.familyId))];
  return prisma.family.findMany({
    where: { id: { in: ids } },
    include: {
      guardians: { select: { relation: true, fullName: true, phone: true, cnic: true } },
      students: {
        where: { deletedAt: null },
        select: { id: true, fullName: true, admissionNo: true, status: true, class: { select: { name: true } }, section: { select: { name: true } } },
      },
    },
  });
}

/** Turns a student's login (and the parent login when no active child remains) on or off. */
export async function syncLoginsForStatus(tx: Prisma.TransactionClient, studentId: string) {
  const st = await tx.student.findUniqueOrThrow({ where: { id: studentId }, include: { family: true } });
  const active = st.status === 'ACTIVE' && !st.deletedAt;
  if (st.userId) {
    await tx.user.update({ where: { id: st.userId }, data: { isActive: active, ...(active ? {} : { tokenVersion: { increment: 1 } }) } });
  }
  if (st.family.parentUserId) {
    const anyActive = await tx.student.count({ where: { familyId: st.familyId, status: 'ACTIVE', deletedAt: null } });
    await tx.user.update({ where: { id: st.family.parentUserId }, data: { isActive: anyActive > 0 } });
  }
}

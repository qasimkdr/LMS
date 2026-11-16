import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Enquiry } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optEmail, optStr, parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { nextNumber } from '../services/counters';
import { num } from '../services/exams';
import { schoolToday } from './attendance';

/** Admission enquiries: register → follow up → test / interview → admit (convert to student) or lost. */
const router = Router();

export const SOURCES = ['WALK_IN', 'REFERRAL', 'BANNER', 'SOCIAL', 'WEBSITE', 'NEWSPAPER', 'OTHER'] as const;
export const STAGES = ['NEW', 'FOLLOW_UP', 'TEST', 'PASSED', 'WAITLIST', 'FAILED', 'ADMITTED', 'LOST'] as const;
const OPEN = ['NEW', 'FOLLOW_UP', 'TEST', 'PASSED', 'WAITLIST'];

const need = (req: Request) => {
  if (!can(req, 'admissions.manage')) throw forbidden('You need the admissions permission');
};
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function present(rows: Enquiry[]) {
  const classes = await prisma.classLevel.findMany({ where: { id: { in: rows.map((r) => r.classId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true, stream: true } });
  return rows.map((r) => {
    const c = classes.find((x) => x.id === r.classId);
    return {
      id: r.id,
      enquiryNo: r.enquiryNo,
      childName: r.childName,
      gender: r.gender,
      dob: ymd(r.dob),
      classId: r.classId,
      classLabel: c ? `${c.name}${c.stream ? ` ${c.stream}` : ''}` : null,
      parentName: r.parentName,
      relation: r.relation,
      phone: r.phone,
      email: r.email,
      address: r.address,
      previousSchool: r.previousSchool,
      source: r.source,
      stage: r.stage,
      followUpDate: ymd(r.followUpDate),
      testAt: r.testAt,
      testMarks: r.testMarks === null ? null : num(r.testMarks),
      testTotal: r.testTotal === null ? null : num(r.testTotal),
      testRemarks: r.testRemarks,
      lostReason: r.lostReason,
      studentId: r.studentId,
      createdAt: r.createdAt,
    };
  });
}

router.get(
  '/enquiries',
  ah(async (req, res) => {
    need(req);
    const schoolId = tenantId(req);
    const q = parse(z.object({ stage: z.enum([...STAGES, 'OPEN', 'DUE'] as [string, ...string[]]).optional(), classId: z.string().optional(), q: z.string().max(100).optional() }), req.query);
    const today = new Date(`${schoolToday(req.user!.school!.timezone)}T00:00:00Z`);
    const stageWhere = !q.stage ? {} : q.stage === 'OPEN' ? { stage: { in: OPEN } } : q.stage === 'DUE' ? { stage: { in: OPEN }, followUpDate: { lte: today } } : { stage: q.stage };
    const rows = await prisma.enquiry.findMany({
      where: { schoolId, ...stageWhere, ...(q.classId ? { classId: q.classId } : {}), ...(q.q ? { OR: [{ childName: { contains: q.q } }, { parentName: { contains: q.q } }, { phone: { contains: q.q } }] } : {}) },
      orderBy: [{ updatedAt: 'desc' }],
      take: 500,
    });
    const counts = await prisma.enquiry.groupBy({ by: ['stage'], where: { schoolId }, _count: { _all: true } });
    const due = await prisma.enquiry.count({ where: { schoolId, stage: { in: OPEN }, followUpDate: { lte: today } } });
    // This month: enquiries, admissions, and where enquiries came from.
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const month = await prisma.enquiry.findMany({ where: { schoolId, createdAt: { gte: monthStart } }, select: { source: true, stage: true } });
    const bySource = Object.fromEntries(SOURCES.map((s) => [s, month.filter((m) => m.source === s).length]));
    res.json({
      enquiries: await present(rows),
      counts: Object.fromEntries(counts.map((c) => [c.stage, c._count._all])),
      due,
      month: { enquiries: month.length, admitted: month.filter((m) => m.stage === 'ADMITTED').length, bySource },
    });
  }),
);

const enquiryBody = z.object({
  childName: z.string().trim().min(2).max(160),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullish(),
  dob: isoDate.nullish(),
  classId: z.string().nullish(),
  parentName: z.string().trim().min(2).max(160),
  relation: optStr(20),
  phone: z.string().trim().min(7).max(30),
  email: optEmail,
  address: optStr(300),
  previousSchool: optStr(160),
  source: z.enum(SOURCES).default('WALK_IN'),
  followUpDate: isoDate.nullish(),
  note: optStr(1000),
});

router.post(
  '/enquiries',
  ah(async (req, res) => {
    need(req);
    const schoolId = tenantId(req);
    const b = parse(enquiryBody, req.body);
    if (b.classId && !(await prisma.classLevel.findFirst({ where: { id: b.classId, schoolId, deletedAt: null } }))) throw badRequest('Unknown class');
    const e = await prisma.$transaction(async (tx) => {
      const enquiryNo = await nextNumber(tx, schoolId, 'enquiry');
      return tx.enquiry.create({
        data: {
          schoolId,
          enquiryNo,
          childName: b.childName,
          gender: b.gender ?? null,
          dob: b.dob ? new Date(b.dob) : null,
          classId: b.classId ?? null,
          parentName: b.parentName,
          relation: b.relation ?? null,
          phone: b.phone,
          email: b.email ?? null,
          address: b.address ?? null,
          previousSchool: b.previousSchool ?? null,
          source: b.source,
          followUpDate: b.followUpDate ? new Date(b.followUpDate) : null,
          stage: b.followUpDate ? 'FOLLOW_UP' : 'NEW',
          createdById: req.user!.id,
          ...(b.note ? { notes: { create: { authorId: req.user!.id, text: b.note } } } : {}),
        },
      });
    });
    await audit(req, { action: 'enquiry.create', entityType: 'Enquiry', entityId: e.id, after: { childName: e.childName, enquiryNo: e.enquiryNo } });
    res.status(201).json({ id: e.id, enquiryNo: e.enquiryNo });
  }),
);

async function load(req: Request, id: string) {
  const e = await prisma.enquiry.findFirst({ where: { id, schoolId: tenantId(req) }, include: { notes: { orderBy: { createdAt: 'desc' } } } });
  if (!e) throw notFound('Enquiry not found');
  return e;
}

router.get(
  '/enquiries/:id',
  ah(async (req, res) => {
    need(req);
    const e = await load(req, req.params.id);
    const authors = await prisma.user.findMany({ where: { id: { in: e.notes.map((n) => n.authorId) } }, select: { id: true, fullName: true } });
    const [info] = await present([e]);
    res.json({ enquiry: info, notes: e.notes.map((n) => ({ id: n.id, text: n.text, author: authors.find((a) => a.id === n.authorId)?.fullName ?? '', createdAt: n.createdAt })) });
  }),
);

router.patch(
  '/enquiries/:id',
  ah(async (req, res) => {
    need(req);
    const e = await load(req, req.params.id);
    const b = parse(
      enquiryBody
        .omit({ note: true, source: true })
        .partial()
        .extend({
          source: z.enum(SOURCES).optional(),
          stage: z.enum(STAGES).optional(),
          testAt: z.coerce.date().nullish(),
          testMarks: z.coerce.number().min(0).nullish(),
          testTotal: z.coerce.number().min(1).nullish(),
          testRemarks: optStr(300),
          lostReason: optStr(200),
        }),
      req.body,
    );
    if (b.stage === 'ADMITTED' && !e.studentId) throw badRequest('Use "Admit" to create the student from this enquiry');
    if (e.stage === 'ADMITTED' && b.stage && b.stage !== 'ADMITTED') throw badRequest('This child is already admitted');
    if (b.testMarks !== undefined && b.testMarks !== null && (b.testTotal ?? (e.testTotal ? num(e.testTotal) : null)) !== null && b.testMarks > (b.testTotal ?? num(e.testTotal))) throw badRequest('Marks cannot be more than the total');
    const data: Record<string, unknown> = { ...b };
    if (b.dob !== undefined) data.dob = b.dob ? new Date(b.dob) : null;
    if (b.followUpDate !== undefined) data.followUpDate = b.followUpDate ? new Date(b.followUpDate) : null;
    // Scheduling a test moves the enquiry to the test stage.
    if (b.testAt && !b.stage && OPEN.includes(e.stage)) data.stage = 'TEST';
    await prisma.enquiry.update({ where: { id: e.id }, data });
    await audit(req, { action: 'enquiry.update', entityType: 'Enquiry', entityId: e.id, before: { stage: e.stage }, after: b });
    res.json({ ok: true });
  }),
);

router.post(
  '/enquiries/:id/notes',
  ah(async (req, res) => {
    need(req);
    const e = await load(req, req.params.id);
    const b = parse(z.object({ text: z.string().trim().min(1).max(1000), followUpDate: isoDate.nullish() }), req.body);
    await prisma.enquiryNote.create({ data: { enquiryId: e.id, authorId: req.user!.id, text: b.text } });
    await prisma.enquiry.update({ where: { id: e.id }, data: { ...(b.followUpDate !== undefined ? { followUpDate: b.followUpDate ? new Date(b.followUpDate) : null } : {}), ...(e.stage === 'NEW' ? { stage: 'FOLLOW_UP' } : {}) } });
    res.status(201).json({ ok: true });
  }),
);

router.delete(
  '/enquiries/:id',
  ah(async (req, res) => {
    need(req);
    const e = await load(req, req.params.id);
    if (e.studentId) throw badRequest('Admitted enquiries are kept as a record');
    await prisma.enquiry.delete({ where: { id: e.id } });
    await audit(req, { action: 'enquiry.delete', entityType: 'Enquiry', entityId: e.id, before: { childName: e.childName } });
    res.json({ ok: true });
  }),
);

export default router;

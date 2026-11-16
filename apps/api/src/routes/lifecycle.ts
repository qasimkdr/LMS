import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optStr, parse } from '../lib/validate';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import { round2 } from '../lib/money';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { nextNumber } from '../services/counters';
import { num } from '../services/exams';
import { recalcInvoice } from '../services/fees';
import { syncLoginsForStatus } from '../services/students';
import { teacherSectionIds } from '../services/teacherScope';
import { percent as attendancePercent } from './attendance';

const classLabel = (c: { name: string; stream: string | null }, s?: { name: string } | null) => `${c.name}${c.stream ? ` ${c.stream}` : ''}${s ? ` ${s.name}` : ''}`;
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function openDues(studentId: string) {
  const inv = await prisma.feeInvoice.findMany({ where: { studentId, status: { in: ['UNPAID', 'PARTIAL'] } }, orderBy: { dueDate: 'asc' } });
  return { invoices: inv.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, title: i.title, period: i.period, total: num(i.total), paid: num(i.paidAmount), balance: round2(num(i.total) - num(i.paidAmount)) })), total: round2(inv.reduce((s, i) => s + num(i.total) - num(i.paidAmount), 0)) };
}

// ---------- Withdrawals and School Leaving Certificate ----------

export const withdrawalRouter = Router();
const needManage = (req: Request) => {
  if (!can(req, 'students.manage')) throw forbidden();
};

async function presentWithdrawal(w: Awaited<ReturnType<typeof prisma.withdrawal.findFirst>> & object) {
  const st = await prisma.student.findUnique({ where: { id: w.studentId }, include: { class: true, section: true } });
  return {
    id: w.id,
    status: w.status,
    reason: w.reason,
    leavingDate: ymd(w.leavingDate),
    requestedAt: w.requestedAt,
    waivedAmount: num(w.waivedAmount),
    conduct: w.conduct,
    remarks: w.remarks,
    certificateNo: w.certificateNo,
    completedAt: w.completedAt,
    student: st ? { id: st.id, fullName: st.fullName, admissionNo: st.admissionNo, photoFileId: st.photoFileId, classLabel: w.classLabel ?? classLabel(st.class, st.section), status: st.status } : null,
  };
}

withdrawalRouter.get(
  '/',
  ah(async (req, res) => {
    if (!can(req, 'students.view')) throw forbidden();
    const q = parse(z.object({ status: z.enum(['REQUESTED', 'COMPLETED', 'CANCELLED']).optional() }), req.query);
    const rows = await prisma.withdrawal.findMany({ where: { schoolId: tenantId(req), ...(q.status ? { status: q.status } : {}) }, orderBy: { requestedAt: 'desc' }, take: 300 });
    const list = [];
    for (const w of rows) list.push({ ...(await presentWithdrawal(w)), dues: w.status === 'REQUESTED' ? (await openDues(w.studentId)).total : 0 });
    res.json({ withdrawals: list });
  }),
);

withdrawalRouter.post(
  '/',
  ah(async (req, res) => {
    needManage(req);
    const schoolId = tenantId(req);
    const b = parse(z.object({ studentId: z.string(), reason: z.string().trim().min(2).max(300), leavingDate: isoDate }), req.body);
    const st = await prisma.student.findFirst({ where: { id: b.studentId, schoolId, deletedAt: null }, include: { class: true, section: true } });
    if (!st) throw badRequest('Unknown student');
    if (st.status !== 'ACTIVE') throw badRequest('This student is not active');
    if (await prisma.withdrawal.findFirst({ where: { studentId: st.id, status: 'REQUESTED' } })) throw conflict('A leaving request is already open for this student');
    const w = await prisma.withdrawal.create({ data: { schoolId, studentId: st.id, reason: b.reason, leavingDate: new Date(b.leavingDate), requestedById: req.user!.id, classLabel: classLabel(st.class, st.section) } });
    await audit(req, { action: 'withdrawal.request', entityType: 'Student', entityId: st.id, after: b });
    res.status(201).json({ id: w.id });
  }),
);

async function loadW(req: Request, id: string) {
  const w = await prisma.withdrawal.findFirst({ where: { id, schoolId: tenantId(req) } });
  if (!w) throw notFound('Leaving request not found');
  return w;
}

withdrawalRouter.get(
  '/:id',
  ah(async (req, res) => {
    if (!can(req, 'students.view')) throw forbidden();
    const w = await loadW(req, req.params.id);
    res.json({ withdrawal: await presentWithdrawal(w), dues: w.status === 'REQUESTED' ? await openDues(w.studentId) : { invoices: [], total: 0 }, canWaive: req.user!.role === 'PRINCIPAL' });
  }),
);

/** Principal waives the remaining dues so the student can leave. */
withdrawalRouter.post(
  '/:id/waive',
  ah(async (req, res) => {
    if (req.user!.role !== 'PRINCIPAL') throw forbidden('Only the principal can waive dues');
    const w = await loadW(req, req.params.id);
    if (w.status !== 'REQUESTED') throw badRequest('This request is closed');
    const { reason } = parse(z.object({ reason: z.string().trim().min(2).max(200) }), req.body);
    const dues = await openDues(w.studentId);
    if (!dues.total) throw badRequest('There are no dues to waive');
    await prisma.$transaction(async (tx) => {
      for (const i of dues.invoices) {
        await tx.feeInvoiceLine.create({ data: { invoiceId: i.id, kind: 'ADJUSTMENT', description: `Waived on leaving: ${reason}`.slice(0, 160), amount: -i.balance } });
        await tx.feeInvoice.update({ where: { id: i.id }, data: { total: round2(i.total - i.balance) } });
        await recalcInvoice(tx, i.id);
      }
      await tx.withdrawal.update({ where: { id: w.id }, data: { waivedAmount: round2(num(w.waivedAmount) + dues.total), waivedById: req.user!.id } });
    });
    await audit(req, { action: 'withdrawal.waive', entityType: 'Student', entityId: w.studentId, after: { amount: dues.total }, reason });
    res.json({ waived: dues.total });
  }),
);

/** Complete: dues must be clear. Issues the certificate number and marks the student as left. */
withdrawalRouter.post(
  '/:id/complete',
  ah(async (req, res) => {
    needManage(req);
    const w = await loadW(req, req.params.id);
    if (w.status !== 'REQUESTED') throw badRequest('This request is closed');
    const b = parse(z.object({ conduct: optStr(40), remarks: optStr(300) }), req.body);
    const dues = await openDues(w.studentId);
    if (dues.total > 0) throw badRequest(`Fee dues of ${dues.total} must be paid or waived by the principal first`, { dues: dues.total });
    const certificateNo = await prisma.$transaction(async (tx) => {
      const no = await nextNumber(tx, w.schoolId, 'slc');
      await tx.withdrawal.update({ where: { id: w.id }, data: { status: 'COMPLETED', certificateNo: no, conduct: b.conduct ?? 'Good', remarks: b.remarks ?? null, completedAt: new Date(), completedById: req.user!.id } });
      await tx.student.update({ where: { id: w.studentId }, data: { status: 'LEFT', statusDate: w.leavingDate, statusReason: w.reason } });
      await syncLoginsForStatus(tx, w.studentId);
      return no;
    });
    await audit(req, { action: 'withdrawal.complete', entityType: 'Student', entityId: w.studentId, after: { certificateNo } });
    res.json({ certificateNo });
  }),
);

withdrawalRouter.post(
  '/:id/cancel',
  ah(async (req, res) => {
    needManage(req);
    const w = await loadW(req, req.params.id);
    if (w.status !== 'REQUESTED') throw badRequest('This request is closed');
    await prisma.withdrawal.update({ where: { id: w.id }, data: { status: 'CANCELLED' } });
    await audit(req, { action: 'withdrawal.cancel', entityType: 'Student', entityId: w.studentId });
    res.json({ ok: true });
  }),
);

/** Data for the printable School Leaving Certificate. */
withdrawalRouter.get(
  '/:id/certificate',
  ah(async (req, res) => {
    if (!can(req, 'students.view')) throw forbidden();
    const w = await loadW(req, req.params.id);
    if (w.status !== 'COMPLETED') throw badRequest('The certificate is issued when the leaving process is completed');
    const st = await prisma.student.findUniqueOrThrow({ where: { id: w.studentId }, include: { family: { include: { guardians: true } } } });
    const father = st.family.guardians.find((g) => g.relation === 'FATHER') ?? st.family.guardians[0];
    const school = await prisma.school.findUniqueOrThrow({ where: { id: w.schoolId } });
    const lastResult = await prisma.studentResult.findFirst({ where: { studentId: st.id, assessment: { kind: 'EXAM', status: 'PUBLISHED' } }, include: { assessment: { select: { title: true, publishedAt: true } } }, orderBy: { assessment: { publishedAt: 'desc' } } });
    res.json({
      school: { name: school.name, address: school.address, city: school.city, phone: school.phone, logoFileId: school.logoFileId },
      certificate: {
        no: w.certificateNo,
        issuedOn: ymd(w.completedAt),
        studentName: st.fullName,
        fatherName: father?.fullName ?? '',
        gender: st.gender,
        dob: ymd(st.dob),
        bForm: st.bForm,
        admissionNo: st.admissionNo,
        admissionDate: ymd(st.admissionDate),
        classAtLeaving: w.classLabel,
        leavingDate: ymd(w.leavingDate),
        reason: w.reason,
        conduct: w.conduct,
        remarks: w.remarks,
        lastExam: lastResult ? { title: lastResult.assessment.title, percent: num(lastResult.percent), grade: lastResult.grade, passed: lastResult.passed } : null,
        duesCleared: true,
      },
    });
  }),
);

// ---------- Session closing and promotion ----------

export const promotionRouter = Router();
const needPrincipal = (req: Request) => {
  if (req.user!.role !== 'PRINCIPAL') throw forbidden('Only the principal can close the session');
};

/** Proposal: each class with its students, a suggested next class, and a suggested action per student. */
promotionRouter.get(
  '/plan',
  ah(async (req, res) => {
    needPrincipal(req);
    const schoolId = tenantId(req);
    const current = await prisma.academicSession.findFirst({ where: { schoolId, isCurrent: true } });
    const classes = await prisma.classLevel.findMany({ where: { schoolId, deletedAt: null }, include: { sections: { where: { deletedAt: null }, orderBy: { name: 'asc' } } }, orderBy: { sortOrder: 'asc' } });
    const students = await prisma.student.findMany({ where: { schoolId, status: 'ACTIVE', deletedAt: null }, select: { id: true, fullName: true, rollNo: true, classId: true, sectionId: true, photoFileId: true }, orderBy: [{ rollNo: 'asc' }, { fullName: 'asc' }] });
    // Latest published term exam of the current session decides the suggestion (failed → stay in class).
    const results = await prisma.studentResult.findMany({
      where: { studentId: { in: students.map((s) => s.id) }, assessment: { kind: 'EXAM', status: 'PUBLISHED', ...(current ? { sessionId: current.id } : {}) } },
      include: { assessment: { select: { title: true, publishedAt: true } } },
      orderBy: { assessment: { publishedAt: 'desc' } },
    });
    const done = current ? await prisma.promotionRecord.findFirst({ where: { schoolId, fromSessionId: current.id } }) : null;
    res.json({
      current: current ? { id: current.id, name: current.name, startDate: ymd(current.startDate), endDate: ymd(current.endDate) } : null,
      alreadyPromoted: Boolean(done),
      classes: classes.map((c, i) => {
        const next = classes[i + 1] ?? null;
        return {
          id: c.id,
          label: classLabel(c),
          sections: c.sections.map((s) => ({ id: s.id, name: s.name })),
          suggestedTargetClassId: next?.id ?? null,
          students: students
            .filter((s) => s.classId === c.id)
            .map((s) => {
              const r = results.find((x) => x.studentId === s.id);
              return {
                id: s.id,
                fullName: s.fullName,
                rollNo: s.rollNo,
                photoFileId: s.photoFileId,
                sectionId: s.sectionId,
                section: c.sections.find((x) => x.id === s.sectionId)?.name ?? null,
                result: r ? { title: r.assessment.title, percent: num(r.percent), passed: r.passed } : null,
                suggested: r && !r.passed ? 'RETAIN' : next ? 'PROMOTE' : 'GRADUATE',
              };
            }),
        };
      }),
    });
  }),
);

const runBody = z.object({
  newSession: z.object({ name: z.string().trim().min(2).max(40), startDate: isoDate, endDate: isoDate }),
  feeIncreasePercent: z.coerce.number().min(0).max(100).default(0),
  classes: z
    .array(
      z.object({
        classId: z.string(),
        targetClassId: z.string().nullable(),
        students: z.array(z.object({ studentId: z.string(), action: z.enum(['PROMOTE', 'RETAIN', 'GRADUATE']), toSectionId: z.string().nullish() })).max(2000),
      }),
    )
    .max(100),
});

/** Close the session: move every student, start the new session, optionally raise fees. */
promotionRouter.post(
  '/run',
  ah(async (req, res) => {
    needPrincipal(req);
    const schoolId = tenantId(req);
    const b = parse(runBody, req.body);
    if (b.newSession.endDate <= b.newSession.startDate) throw badRequest('The session must end after it starts');
    const current = await prisma.academicSession.findFirst({ where: { schoolId, isCurrent: true } });
    if (current && b.newSession.startDate <= ymd(current.startDate)!) throw badRequest('The new session must start after the current one');
    if (current && (await prisma.promotionRecord.findFirst({ where: { schoolId, fromSessionId: current.id } }))) throw conflict('This session has already been closed');
    if (await prisma.academicSession.findFirst({ where: { schoolId, name: b.newSession.name } })) throw conflict('A session with this name already exists');
    const classes = await prisma.classLevel.findMany({ where: { schoolId, deletedAt: null }, include: { sections: { where: { deletedAt: null } } } });
    const students = await prisma.student.findMany({ where: { schoolId, status: 'ACTIVE', deletedAt: null }, select: { id: true, classId: true, sectionId: true } });
    const decided = new Map<string, { action: string; toClassId: string | null; toSectionId: string | null }>();
    for (const c of b.classes) {
      const from = classes.find((x) => x.id === c.classId);
      if (!from) throw badRequest('Unknown class');
      const target = c.targetClassId ? classes.find((x) => x.id === c.targetClassId) : null;
      if (c.targetClassId && !target) throw badRequest('Unknown target class');
      for (const s of c.students) {
        const st = students.find((x) => x.id === s.studentId && x.classId === c.classId);
        if (!st) throw badRequest('A student does not belong to the class they were listed under');
        if (s.action === 'PROMOTE' && !target) throw badRequest(`Choose the next class for ${classLabel(from)} or mark its students as graduated`);
        const curSection = from.sections.find((x) => x.id === st.sectionId);
        let toClassId: string | null = null;
        let toSectionId: string | null = null;
        if (s.action === 'RETAIN') {
          toClassId = from.id;
          toSectionId = s.toSectionId ?? st.sectionId;
        } else if (s.action === 'PROMOTE') {
          toClassId = target!.id;
          // Same section name in the next class when it exists, otherwise its first section.
          toSectionId = s.toSectionId ?? target!.sections.find((x) => x.name === curSection?.name)?.id ?? target!.sections[0]?.id ?? null;
        }
        if (toSectionId && toClassId && !classes.find((x) => x.id === toClassId)!.sections.some((x) => x.id === toSectionId)) throw badRequest('Section is not in the target class');
        decided.set(st.id, { action: s.action, toClassId, toSectionId });
      }
    }
    const missing = students.filter((s) => !decided.has(s.id));
    if (missing.length) throw badRequest(`${missing.length} active student(s) have no decision`, { missing: missing.length });

    const batchId = crypto.randomUUID();
    const result = await prisma.$transaction(
      async (tx) => {
        const session = await tx.academicSession.create({ data: { schoolId, name: b.newSession.name, startDate: new Date(b.newSession.startDate), endDate: new Date(b.newSession.endDate), isCurrent: false } });
        const counts = { PROMOTE: 0, RETAIN: 0, GRADUATE: 0 } as Record<string, number>;
        for (const st of students) {
          const d = decided.get(st.id)!;
          counts[d.action]++;
          await tx.promotionRecord.create({ data: { schoolId, batchId, studentId: st.id, fromSessionId: current?.id ?? null, toSessionId: session.id, fromClassId: st.classId, fromSectionId: st.sectionId, toClassId: d.toClassId, toSectionId: d.toSectionId, action: d.action } });
          if (d.action === 'GRADUATE') {
            await tx.student.update({ where: { id: st.id }, data: { status: 'GRADUATED', statusDate: current?.endDate ?? new Date(), statusReason: `Graduated (${current?.name ?? 'session'})` } });
            await syncLoginsForStatus(tx, st.id);
          } else {
            await tx.student.update({ where: { id: st.id }, data: { classId: d.toClassId!, sectionId: d.toSectionId, sessionId: session.id } });
          }
        }
        await tx.academicSession.updateMany({ where: { schoolId }, data: { isCurrent: false } });
        await tx.academicSession.update({ where: { id: session.id }, data: { isCurrent: true } });
        let feesChanged = 0;
        if (b.feeIncreasePercent > 0) {
          const fees = await tx.classFee.findMany({ where: { head: { schoolId } } });
          for (const f of fees) {
            await tx.classFee.update({ where: { classId_headId: { classId: f.classId, headId: f.headId } }, data: { amount: Math.round(num(f.amount) * (1 + b.feeIncreasePercent / 100)) } });
            feesChanged++;
          }
        }
        return { sessionId: session.id, counts, feesChanged };
      },
      { timeout: 60000 },
    );
    // Unpaid vouchers stay open, so arrears carry forward into the new session automatically.
    const arrears = await prisma.feeInvoice.aggregate({ where: { schoolId, status: { in: ['UNPAID', 'PARTIAL'] } }, _sum: { total: true, paidAmount: true } });
    await audit(req, { action: 'session.close', entityType: 'AcademicSession', entityId: result.sessionId, after: { from: current?.name, to: b.newSession.name, ...result.counts, feeIncreasePercent: b.feeIncreasePercent } });
    res.json({ ...result, arrearsCarried: round2(num(arrears._sum.total) - num(arrears._sum.paidAmount)) });
  }),
);

promotionRouter.get(
  '/history',
  ah(async (req, res) => {
    needPrincipal(req);
    const schoolId = tenantId(req);
    const groups = await prisma.promotionRecord.groupBy({ by: ['batchId', 'fromSessionId', 'toSessionId', 'action'], where: { schoolId }, _count: { _all: true }, _min: { createdAt: true } });
    const sessions = await prisma.academicSession.findMany({ where: { schoolId } });
    const batches = new Map<string, { batchId: string; from: string | null; to: string; at: Date | null; counts: Record<string, number> }>();
    for (const g of groups) {
      const x = batches.get(g.batchId) ?? { batchId: g.batchId, from: sessions.find((s) => s.id === g.fromSessionId)?.name ?? null, to: sessions.find((s) => s.id === g.toSessionId)?.name ?? '', at: g._min.createdAt, counts: {} };
      x.counts[g.action] = g._count._all;
      batches.set(g.batchId, x);
    }
    res.json({ batches: [...batches.values()].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)) });
  }),
);

// ---------- Academic history of a student ----------

export const historyRouter = Router();

historyRouter.get(
  '/students/:id',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const st = await prisma.student.findFirst({ where: { id: req.params.id, schoolId }, include: { class: true, section: true } });
    if (!st) throw notFound('Student not found');
    const u = req.user!;
    let ok = can(req, 'students.view');
    if (!ok && u.role === 'TEACHER') ok = Boolean(st.sectionId && (await teacherSectionIds(schoolId, u.id)).includes(st.sectionId));
    if (!ok) throw notFound('Student not found');
    const [sessions, promotions, results, remarks, honors, payments] = await Promise.all([
      prisma.academicSession.findMany({ where: { schoolId }, orderBy: { startDate: 'asc' } }),
      prisma.promotionRecord.findMany({ where: { studentId: st.id }, orderBy: { createdAt: 'asc' } }),
      prisma.studentResult.findMany({ where: { studentId: st.id, assessment: { status: 'PUBLISHED' } }, include: { assessment: { select: { id: true, title: true, kind: true, sessionId: true, publishedAt: true } } } }),
      prisma.studentRemark.count({ where: { studentId: st.id, deletedAt: null } }),
      prisma.honor.findMany({ where: { studentId: st.id }, include: { type: true } }),
      prisma.feePaymentAllocation.findMany({ where: { invoice: { studentId: st.id }, payment: { status: { not: 'CANCELLED' } } }, include: { payment: { select: { receivedAt: true } } } }),
    ]);
    const classIds = [...new Set([st.classId, ...promotions.flatMap((p) => [p.fromClassId, p.toClassId]).filter((x): x is string => Boolean(x))])];
    const sectionIds = [...new Set(promotions.flatMap((p) => [p.fromSectionId, p.toSectionId]).filter((x): x is string => Boolean(x)))];
    const [cls, secs] = await Promise.all([prisma.classLevel.findMany({ where: { id: { in: classIds } } }), prisma.section.findMany({ where: { id: { in: sectionIds } } })]);
    const label = (cid: string | null, sid: string | null) => {
      const c = cls.find((x) => x.id === cid);
      return c ? classLabel(c, secs.find((x) => x.id === sid) ?? null) : '';
    };
    // Which class the student was in during each session.
    const rows = [];
    for (const s of sessions) {
      const leftFrom = promotions.find((p) => p.fromSessionId === s.id);
      const cameTo = promotions.find((p) => p.toSessionId === s.id);
      let classText: string | null = null;
      if (leftFrom) classText = label(leftFrom.fromClassId, leftFrom.fromSectionId);
      else if (cameTo) classText = cameTo.toClassId ? label(cameTo.toClassId, cameTo.toSectionId) : null;
      else if (s.isCurrent && st.status === 'ACTIVE') classText = classLabel(st.class, st.section);
      const inSession = (d: Date) => d >= s.startDate && d <= new Date(s.endDate.getTime() + 86400000);
      if (!classText && !results.some((r) => r.assessment.sessionId === s.id) && !(s.isCurrent && st.sessionId === s.id)) continue;
      const att = await prisma.attendanceRecord.groupBy({ by: ['status'], where: { studentId: st.id, date: { gte: s.startDate, lte: s.endDate } }, _count: { _all: true } });
      const c: Record<string, number> = {};
      att.forEach((g) => (c[g.status] = g._count._all));
      const sr = results.filter((r) => r.assessment.sessionId === s.id).sort((a, b) => (a.assessment.publishedAt?.getTime() ?? 0) - (b.assessment.publishedAt?.getTime() ?? 0));
      rows.push({
        session: { id: s.id, name: s.name, current: s.isCurrent },
        classLabel: classText ?? classLabel(st.class, st.section),
        outcome: leftFrom?.action ?? null,
        attendance: { percent: attendancePercent(c), days: Object.values(c).reduce((a, b) => a + b, 0) },
        exams: sr.filter((r) => r.assessment.kind === 'EXAM').map((r) => ({ id: r.assessment.id, title: r.assessment.title, percent: num(r.percent), grade: r.grade, position: r.positionClass, passed: r.passed })),
        testAverage: sr.filter((r) => r.assessment.kind === 'TEST').length ? round2(sr.filter((r) => r.assessment.kind === 'TEST').reduce((a, r) => a + num(r.percent), 0) / sr.filter((r) => r.assessment.kind === 'TEST').length) : null,
        feesPaid: round2(payments.filter((p) => inSession(p.payment.receivedAt)).reduce((a, p) => a + num(p.amount), 0)),
        honors: honors.filter((h) => h.createdAt >= s.startDate && h.createdAt <= new Date(s.endDate.getTime() + 86400000)).map((h) => ({ name: h.type.name, icon: h.type.icon, period: h.period })),
      });
    }
    const withdrawal = await prisma.withdrawal.findFirst({ where: { studentId: st.id, status: 'COMPLETED' }, orderBy: { completedAt: 'desc' } });
    res.json({
      student: { admissionDate: ymd(st.admissionDate), status: st.status, statusDate: ymd(st.statusDate), statusReason: st.statusReason },
      sessions: rows.reverse(),
      remarks,
      leaving: withdrawal ? { id: withdrawal.id, certificateNo: withdrawal.certificateNo, leavingDate: ymd(withdrawal.leavingDate) } : null,
    });
  }),
);

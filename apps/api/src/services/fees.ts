import type { FeeSettings, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest } from '../lib/errors';
import { round2 } from '../lib/money';
import { nextNumber } from './counters';

type Tx = Prisma.TransactionClient;
export const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export async function getFeeSettings(schoolId: string): Promise<FeeSettings> {
  return (await prisma.feeSettings.findUnique({ where: { schoolId } })) ?? prisma.feeSettings.upsert({ where: { schoolId }, create: { schoolId }, update: {} });
}

/** Late fee for paying a voucher on `onDate` (YYYY-MM-DD). */
export function lateFeeFor(s: FeeSettings, dueDate: Date, onDate: string): number {
  const days = Math.floor((asDate(onDate).getTime() - asDate(ymd(dueDate)).getTime()) / 86400000);
  if (days <= 0 || s.lateFeeType === 'NONE') return 0;
  if (s.lateFeeType === 'FIXED') return num(s.lateFeeAmount);
  const v = num(s.lateFeeAmount) * days;
  const cap = num(s.lateFeeMax);
  return round2(cap > 0 ? Math.min(v, cap) : v);
}

/** Recomputes a voucher's paid amount and status from its allocations (valid receipts only). */
export async function recalcInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.feeInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.status === 'CANCELLED') return inv;
  const agg = await tx.feePaymentAllocation.aggregate({ where: { invoiceId, payment: { status: { not: 'CANCELLED' } } }, _sum: { amount: true } });
  const paid = round2(num(agg._sum.amount));
  const total = num(inv.total);
  // A voucher with nothing left to pay (e.g. fully waived) counts as paid.
  const status = total <= 0.001 ? 'PAID' : paid <= 0 ? 'UNPAID' : paid + 0.001 >= total ? 'PAID' : 'PARTIAL';
  return tx.feeInvoice.update({ where: { id: invoiceId }, data: { paidAmount: paid, status } });
}

async function nextInvoiceNo(tx: Tx, schoolId: string) {
  return `INV-${String(await nextNumber(tx, schoolId, 'invoice')).padStart(6, '0')}`;
}

/** Open vouchers (with a balance), oldest due first. */
export async function openInvoices(db: Tx | typeof prisma, where: Prisma.FeeInvoiceWhereInput) {
  const rows = await db.feeInvoice.findMany({
    where: { ...where, status: { in: ['UNPAID', 'PARTIAL'] } },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    include: { lines: true },
  });
  return rows.map((r) => ({ ...r, balance: round2(num(r.total) - num(r.paidAmount)) })).filter((r) => r.balance > 0.001);
}

/** Money paid by a family that has not been used against any voucher yet (advance / credit). */
export async function familyCredit(db: Tx | typeof prisma, familyId: string) {
  const payments = await db.feePayment.findMany({ where: { familyId, status: { not: 'CANCELLED' } }, select: { id: true, amount: true, receivedAt: true, allocations: { select: { amount: true } } } });
  return payments
    .map((p) => ({ id: p.id, receivedAt: p.receivedAt, unallocated: round2(num(p.amount) - p.allocations.reduce((a, x) => a + num(x.amount), 0)) }))
    .filter((p) => p.unallocated > 0.001)
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}

/** Uses a family's credit to pay its open vouchers (oldest first). */
export async function applyCredit(tx: Tx, familyId: string) {
  const credits = await familyCredit(tx, familyId);
  if (!credits.length) return 0;
  const invoices = await openInvoices(tx, { familyId });
  let used = 0;
  const touched = new Set<string>();
  for (const c of credits) {
    let left = c.unallocated;
    for (const inv of invoices) {
      if (left <= 0.001) break;
      if (inv.balance <= 0.001) continue;
      const amt = round2(Math.min(left, inv.balance));
      await tx.feePaymentAllocation.create({ data: { paymentId: c.id, invoiceId: inv.id, amount: amt } });
      inv.balance = round2(inv.balance - amt);
      left = round2(left - amt);
      used = round2(used + amt);
      touched.add(inv.id);
    }
  }
  for (const id of touched) await recalcInvoice(tx, id);
  return used;
}

// ---------- Generating vouchers ----------

interface Line {
  headId: string | null;
  kind: string;
  description: string;
  amount: number;
}

/** Monthly lines for one student: heads due this month, minus the student's discount on discountable heads. */
export function monthlyLines(
  heads: { id: string; name: string; frequency: string; months: unknown; discountable: boolean; amount: number }[],
  month: number,
  discount: { percent: number; amount: number; label: string | null },
): Line[] {
  const due = heads.filter((h) => h.amount > 0 && (h.frequency === 'MONTHLY' || (h.frequency === 'SELECTED_MONTHS' && Array.isArray(h.months) && (h.months as number[]).includes(month))));
  const lines: Line[] = due.map((h) => ({ headId: h.id, kind: 'MONTHLY', description: h.name, amount: h.amount }));
  const base = due.filter((h) => h.discountable).reduce((a, h) => a + h.amount, 0);
  const off = Math.min(base, round2((base * discount.percent) / 100 + discount.amount));
  if (off > 0) lines.push({ headId: null, kind: 'DISCOUNT', description: `Discount${discount.label ? ` (${discount.label})` : ''}`, amount: -off });
  return lines;
}

/**
 * Creates the monthly vouchers for a period (skips students who already have one).
 * Afterwards each family's credit (advance payments) is applied.
 */
export async function generateMonthly(schoolId: string, period: string, opts: { classIds?: string[]; createdById?: string | null; dueDate?: string } = {}) {
  const settings = await getFeeSettings(schoolId);
  const [y, m] = period.split('-').map(Number);
  const dueDate = opts.dueDate ?? `${period}-${String(Math.min(settings.dueDay, 28)).padStart(2, '0')}`;
  const heads = await prisma.feeHead.findMany({ where: { schoolId, isActive: true }, include: { classFees: true }, orderBy: { sortOrder: 'asc' } });
  const students = await prisma.student.findMany({
    where: { schoolId, status: 'ACTIVE', deletedAt: null, ...(opts.classIds?.length ? { classId: { in: opts.classIds } } : {}) },
    select: { id: true, familyId: true, classId: true, discountPercent: true, discountAmount: true, discountType: true, admissionDate: true },
  });
  const existing = new Set((await prisma.feeInvoice.findMany({ where: { schoolId, period, status: { not: 'CANCELLED' } }, select: { studentId: true } })).map((i) => i.studentId));
  let created = 0;
  let skipped = 0;
  let empty = 0;
  const families = new Set<string>();
  for (const st of students) {
    if (existing.has(st.id)) {
      skipped++;
      continue;
    }
    // Students admitted after this month are not charged for it.
    if (st.admissionDate > new Date(Date.UTC(y, m, 0))) {
      skipped++;
      continue;
    }
    const lines = monthlyLines(
      heads.map((h) => ({ ...h, amount: num(h.classFees.find((c) => c.classId === st.classId)?.amount) })),
      m,
      { percent: num(st.discountPercent), amount: num(st.discountAmount), label: st.discountType },
    );
    const total = round2(lines.reduce((a, l) => a + l.amount, 0));
    if (lines.length === 0 || total <= 0) {
      empty++;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.feeInvoice.create({
        data: {
          schoolId,
          studentId: st.id,
          familyId: st.familyId,
          invoiceNo: await nextInvoiceNo(tx, schoolId),
          period,
          title: `Fee for ${monthLabel(period)}`,
          issueDate: new Date(),
          dueDate: asDate(dueDate),
          total,
          createdById: opts.createdById ?? null,
          lines: { create: lines },
        },
      });
    });
    families.add(st.familyId);
    created++;
  }
  for (const f of families) await prisma.$transaction((tx) => applyCredit(tx, f));
  return { created, skipped, empty, dueDate };
}

/** One-off charge (admission fee, trip, books…) for selected students. */
export async function createOneOff(
  schoolId: string,
  input: { studentIds: string[]; title: string; lines: { headId?: string | null; description: string; amount: number }[]; dueDate: string; createdById: string },
) {
  const students = await prisma.student.findMany({ where: { schoolId, id: { in: input.studentIds }, deletedAt: null }, select: { id: true, familyId: true } });
  if (students.length !== new Set(input.studentIds).size) throw badRequest('Unknown student');
  const total = round2(input.lines.reduce((a, l) => a + l.amount, 0));
  if (total <= 0) throw badRequest('Total must be more than zero');
  const ids: string[] = [];
  for (const st of students) {
    await prisma.$transaction(async (tx) => {
      const inv = await tx.feeInvoice.create({
        data: {
          schoolId,
          studentId: st.id,
          familyId: st.familyId,
          invoiceNo: await nextInvoiceNo(tx, schoolId),
          period: null,
          title: input.title,
          issueDate: new Date(),
          dueDate: asDate(input.dueDate),
          total,
          createdById: input.createdById,
          lines: { create: input.lines.map((l) => ({ headId: l.headId ?? null, kind: 'ONE_TIME', description: l.description, amount: l.amount })) },
        },
      });
      ids.push(inv.id);
      await applyCredit(tx, st.familyId);
    });
  }
  return ids;
}

// ---------- Collecting ----------

export interface CollectInput {
  schoolId: string;
  familyId: string;
  /** Limit to these students' vouchers (null = whole family). */
  studentIds?: string[] | null;
  /** Pay only these vouchers (else oldest first). */
  invoiceIds?: string[] | null;
  amount: number;
  method: string;
  reference?: string | null;
  receivedAt: Date;
  collectedById: string | null;
  source: 'COUNTER' | 'ONLINE';
  chargeLateFee: boolean;
  note?: string | null;
}

/**
 * Records a payment: adds late fees to overdue vouchers (if chosen), then pays the vouchers oldest first.
 * Anything left over stays as the family's credit for future vouchers.
 */
export async function collect(tx: Tx, input: CollectInput) {
  if (input.amount <= 0) throw badRequest('Amount must be more than zero');
  const settings = (await tx.feeSettings.findUnique({ where: { schoolId: input.schoolId } })) ?? (await getFeeSettings(input.schoolId));
  const where: Prisma.FeeInvoiceWhereInput = {
    schoolId: input.schoolId,
    familyId: input.familyId,
    ...(input.studentIds?.length ? { studentId: { in: input.studentIds } } : {}),
    ...(input.invoiceIds?.length ? { id: { in: input.invoiceIds } } : {}),
  };
  const onDate = ymd(input.receivedAt);
  let invoices = await openInvoices(tx, where);
  const lateAdded: { invoiceId: string; amount: number }[] = [];
  if (input.chargeLateFee) {
    for (const inv of invoices) {
      if (inv.lateFeeApplied) continue;
      const fee = lateFeeFor(settings, inv.dueDate, onDate);
      if (fee <= 0) continue;
      await tx.feeInvoiceLine.create({ data: { invoiceId: inv.id, kind: 'LATE_FEE', description: 'Late payment fee', amount: fee } });
      await tx.feeInvoice.update({ where: { id: inv.id }, data: { total: { increment: fee }, lateFeeApplied: true } });
      lateAdded.push({ invoiceId: inv.id, amount: fee });
    }
    if (lateAdded.length) invoices = await openInvoices(tx, where);
  }
  const receiptNo = `${settings.receiptPrefix}-${String(await nextNumber(tx, input.schoolId, 'receipt')).padStart(6, '0')}`;
  const payment = await tx.feePayment.create({
    data: {
      schoolId: input.schoolId,
      receiptNo,
      familyId: input.familyId,
      studentId: input.studentIds?.length === 1 ? input.studentIds[0] : null,
      amount: round2(input.amount),
      method: input.method,
      reference: input.reference ?? null,
      source: input.source,
      receivedAt: input.receivedAt,
      collectedById: input.collectedById,
      note: input.note ?? null,
    },
  });
  let left = round2(input.amount);
  for (const inv of invoices) {
    if (left <= 0.001) break;
    const amt = round2(Math.min(left, inv.balance));
    await tx.feePaymentAllocation.create({ data: { paymentId: payment.id, invoiceId: inv.id, amount: amt } });
    left = round2(left - amt);
    await recalcInvoice(tx, inv.id);
  }
  return { payment, credit: left, lateAdded };
}

export async function cancelPayment(tx: Tx, paymentId: string, byUserId: string, reason: string) {
  const p = await tx.feePayment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: true } });
  await tx.feePayment.update({ where: { id: p.id }, data: { status: 'CANCELLED', cancelReason: reason, cancelledById: byUserId, cancelledAt: new Date() } });
  await tx.feePaymentAllocation.deleteMany({ where: { paymentId: p.id } });
  for (const a of p.allocations) await recalcInvoice(tx, a.invoiceId);
  return p;
}

/** Dues of a family (optionally some students): open vouchers, late fee if paid today, credit. */
export async function familyDues(schoolId: string, familyId: string, today: string, studentIds?: string[]) {
  const settings = await getFeeSettings(schoolId);
  const invoices = await openInvoices(prisma, { schoolId, familyId, ...(studentIds?.length ? { studentId: { in: studentIds } } : {}) });
  const credit = round2((await familyCredit(prisma, familyId)).reduce((a, c) => a + c.unallocated, 0));
  const withLate = invoices.map((i) => ({ ...i, lateFeeIfPaidToday: i.lateFeeApplied ? 0 : lateFeeFor(settings, i.dueDate, today), overdue: ymd(i.dueDate) < today }));
  const due = round2(withLate.reduce((a, i) => a + i.balance, 0));
  const late = round2(withLate.reduce((a, i) => a + i.lateFeeIfPaidToday, 0));
  return { invoices: withLate, due, lateFee: late, credit, payable: round2(Math.max(0, due + late - credit)) };
}

/**
 * Hourly job: schools with "generate automatically" get this month's vouchers once the month has started
 * (in the school's time zone). Returns the schools processed.
 */
export async function autoGenerateDue(now = new Date()) {
  const schools = await prisma.feeSettings.findMany({ where: { autoGenerate: true }, select: { schoolId: true } });
  const done: { schoolId: string; period: string; created: number }[] = [];
  for (const { schoolId } of schools) {
    const school = await prisma.school.findUnique({ where: { id: schoolId }, include: { plan: true } });
    if (!school || school.deletedAt || !['ACTIVE', 'TRIAL'].includes(school.status)) continue;
    if (!((school.plan.modules as string[]) ?? []).includes('fees')) continue;
    const period = new Intl.DateTimeFormat('en-CA', { timeZone: school.timezone, year: 'numeric', month: '2-digit' }).format(now).slice(0, 7);
    const already = await prisma.feeInvoice.count({ where: { schoolId, period } });
    if (already) continue;
    const r = await generateMonthly(schoolId, period, { createdById: null });
    if (r.created) {
      const { sendFeeNotices } = await import('./feeMessages');
      const families = (await prisma.feeInvoice.findMany({ where: { schoolId, period }, select: { familyId: true } })).map((i) => i.familyId);
      await sendFeeNotices(schoolId, families, { force: false, title: `Fee voucher for ${monthLabel(period)}` });
    }
    await prisma.auditLog.create({ data: { schoolId, action: 'fees.auto_generate', entityType: 'School', entityId: schoolId, after: { period, ...r } } });
    done.push({ schoolId, period, created: r.created });
  }
  return done;
}

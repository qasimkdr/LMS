import type { Plan, School } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { round2, toNum } from '../lib/money';
import { periodRange } from '../lib/dates';
import { countActiveStudents } from './limits';

export const GRACE_DAYS = 7;
export const SUSPEND_AFTER_DAYS = 30;
const DAY = 24 * 3600 * 1000;

/** Fixed plan price + per-student price for every active student above the plan's included count. */
export function calculateAmount(plan: Pick<Plan, 'monthlyPrice' | 'includedStudents' | 'perStudentPrice'>, activeStudents: number) {
  const base = toNum(plan.monthlyPrice)!;
  const per = toNum(plan.perStudentPrice)!;
  const extraStudents = Math.max(0, activeStudents - plan.includedStudents);
  return { base, per, extraStudents, amount: round2(base + extraStudents * per) };
}

export async function previewInvoice(school: School & { plan: Plan }) {
  const activeStudents = await countActiveStudents(school.id);
  return { activeStudents, ...calculateAmount(school.plan, activeStudents) };
}

function dueDateFor(period: string, billingDay: number) {
  const { start } = periodRange(period);
  const day = Math.min(Math.max(billingDay, 1), 28);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day, 23, 59, 59));
}

/** Creates the invoice for one school and month. Returns null if it already exists. */
export async function generateInvoice(school: School & { plan: Plan }, period: string) {
  const existing = await prisma.schoolInvoice.findUnique({ where: { schoolId_period: { schoolId: school.id, period } } });
  if (existing) return null;
  const p = await previewInvoice(school);
  return prisma.schoolInvoice.create({
    data: {
      schoolId: school.id,
      period,
      planName: school.plan.name,
      basePrice: p.base,
      includedStudents: school.plan.includedStudents,
      activeStudents: p.activeStudents,
      extraStudents: p.extraStudents,
      perStudentPrice: p.per,
      amount: p.amount,
      dueDate: dueDateFor(period, school.billingDay),
    },
  });
}

/** Schools billed in a month: everything except trials, suspended and deleted schools. */
export async function generateInvoicesForPeriod(period: string) {
  const schools = await prisma.school.findMany({
    where: { deletedAt: null, status: { in: ['ACTIVE', 'READ_ONLY'] } },
    include: { plan: true },
  });
  let created = 0;
  for (const s of schools) if (await generateInvoice(s, period)) created++;
  return { created, skipped: schools.length - created };
}

/**
 * Unpaid past the grace period -> READ_ONLY; unpaid for SUSPEND_AFTER_DAYS -> SUSPENDED.
 * Returns the schools whose status changed.
 */
export async function applyOverduePolicy(now = new Date()) {
  const overdue = await prisma.schoolInvoice.findMany({
    where: { status: 'UNPAID', dueDate: { lt: new Date(now.getTime() - GRACE_DAYS * DAY) } },
    include: { school: true },
    orderBy: { dueDate: 'asc' },
  });
  const changes: { schoolId: string; from: string; to: string }[] = [];
  const seen = new Set<string>();
  for (const inv of overdue) {
    if (seen.has(inv.schoolId) || inv.school.deletedAt) continue;
    seen.add(inv.schoolId);
    const target = inv.dueDate.getTime() < now.getTime() - SUSPEND_AFTER_DAYS * DAY ? 'SUSPENDED' : 'READ_ONLY';
    const from = inv.school.status;
    const shouldChange = (target === 'SUSPENDED' && from !== 'SUSPENDED') || (target === 'READ_ONLY' && from === 'ACTIVE');
    if (shouldChange) {
      await prisma.school.update({ where: { id: inv.schoolId }, data: { status: target } });
      await prisma.auditLog.create({
        data: {
          schoolId: inv.schoolId,
          action: 'school.status_auto',
          entityType: 'School',
          entityId: inv.schoolId,
          before: { status: from },
          after: { status: target },
          reason: `Invoice ${inv.period} unpaid`,
        },
      });
      changes.push({ schoolId: inv.schoolId, from, to: target });
    }
  }
  return changes;
}

/** After a payment: a READ_ONLY school with no remaining overdue invoices goes back to ACTIVE. */
export async function restoreIfCleared(schoolId: string, now = new Date()) {
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school || school.status !== 'READ_ONLY') return false;
  const stillOverdue = await prisma.schoolInvoice.count({
    where: { schoolId, status: 'UNPAID', dueDate: { lt: new Date(now.getTime() - GRACE_DAYS * DAY) } },
  });
  if (stillOverdue) return false;
  await prisma.school.update({ where: { id: schoolId }, data: { status: 'ACTIVE' } });
  return true;
}

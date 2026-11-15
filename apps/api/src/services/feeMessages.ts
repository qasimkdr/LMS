import { prisma } from '../lib/prisma';
import { MESSAGE_TYPES, renderTemplate } from '../config/messageTypes';
import { enqueue, getSettings, notify, ruleFor, whatsappReady } from './messaging';
import { monthLabel, num, openInvoices } from './fees';
import { round2 } from '../lib/money';

const fmt = (n: number, currency: string) => `${currency} ${Math.round(n).toLocaleString('en-US')}`;
const niceDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

async function familyContacts(familyId: string) {
  const f = await prisma.family.findUniqueOrThrow({
    where: { id: familyId },
    select: {
      parentUserId: true,
      guardians: { where: { receivesMessages: true, isDeceased: false }, select: { fullName: true, phone: true, whatsapp: true } },
      students: { where: { deletedAt: null, status: 'ACTIVE' }, select: { id: true, fullName: true } },
    },
  });
  return f;
}

/** WhatsApp (if switched on) and in-app notice for a receipt. */
export async function sendReceipt(schoolId: string, paymentId: string) {
  const [p, school, settings] = await Promise.all([
    prisma.feePayment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: { include: { invoice: { select: { studentId: true } } } } } }),
    prisma.school.findUniqueOrThrow({ where: { id: schoolId } }),
    getSettings(schoolId),
  ]);
  const fam = await familyContacts(p.familyId);
  const studentIds = new Set(p.allocations.map((a) => a.invoice.studentId));
  if (p.studentId) studentIds.add(p.studentId);
  const names = fam.students.filter((s) => studentIds.has(s.id)).map((s) => s.fullName);
  const forWho = names.length ? names.join(', ') : 'your family';
  const balance = round2((await openInvoices(prisma, { familyId: p.familyId })).reduce((a, i) => a + i.balance, 0));
  const params = [fmt(num(p.amount), school.currency), forWho, niceDate(p.receivedAt), p.receiptNo, fmt(balance, school.currency), school.name];
  const body = renderTemplate(MESSAGE_TYPES.RECEIPT.suggestedTemplate.text, params);
  let queued = 0;
  if (whatsappReady(settings) && ruleFor(settings, 'RECEIPT') === 'auto') {
    queued = await enqueue(
      schoolId,
      settings,
      fam.guardians.map((g) => ({ to: { phone: g.whatsapp ?? g.phone ?? '', name: g.fullName }, type: 'RECEIPT', params, body })),
    );
  }
  if (fam.parentUserId) await notify(schoolId, [{ userId: fam.parentUserId, type: 'RECEIPT', title: `Fee received: ${params[0]}`, body, link: '/home/fees' }]);
  return queued;
}

/**
 * Fee reminders / "voucher issued" notices to families. One message per family listing all its children's dues.
 * `force` sends WhatsApp even when the rule is "manual" (someone pressed Send).
 */
export async function sendFeeNotices(schoolId: string, familyIds: string[], opts: { force: boolean; title?: string }) {
  const [school, settings] = await Promise.all([prisma.school.findUniqueOrThrow({ where: { id: schoolId } }), getSettings(schoolId)]);
  const rule = ruleFor(settings, 'FEE_VOUCHER');
  const useWhatsapp = whatsappReady(settings) && (rule === 'auto' || (opts.force && rule !== 'off'));
  let whatsapp = 0;
  let inApp = 0;
  for (const familyId of [...new Set(familyIds)]) {
    const invoices = await openInvoices(prisma, { schoolId, familyId });
    if (!invoices.length) continue;
    const fam = await familyContacts(familyId);
    const ids = new Set(invoices.map((i) => i.studentId));
    const names = fam.students.filter((s) => ids.has(s.id)).map((s) => s.fullName).join(', ') || 'your child';
    const due = round2(invoices.reduce((a, i) => a + i.balance, 0));
    const periods = [...new Set(invoices.map((i) => (i.period ? monthLabel(i.period) : i.title)))];
    const what = periods.length > 2 ? `${periods.length} months/charges` : periods.join(' and ');
    const latest = invoices[invoices.length - 1];
    const params = [names, what, niceDate(latest.dueDate), fmt(due, school.currency), school.name];
    const body = renderTemplate(MESSAGE_TYPES.FEE_VOUCHER.suggestedTemplate.text, params);
    if (useWhatsapp) {
      whatsapp += await enqueue(schoolId, settings, fam.guardians.map((g) => ({ to: { phone: g.whatsapp ?? g.phone ?? '', name: g.fullName }, type: 'FEE_VOUCHER', params, body })));
    }
    if (fam.parentUserId) {
      await notify(schoolId, [{ userId: fam.parentUserId, type: 'FEE_VOUCHER', title: opts.title ?? `Fee due: ${params[3]}`, body, link: '/home/fees' }]);
      inApp++;
    }
  }
  return { whatsapp, inApp };
}

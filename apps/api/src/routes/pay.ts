import crypto from 'node:crypto';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { assertPrincipal } from '../lib/http';
import { decrypt, encrypt } from '../lib/crypto';
import { round2 } from '../lib/money';
import { env } from '../config/env';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { collect, familyDues, num } from '../services/fees';
import { sendReceipt } from '../services/feeMessages';
import { jazzcashCheckout, jazzcashResult } from '../services/gateways';
import { schoolToday } from './attendance';

/** Online fee payment through each school's own merchant account. */
const router = Router();

const hasModule = (req: Request) => ((req.user!.school!.plan.modules as string[]) ?? []).includes('online_fee_payment');
const assertModule = (req: Request) => {
  if (!hasModule(req)) throw forbidden('Your plan does not include online fee payment', 'MODULE_DISABLED');
};

async function gateway(schoolId: string) {
  return (await prisma.paymentGatewaySettings.findUnique({ where: { schoolId } })) ?? prisma.paymentGatewaySettings.create({ data: { schoolId } });
}

const view = (g: Awaited<ReturnType<typeof gateway>>) => ({
  provider: g.provider,
  enabled: g.enabled,
  merchantId: g.merchantId,
  hasPassword: Boolean(g.passwordEnc),
  hasIntegritySalt: Boolean(g.integritySaltEnc),
  sandbox: g.sandbox,
  allowPartial: g.allowPartial,
  testGatewayAvailable: env.PAYMENTS_TEST_GATEWAY,
  returnUrl: `${env.APP_URL}/api/pay/return/jazzcash/${g.schoolId}`,
});

router.get(
  '/settings',
  ah(async (req, res) => {
    assertPrincipal(req);
    assertModule(req);
    res.json({ settings: view(await gateway(tenantId(req))) });
  }),
);

router.put(
  '/settings',
  ah(async (req, res) => {
    assertPrincipal(req);
    assertModule(req);
    const schoolId = tenantId(req);
    const body = parse(
      z.object({
        provider: z.enum(['NONE', 'JAZZCASH', 'TEST']).optional(),
        enabled: z.boolean().optional(),
        merchantId: z.string().trim().max(60).optional(),
        password: z.string().trim().min(1).max(200).optional(),
        integritySalt: z.string().trim().min(1).max(200).optional(),
        sandbox: z.boolean().optional(),
        allowPartial: z.boolean().optional(),
      }),
      req.body,
    );
    if (body.provider === 'TEST' && !env.PAYMENTS_TEST_GATEWAY) throw badRequest('The test gateway is not available on this server');
    const g = await gateway(schoolId);
    const next = { ...g, ...body };
    if (body.enabled && next.provider === 'JAZZCASH' && !(next.merchantId && (body.password || g.passwordEnc) && (body.integritySalt || g.integritySaltEnc))) {
      throw badRequest('Enter the merchant ID, password and integrity salt first');
    }
    if (body.enabled && next.provider === 'NONE') throw badRequest('Choose a payment provider first');
    const saved = await prisma.paymentGatewaySettings.update({
      where: { schoolId },
      data: {
        ...(body.provider ? { provider: body.provider } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.merchantId !== undefined ? { merchantId: body.merchantId || null } : {}),
        ...(body.password ? { passwordEnc: encrypt(body.password) } : {}),
        ...(body.integritySalt ? { integritySaltEnc: encrypt(body.integritySalt) } : {}),
        ...(body.sandbox !== undefined ? { sandbox: body.sandbox } : {}),
        ...(body.allowPartial !== undefined ? { allowPartial: body.allowPartial } : {}),
      },
    });
    await audit(req, { action: 'pay.settings', entityType: 'School', entityId: schoolId, after: { ...body, password: body.password ? 'changed' : undefined, integritySalt: body.integritySalt ? 'changed' : undefined } });
    res.json({ settings: view(saved) });
  }),
);

/** Parent starts a payment. Returns the form the browser must post to the gateway. */
router.post(
  '/start',
  ah(async (req, res) => {
    assertModule(req);
    const u = req.user!;
    if (u.role !== 'PARENT') throw forbidden('Only parents can pay online');
    const schoolId = tenantId(req);
    const body = parse(z.object({ invoiceIds: z.array(z.string()).optional(), amount: z.coerce.number().positive().optional() }), req.body ?? {});
    const g = await gateway(schoolId);
    if (!g.enabled || g.provider === 'NONE') throw badRequest('Online payment is not available. Please pay at the school.');
    const fam = await prisma.family.findFirst({ where: { schoolId, parentUserId: u.id } });
    if (!fam) throw notFound('Family not found');
    const dues = await familyDues(schoolId, fam.id, schoolToday(u.school!.timezone));
    const chosen = body.invoiceIds?.length ? dues.invoices.filter((i) => body.invoiceIds!.includes(i.id)) : dues.invoices;
    if (!chosen.length) throw badRequest('Nothing to pay');
    const full = round2(chosen.reduce((a, i) => a + i.balance + i.lateFeeIfPaidToday, 0));
    const amount = body.amount !== undefined ? round2(body.amount) : full;
    if (amount > full + 0.001) throw badRequest('Amount is more than what is due');
    if (amount < full - 0.001 && !g.allowPartial) throw badRequest('Your school accepts full payment only');
    const txnRef = `T${Date.now()}${crypto.randomInt(100, 999)}`;
    const op = await prisma.onlinePayment.create({
      data: { schoolId, familyId: fam.id, invoiceIds: chosen.map((i) => i.id), amount, provider: g.provider, txnRef, createdById: u.id },
    });
    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    if (g.provider === 'TEST') {
      if (!env.PAYMENTS_TEST_GATEWAY) throw badRequest('Test gateway is not available');
      return res.json({ ref: op.txnRef, action: `${env.APP_URL}/pay/test`, method: 'GET', fields: { ref: op.txnRef } });
    }
    const form = jazzcashCheckout({
      merchantId: g.merchantId!,
      password: decrypt(g.passwordEnc!),
      integritySalt: decrypt(g.integritySaltEnc!),
      sandbox: g.sandbox,
      txnRef,
      amount,
      billReference: `F${fam.familyNo}`,
      description: `${school.name} fee family ${fam.familyNo}`,
      returnUrl: `${env.APP_URL}/api/pay/return/jazzcash/${schoolId}`,
    });
    await audit(req, { action: 'pay.start', entityType: 'OnlinePayment', entityId: op.id, after: { amount, invoices: chosen.length } });
    res.json({ ref: op.txnRef, action: form.action, method: 'POST', fields: form.fields });
  }),
);

router.get(
  '/status/:ref',
  ah(async (req, res) => {
    const op = await prisma.onlinePayment.findFirst({ where: { txnRef: req.params.ref, schoolId: tenantId(req) } });
    if (!op || (req.user!.role === 'PARENT' && op.createdById !== req.user!.id)) throw notFound('Payment not found');
    const receipt = op.paymentId ? await prisma.feePayment.findUnique({ where: { id: op.paymentId }, select: { id: true, receiptNo: true } }) : null;
    res.json({ status: op.status, amount: num(op.amount), message: op.message, receipt });
  }),
);

/** Principal: list of online payments (to reconcile with the bank statement). */
router.get(
  '/transactions',
  ah(async (req, res) => {
    assertPrincipal(req);
    const rows = await prisma.onlinePayment.findMany({ where: { schoolId: tenantId(req) }, orderBy: { createdAt: 'desc' }, take: 200 });
    const fams = await prisma.family.findMany({ where: { id: { in: rows.map((r) => r.familyId) } }, select: { id: true, familyNo: true } });
    res.json({ transactions: rows.map((r) => ({ ...r, amount: num(r.amount), familyNo: fams.find((f) => f.id === r.familyId)?.familyNo, response: undefined })) });
  }),
);

// ---------- Built-in test gateway (only when PAYMENTS_TEST_GATEWAY=true) ----------

router.get(
  '/test/:ref',
  ah(async (req, res) => {
    if (!env.PAYMENTS_TEST_GATEWAY) throw notFound();
    const op = await prisma.onlinePayment.findFirst({ where: { txnRef: req.params.ref, schoolId: tenantId(req), provider: 'TEST' } });
    if (!op || op.createdById !== req.user!.id) throw notFound('Payment not found');
    res.json({ ref: op.txnRef, amount: num(op.amount), status: op.status, currency: req.user!.school!.currency });
  }),
);

router.post(
  '/test/:ref/complete',
  ah(async (req, res) => {
    if (!env.PAYMENTS_TEST_GATEWAY) throw notFound();
    const { outcome } = parse(z.object({ outcome: z.enum(['success', 'failure']) }), req.body);
    const op = await prisma.onlinePayment.findFirst({ where: { txnRef: req.params.ref, schoolId: tenantId(req), provider: 'TEST' } });
    if (!op || op.createdById !== req.user!.id) throw notFound('Payment not found');
    await completeOnline(op.txnRef, outcome === 'success', outcome === 'success' ? 'Paid (test gateway)' : 'Declined (test gateway)', { test: true });
    res.json({ ok: true, ref: op.txnRef });
  }),
);

export default router;

// ---------- Completing a payment (shared by all gateways) ----------

/** Idempotent: the receipt is created once, however many times the gateway calls back. */
export async function completeOnline(txnRef: string, success: boolean, message: string, response: unknown, paidAmount?: number) {
  const op = await prisma.onlinePayment.findUnique({ where: { txnRef } });
  if (!op || op.status === 'SUCCESS') return op;
  if (!success) {
    return prisma.onlinePayment.update({ where: { id: op.id }, data: { status: 'FAILED', message: message.slice(0, 300), response: response as object, completedAt: new Date() } });
  }
  const amount = paidAmount ?? num(op.amount);
  const result = await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction so two callbacks cannot both create a receipt.
    const fresh = await tx.onlinePayment.findUniqueOrThrow({ where: { id: op.id } });
    if (fresh.status === 'SUCCESS') return null;
    const r = await collect(tx, {
      schoolId: op.schoolId,
      familyId: op.familyId,
      invoiceIds: op.invoiceIds as string[],
      amount,
      method: 'ONLINE',
      reference: `${op.provider} ${op.txnRef}`,
      receivedAt: op.createdAt,
      collectedById: null,
      source: 'ONLINE',
      chargeLateFee: true,
    });
    await tx.onlinePayment.update({ where: { id: op.id }, data: { status: 'SUCCESS', message: message.slice(0, 300), response: response as object, completedAt: new Date(), paymentId: r.payment.id } });
    return r;
  });
  if (result) {
    await sendReceipt(op.schoolId, result.payment.id);
    await prisma.auditLog.create({ data: { schoolId: op.schoolId, action: 'pay.success', entityType: 'OnlinePayment', entityId: op.id, after: { amount, receiptNo: result.payment.receiptNo } } });
  }
  return prisma.onlinePayment.findUnique({ where: { id: op.id } });
}

/** JazzCash posts the result here from the parent's browser (no cookies or CSRF header). */
export const payReturnRouter = Router();

payReturnRouter.post(
  '/jazzcash/:schoolId',
  express.urlencoded({ extended: false, limit: '100kb' }),
  ah(async (req, res) => {
    const g = await prisma.paymentGatewaySettings.findUnique({ where: { schoolId: req.params.schoolId } });
    const body = req.body as Record<string, string>;
    if (!g?.integritySaltEnc) return res.redirect(303, `${env.APP_URL}/home/fees?payment=failed`);
    const r = jazzcashResult(body, decrypt(g.integritySaltEnc));
    const op = r.txnRef ? await prisma.onlinePayment.findFirst({ where: { txnRef: r.txnRef, schoolId: g.schoolId } }) : null;
    if (!r.valid || !op) {
      // Tampered or unknown: never mark anything paid.
      await prisma.auditLog.create({ data: { schoolId: g.schoolId, action: 'pay.invalid_callback', entityType: 'OnlinePayment', entityId: op?.id ?? null, after: { txnRef: r.txnRef, code: r.code, validHash: r.valid } } });
      return res.redirect(303, `${env.APP_URL}/home/fees?payment=failed`);
    }
    if (r.success && Math.abs(r.amount - num(op.amount)) > 0.01) {
      await completeOnline(op.txnRef, false, `Amount mismatch: paid ${r.amount}, expected ${num(op.amount)}`, body);
      return res.redirect(303, `${env.APP_URL}/home/fees?payment=failed&ref=${op.txnRef}`);
    }
    if (r.pending) {
      await prisma.onlinePayment.update({ where: { id: op.id }, data: { message: `Pending: ${r.message}`.slice(0, 300), response: body } });
      return res.redirect(303, `${env.APP_URL}/home/fees?payment=pending&ref=${op.txnRef}`);
    }
    await completeOnline(op.txnRef, r.success, `${r.code} ${r.message}`, body, r.amount);
    res.redirect(303, `${env.APP_URL}/home/fees?payment=${r.success ? 'success' : 'failed'}&ref=${op.txnRef}`);
  }),
);

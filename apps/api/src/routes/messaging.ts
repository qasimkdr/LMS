import crypto from 'node:crypto';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { assertPrincipal, can } from '../lib/http';
import { decrypt, encrypt } from '../lib/crypto';
import { env } from '../config/env';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { MESSAGE_TYPES, renderTemplate } from '../config/messageTypes';
import { checkConnection, normalizePhone, sendTemplate, WaError } from '../services/whatsapp';
import { applyStatuses, enqueue, getSettings, notify, ruleFor, studentsWithContacts, templateFor, whatsappReady } from '../services/messaging';

const router = Router();

const hasWhatsapp = (req: Request) => ((req.user!.school!.plan.modules as string[]) ?? []).includes('whatsapp');
function assertWhatsappModule(req: Request) {
  if (!hasWhatsapp(req)) throw forbidden('Your plan does not include WhatsApp messaging', 'MODULE_DISABLED');
}

function assertCanSend(req: Request) {
  if (!can(req, 'messages.send')) throw forbidden('You need the "Send messages" permission');
}

// ---------- Settings (principal) ----------

function settingsView(s: Awaited<ReturnType<typeof getSettings>>) {
  return {
    whatsappEnabled: s.whatsappEnabled,
    phoneNumberId: s.phoneNumberId,
    businessAccountId: s.businessAccountId,
    hasAccessToken: Boolean(s.accessTokenEnc),
    hasAppSecret: Boolean(s.appSecretEnc),
    displayPhone: s.displayPhone,
    verifiedName: s.verifiedName,
    status: s.status,
    lastError: s.lastError,
    lastCheckedAt: s.lastCheckedAt,
    countryCode: s.countryCode,
    webhookUrl: `${env.APP_URL}/api/webhooks/whatsapp/${s.schoolId}`,
    verifyToken: s.verifyToken,
    testMode: env.WHATSAPP_DRY_RUN,
    types: Object.entries(MESSAGE_TYPES).map(([key, t]) => ({
      key,
      label: t.label,
      description: t.description,
      available: t.available,
      rules: t.rules,
      rule: ruleFor(s, key),
      template: templateFor(s, key),
      suggestedTemplate: t.suggestedTemplate,
      params: t.params,
    })),
  };
}

router.get(
  '/settings',
  ah(async (req, res) => {
    assertPrincipal(req);
    assertWhatsappModule(req);
    res.json({ settings: settingsView(await getSettings(tenantId(req))) });
  }),
);

/** Save credentials and rules. A new phone number id or token is checked with Meta straight away. */
router.put(
  '/settings',
  ah(async (req, res) => {
    assertPrincipal(req);
    assertWhatsappModule(req);
    const schoolId = tenantId(req);
    const typeKeys = Object.keys(MESSAGE_TYPES) as [string, ...string[]];
    const body = parse(
      z.object({
        whatsappEnabled: z.boolean().optional(),
        phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, 'Phone number ID is a long number from Meta').or(z.literal('')).optional(),
        businessAccountId: z.string().trim().regex(/^\d{5,30}$/).or(z.literal('')).optional(),
        accessToken: z.string().trim().min(20).max(1000).optional(),
        appSecret: z.string().trim().min(16).max(200).optional(),
        countryCode: z.string().regex(/^\d{1,4}$/).optional(),
        rules: z.partialRecord(z.enum(typeKeys), z.enum(['auto', 'manual', 'off'])).optional(),
        templates: z.partialRecord(z.enum(typeKeys), z.object({ name: z.string().trim().regex(/^[a-z0-9_]{1,120}$/, 'Template names use lowercase letters, numbers and _'), language: z.string().trim().min(2).max(10) })).optional(),
      }),
      req.body,
    );
    const before = await getSettings(schoolId);
    for (const [k, r] of Object.entries(body.rules ?? {})) {
      if (r && !MESSAGE_TYPES[k].rules.includes(r)) throw badRequest(`${MESSAGE_TYPES[k].label} cannot be set to ${r}`);
    }
    const data: Prisma.MessagingSettingsUpdateInput = {
      ...(body.whatsappEnabled !== undefined ? { whatsappEnabled: body.whatsappEnabled } : {}),
      ...(body.phoneNumberId !== undefined ? { phoneNumberId: body.phoneNumberId || null } : {}),
      ...(body.businessAccountId !== undefined ? { businessAccountId: body.businessAccountId || null } : {}),
      ...(body.accessToken ? { accessTokenEnc: encrypt(body.accessToken) } : {}),
      ...(body.appSecret ? { appSecretEnc: encrypt(body.appSecret) } : {}),
      ...(body.countryCode ? { countryCode: body.countryCode } : {}),
      ...(body.rules ? { rules: { ...((before.rules as object) ?? {}), ...body.rules } } : {}),
      ...(body.templates ? { templates: { ...((before.templates as object) ?? {}), ...body.templates } } : {}),
    };
    const credsChanged = body.accessToken !== undefined || (body.phoneNumberId !== undefined && body.phoneNumberId !== before.phoneNumberId);
    let s = await prisma.messagingSettings.update({ where: { schoolId }, data });
    if (credsChanged) s = await verifyConnection(schoolId);
    await audit(req, {
      action: 'messaging.settings',
      entityType: 'School',
      entityId: schoolId,
      // Secrets are never logged.
      after: { ...body, accessToken: body.accessToken ? 'changed' : undefined, appSecret: body.appSecret ? 'changed' : undefined },
    });
    res.json({ settings: settingsView(s) });
  }),
);

async function verifyConnection(schoolId: string) {
  const s = await getSettings(schoolId);
  if (!s.phoneNumberId || !s.accessTokenEnc) {
    return prisma.messagingSettings.update({ where: { schoolId }, data: { status: 'NOT_SET', lastError: null, lastCheckedAt: new Date() } });
  }
  try {
    const info = await checkConnection({ phoneNumberId: s.phoneNumberId, accessToken: decrypt(s.accessTokenEnc) });
    return prisma.messagingSettings.update({ where: { schoolId }, data: { status: 'CONNECTED', lastError: null, lastCheckedAt: new Date(), displayPhone: info.displayPhone, verifiedName: info.verifiedName } });
  } catch (e) {
    const msg = (e as Error).message;
    const status = /token|session|expired|OAuth/i.test(msg) ? 'TOKEN_EXPIRED' : 'ERROR';
    return prisma.messagingSettings.update({ where: { schoolId }, data: { status, lastError: msg.slice(0, 500), lastCheckedAt: new Date() } });
  }
}

router.post(
  '/settings/check',
  ah(async (req, res) => {
    assertPrincipal(req);
    assertWhatsappModule(req);
    res.json({ settings: settingsView(await verifyConnection(tenantId(req))) });
  }),
);

/** Sends Meta's built-in "hello_world" template (or a chosen one) to a number, right away. */
router.post(
  '/settings/test',
  ah(async (req, res) => {
    assertPrincipal(req);
    assertWhatsappModule(req);
    const schoolId = tenantId(req);
    const body = parse(z.object({ phone: z.string().min(7).max(20), type: z.string().optional() }), req.body);
    const s = await getSettings(schoolId);
    if (!s.phoneNumberId || !s.accessTokenEnc) throw badRequest('Connect your WhatsApp number first');
    const to = normalizePhone(body.phone, s.countryCode);
    if (!to) throw badRequest('Enter a valid mobile number');
    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    let name = 'hello_world';
    let language = 'en_US';
    let params: string[] = [];
    if (body.type && MESSAGE_TYPES[body.type]?.available) {
      ({ name, language } = templateFor(s, body.type));
      params = body.type === 'MANUAL' ? ['This is a test message from the school system.', school.name] : ['Test Student', 'Class 1 A', new Date().toLocaleDateString('en-GB'), school.name];
    }
    try {
      const id = await sendTemplate({ phoneNumberId: s.phoneNumberId, accessToken: decrypt(s.accessTokenEnc) }, to, name, language, params);
      await audit(req, { action: 'messaging.test', entityType: 'School', entityId: schoolId, after: { to, template: name } });
      res.json({ ok: true, messageId: id, template: name });
    } catch (e) {
      throw badRequest(`WhatsApp said: ${(e as WaError).message}`);
    }
  }),
);

// ---------- Compose and send ----------

const audienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('school') }),
  z.object({ kind: z.literal('classes'), ids: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal('sections'), ids: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal('students'), ids: z.array(z.string()).min(1).max(2000) }),
  z.object({ kind: z.literal('staff'), roles: z.array(z.enum(['TEACHER', 'STAFF'])).min(1) }),
]);

const composeSchema = z.object({
  title: z.string().trim().min(2).max(160),
  message: z.string().trim().min(2).max(900),
  audience: audienceSchema,
  channels: z.object({ whatsapp: z.boolean(), inApp: z.boolean() }).refine((c) => c.whatsapp || c.inApp, 'Choose at least one way to send'),
  sendAt: z.coerce.date().optional(),
});

interface Target {
  phone: string | null;
  name: string;
  userId: string | null;
  studentId?: string;
  studentName?: string;
  classLabel?: string;
}

/** Who a message goes to. Parents of several children get one message unless it mentions {student} or {class}. */
async function resolveTargets(schoolId: string, audience: z.infer<typeof audienceSchema>, personal: boolean): Promise<Target[]> {
  if (audience.kind === 'staff') {
    const users = await prisma.user.findMany({ where: { schoolId, role: { in: audience.roles }, isActive: true, deletedAt: null }, select: { id: true, fullName: true, phone: true } });
    return users.map((u) => ({ phone: u.phone, name: u.fullName, userId: u.id }));
  }
  const where: Prisma.StudentWhereInput =
    audience.kind === 'school' ? {} : audience.kind === 'classes' ? { classId: { in: audience.ids } } : audience.kind === 'sections' ? { sectionId: { in: audience.ids } } : { id: { in: audience.ids } };
  const students = await studentsWithContacts(schoolId, where);
  const out: Target[] = [];
  const seenPhone = new Set<string>();
  const seenUser = new Set<string>();
  for (const st of students) {
    const base = { studentId: st.id, studentName: st.fullName, classLabel: st.classLabel };
    // One in-app notification per parent login (per child when personalised).
    const userKey = personal ? `${st.parentUserId}:${st.id}` : st.parentUserId;
    const addUser = st.parentUserId && !seenUser.has(userKey!);
    if (addUser) seenUser.add(userKey!);
    if (st.guardians.length === 0 && addUser) out.push({ phone: null, name: st.fullName, userId: st.parentUserId, ...base });
    st.guardians.forEach((g, i) => {
      const key = personal ? `${g.phone}:${st.id}` : (g.phone ?? `none:${st.id}:${i}`);
      if (seenPhone.has(key)) return;
      seenPhone.add(key);
      out.push({ phone: g.phone, name: g.name, userId: i === 0 && addUser ? st.parentUserId : null, ...base });
    });
  }
  return out;
}

const personalise = (msg: string, t: Target) =>
  msg.replace(/\{student\}/gi, t.studentName ?? '').replace(/\{class\}/gi, t.classLabel ?? '').replace(/\{parent\}/gi, t.name);

router.post(
  '/compose/preview',
  ah(async (req, res) => {
    assertCanSend(req);
    const schoolId = tenantId(req);
    const body = parse(composeSchema.partial({ title: true, channels: true }), req.body);
    const s = await getSettings(schoolId);
    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const personal = /\{(student|class)\}/i.test(body.message);
    const targets = await resolveTargets(schoolId, body.audience, personal);
    const phones = targets.filter((t) => t.phone);
    const valid = phones.filter((t) => normalizePhone(t.phone, s.countryCode));
    const sample = targets.find((t) => t.studentName) ?? targets[0];
    res.json({
      recipients: targets.length,
      whatsappNumbers: valid.length,
      invalidNumbers: phones.length - valid.length,
      noNumber: targets.filter((t) => !t.phone).length,
      appUsers: new Set(targets.map((t) => t.userId).filter(Boolean)).size,
      whatsappAvailable: hasWhatsapp(req) && whatsappReady(s) && ruleFor(s, 'MANUAL') !== 'off',
      sample: sample ? renderTemplate(MESSAGE_TYPES.MANUAL.suggestedTemplate.text, [personalise(body.message, sample), school.name]) : null,
    });
  }),
);

router.post(
  '/compose',
  ah(async (req, res) => {
    assertCanSend(req);
    const schoolId = tenantId(req);
    const body = parse(composeSchema, req.body);
    const s = await getSettings(schoolId);
    if (body.channels.whatsapp && !hasWhatsapp(req)) throw forbidden('Your plan does not include WhatsApp messaging', 'MODULE_DISABLED');
    if (body.channels.whatsapp && !(whatsappReady(s) && ruleFor(s, 'MANUAL') !== 'off')) throw badRequest('WhatsApp is not connected or is switched off in Settings → WhatsApp');
    if (body.sendAt && body.sendAt.getTime() < Date.now() - 60000) throw badRequest('Choose a time in the future');
    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const personal = /\{(student|class)\}/i.test(body.message);
    const targets = await resolveTargets(schoolId, body.audience, personal);
    if (targets.length === 0) throw badRequest('Nobody matches this audience');

    const batch = await prisma.messageBatch.create({
      data: { schoolId, type: 'MANUAL', title: body.title, body: body.message, audience: body.audience, channels: body.channels, total: targets.length, createdById: req.user!.id, scheduledAt: body.sendAt ?? null },
    });
    let queued = 0;
    if (body.channels.whatsapp) {
      queued = await enqueue(
        schoolId,
        s,
        targets
          .filter((t) => t.phone)
          .map((t) => {
            const text = personalise(body.message, t);
            const params = [text, school.name];
            return { to: { phone: t.phone!, name: t.name, studentId: t.studentId }, type: 'MANUAL', params, body: renderTemplate(MESSAGE_TYPES.MANUAL.suggestedTemplate.text, params) };
          }),
        { batchId: batch.id, sendAt: body.sendAt },
      );
    }
    let notified = 0;
    if (body.channels.inApp) {
      // In-app notices appear immediately (scheduling applies to WhatsApp).
      const items = targets.filter((t) => t.userId).map((t) => ({ userId: t.userId!, type: 'MANUAL', title: body.title, body: personalise(body.message, t), batchId: batch.id }));
      await notify(schoolId, items);
      notified = items.length;
    }
    await audit(req, { action: 'message.send', entityType: 'MessageBatch', entityId: batch.id, after: { title: body.title, audience: body.audience, whatsapp: queued, inApp: notified } });
    res.status(201).json({ batchId: batch.id, whatsappQueued: queued, inAppNotified: notified });
  }),
);

// ---------- History ----------

router.get(
  '/batches',
  ah(async (req, res) => {
    assertCanSend(req);
    const schoolId = tenantId(req);
    const batches = await prisma.messageBatch.findMany({ where: { schoolId }, orderBy: { createdAt: 'desc' }, take: 100 });
    const counts = await prisma.message.groupBy({ by: ['batchId', 'status'], where: { batchId: { in: batches.map((b) => b.id) } }, _count: { _all: true } });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(batches.map((b) => b.createdById))] } }, select: { id: true, fullName: true } });
    res.json({
      batches: batches.map((b) => ({
        ...b,
        createdBy: users.find((u) => u.id === b.createdById)?.fullName ?? null,
        counts: Object.fromEntries(counts.filter((c) => c.batchId === b.id).map((c) => [c.status, c._count._all])),
      })),
    });
  }),
);

router.get(
  '/batches/:id',
  ah(async (req, res) => {
    assertCanSend(req);
    const schoolId = tenantId(req);
    const batch = await prisma.messageBatch.findFirst({ where: { id: req.params.id, schoolId } });
    if (!batch) throw notFound('Not found');
    const messages = await prisma.message.findMany({
      where: { batchId: batch.id },
      select: { id: true, toName: true, toPhone: true, status: true, error: true, sentAt: true, deliveredAt: true, readAt: true, studentId: true, body: true },
      orderBy: { createdAt: 'asc' },
    });
    const notifications = await prisma.notification.count({ where: { batchId: batch.id } });
    const readNotifications = await prisma.notification.count({ where: { batchId: batch.id, readAt: { not: null } } });
    res.json({ batch, messages, notifications, readNotifications });
  }),
);

/** Log of single messages (absent alerts etc.) with filters. */
router.get(
  '/log',
  ah(async (req, res) => {
    assertCanSend(req);
    const q = parse(
      z.object({ type: z.string().optional(), status: z.string().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), page: z.coerce.number().int().min(1).default(1) }),
      req.query,
    );
    const where: Prisma.MessageWhereInput = {
      schoolId: tenantId(req),
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.date ? { createdAt: { gte: new Date(`${q.date}T00:00:00Z`), lt: new Date(new Date(`${q.date}T00:00:00Z`).getTime() + 86400000) } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.message.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 50, take: 50, select: { id: true, type: true, toName: true, toPhone: true, status: true, error: true, body: true, createdAt: true, sentAt: true, deliveredAt: true, readAt: true } }),
      prisma.message.count({ where }),
    ]);
    res.json({ rows, total, page: q.page, pageSize: 50 });
  }),
);

router.post(
  '/retry',
  ah(async (req, res) => {
    assertCanSend(req);
    const body = parse(z.object({ batchId: z.string().optional(), messageIds: z.array(z.string()).optional() }), req.body);
    const where: Prisma.MessageWhereInput = { schoolId: tenantId(req), status: 'FAILED', ...(body.batchId ? { batchId: body.batchId } : {}), ...(body.messageIds ? { id: { in: body.messageIds } } : {}) };
    const { count } = await prisma.message.updateMany({ where, data: { status: 'QUEUED', attempts: 0, error: null, nextAttemptAt: new Date() } });
    res.json({ retried: count });
  }),
);

/** WhatsApp usage per type this month (to estimate the school's Meta bill). */
router.get(
  '/stats',
  ah(async (req, res) => {
    assertCanSend(req);
    const schoolId = tenantId(req);
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const rows = await prisma.message.groupBy({ by: ['type', 'status'], where: { schoolId, createdAt: { gte: start } }, _count: { _all: true } });
    const s = await getSettings(schoolId);
    res.json({ since: start, rows: rows.map((r) => ({ type: r.type, status: r.status, count: r._count._all })), ready: whatsappReady(s), status: s.status, enabled: s.whatsappEnabled });
  }),
);

export default router;

// ---------- Webhook (public, called by Meta) ----------

export const webhookRouter = Router();

webhookRouter.get(
  '/whatsapp/:schoolId',
  ah(async (req, res) => {
    const s = await prisma.messagingSettings.findUnique({ where: { schoolId: req.params.schoolId } });
    const ok = s && req.query['hub.mode'] === 'subscribe' && typeof req.query['hub.verify_token'] === 'string' && req.query['hub.verify_token'] === s.verifyToken;
    if (!ok) return res.sendStatus(403);
    res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
  }),
);

webhookRouter.post(
  '/whatsapp/:schoolId',
  express.raw({ type: '*/*', limit: '1mb' }),
  ah(async (req, res) => {
    const s = await prisma.messagingSettings.findUnique({ where: { schoolId: req.params.schoolId } });
    // Without the app secret we cannot prove the call came from Meta, so it is ignored.
    if (!s?.appSecretEnc) return res.sendStatus(200);
    const raw = req.body as Buffer;
    const sig = req.get('x-hub-signature-256') ?? '';
    const expected = 'sha256=' + crypto.createHmac('sha256', decrypt(s.appSecretEnc)).update(raw).digest('hex');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.sendStatus(401);
    let payload: { entry?: { changes?: { value?: { statuses?: never[] } }[] }[] };
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return res.sendStatus(400);
    }
    const statuses = (payload.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.statuses ?? []));
    if (statuses.length) await applyStatuses(s.schoolId, statuses);
    res.sendStatus(200);
  }),
);

// ---------- In-app notifications (everyone) ----------

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  ah(async (req, res) => {
    const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1) }), req.query);
    const userId = req.user!.id;
    const [rows, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 30, take: 30 }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    res.json({ notifications: rows, unread });
  }),
);

notificationsRouter.get(
  '/unread-count',
  ah(async (req, res) => {
    res.json({ unread: await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }) });
  }),
);

notificationsRouter.post(
  '/read',
  ah(async (req, res) => {
    const body = parse(z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }), req.body);
    const { count } = await prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) },
      data: { readAt: new Date() },
    });
    res.json({ marked: count });
  }),
);

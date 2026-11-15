import crypto from 'node:crypto';
import type { MessagingSettings, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { decrypt } from '../lib/crypto';
import { MESSAGE_TYPES, renderTemplate, type Rule } from '../config/messageTypes';
import { normalizePhone, sendTemplate, WaError } from './whatsapp';

// ---------- Settings ----------

export async function getSettings(schoolId: string): Promise<MessagingSettings> {
  const s = await prisma.messagingSettings.findUnique({ where: { schoolId } });
  if (s) return s;
  return prisma.messagingSettings.upsert({
    where: { schoolId },
    create: { schoolId, verifyToken: crypto.randomBytes(16).toString('hex') },
    update: {},
  });
}

export function ruleFor(s: MessagingSettings, type: string): Rule {
  const rules = (s.rules as Record<string, Rule> | null) ?? {};
  const def = MESSAGE_TYPES[type];
  const r = rules[type] ?? def?.defaultRule ?? 'off';
  return def?.rules.includes(r) ? r : (def?.defaultRule ?? 'off');
}

export function templateFor(s: MessagingSettings, type: string): { name: string; language: string } {
  const t = (s.templates as Record<string, { name?: string; language?: string }> | null)?.[type];
  const def = MESSAGE_TYPES[type]?.suggestedTemplate;
  return { name: t?.name || def?.name || '', language: t?.language || def?.language || 'en' };
}

/** WhatsApp can be used: switched on and connected. */
export const whatsappReady = (s: MessagingSettings) => s.whatsappEnabled && s.status === 'CONNECTED' && Boolean(s.phoneNumberId && s.accessTokenEnc);

// ---------- Recipients ----------

export interface Recipient {
  phone: string;
  name: string;
  studentId?: string;
  studentName?: string;
  classLabel?: string;
}

const classLabel = (c: { name: string; stream: string | null }, s?: { name: string } | null) => `${c.name}${c.stream ? ` ${c.stream}` : ''}${s ? ` ${s.name}` : ''}`;

/** Students with the guardians who receive messages and the family's parent login. */
export async function studentsWithContacts(schoolId: string, where: Prisma.StudentWhereInput) {
  const rows = await prisma.student.findMany({
    where: { schoolId, deletedAt: null, status: 'ACTIVE', ...where },
    select: {
      id: true,
      fullName: true,
      class: { select: { name: true, stream: true } },
      section: { select: { name: true } },
      family: { select: { parentUserId: true, guardians: { where: { receivesMessages: true, isDeceased: false }, select: { fullName: true, phone: true, whatsapp: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    classLabel: classLabel(r.class, r.section),
    parentUserId: r.family.parentUserId,
    guardians: r.family.guardians.map((g) => ({ name: g.fullName, phone: g.whatsapp ?? g.phone })),
  }));
}

// ---------- Queueing ----------

interface QueueItem {
  to: Recipient;
  type: string;
  params: string[];
  /** Readable text for the log. */
  body: string;
}

/**
 * Adds WhatsApp messages to the outbox. Numbers that cannot be used are logged as SKIPPED so the
 * school can see who was not reached.
 */
export async function enqueue(schoolId: string, settings: MessagingSettings, items: QueueItem[], opts: { batchId?: string; sendAt?: Date } = {}) {
  if (items.length === 0) return 0;
  const data: Prisma.MessageCreateManyInput[] = items.map((it) => {
    const tpl = templateFor(settings, it.type);
    const phone = normalizePhone(it.to.phone, settings.countryCode);
    return {
      schoolId,
      batchId: opts.batchId ?? null,
      type: it.type,
      toPhone: phone ?? (it.to.phone || '').slice(0, 20),
      toName: it.to.name.slice(0, 160),
      studentId: it.to.studentId ?? null,
      templateName: tpl.name,
      templateLanguage: tpl.language,
      params: it.params,
      body: it.body,
      status: phone ? 'QUEUED' : 'SKIPPED',
      error: phone ? null : 'No valid WhatsApp number',
      nextAttemptAt: opts.sendAt ?? new Date(),
    };
  });
  await prisma.message.createMany({ data });
  return data.filter((d) => d.status === 'QUEUED').length;
}

/** Builds the WhatsApp items for an absent or late alert for one student. */
export function alertItems(
  type: 'ABSENT' | 'LATE',
  student: { id: string; fullName: string; classLabel: string; guardians: { name: string; phone: string | null }[] },
  dateLabel: string,
  schoolName: string,
): QueueItem[] {
  const params = [student.fullName, student.classLabel, dateLabel, schoolName];
  const body = renderTemplate(MESSAGE_TYPES[type].suggestedTemplate.text, params);
  return student.guardians.map((g) => ({ to: { phone: g.phone ?? '', name: g.name, studentId: student.id }, type, params, body }));
}

export async function notify(schoolId: string, items: { userId: string; type: string; title: string; body: string; link?: string; batchId?: string }[]) {
  if (items.length === 0) return;
  await prisma.notification.createMany({ data: items.map((n) => ({ schoolId, ...n, link: n.link ?? null, batchId: n.batchId ?? null })) });
}

// ---------- Outbox worker ----------

const MAX_ATTEMPTS = 5;

/**
 * Sends queued WhatsApp messages. Safe to run from several processes: rows are claimed with
 * SELECT … FOR UPDATE SKIP LOCKED. Returns how many messages were processed.
 */
export async function processOutbox(limit = 50): Promise<number> {
  // Messages stuck in SENDING (process crashed mid-send) go back to the queue.
  await prisma.message.updateMany({ where: { status: 'SENDING', nextAttemptAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } }, data: { status: 'QUEUED' } });

  const claimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM Message WHERE status = 'QUEUED' AND nextAttemptAt <= NOW(3)
      ORDER BY nextAttemptAt LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    const ids = rows.map((r) => r.id);
    if (ids.length) await tx.message.updateMany({ where: { id: { in: ids } }, data: { status: 'SENDING', nextAttemptAt: new Date() } });
    return ids;
  });
  if (claimed.length === 0) return 0;

  const messages = await prisma.message.findMany({ where: { id: { in: claimed } } });
  const settingsCache = new Map<string, MessagingSettings>();
  for (const m of messages) {
    let s = settingsCache.get(m.schoolId);
    if (!s) {
      s = await getSettings(m.schoolId);
      settingsCache.set(m.schoolId, s);
    }
    if (!whatsappReady(s) || ruleFor(s, m.type) === 'off') {
      await prisma.message.update({ where: { id: m.id }, data: { status: 'SKIPPED', error: 'WhatsApp is switched off or not connected for this school' } });
      continue;
    }
    try {
      const id = await sendTemplate(
        { phoneNumberId: s.phoneNumberId!, accessToken: decrypt(s.accessTokenEnc!) },
        m.toPhone,
        m.templateName ?? '',
        m.templateLanguage ?? 'en',
        (m.params as string[]) ?? [],
      );
      await prisma.message.update({ where: { id: m.id }, data: { status: 'SENT', providerMessageId: id, sentAt: new Date(), attempts: { increment: 1 }, error: null } });
    } catch (e) {
      const err = e instanceof WaError ? e : new WaError((e as Error).message, true);
      const attempts = m.attempts + 1;
      const retry = err.retryable && attempts < MAX_ATTEMPTS;
      await prisma.message.update({
        where: { id: m.id },
        data: {
          status: retry ? 'QUEUED' : 'FAILED',
          attempts,
          error: err.message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + 2 ** attempts * 60 * 1000),
        },
      });
    }
  }
  return messages.length;
}

// ---------- Delivery status from Meta's webhook ----------

const ORDER: Record<string, number> = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5, SKIPPED: 5 };

interface WebhookStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp?: string;
  errors?: { title?: string; message?: string; error_data?: { details?: string } }[];
}

export async function applyStatuses(schoolId: string, statuses: WebhookStatus[]) {
  let updated = 0;
  for (const st of statuses) {
    const msg = await prisma.message.findFirst({ where: { schoolId, providerMessageId: st.id } });
    if (!msg) continue;
    const next = st.status.toUpperCase() as 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
    if (next !== 'FAILED' && ORDER[next] <= ORDER[msg.status]) continue;
    const at = st.timestamp ? new Date(Number(st.timestamp) * 1000) : new Date();
    const e = st.errors?.[0];
    await prisma.message.update({
      where: { id: msg.id },
      data: {
        status: next,
        ...(next === 'DELIVERED' ? { deliveredAt: at } : {}),
        ...(next === 'READ' ? { readAt: at, deliveredAt: msg.deliveredAt ?? at } : {}),
        ...(next === 'FAILED' ? { error: (e?.error_data?.details ?? e?.message ?? e?.title ?? 'Delivery failed').slice(0, 500) } : {}),
      },
    });
    updated++;
  }
  return updated;
}

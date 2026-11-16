import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Conversation } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { notify } from '../services/messaging';

/** Parent ↔ teacher messages, one thread per parent, teacher and child. Kept as school record. */
const router = Router();

const KINDS = ['GENERAL', 'QUERY', 'COMPLAINT'] as const;
const classLabel = (c: { name: string; stream: string | null }, s?: { name: string } | null) => `${c.name}${c.stream ? ` ${c.stream}` : ''}${s ? ` ${s.name}` : ''}`;

/** The teachers of a child: class teacher and subject teachers of the child's section. */
export async function childTeachers(schoolId: string, sectionId: string | null) {
  if (!sectionId) return [];
  const section = await prisma.section.findUnique({ where: { id: sectionId }, select: { classTeacherId: true } });
  const assignments = await prisma.teachingAssignment.findMany({ where: { schoolId, sectionId }, select: { teacherId: true, subject: { select: { name: true } } } });
  const ids = [...new Set([section?.classTeacherId, ...assignments.map((a) => a.teacherId)].filter((x): x is string => Boolean(x)))];
  const users = await prisma.user.findMany({ where: { id: { in: ids }, isActive: true, deletedAt: null }, select: { id: true, fullName: true, photoFileId: true } });
  return users
    .map((u) => ({ id: u.id, fullName: u.fullName, photoFileId: u.photoFileId, classTeacher: u.id === section?.classTeacherId, subjects: assignments.filter((a) => a.teacherId === u.id).map((a) => a.subject.name) }))
    .sort((a, b) => Number(b.classTeacher) - Number(a.classTeacher) || a.fullName.localeCompare(b.fullName));
}

function withinHours(h: { enabled: boolean; start: string; end: string } | null, timezone: string, now = new Date()) {
  if (!h?.enabled) return true;
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now);
  return day !== 'Sun' && t >= h.start && t < h.end;
}

async function checkFiles(schoolId: string, userId: string, ids: string[]) {
  if (!ids.length) return;
  const n = await prisma.storedFile.count({ where: { schoolId, id: { in: ids }, uploadedById: userId, deletedAt: null } });
  if (n !== new Set(ids).size) throw badRequest('Unknown file');
}

async function load(req: Request, id: string) {
  const c = await prisma.conversation.findFirst({ where: { id, schoolId: tenantId(req), deletedAt: null } });
  if (!c) throw notFound('Conversation not found');
  const u = req.user!;
  const role = c.parentUserId === u.id ? 'PARENT' : c.teacherId === u.id ? 'TEACHER' : u.role === 'PRINCIPAL' ? 'PRINCIPAL' : null;
  if (!role) throw notFound('Conversation not found');
  return { c, role };
}

async function present(rows: Conversation[], meId: string) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.parentUserId, r.teacherId]))] } }, select: { id: true, fullName: true, photoFileId: true } });
  const students = await prisma.student.findMany({ where: { id: { in: rows.map((r) => r.studentId) } }, select: { id: true, fullName: true, class: { select: { name: true, stream: true } }, section: { select: { name: true } } } });
  const last = await Promise.all(rows.map((r) => prisma.conversationMessage.findFirst({ where: { conversationId: r.id }, orderBy: { createdAt: 'desc' } })));
  const unread = await prisma.conversationMessage.groupBy({ by: ['conversationId'], where: { conversationId: { in: rows.map((r) => r.id) }, senderId: { not: meId }, readAt: null }, _count: { _all: true } });
  return rows.map((r, i) => {
    const st = students.find((s) => s.id === r.studentId);
    const u = (id: string) => users.find((x) => x.id === id);
    return {
      id: r.id,
      kind: r.kind,
      parent: { id: r.parentUserId, fullName: u(r.parentUserId)?.fullName ?? '' },
      teacher: { id: r.teacherId, fullName: u(r.teacherId)?.fullName ?? '', photoFileId: u(r.teacherId)?.photoFileId ?? null },
      student: st ? { id: st.id, fullName: st.fullName, classLabel: classLabel(st.class, st.section) } : null,
      last: last[i] ? { text: last[i]!.text, at: last[i]!.createdAt, mine: last[i]!.senderId === meId } : null,
      unread: unread.find((x) => x.conversationId === r.id)?._count._all ?? 0,
      forwardedAt: r.forwardedAt,
      lastMessageAt: r.lastMessageAt,
    };
  });
}

/** Inbox: parents see their threads; teachers theirs; the principal sees all (?all=true). */
router.get(
  '/',
  ah(async (req, res) => {
    const u = req.user!;
    const q = parse(z.object({ all: z.enum(['true', 'false']).optional() }), req.query);
    let where;
    if (u.role === 'PARENT') where = { parentUserId: u.id };
    else if (u.role === 'TEACHER') where = { teacherId: u.id };
    else if (u.role === 'PRINCIPAL') where = q.all === 'true' ? {} : { OR: [{ teacherId: u.id }, { forwardedAt: { not: null } }] };
    else throw forbidden();
    const rows = await prisma.conversation.findMany({ where: { schoolId: tenantId(req), deletedAt: null, ...where }, orderBy: { lastMessageAt: 'desc' }, take: 300 });
    res.json({ conversations: await present(rows, u.id) });
  }),
);

/** Parents: each child with the teachers they can message. */
router.get(
  '/teachers',
  ah(async (req, res) => {
    const u = req.user!;
    if (u.role !== 'PARENT') throw forbidden();
    const kids = await prisma.student.findMany({ where: { schoolId: tenantId(req), family: { parentUserId: u.id }, deletedAt: null, status: 'ACTIVE' }, select: { id: true, fullName: true, sectionId: true, class: { select: { name: true, stream: true } }, section: { select: { name: true } } }, orderBy: { dob: 'asc' } });
    const out = [];
    for (const k of kids) out.push({ student: { id: k.id, fullName: k.fullName, classLabel: classLabel(k.class, k.section) }, teachers: await childTeachers(tenantId(req), k.sectionId) });
    res.json({ children: out });
  }),
);

const sendBody = z.object({ text: z.string().trim().min(1).max(3000), fileIds: z.array(z.string()).max(5).default([]) });

/** Parent starts (or continues) a conversation with one of the child's teachers. */
router.post(
  '/',
  ah(async (req, res) => {
    const u = req.user!;
    const schoolId = tenantId(req);
    if (u.role !== 'PARENT') throw forbidden();
    const body = parse(sendBody.extend({ studentId: z.string(), teacherId: z.string(), kind: z.enum(KINDS).default('GENERAL') }), req.body);
    const st = await prisma.student.findFirst({ where: { id: body.studentId, schoolId, family: { parentUserId: u.id }, deletedAt: null } });
    if (!st) throw notFound('Student not found');
    if (!(await childTeachers(schoolId, st.sectionId)).some((t) => t.id === body.teacherId)) throw forbidden("You can message only your child's teachers");
    await checkFiles(schoolId, u.id, body.fileIds);
    const c = await prisma.conversation.upsert({
      where: { parentUserId_teacherId_studentId: { parentUserId: u.id, teacherId: body.teacherId, studentId: st.id } },
      create: { schoolId, parentUserId: u.id, teacherId: body.teacherId, studentId: st.id, kind: body.kind },
      update: { deletedAt: null, ...(body.kind === 'COMPLAINT' ? { kind: 'COMPLAINT' } : {}) },
    });
    await postMessage(req, c, body.text, body.fileIds, body.kind);
    res.status(201).json({ id: c.id });
  }),
);

async function postMessage(req: Request, c: Conversation, text: string, fileIds: string[], kind?: string) {
  const u = req.user!;
  const school = u.school!;
  await prisma.conversationMessage.create({ data: { conversationId: c.id, senderId: u.id, text, fileIds } });
  await prisma.conversation.update({ where: { id: c.id }, data: { lastMessageAt: new Date() } });
  const st = await prisma.student.findUnique({ where: { id: c.studentId }, select: { fullName: true } });
  const to = u.id === c.parentUserId ? c.teacherId : c.parentUserId;
  const label = kind === 'COMPLAINT' ? 'Complaint' : kind === 'QUERY' ? 'Query' : 'Message';
  await notify(c.schoolId, [{ userId: to, type: 'MESSAGE', title: `${u.id === c.parentUserId ? `${label} from ${u.fullName}` : `Reply from ${u.fullName}`} (${st?.fullName ?? ''})`, body: text.slice(0, 200), link: `/conversations?c=${c.id}` }]);
  // Teacher outside message hours: automatic reply to the parent.
  if (u.id === c.parentUserId) {
    const hours = await prisma.messageHours.findUnique({ where: { userId: c.teacherId } });
    if (!withinHours(hours, school.timezone)) {
      const recentAuto = await prisma.conversationMessage.findFirst({ where: { conversationId: c.id, isAuto: true, createdAt: { gt: new Date(Date.now() - 6 * 3600000) } } });
      if (!recentAuto) await prisma.conversationMessage.create({ data: { conversationId: c.id, senderId: c.teacherId, text: `Thank you for your message. I will reply during school hours (${hours!.start}–${hours!.end}).`, fileIds: [], isAuto: true } });
    }
  }
}

router.get(
  '/:id',
  ah(async (req, res) => {
    const { c, role } = await load(req, req.params.id);
    const msgs = await prisma.conversationMessage.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: 'asc' }, take: 500 });
    // Opening the thread marks the other side's messages as read (not when the principal is only viewing).
    if (role !== 'PRINCIPAL') await prisma.conversationMessage.updateMany({ where: { conversationId: c.id, senderId: { not: req.user!.id }, readAt: null }, data: { readAt: new Date() } });
    const files = await prisma.storedFile.findMany({ where: { id: { in: msgs.flatMap((m) => m.fileIds as string[]) } }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true } });
    const [info] = await present([c], req.user!.id);
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(msgs.map((m) => m.senderId))] } }, select: { id: true, fullName: true } });
    res.json({
      conversation: info,
      role,
      messages: msgs.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        sender: users.find((x) => x.id === m.senderId)?.fullName ?? '',
        text: m.text,
        isAuto: m.isAuto,
        files: (m.fileIds as string[]).map((id) => files.find((f) => f.id === id)).filter(Boolean).map((f) => ({ id: f!.id, name: f!.originalName, mimeType: f!.mimeType, sizeBytes: f!.sizeBytes })),
        readAt: m.readAt,
        createdAt: m.createdAt,
        mine: m.senderId === req.user!.id,
      })),
    });
  }),
);

router.post(
  '/:id/messages',
  ah(async (req, res) => {
    const { c, role } = await load(req, req.params.id);
    if (role === 'PRINCIPAL') throw forbidden('The principal can read but not write in teacher conversations');
    const body = parse(sendBody, req.body);
    await checkFiles(tenantId(req), req.user!.id, body.fileIds);
    await postMessage(req, c, body.text, body.fileIds);
    res.status(201).json({ ok: true });
  }),
);

/** Teacher forwards the conversation to the principal. */
router.post(
  '/:id/forward',
  ah(async (req, res) => {
    const { c, role } = await load(req, req.params.id);
    if (role !== 'TEACHER') throw forbidden();
    const { note } = parse(z.object({ note: z.string().trim().max(500).optional() }), req.body);
    await prisma.conversation.update({ where: { id: c.id }, data: { forwardedAt: new Date() } });
    const principals = await prisma.user.findMany({ where: { schoolId: c.schoolId, role: 'PRINCIPAL', isActive: true, deletedAt: null }, select: { id: true } });
    await notify(c.schoolId, principals.map((p) => ({ userId: p.id, type: 'MESSAGE', title: `${req.user!.fullName} forwarded a parent conversation`, body: note || 'Needs your attention.', link: `/conversations?c=${c.id}` })));
    await audit(req, { action: 'conversation.forward', entityType: 'Conversation', entityId: c.id, after: { note } });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const { c, role } = await load(req, req.params.id);
    if (role !== 'PRINCIPAL') throw forbidden('Only the principal can delete conversations');
    await prisma.conversation.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
    await audit(req, { action: 'conversation.delete', entityType: 'Conversation', entityId: c.id });
    res.json({ ok: true });
  }),
);

router.get(
  '/settings/hours',
  ah(async (req, res) => {
    const h = await prisma.messageHours.findUnique({ where: { userId: req.user!.id } });
    res.json({ hours: h ?? { enabled: false, start: '08:00', end: '15:00' } });
  }),
);

router.put(
  '/settings/hours',
  ah(async (req, res) => {
    if (req.user!.role !== 'TEACHER') throw forbidden();
    const t = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
    const body = parse(z.object({ enabled: z.boolean(), start: t, end: t }).refine((b) => b.end > b.start, 'End must be after start'), req.body);
    await prisma.messageHours.upsert({ where: { userId: req.user!.id }, create: { userId: req.user!.id, schoolId: tenantId(req), ...body }, update: body });
    res.json({ ok: true });
  }),
);

export default router;

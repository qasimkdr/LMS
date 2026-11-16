import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { optStr, parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { notify } from '../services/messaging';
import { deleteSchoolFile } from '../services/files';

/**
 * Class chat: one group per section for its students and teachers. The app polls for new messages.
 * Everything older than 30 days is deleted automatically (reported messages wait for review).
 */
const router = Router();
export const CHAT_DAYS = 30;

const classLabel = (c: { name: string; stream: string | null }, s?: { name: string } | null) => `${c.name}${c.stream ? ` ${c.stream}` : ''}${s ? ` ${s.name}` : ''}`;

async function settings(schoolId: string) {
  return (await prisma.commSettings.findUnique({ where: { schoolId } })) ?? prisma.commSettings.upsert({ where: { schoolId }, create: { schoolId }, update: {} });
}

interface Access {
  section: { id: string; name: string; classId: string; classTeacherId: string | null; class: { name: string; stream: string | null } };
  moderator: boolean;
  member: boolean;
}

/** Who may see / moderate a section's chat: its students, its teachers, and the principal (moderator, not member). */
async function access(req: Request, sectionId: string): Promise<Access> {
  const u = req.user!;
  const schoolId = tenantId(req);
  const section = await prisma.section.findFirst({ where: { id: sectionId, schoolId, deletedAt: null }, select: { id: true, name: true, classId: true, classTeacherId: true, class: { select: { name: true, stream: true } } } });
  if (!section) throw notFound('Chat not found');
  if (u.role === 'PRINCIPAL') return { section, moderator: true, member: false };
  if (u.role === 'TEACHER') {
    const teaches = section.classTeacherId === u.id || Boolean(await prisma.teachingAssignment.findFirst({ where: { schoolId, sectionId, teacherId: u.id } }));
    if (teaches) return { section, moderator: true, member: true };
  }
  if (u.role === 'STUDENT') {
    const st = await prisma.student.findFirst({ where: { userId: u.id, schoolId, deletedAt: null, status: 'ACTIVE' }, select: { sectionId: true } });
    if (st?.sectionId === sectionId) return { section, moderator: false, member: true };
  }
  throw notFound('Chat not found');
}

router.get(
  '/rooms',
  ah(async (req, res) => {
    const u = req.user!;
    const schoolId = tenantId(req);
    const s = await settings(schoolId);
    let sectionIds: string[] = [];
    if (u.role === 'PRINCIPAL') sectionIds = (await prisma.section.findMany({ where: { schoolId, deletedAt: null }, select: { id: true } })).map((x) => x.id);
    else if (u.role === 'TEACHER') {
      const [own, taught] = await Promise.all([
        prisma.section.findMany({ where: { schoolId, classTeacherId: u.id, deletedAt: null }, select: { id: true } }),
        prisma.teachingAssignment.findMany({ where: { schoolId, teacherId: u.id }, select: { sectionId: true } }),
      ]);
      sectionIds = [...new Set([...own.map((x) => x.id), ...taught.map((x) => x.sectionId)])];
    } else if (u.role === 'STUDENT') {
      const st = await prisma.student.findFirst({ where: { userId: u.id, schoolId, deletedAt: null, status: 'ACTIVE' }, select: { sectionId: true } });
      sectionIds = st?.sectionId ? [st.sectionId] : [];
    } else throw forbidden('Class chat is for students and teachers');
    const sections = await prisma.section.findMany({ where: { id: { in: sectionIds }, deletedAt: null }, select: { id: true, name: true, class: { select: { name: true, stream: true, sortOrder: true } } } });
    const rooms = await prisma.chatRoom.findMany({ where: { sectionId: { in: sectionIds } } });
    const last = await Promise.all(sectionIds.map((id) => prisma.chatMessage.findFirst({ where: { sectionId: id, deletedAt: null }, orderBy: { createdAt: 'desc' } })));
    const senders = await prisma.user.findMany({ where: { id: { in: last.filter(Boolean).map((m) => m!.senderId) } }, select: { id: true, fullName: true } });
    const reports = u.role === 'STUDENT' ? [] : await prisma.chatMessage.groupBy({ by: ['sectionId'], where: { sectionId: { in: sectionIds }, reportedById: { not: null }, reportReviewedAt: null }, _count: { _all: true } });
    res.json({
      enabled: s.classChatEnabled,
      days: CHAT_DAYS,
      rooms: sections
        .sort((a, b) => a.class.sortOrder - b.class.sortOrder || classLabel(a.class, a).localeCompare(classLabel(b.class, b), undefined, { numeric: true }))
        .map((sec) => {
          const m = last[sectionIds.indexOf(sec.id)];
          return {
            sectionId: sec.id,
            label: classLabel(sec.class, sec),
            mode: rooms.find((r) => r.sectionId === sec.id)?.mode ?? 'OPEN',
            last: m ? { text: m.text ?? (m.fileId ? '📎 Attachment' : ''), at: m.createdAt, by: senders.find((x) => x.id === m.senderId)?.fullName ?? '' } : null,
            reports: reports.find((r) => r.sectionId === sec.id)?._count._all ?? 0,
          };
        }),
    });
  }),
);

router.get(
  '/rooms/:sectionId',
  ah(async (req, res) => {
    const a = await access(req, req.params.sectionId);
    const schoolId = tenantId(req);
    const q = parse(z.object({ after: z.string().datetime().optional(), before: z.string().datetime().optional() }), req.query);
    const rows = await prisma.chatMessage.findMany({
      where: { sectionId: a.section.id, ...(q.after ? { createdAt: { gt: new Date(q.after) } } : q.before ? { createdAt: { lt: new Date(q.before) } } : {}) },
      orderBy: { createdAt: q.after ? 'asc' : 'desc' },
      take: 60,
    });
    const list = q.after ? rows : rows.reverse();
    const replyIds = list.map((m) => m.replyToId).filter((x): x is string => Boolean(x));
    const replies = replyIds.length ? await prisma.chatMessage.findMany({ where: { id: { in: replyIds } } }) : [];
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set([...list.map((m) => m.senderId), ...replies.map((r) => r.senderId)])] } }, select: { id: true, fullName: true, role: true, photoFileId: true } });
    const files = await prisma.storedFile.findMany({ where: { id: { in: list.map((m) => m.fileId).filter((x): x is string => Boolean(x)) } }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true, deletedAt: true } });
    const room = await prisma.chatRoom.findUnique({ where: { sectionId: a.section.id } });
    const mute = a.member && req.user!.role === 'STUDENT' ? await prisma.chatMute.findUnique({ where: { sectionId_userId: { sectionId: a.section.id, userId: req.user!.id } } }) : null;
    const s = await settings(schoolId);
    const mode = room?.mode ?? 'OPEN';
    const mutedUntil = mute && mute.until > new Date() ? mute.until : null;
    const me = req.user!.id;
    const name = (id: string) => users.find((x) => x.id === id);
    res.json({
      room: { sectionId: a.section.id, label: classLabel(a.section.class, a.section), mode, enabled: s.classChatEnabled, days: CHAT_DAYS },
      moderator: a.moderator,
      canSend: s.classChatEnabled && (a.moderator || (a.member && mode === 'OPEN' && !mutedUntil)),
      mutedUntil,
      messages: list.map((m) => {
        const u = name(m.senderId);
        const r = replies.find((x) => x.id === m.replyToId);
        const f = files.find((x) => x.id === m.fileId);
        const deleted = Boolean(m.deletedAt);
        return {
          id: m.id,
          sender: { id: m.senderId, fullName: u?.fullName ?? 'Former member', role: u?.role ?? 'STUDENT', photoFileId: u?.photoFileId ?? null },
          text: deleted ? null : m.text,
          file: deleted || !f || f.deletedAt ? null : { id: f.id, name: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes },
          replyTo: r ? { id: r.id, text: r.deletedAt ? 'Deleted message' : (r.text ?? '📎 Attachment'), by: name(r.senderId)?.fullName ?? '' } : null,
          createdAt: m.createdAt,
          deleted,
          mine: m.senderId === me,
          reported: a.moderator ? Boolean(m.reportedById && !m.reportReviewedAt) : false,
          reportReason: a.moderator ? m.reportReason : null,
        };
      }),
    });
  }),
);

router.post(
  '/rooms/:sectionId/messages',
  ah(async (req, res) => {
    const a = await access(req, req.params.sectionId);
    const schoolId = tenantId(req);
    const body = parse(z.object({ text: optStr(2000), fileId: z.string().nullish(), replyToId: z.string().nullish() }), req.body);
    if (!body.text && !body.fileId) throw badRequest('Write a message');
    const s = await settings(schoolId);
    if (!s.classChatEnabled) throw forbidden('Class chat is switched off by the school');
    if (!a.member && !a.moderator) throw forbidden();
    if (!a.moderator) {
      const room = await prisma.chatRoom.findUnique({ where: { sectionId: a.section.id } });
      if (room && room.mode !== 'OPEN') throw forbidden(room.mode === 'CLOSED' ? 'The chat is closed right now' : 'Only teachers can send messages right now');
      const mute = await prisma.chatMute.findUnique({ where: { sectionId_userId: { sectionId: a.section.id, userId: req.user!.id } } });
      if (mute && mute.until > new Date()) throw forbidden('You have been muted by your teacher');
    }
    if (body.fileId && !(await prisma.storedFile.findFirst({ where: { id: body.fileId, schoolId, uploadedById: req.user!.id, deletedAt: null } }))) throw badRequest('Unknown file');
    if (body.replyToId && !(await prisma.chatMessage.findFirst({ where: { id: body.replyToId, sectionId: a.section.id } }))) throw badRequest('Unknown message');
    const m = await prisma.chatMessage.create({ data: { schoolId, sectionId: a.section.id, senderId: req.user!.id, text: body.text ?? null, fileId: body.fileId ?? null, replyToId: body.replyToId ?? null } });
    res.status(201).json({ id: m.id, createdAt: m.createdAt });
  }),
);

async function loadMessage(req: Request, id: string) {
  const m = await prisma.chatMessage.findFirst({ where: { id, schoolId: tenantId(req) } });
  if (!m) throw notFound('Message not found');
  return { m, a: await access(req, m.sectionId) };
}

router.delete(
  '/messages/:id',
  ah(async (req, res) => {
    const { m, a } = await loadMessage(req, req.params.id);
    if (!(a.moderator || m.senderId === req.user!.id)) throw forbidden();
    if (m.deletedAt) return res.json({ ok: true });
    await prisma.chatMessage.update({ where: { id: m.id }, data: { deletedAt: new Date(), deletedById: req.user!.id } });
    if (m.fileId) await deleteSchoolFile(m.schoolId, m.fileId);
    if (m.senderId !== req.user!.id) await audit(req, { action: 'chat.delete', entityType: 'ChatMessage', entityId: m.id, before: { text: m.text, senderId: m.senderId } });
    res.json({ ok: true });
  }),
);

/** A student reports a message to the teachers. */
router.post(
  '/messages/:id/report',
  ah(async (req, res) => {
    const { m, a } = await loadMessage(req, req.params.id);
    if (!a.member || m.senderId === req.user!.id) throw forbidden();
    const { reason } = parse(z.object({ reason: optStr(300) }), req.body);
    await prisma.chatMessage.update({ where: { id: m.id }, data: { reportedById: req.user!.id, reportReason: reason ?? null, reportReviewedAt: null } });
    if (a.section.classTeacherId) await notify(m.schoolId, [{ userId: a.section.classTeacherId, type: 'CHAT', title: `Message reported in ${classLabel(a.section.class, a.section)} chat`, body: reason ?? (m.text ?? '').slice(0, 120), link: `/chat?room=${a.section.id}` }]);
    res.json({ ok: true });
  }),
);

router.post(
  '/messages/:id/review',
  ah(async (req, res) => {
    const { m, a } = await loadMessage(req, req.params.id);
    if (!a.moderator) throw forbidden();
    await prisma.chatMessage.update({ where: { id: m.id }, data: { reportReviewedAt: new Date() } });
    await audit(req, { action: 'chat.report_review', entityType: 'ChatMessage', entityId: m.id, after: { reason: m.reportReason } });
    res.json({ ok: true });
  }),
);

router.put(
  '/rooms/:sectionId/mode',
  ah(async (req, res) => {
    const a = await access(req, req.params.sectionId);
    if (!a.moderator) throw forbidden();
    const { mode } = parse(z.object({ mode: z.enum(['OPEN', 'TEACHERS_ONLY', 'CLOSED']) }), req.body);
    await prisma.chatRoom.upsert({ where: { sectionId: a.section.id }, create: { sectionId: a.section.id, schoolId: tenantId(req), mode, updatedBy: req.user!.id }, update: { mode, updatedBy: req.user!.id } });
    await audit(req, { action: 'chat.mode', entityType: 'Section', entityId: a.section.id, after: { mode } });
    res.json({ ok: true });
  }),
);

/** Members (for muting): students of the section and its teachers. */
router.get(
  '/rooms/:sectionId/members',
  ah(async (req, res) => {
    const a = await access(req, req.params.sectionId);
    const schoolId = tenantId(req);
    const students = await prisma.student.findMany({ where: { sectionId: a.section.id, status: 'ACTIVE', deletedAt: null, userId: { not: null } }, select: { userId: true, fullName: true, rollNo: true, photoFileId: true }, orderBy: [{ rollNo: 'asc' }, { fullName: 'asc' }] });
    const teacherIds = [...new Set([a.section.classTeacherId, ...(await prisma.teachingAssignment.findMany({ where: { schoolId, sectionId: a.section.id }, select: { teacherId: true } })).map((t) => t.teacherId)].filter((x): x is string => Boolean(x)))];
    const teachers = await prisma.user.findMany({ where: { id: { in: teacherIds } }, select: { id: true, fullName: true, photoFileId: true } });
    const mutes = a.moderator ? await prisma.chatMute.findMany({ where: { sectionId: a.section.id, until: { gt: new Date() } } }) : [];
    res.json({
      teachers: teachers.map((t) => ({ id: t.id, fullName: t.fullName, photoFileId: t.photoFileId, classTeacher: t.id === a.section.classTeacherId })),
      students: students.map((s) => ({ id: s.userId!, fullName: s.fullName, rollNo: s.rollNo, photoFileId: s.photoFileId, mutedUntil: mutes.find((m) => m.userId === s.userId)?.until ?? null })),
    });
  }),
);

router.post(
  '/rooms/:sectionId/mute',
  ah(async (req, res) => {
    const a = await access(req, req.params.sectionId);
    if (!a.moderator) throw forbidden();
    const body = parse(z.object({ userId: z.string(), minutes: z.coerce.number().int().min(0).max(60 * 24 * 14) }), req.body);
    const st = await prisma.student.findFirst({ where: { userId: body.userId, sectionId: a.section.id, deletedAt: null } });
    if (!st) throw badRequest('Only students of this class can be muted');
    if (!body.minutes) await prisma.chatMute.deleteMany({ where: { sectionId: a.section.id, userId: body.userId } });
    else {
      const until = new Date(Date.now() + body.minutes * 60000);
      await prisma.chatMute.upsert({ where: { sectionId_userId: { sectionId: a.section.id, userId: body.userId } }, create: { schoolId: tenantId(req), sectionId: a.section.id, userId: body.userId, until, byId: req.user!.id }, update: { until, byId: req.user!.id } });
    }
    await audit(req, { action: body.minutes ? 'chat.mute' : 'chat.unmute', entityType: 'Student', entityId: st.id, after: { minutes: body.minutes } });
    res.json({ ok: true });
  }),
);

router.get(
  '/settings',
  ah(async (req, res) => {
    res.json({ settings: await settings(tenantId(req)) });
  }),
);

router.put(
  '/settings',
  ah(async (req, res) => {
    if (req.user!.role !== 'PRINCIPAL') throw forbidden('Only the principal can change this');
    const body = parse(z.object({ classChatEnabled: z.boolean() }), req.body);
    await settings(tenantId(req));
    await prisma.commSettings.update({ where: { schoolId: tenantId(req) }, data: body });
    await audit(req, { action: 'chat.settings', entityType: 'CommSettings', entityId: tenantId(req), after: body });
    res.json({ ok: true });
  }),
);

/** Daily: delete chat messages (and their files) older than 30 days, except reported ones awaiting review. */
export async function cleanupChat(now = new Date()) {
  const cutoff = new Date(now.getTime() - CHAT_DAYS * 86400000);
  const old = await prisma.chatMessage.findMany({ where: { createdAt: { lt: cutoff }, OR: [{ reportedById: null }, { reportReviewedAt: { not: null } }] }, select: { id: true, schoolId: true, fileId: true }, take: 5000 });
  for (const m of old.filter((x) => x.fileId)) await deleteSchoolFile(m.schoolId, m.fileId!);
  // Replies pointing at removed messages just show "Deleted message".
  const r = await prisma.chatMessage.deleteMany({ where: { id: { in: old.map((m) => m.id) } } });
  return r.count;
}

export default router;

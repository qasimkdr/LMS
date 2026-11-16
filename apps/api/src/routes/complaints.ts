import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Complaint } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { notify } from '../services/messaging';
import { nextNumber } from '../services/counters';

/** Complaints from parents to the principal, as tickets: New → In progress → Resolved / Closed. */
const router = Router();

export const CATEGORIES = ['TEACHER', 'STAFF', 'STUDENT', 'FEES', 'ACADEMICS', 'FACILITIES', 'TRANSPORT', 'SAFETY', 'OTHER'] as const;
const STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
const STATUS_LABEL: Record<string, string> = { NEW: 'New', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', CLOSED: 'Closed' };

/** Principal, or staff/teachers the complaint is assigned to. */
const isManager = (req: Request) => req.user!.role === 'PRINCIPAL' || can(req, 'students.manage');

async function load(req: Request, id: string) {
  const c = await prisma.complaint.findFirst({ where: { id, schoolId: tenantId(req) } });
  if (!c) throw notFound('Complaint not found');
  const u = req.user!;
  const role = c.parentUserId === u.id ? 'PARENT' : isManager(req) ? 'MANAGER' : c.assignedToId === u.id ? 'ASSIGNEE' : null;
  if (!role) throw notFound('Complaint not found');
  return { c, role };
}

async function checkFiles(schoolId: string, userId: string, ids: string[]) {
  if (!ids.length) return;
  if ((await prisma.storedFile.count({ where: { schoolId, id: { in: ids }, uploadedById: userId, deletedAt: null } })) !== new Set(ids).size) throw badRequest('Unknown file');
}

async function summaries(rows: Complaint[]) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.parentUserId, r.assignedToId].filter((x): x is string => Boolean(x))))] } }, select: { id: true, fullName: true } });
  const students = await prisma.student.findMany({ where: { id: { in: rows.map((r) => r.studentId).filter((x): x is string => Boolean(x)) } }, select: { id: true, fullName: true } });
  return rows.map((r) => ({
    id: r.id,
    ticketNo: r.ticketNo,
    category: r.category,
    subject: r.subject,
    status: r.status,
    privateFromTeachers: r.privateFromTeachers,
    parent: users.find((u) => u.id === r.parentUserId)?.fullName ?? '',
    student: students.find((s) => s.id === r.studentId)?.fullName ?? null,
    assignedTo: users.find((u) => u.id === r.assignedToId)?.fullName ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    resolvedAt: r.resolvedAt,
  }));
}

router.get(
  '/',
  ah(async (req, res) => {
    const u = req.user!;
    const q = parse(z.object({ status: z.enum(STATUSES).optional(), category: z.enum(CATEGORIES).optional() }), req.query);
    const scope = u.role === 'PARENT' ? { parentUserId: u.id } : isManager(req) ? {} : { assignedToId: u.id };
    const rows = await prisma.complaint.findMany({ where: { schoolId: tenantId(req), ...scope, ...(q.status ? { status: q.status } : {}), ...(q.category ? { category: q.category } : {}) }, orderBy: [{ updatedAt: 'desc' }], take: 500 });
    const all = isManager(req) ? await prisma.complaint.groupBy({ by: ['status'], where: { schoolId: tenantId(req) }, _count: { _all: true } }) : [];
    res.json({ complaints: await summaries(rows), counts: Object.fromEntries(all.map((g) => [g.status, g._count._all])), manager: isManager(req) });
  }),
);

router.post(
  '/',
  ah(async (req, res) => {
    const u = req.user!;
    const schoolId = tenantId(req);
    if (u.role !== 'PARENT') throw forbidden('Complaints are sent by parents');
    const body = parse(
      z.object({
        studentId: z.string().nullish(),
        category: z.enum(CATEGORIES),
        subject: z.string().trim().min(3).max(200),
        description: z.string().trim().min(5).max(4000),
        fileIds: z.array(z.string()).max(5).default([]),
        privateFromTeachers: z.boolean().default(false),
        conversationId: z.string().nullish(),
      }),
      req.body,
    );
    if (body.studentId && !(await prisma.student.findFirst({ where: { id: body.studentId, schoolId, family: { parentUserId: u.id } } }))) throw badRequest('Unknown student');
    if (body.conversationId && !(await prisma.conversation.findFirst({ where: { id: body.conversationId, parentUserId: u.id } }))) throw badRequest('Unknown conversation');
    await checkFiles(schoolId, u.id, body.fileIds);
    const c = await prisma.$transaction(async (tx) => {
      const ticketNo = await nextNumber(tx, schoolId, 'complaint');
      return tx.complaint.create({ data: { schoolId, ticketNo, parentUserId: u.id, studentId: body.studentId ?? null, category: body.category, subject: body.subject, description: body.description, fileIds: body.fileIds, privateFromTeachers: body.privateFromTeachers, sourceConversationId: body.conversationId ?? null } });
    });
    const principals = await prisma.user.findMany({ where: { schoolId, role: 'PRINCIPAL', isActive: true, deletedAt: null }, select: { id: true } });
    await notify(schoolId, principals.map((p) => ({ userId: p.id, type: 'COMPLAINT', title: `New complaint #${c.ticketNo}: ${c.subject}`, body: `From ${u.fullName}`, link: `/complaints?id=${c.id}` })));
    await audit(req, { action: 'complaint.create', entityType: 'Complaint', entityId: c.id, after: { ticketNo: c.ticketNo, category: c.category } });
    res.status(201).json({ id: c.id, ticketNo: c.ticketNo });
  }),
);

router.get(
  '/:id',
  ah(async (req, res) => {
    const { c, role } = await load(req, req.params.id);
    const entries = await prisma.complaintEntry.findMany({ where: { complaintId: c.id, ...(role === 'PARENT' ? { kind: { not: 'NOTE' } } : {}) }, orderBy: { createdAt: 'asc' } });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.authorId))] } }, select: { id: true, fullName: true, role: true } });
    const files = await prisma.storedFile.findMany({ where: { id: { in: [...(c.fileIds as string[]), ...entries.flatMap((e) => e.fileIds as string[])] } }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true } });
    const f = (ids: unknown) => (ids as string[]).map((id) => files.find((x) => x.id === id)).filter(Boolean).map((x) => ({ id: x!.id, name: x!.originalName, mimeType: x!.mimeType, sizeBytes: x!.sizeBytes }));
    const [summary] = await summaries([c]);
    const staff = role === 'MANAGER' ? await prisma.user.findMany({ where: { schoolId: c.schoolId, role: { in: ['STAFF', 'TEACHER'] }, isActive: true, deletedAt: null, ...(c.privateFromTeachers ? { role: 'STAFF' } : {}) }, select: { id: true, fullName: true, role: true }, orderBy: { fullName: 'asc' } }) : [];
    res.json({
      complaint: { ...summary, description: c.description, files: f(c.fileIds), studentId: c.studentId },
      role,
      entries: entries.map((e) => ({ id: e.id, kind: e.kind, text: e.text, files: f(e.fileIds), author: users.find((u) => u.id === e.authorId)?.fullName ?? '', authorRole: users.find((u) => u.id === e.authorId)?.role ?? null, mine: e.authorId === req.user!.id, createdAt: e.createdAt })),
      staff,
    });
  }),
);

async function tellParent(c: Complaint, title: string, body: string) {
  await notify(c.schoolId, [{ userId: c.parentUserId, type: 'COMPLAINT', title, body, link: `/complaints?id=${c.id}` }]);
}

/** Reply (parent or school) or internal note (school only). */
router.post(
  '/:id/entries',
  ah(async (req, res) => {
    const { c, role } = await load(req, req.params.id);
    const body = parse(z.object({ kind: z.enum(['REPLY', 'NOTE']).default('REPLY'), text: z.string().trim().min(1).max(3000), fileIds: z.array(z.string()).max(5).default([]) }), req.body);
    if (role === 'PARENT' && body.kind === 'NOTE') throw forbidden();
    if (role === 'PARENT' && c.status === 'CLOSED') throw badRequest('This complaint is closed');
    await checkFiles(c.schoolId, req.user!.id, body.fileIds);
    await prisma.complaintEntry.create({ data: { complaintId: c.id, authorId: req.user!.id, kind: body.kind, text: body.text, fileIds: body.fileIds } });
    const reopen = role === 'PARENT' && c.status === 'RESOLVED';
    await prisma.complaint.update({ where: { id: c.id }, data: { updatedAt: new Date(), ...(reopen ? { status: 'IN_PROGRESS', resolvedAt: null } : role !== 'PARENT' && c.status === 'NEW' && body.kind === 'REPLY' ? { status: 'IN_PROGRESS' } : {}) } });
    if (role !== 'PARENT' && body.kind === 'REPLY') await tellParent(c, `Reply on complaint #${c.ticketNo}`, body.text.slice(0, 200));
    if (role === 'PARENT') {
      const to = [c.assignedToId, ...(await prisma.user.findMany({ where: { schoolId: c.schoolId, role: 'PRINCIPAL', isActive: true }, select: { id: true } })).map((p) => p.id)].filter((x): x is string => Boolean(x));
      await notify(c.schoolId, [...new Set(to)].map((userId) => ({ userId, type: 'COMPLAINT', title: `Parent replied on complaint #${c.ticketNo}`, body: body.text.slice(0, 200), link: `/complaints?id=${c.id}` })));
    }
    res.status(201).json({ ok: true });
  }),
);

router.patch(
  '/:id',
  ah(async (req, res) => {
    const { c, role } = await load(req, req.params.id);
    if (role === 'PARENT') throw forbidden();
    const body = parse(z.object({ status: z.enum(STATUSES).optional(), assignedToId: z.string().nullish() }), req.body);
    if (role === 'ASSIGNEE' && body.assignedToId !== undefined) throw forbidden('Only the principal can assign');
    const data: { status?: string; resolvedAt?: Date | null; assignedToId?: string | null } = {};
    if (body.status && body.status !== c.status) {
      data.status = body.status;
      data.resolvedAt = ['RESOLVED', 'CLOSED'].includes(body.status) ? new Date() : null;
      await prisma.complaintEntry.create({ data: { complaintId: c.id, authorId: req.user!.id, kind: 'STATUS', text: STATUS_LABEL[body.status], fileIds: [] } });
      await tellParent(c, `Complaint #${c.ticketNo}: ${STATUS_LABEL[body.status]}`, c.subject);
    }
    if (body.assignedToId !== undefined && body.assignedToId !== c.assignedToId) {
      if (body.assignedToId) {
        const a = await prisma.user.findFirst({ where: { id: body.assignedToId, schoolId: c.schoolId, role: { in: c.privateFromTeachers ? ['STAFF'] : ['STAFF', 'TEACHER'] }, isActive: true } });
        if (!a) throw badRequest(c.privateFromTeachers ? 'This complaint is private from teachers; assign it to office staff' : 'Unknown staff member');
        await prisma.complaintEntry.create({ data: { complaintId: c.id, authorId: req.user!.id, kind: 'ASSIGN', text: `Assigned to ${a.fullName}`, fileIds: [] } });
        await notify(c.schoolId, [{ userId: a.id, type: 'COMPLAINT', title: `Complaint #${c.ticketNo} assigned to you`, body: c.subject, link: `/complaints?id=${c.id}` }]);
      }
      data.assignedToId = body.assignedToId ?? null;
      if (c.status === 'NEW' && !data.status) data.status = 'IN_PROGRESS';
    }
    await prisma.complaint.update({ where: { id: c.id }, data });
    await audit(req, { action: 'complaint.update', entityType: 'Complaint', entityId: c.id, before: { status: c.status, assignedToId: c.assignedToId }, after: body });
    res.json({ ok: true });
  }),
);

export default router;

import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { can } from '../lib/http';
import { tenantId } from '../middleware/auth';
import { audit } from '../services/audit';
import { enqueue, getSettings, notify, ruleFor, studentsWithContacts, whatsappReady } from '../services/messaging';
import { MESSAGE_TYPES, renderTemplate } from '../config/messageTypes';

/** Circulars / announcements with read receipts. */
const router = Router();
const isManager = (req: Request) => can(req, 'messages.send');
const classLabel = (c: { name: string; stream: string | null }, s?: { name: string } | null) => `${c.name}${c.stream ? ` ${c.stream}` : ''}${s ? ` ${s.name}` : ''}`;

const body = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(3).max(20000),
  fileIds: z.array(z.string()).max(5).default([]),
  audience: z.enum(['SCHOOL', 'CLASSES', 'SECTIONS', 'STAFF']),
  classIds: z.array(z.string()).max(100).default([]),
  sectionIds: z.array(z.string()).max(300).default([]),
  includeStaff: z.boolean().default(false),
  whatsapp: z.boolean().default(false),
});

router.post(
  '/',
  ah(async (req, res) => {
    if (!isManager(req)) throw forbidden();
    const schoolId = tenantId(req);
    const b = parse(body, req.body);
    if (b.audience === 'CLASSES' && !b.classIds.length) throw badRequest('Choose at least one class');
    if (b.audience === 'SECTIONS' && !b.sectionIds.length) throw badRequest('Choose at least one section');
    if (b.fileIds.length && (await prisma.storedFile.count({ where: { schoolId, id: { in: b.fileIds }, deletedAt: null } })) !== new Set(b.fileIds).size) throw badRequest('Unknown file');
    const studentWhere = b.audience === 'SCHOOL' ? {} : b.audience === 'CLASSES' ? { classId: { in: b.classIds } } : b.audience === 'SECTIONS' ? { sectionId: { in: b.sectionIds } } : null;
    const students = studentWhere ? await studentsWithContacts(schoolId, studentWhere) : [];
    const staff = b.audience === 'STAFF' || b.includeStaff ? await prisma.user.findMany({ where: { schoolId, role: { in: ['TEACHER', 'STAFF'] }, isActive: true, deletedAt: null }, select: { id: true } }) : [];
    const recipients = [...new Set([...students.map((s) => s.parentUserId).filter((x): x is string => Boolean(x)), ...staff.map((s) => s.id)])];
    if (!recipients.length) throw badRequest('Nobody to send to');
    const c = await prisma.circular.create({ data: { schoolId, title: b.title, body: b.body, fileIds: b.fileIds, audience: b.audience, classIds: b.classIds, sectionIds: b.sectionIds, includeStaff: b.includeStaff, recipientIds: recipients, whatsapp: b.whatsapp, createdById: req.user!.id } });
    await notify(schoolId, recipients.map((userId) => ({ userId, type: 'CIRCULAR', title: `📢 ${b.title}`, body: b.body.slice(0, 200), link: `/circulars?id=${c.id}` })));
    let whatsapp = 0;
    if (b.whatsapp && students.length) {
      const settings = await getSettings(schoolId);
      if (whatsappReady(settings) && ruleFor(settings, 'CIRCULAR') !== 'off') {
        const school = req.user!.school!;
        // One message per family phone, not per child.
        const seen = new Set<string>();
        const items = [];
        for (const s of students)
          for (const g of s.guardians) {
            if (!g.phone || seen.has(g.phone)) continue;
            seen.add(g.phone);
            const params = [b.title.slice(0, 200), school.name];
            items.push({ to: { phone: g.phone, name: g.name, studentId: s.id }, type: 'CIRCULAR', params, body: renderTemplate(MESSAGE_TYPES.CIRCULAR.suggestedTemplate.text, params) });
          }
        whatsapp = await enqueue(schoolId, settings, items);
      }
    }
    await audit(req, { action: 'circular.send', entityType: 'Circular', entityId: c.id, after: { title: b.title, audience: b.audience, recipients: recipients.length, whatsapp } });
    res.status(201).json({ id: c.id, recipients: recipients.length, whatsapp });
  }),
);

router.get(
  '/',
  ah(async (req, res) => {
    const u = req.user!;
    const schoolId = tenantId(req);
    const manager = isManager(req);
    const rows = await prisma.circular.findMany({
      where: { schoolId, deletedAt: null, ...(manager ? {} : { recipientIds: { array_contains: u.id } }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { _count: { select: { reads: true } }, reads: { where: { userId: u.id }, select: { readAt: true } } },
    });
    const authors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, fullName: true } });
    res.json({
      manager,
      circulars: rows.map((r) => ({
        id: r.id,
        title: r.title,
        preview: r.body.slice(0, 180),
        audience: r.audience,
        createdAt: r.createdAt,
        by: authors.find((a) => a.id === r.createdById)?.fullName ?? '',
        files: (r.fileIds as string[]).length,
        read: r.reads.length > 0,
        ...(manager ? { recipients: (r.recipientIds as string[]).length, reads: r._count.reads } : {}),
      })),
    });
  }),
);

async function load(req: Request, id: string) {
  const c = await prisma.circular.findFirst({ where: { id, schoolId: tenantId(req), deletedAt: null } });
  if (!c) throw notFound('Circular not found');
  const recipient = (c.recipientIds as string[]).includes(req.user!.id);
  if (!recipient && !isManager(req)) throw notFound('Circular not found');
  return { c, recipient };
}

router.get(
  '/:id',
  ah(async (req, res) => {
    const { c, recipient } = await load(req, req.params.id);
    if (recipient) await prisma.circularRead.upsert({ where: { circularId_userId: { circularId: c.id, userId: req.user!.id } }, create: { circularId: c.id, userId: req.user!.id }, update: {} });
    const files = await prisma.storedFile.findMany({ where: { id: { in: c.fileIds as string[] }, deletedAt: null }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true } });
    const author = await prisma.user.findUnique({ where: { id: c.createdById }, select: { fullName: true } });
    const readCount = await prisma.circularRead.count({ where: { circularId: c.id } });
    res.json({
      circular: { id: c.id, title: c.title, body: c.body, audience: c.audience, createdAt: c.createdAt, by: author?.fullName ?? '', files: files.map((f) => ({ id: f.id, name: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes })) },
      ...(isManager(req) ? { stats: { recipients: (c.recipientIds as string[]).length, reads: readCount } } : {}),
    });
  }),
);

/** Read receipts: who has opened the circular (parents with their children's names). */
router.get(
  '/:id/receipts',
  ah(async (req, res) => {
    if (!isManager(req)) throw forbidden();
    const { c } = await load(req, req.params.id);
    const ids = c.recipientIds as string[];
    const [users, reads, kids] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, role: true, phone: true } }),
      prisma.circularRead.findMany({ where: { circularId: c.id } }),
      prisma.student.findMany({ where: { family: { parentUserId: { in: ids } }, deletedAt: null, status: 'ACTIVE' }, select: { fullName: true, family: { select: { parentUserId: true } }, class: { select: { name: true, stream: true } }, section: { select: { name: true } } } }),
    ]);
    const rows = users
      .map((u) => ({
        userId: u.id,
        name: u.fullName,
        role: u.role,
        children: kids.filter((k) => k.family.parentUserId === u.id).map((k) => `${k.fullName} (${classLabel(k.class, k.section)})`),
        readAt: reads.find((r) => r.userId === u.id)?.readAt ?? null,
      }))
      .sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)) || (a.children[0] ?? a.name).localeCompare(b.children[0] ?? b.name));
    res.json({ total: rows.length, read: reads.length, rows });
  }),
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    if (!isManager(req)) throw forbidden();
    const { c } = await load(req, req.params.id);
    await prisma.circular.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
    await audit(req, { action: 'circular.delete', entityType: 'Circular', entityId: c.id, before: { title: c.title } });
    res.json({ ok: true });
  }),
);

export default router;

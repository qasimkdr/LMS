import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { Prisma, prisma } from '@nexora/database';
import { z } from 'zod';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { routeParam } from '../utils/http.js';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  subject: z.string().min(4).max(180),
  category: z.enum(['GENERAL', 'BILLING', 'TECHNICAL', 'DATA', 'ACCOUNT', 'FEATURE']).default('GENERAL'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  message: z.string().min(4).max(5000),
});

router.post('/tickets', requireRoles('PRINCIPAL', 'STAFF'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid support ticket', issues: parsed.error.flatten() });
  const schoolId = req.auth!.schoolId;
  if (!schoolId) return res.status(403).json({ message: 'School scope required' });

  const id = randomUUID();
  const messageId = randomUUID();
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "SupportTicket"
        (id, "schoolId", "createdById", subject, category, priority, status, "createdAt", "updatedAt")
      VALUES
        (${id}, ${schoolId}, ${req.auth!.userId}, ${parsed.data.subject}, ${parsed.data.category}, ${parsed.data.priority}, 'OPEN', ${now}, ${now})
    `);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "SupportTicketMessage"
        (id, "ticketId", "authorId", body, "isInternal", "createdAt")
      VALUES
        (${messageId}, ${id}, ${req.auth!.userId}, ${parsed.data.message}, false, ${now})
    `);
    await tx.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: 'SUPPORT_TICKET_CREATED',
        entityType: 'SupportTicket',
        entityId: id,
        afterData: { subject: parsed.data.subject, category: parsed.data.category, priority: parsed.data.priority },
      },
    });
  });

  return res.status(201).json({ id, status: 'OPEN' });
});

router.get('/tickets', requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'STAFF'), async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;

  if (req.auth!.role === 'SUPER_ADMIN') {
    const rows = status
      ? await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT t.*, s.name AS "schoolName", u."firstName", u."lastName",
            (SELECT COUNT(*) FROM "SupportTicketMessage" m WHERE m."ticketId" = t.id) AS "messageCount"
          FROM "SupportTicket" t
          JOIN "School" s ON s.id = t."schoolId"
          JOIN "User" u ON u.id = t."createdById"
          WHERE t.status = ${status}
          ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
            t."updatedAt" DESC
        `)
      : await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT t.*, s.name AS "schoolName", u."firstName", u."lastName",
            (SELECT COUNT(*) FROM "SupportTicketMessage" m WHERE m."ticketId" = t.id) AS "messageCount"
          FROM "SupportTicket" t
          JOIN "School" s ON s.id = t."schoolId"
          JOIN "User" u ON u.id = t."createdById"
          ORDER BY CASE t.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'WAITING_ON_SCHOOL' THEN 2 WHEN 'RESOLVED' THEN 3 ELSE 4 END,
            CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
            t."updatedAt" DESC
        `);
    return res.json(rows.map((row) => ({ ...row, messageCount: Number(row.messageCount ?? 0) })));
  }

  const schoolId = req.auth!.schoolId!;
  const rows = status
    ? await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT t.*, u."firstName", u."lastName",
          (SELECT COUNT(*) FROM "SupportTicketMessage" m WHERE m."ticketId" = t.id AND m."isInternal" = false) AS "messageCount"
        FROM "SupportTicket" t
        JOIN "User" u ON u.id = t."createdById"
        WHERE t."schoolId" = ${schoolId} AND t.status = ${status}
        ORDER BY t."updatedAt" DESC
      `)
    : await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT t.*, u."firstName", u."lastName",
          (SELECT COUNT(*) FROM "SupportTicketMessage" m WHERE m."ticketId" = t.id AND m."isInternal" = false) AS "messageCount"
        FROM "SupportTicket" t
        JOIN "User" u ON u.id = t."createdById"
        WHERE t."schoolId" = ${schoolId}
        ORDER BY t."updatedAt" DESC
      `);

  return res.json(rows.map((row) => ({ ...row, messageCount: Number(row.messageCount ?? 0) })));
});

router.get('/tickets/:id', requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'STAFF'), async (req, res) => {
  const id = routeParam(req.params.id);
  const tickets = req.auth!.role === 'SUPER_ADMIN'
    ? await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT t.*, s.name AS "schoolName"
        FROM "SupportTicket" t
        JOIN "School" s ON s.id = t."schoolId"
        WHERE t.id = ${id}
        LIMIT 1
      `)
    : await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT *
        FROM "SupportTicket"
        WHERE id = ${id} AND "schoolId" = ${req.auth!.schoolId!}
        LIMIT 1
      `);

  const ticket = tickets[0];
  if (!ticket) return res.status(404).json({ message: 'Support ticket not found' });

  const messages = req.auth!.role === 'SUPER_ADMIN'
    ? await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT m.*, u."firstName", u."lastName", u.role
        FROM "SupportTicketMessage" m
        JOIN "User" u ON u.id = m."authorId"
        WHERE m."ticketId" = ${id}
        ORDER BY m."createdAt"
      `)
    : await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT m.*, u."firstName", u."lastName", u.role
        FROM "SupportTicketMessage" m
        JOIN "User" u ON u.id = m."authorId"
        WHERE m."ticketId" = ${id} AND m."isInternal" = false
        ORDER BY m."createdAt"
      `);

  return res.json({ ticket, messages });
});

const messageSchema = z.object({
  body: z.string().min(1).max(5000),
  isInternal: z.boolean().default(false),
});

router.post('/tickets/:id/messages', requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'STAFF'), async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid reply' });
  if (parsed.data.isInternal && req.auth!.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ message: 'Internal notes are Super Admin only' });
  }

  const id = routeParam(req.params.id);
  const rows = req.auth!.role === 'SUPER_ADMIN'
    ? await prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "SupportTicket" WHERE id = ${id} LIMIT 1`)
    : await prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "SupportTicket" WHERE id = ${id} AND "schoolId" = ${req.auth!.schoolId!} LIMIT 1`);

  const ticket = rows[0];
  if (!ticket) return res.status(404).json({ message: 'Support ticket not found' });
  if (['RESOLVED', 'CLOSED'].includes(ticket.status) && req.auth!.role !== 'SUPER_ADMIN') {
    return res.status(409).json({ message: 'Resolved or closed tickets cannot be replied to' });
  }

  const messageId = randomUUID();
  const now = new Date();
  const nextStatus = req.auth!.role === 'SUPER_ADMIN'
    ? parsed.data.isInternal ? ticket.status : 'WAITING_ON_SCHOOL'
    : 'OPEN';

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "SupportTicketMessage"
        (id, "ticketId", "authorId", body, "isInternal", "createdAt")
      VALUES
        (${messageId}, ${id}, ${req.auth!.userId}, ${parsed.data.body}, ${parsed.data.isInternal}, ${now})
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "SupportTicket"
      SET status = ${nextStatus}, "updatedAt" = ${now}
      WHERE id = ${id}
    `);
    await tx.auditLog.create({
      data: {
        schoolId: ticket.schoolId,
        actorId: req.auth!.userId,
        action: parsed.data.isInternal ? 'SUPPORT_INTERNAL_NOTE_ADDED' : 'SUPPORT_REPLY_ADDED',
        entityType: 'SupportTicket',
        entityId: id,
        afterData: { messageId, status: nextStatus },
      },
    });

    if (req.auth!.role === 'SUPER_ADMIN' && !parsed.data.isInternal) {
      const recipients = await tx.user.findMany({
        where: { schoolId: ticket.schoolId, role: { in: ['PRINCIPAL', 'STAFF'] }, isActive: true },
        select: { id: true },
      });
      if (recipients.length) {
        await tx.notification.createMany({
          data: recipients.map((recipient) => ({
            schoolId: ticket.schoolId,
            userId: recipient.id,
            title: 'Nexora Support replied',
            body: ticket.subject,
            link: '/support',
          })),
        });
      }
    }
  });

  return res.status(201).json({ id: messageId, status: nextStatus });
});

const updateSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_SCHOOL', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
});

router.patch('/tickets/:id', requireRoles('SUPER_ADMIN'), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid support update' });

  const id = routeParam(req.params.id);
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM "SupportTicket" WHERE id = ${id} LIMIT 1`);
  const ticket = rows[0];
  if (!ticket) return res.status(404).json({ message: 'Support ticket not found' });

  if (parsed.data.assignedToId) {
    const admin = await prisma.user.findFirst({
      where: { id: parsed.data.assignedToId, role: 'SUPER_ADMIN', isActive: true },
    });
    if (!admin) return res.status(400).json({ message: 'Assignee must be an active Super Admin' });
  }

  const status = parsed.data.status ?? ticket.status;
  const priority = parsed.data.priority ?? ticket.priority;
  const assignedToId = parsed.data.assignedToId === undefined ? ticket.assignedToId : parsed.data.assignedToId;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "SupportTicket"
      SET status = ${status}, priority = ${priority}, "assignedToId" = ${assignedToId}, "updatedAt" = ${now}
      WHERE id = ${id}
    `);
    await tx.auditLog.create({
      data: {
        schoolId: ticket.schoolId,
        actorId: req.auth!.userId,
        action: 'SUPPORT_TICKET_UPDATED',
        entityType: 'SupportTicket',
        entityId: id,
        beforeData: { status: ticket.status, priority: ticket.priority, assignedToId: ticket.assignedToId },
        afterData: { status, priority, assignedToId },
      },
    });
  });

  return res.json({ ok: true, status, priority, assignedToId });
});

export default router;

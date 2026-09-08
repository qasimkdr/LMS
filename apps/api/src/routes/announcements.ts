import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant);

const createSchema = z.object({
  title: z.string().min(2),
  body: z.string().min(2).max(5000),
  audience: z.array(z.enum(['PRINCIPAL','STAFF','TEACHER','STUDENT','PARENT'])).min(1),
  classId: z.string().uuid().optional(),
  publishAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  isPinned: z.boolean().optional(),
});

router.get('/manage', requireRoles('PRINCIPAL','STAFF'), async (req, res) => {
  const rows = await prisma.announcement.findMany({
    where: { schoolId: req.auth!.schoolId! },
    include: { class: { select: { name: true, section: true } } },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  res.json(rows);
});

router.get('/', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const now = new Date();
  const role = req.auth!.role;
  const where: any = { schoolId, OR: [{ publishAt: null }, { publishAt: { lte: now } }], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }] };
  if (!['PRINCIPAL','STAFF'].includes(role)) where.audience = { has: role };
  const rows = await prisma.announcement.findMany({ where, orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }], take: 50 });
  res.json(rows);
});

router.post('/', requireRoles('PRINCIPAL','STAFF'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid announcement', issues: parsed.error.flatten() });
  const schoolId = req.auth!.schoolId!;
  if (parsed.data.classId) {
    const classExists = await prisma.class.count({ where: { id: parsed.data.classId, schoolId } });
    if (!classExists) return res.status(400).json({ message: 'Class target does not belong to this school' });
  }
  const policy = await prisma.approvalPolicy.findUnique({ where: { schoolId_actionKey: { schoolId, actionKey: 'ANNOUNCEMENT_PUBLISH' } } });
  if (req.auth!.role === 'STAFF' && policy && !policy.staffAllowed) return res.status(403).json({ message: 'Staff are not allowed to publish announcements' });
  if (req.auth!.role === 'STAFF' && policy?.requiresApproval) {
    const request = await prisma.$transaction(async tx => {
      const r = await tx.approvalRequest.create({ data: { schoolId, requesterId: req.auth!.userId, requestType: 'ANNOUNCEMENT_PUBLISH', entityType: 'Announcement', proposedData: parsed.data, status: 'PENDING', submittedAt: new Date() } });
      await tx.approvalVersion.create({ data: { approvalRequestId: r.id, revision: 1, proposedData: parsed.data } });
      return r;
    });
    return res.status(202).json({ approvalRequired: true, request });
  }
  const row = await prisma.announcement.create({ data: { schoolId, createdById: req.auth!.userId, ...parsed.data } });
  await prisma.auditLog.create({ data: { schoolId, actorId: req.auth!.userId, action: 'ANNOUNCEMENT_CREATED', entityType: 'Announcement', entityId: row.id } });
  res.status(201).json(row);
});

export default router;

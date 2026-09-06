import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant);

const requestSchema = z.object({
  requestType: z.enum(['TEACHER_ASSIGNMENT']),
  entityType: z.string().default('TeacherAssignment'),
  entityId: z.string().optional(),
  proposedData: z.object({ teacherId: z.string().uuid(), classId: z.string().uuid(), subjectId: z.string().uuid() }),
  note: z.string().max(1000).optional(),
});

router.get('/', requireRoles('PRINCIPAL', 'STAFF'), async (req, res) => {
  const requests = await prisma.approvalRequest.findMany({
    where: { schoolId: req.auth!.schoolId!, ...(req.auth!.role === 'STAFF' ? { requesterId: req.auth!.userId } : {}) },
    orderBy: { updatedAt: 'desc' },
    include: {
      requester: { select: { id: true, firstName: true, lastName: true } },
      reviewer: { select: { id: true, firstName: true, lastName: true } },
      versions: { orderBy: { revision: 'desc' } },
    },
  });
  res.json(requests);
});

router.post('/', requireRoles('STAFF'), async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid approval request', issues: parsed.error.flatten() });

  const { teacherId, classId, subjectId } = parsed.data.proposedData;
  const [teacher, klass, subject] = await Promise.all([
    prisma.user.findFirst({ where: { id: teacherId, schoolId: req.auth!.schoolId, role: 'TEACHER', isActive: true } }),
    prisma.class.findFirst({ where: { id: classId, schoolId: req.auth!.schoolId } }),
    prisma.subject.findFirst({ where: { id: subjectId, schoolId: req.auth!.schoolId } }),
  ]);
  if (!teacher || !klass || !subject) return res.status(400).json({ message: 'Teacher, class or subject is outside your school or invalid' });

  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.approvalRequest.create({
      data: {
        schoolId: req.auth!.schoolId!, requesterId: req.auth!.userId,
        requestType: parsed.data.requestType, entityType: parsed.data.entityType,
        entityId: parsed.data.entityId, proposedData: parsed.data.proposedData,
        status: 'PENDING', submittedAt: new Date(),
      },
    });
    await tx.approvalVersion.create({ data: { approvalRequestId: request.id, revision: 1, proposedData: parsed.data.proposedData, note: parsed.data.note } });
    await tx.auditLog.create({ data: { schoolId: req.auth!.schoolId!, actorId: req.auth!.userId, action: 'APPROVAL_SUBMITTED', entityType: 'ApprovalRequest', entityId: request.id, afterData: parsed.data.proposedData } });
    return request;
  });
  res.status(201).json(created);
});

router.patch('/:id/resubmit', requireRoles('STAFF'), async (req, res) => {
  const parsed = requestSchema.pick({ proposedData: true, note: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid revision' });
  const current = await prisma.approvalRequest.findFirst({ where: { id: req.params.id, schoolId: req.auth!.schoolId, requesterId: req.auth!.userId, status: 'REVISION_REQUIRED' } });
  if (!current) return res.status(404).json({ message: 'Revision request not found' });
  const revision = current.revision + 1;
  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.approvalRequest.update({ where: { id: current.id }, data: { proposedData: parsed.data.proposedData, revision, status: 'RESUBMITTED', submittedAt: new Date(), principalRemark: null } });
    await tx.approvalVersion.create({ data: { approvalRequestId: current.id, revision, proposedData: parsed.data.proposedData, note: parsed.data.note } });
    await tx.auditLog.create({ data: { schoolId: req.auth!.schoolId!, actorId: req.auth!.userId, action: 'APPROVAL_RESUBMITTED', entityType: 'ApprovalRequest', entityId: current.id, afterData: parsed.data.proposedData } });
    return request;
  });
  res.json(updated);
});

const reviewSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT', 'REVISION_REQUIRED']), remark: z.string().max(1000).optional() });

router.patch('/:id/review', requireRoles('PRINCIPAL'), async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid review decision' });
  if (parsed.data.decision !== 'APPROVE' && !parsed.data.remark) return res.status(400).json({ message: 'A remark is required when rejecting or requesting revision' });

  const current = await prisma.approvalRequest.findFirst({ where: { id: req.params.id, schoolId: req.auth!.schoolId, status: { in: ['PENDING', 'RESUBMITTED'] } } });
  if (!current) return res.status(404).json({ message: 'Pending request not found' });

  const result = await prisma.$transaction(async (tx) => {
    if (parsed.data.decision === 'APPROVE' && current.requestType === 'TEACHER_ASSIGNMENT') {
      const data = current.proposedData as { teacherId: string; classId: string; subjectId: string };
      const [teacher, klass, subject] = await Promise.all([
        tx.user.findFirst({ where: { id: data.teacherId, schoolId: req.auth!.schoolId, role: 'TEACHER' } }),
        tx.class.findFirst({ where: { id: data.classId, schoolId: req.auth!.schoolId } }),
        tx.subject.findFirst({ where: { id: data.subjectId, schoolId: req.auth!.schoolId } }),
      ]);
      if (!teacher || !klass || !subject) throw new Error('Referenced school records are no longer valid');
      await tx.teacherAssignment.upsert({
        where: { schoolId_teacherId_classId_subjectId: { schoolId: req.auth!.schoolId!, teacherId: data.teacherId, classId: data.classId, subjectId: data.subjectId } },
        create: { schoolId: req.auth!.schoolId!, teacherId: data.teacherId, classId: data.classId, subjectId: data.subjectId },
        update: {},
      });
    }

    const status = parsed.data.decision === 'APPROVE' ? 'APPROVED' : parsed.data.decision === 'REJECT' ? 'REJECTED' : 'REVISION_REQUIRED';
    const request = await tx.approvalRequest.update({ where: { id: current.id }, data: { status, reviewerId: req.auth!.userId, reviewedAt: new Date(), principalRemark: parsed.data.remark } });
    await tx.auditLog.create({ data: { schoolId: req.auth!.schoolId!, actorId: req.auth!.userId, action: `APPROVAL_${status}`, entityType: 'ApprovalRequest', entityId: current.id, afterData: { remark: parsed.data.remark ?? null } } });
    return request;
  });

  res.json(result);
});

export default router;

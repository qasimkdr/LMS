import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@nexora/database';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireTenant, requireRoles('PRINCIPAL'));

const defaults = [
  'CREATE_STUDENT','EDIT_STUDENT','DELETE_STUDENT','CHANGE_STUDENT_CLASS','ASSIGN_TEACHER','EDIT_TIMETABLE','PUBLISH_ANNOUNCEMENT','EDIT_OLD_ATTENDANCE','CORRECT_RESULT','DELETE_RECORD'
];

router.get('/', async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const existing = await prisma.approvalPolicy.findMany({ where: { schoolId }, orderBy: { actionKey: 'asc' } });
  const map = new Map(existing.map((p) => [p.actionKey, p]));
  res.json(defaults.map((actionKey) => map.get(actionKey) ?? { actionKey, requiresApproval: true, allowedForStaff: true, schoolId }));
});

const updateSchema = z.object({ actionKey: z.string().min(2).max(80), requiresApproval: z.boolean(), allowedForStaff: z.boolean() });
router.put('/', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid policy' });
  const schoolId = req.auth!.schoolId!;
  const policy = await prisma.approvalPolicy.upsert({
    where: { schoolId_actionKey: { schoolId, actionKey: parsed.data.actionKey } },
    create: { schoolId, ...parsed.data }, update: parsed.data,
  });
  await prisma.auditLog.create({ data: { schoolId, actorId: req.auth!.userId, action: 'APPROVAL_POLICY_UPDATED', entityType: 'ApprovalPolicy', entityId: policy.id, afterData: parsed.data } });
  res.json(policy);
});

export default router;

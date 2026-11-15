import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { FileCategory } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/asyncHandler';
import { parse } from '../lib/validate';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { tenantId } from '../middleware/auth';
import { effectiveLimits } from '../services/limits';
import { deleteSchoolFile, saveSchoolFile } from '../services/files';
import { storage } from '../storage';
import { audit } from '../services/audit';

const router = Router();

const canManageFiles = (req: Request) => {
  const u = req.user!;
  return u.role === 'PRINCIPAL' || u.role === 'TEACHER' || (u.role === 'STAFF' && u.permissions.includes('files.manage'));
};

/** Upload: multipart field "file" plus "category". Size limit comes from the school's plan. */
router.post(
  '/',
  ah(async (req, res) => {
    const school = req.user!.school!;
    const u = req.user!;
    // Profile photos and student documents can be added by staff who manage students/staff.
    const peopleUpload = u.role === 'STAFF' && (u.permissions.includes('students.manage') || u.permissions.includes('staff.manage'));
    if (!canManageFiles(req) && !peopleUpload) throw forbidden();
    const limit = effectiveLimits(school).maxFileBytes;
    await new Promise<void>((resolve, reject) =>
      multer({ storage: multer.memoryStorage(), limits: { fileSize: limit, files: 1 } }).single('file')(req, {} as never, (err) =>
        err ? reject(err) : resolve(),
      ),
    );
    if (!req.file) throw badRequest('No file uploaded (field name must be "file")');
    const { category } = parse(z.object({ category: z.nativeEnum(FileCategory).default('OTHER') }), req.body);
    if (!canManageFiles(req) && !['PROFILE_PHOTO', 'STUDENT_DOCUMENT', 'STAFF_DOCUMENT'].includes(category)) throw forbidden();
    const saved = await saveSchoolFile({ school, uploadedById: req.user!.id, category, file: req.file });
    await audit(req, { action: 'file.upload', entityType: 'StoredFile', entityId: saved.id, after: { name: saved.originalName, size: saved.sizeBytes, category } });
    res.status(201).json({ file: saved });
  }),
);

router.get(
  '/',
  ah(async (req, res) => {
    if (!canManageFiles(req)) throw forbidden();
    const q = parse(
      z.object({
        category: z.nativeEnum(FileCategory).optional(),
        page: z.coerce.number().int().min(1).default(1),
      }),
      req.query,
    );
    const where = {
      schoolId: tenantId(req),
      deletedAt: null,
      category: q.category,
      // Teachers see only their own uploads in the file manager.
      ...(req.user!.role === 'TEACHER' ? { uploadedById: req.user!.id } : {}),
    };
    const pageSize = 50;
    const [files, total] = await Promise.all([
      prisma.storedFile.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * pageSize, take: pageSize }),
      prisma.storedFile.count({ where }),
    ]);
    res.json({ files, total, page: q.page, pageSize });
  }),
);

/** Any logged-in user of the same school can open a file by id. Per-category rules come with each module. */
router.get(
  '/:id/download',
  ah(async (req, res) => {
    const file = await prisma.storedFile.findFirst({ where: { id: req.params.id, schoolId: tenantId(req), deletedAt: null } });
    if (!file) throw notFound('File not found');
    const u = req.user!;
    const sensitive: Record<string, string> = { STUDENT_DOCUMENT: 'students.view', STAFF_DOCUMENT: 'staff.view' };
    const perm = sensitive[file.category];
    if (perm && !(u.role === 'PRINCIPAL' || (u.role === 'STAFF' && u.permissions.includes(perm)))) throw notFound('File not found');
    const stream = await storage.get(file.storageKey);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    const inline = file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf';
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }),
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const schoolId = tenantId(req);
    const file = await prisma.storedFile.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
    if (!file) throw notFound('File not found');
    const u = req.user!;
    const allowed = u.role === 'PRINCIPAL' || (u.role === 'STAFF' && u.permissions.includes('files.manage')) || file.uploadedById === u.id;
    if (!allowed) throw forbidden();
    await deleteSchoolFile(schoolId, file.id);
    await audit(req, { action: 'file.delete', entityType: 'StoredFile', entityId: file.id, before: { name: file.originalName, size: file.sizeBytes } });
    res.json({ ok: true });
  }),
);

export default router;

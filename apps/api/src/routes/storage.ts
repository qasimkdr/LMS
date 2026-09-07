import { randomUUID } from 'node:crypto';
import { Router, raw } from 'express';
import { Prisma, prisma } from '@nexora/database';
import { z } from 'zod';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';
import { routeParam } from '../utils/http.js';

const router = Router();
router.use(requireAuth, requireTenant);

const bucket = 'nexora-private';
const allowed = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'application/zip',
]);
const categories = new Set([
  'school-logo',
  'assignment',
  'material',
  'submission',
  'exam',
  'report',
  'general',
]);
const referenceTrackedCategories = ['school-logo', 'assignment', 'material', 'submission'] as const;

type StorageRow = {
  id: string;
  schoolId: string;
  uploadedById: string;
  bucket: string;
  path: string;
  originalName: string;
  mimeType: string;
  sizeBytes: bigint | number;
  category: string;
  createdAt?: Date;
};

function env() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase storage environment is not configured');
  return { url: url.replace(/\/$/, ''), key };
}

async function ensureBucket() {
  const { url, key } = env();
  const headers = {
    Authorization: `Bearer ${key}`,
    apikey: key,
    'Content-Type': 'application/json',
  };
  const check = await fetch(`${url}/storage/v1/bucket/${bucket}`, { headers });
  if (check.ok) return;
  const create = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: false,
      file_size_limit: 104857600,
      allowed_mime_types: [...allowed],
    }),
  });
  if (!create.ok && create.status !== 409) {
    throw new Error(`Could not initialize storage bucket: ${await create.text()}`);
  }
}

const clean = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(-120) || 'file';

function uploadAllowed(role: string, category: string) {
  if (role === 'PRINCIPAL') return true;
  if (role === 'TEACHER') return ['assignment', 'material', 'exam', 'general'].includes(category);
  if (role === 'STAFF') return category === 'general';
  if (role === 'STUDENT') return category === 'submission';
  return false;
}

async function isObjectLinked(obj: Pick<StorageRow, 'id' | 'schoolId' | 'category'>) {
  const reference = `storage://${obj.id}`;
  if (obj.category === 'school-logo') {
    return Boolean(
      await prisma.school.findFirst({
        where: { id: obj.schoolId, logoUrl: reference },
        select: { id: true },
      }),
    );
  }
  if (obj.category === 'assignment') {
    return Boolean(
      await prisma.assignment.findFirst({
        where: { schoolId: obj.schoolId, attachmentUrl: reference },
        select: { id: true },
      }),
    );
  }
  if (obj.category === 'material') {
    return Boolean(
      await prisma.courseMaterial.findFirst({
        where: { schoolId: obj.schoolId, fileUrl: reference },
        select: { id: true },
      }),
    );
  }
  if (obj.category === 'submission') {
    return Boolean(
      await prisma.assignmentSubmission.findFirst({
        where: { attachmentUrl: reference, assignment: { schoolId: obj.schoolId } },
        select: { id: true },
      }),
    );
  }
  return null;
}

async function canAccessObject(
  auth: { userId: string; schoolId?: string; role: string },
  obj: StorageRow,
) {
  if (auth.role === 'PRINCIPAL' || obj.uploadedById === auth.userId) return true;
  if (obj.category === 'school-logo') return true;
  const ref = `storage://${obj.id}`;
  const schoolId = auth.schoolId!;

  if (obj.category === 'assignment') {
    const assignment = await prisma.assignment.findFirst({
      where: { schoolId, attachmentUrl: ref },
      select: { classId: true, subjectId: true },
    });
    if (!assignment) return false;
    if (auth.role === 'STUDENT') {
      const student = await prisma.studentProfile.findFirst({
        where: { schoolId, userId: auth.userId },
        select: { classId: true },
      });
      return student?.classId === assignment.classId;
    }
    if (auth.role === 'PARENT') {
      const parent = await prisma.parentProfile.findFirst({
        where: { schoolId, userId: auth.userId },
        select: { id: true },
      });
      if (!parent) return false;
      return Boolean(
        await prisma.studentParent.findFirst({
          where: { parentId: parent.id, student: { schoolId, classId: assignment.classId } },
        }),
      );
    }
    if (auth.role === 'TEACHER') {
      return Boolean(
        await prisma.teacherAssignment.findFirst({
          where: {
            schoolId,
            teacherId: auth.userId,
            classId: assignment.classId,
            subjectId: assignment.subjectId,
          },
        }),
      );
    }
    return false;
  }

  if (obj.category === 'material') {
    const material = await prisma.courseMaterial.findFirst({
      where: { schoolId, fileUrl: ref },
      select: { classId: true, subjectId: true },
    });
    if (!material) return false;
    if (auth.role === 'STUDENT') {
      const student = await prisma.studentProfile.findFirst({
        where: { schoolId, userId: auth.userId },
        select: { classId: true },
      });
      return student?.classId === material.classId;
    }
    if (auth.role === 'PARENT') {
      const parent = await prisma.parentProfile.findFirst({
        where: { schoolId, userId: auth.userId },
        select: { id: true },
      });
      if (!parent) return false;
      return Boolean(
        await prisma.studentParent.findFirst({
          where: { parentId: parent.id, student: { schoolId, classId: material.classId } },
        }),
      );
    }
    if (auth.role === 'TEACHER') {
      return Boolean(
        await prisma.teacherAssignment.findFirst({
          where: {
            schoolId,
            teacherId: auth.userId,
            classId: material.classId,
            subjectId: material.subjectId,
          },
        }),
      );
    }
    return false;
  }

  if (obj.category === 'submission') {
    const submission = await prisma.assignmentSubmission.findFirst({
      where: { attachmentUrl: ref, assignment: { schoolId } },
      include: {
        assignment: { select: { classId: true, subjectId: true } },
        student: { select: { id: true } },
      },
    });
    if (!submission) return false;
    if (auth.role === 'STUDENT') return submission.studentUserId === auth.userId;
    if (auth.role === 'PARENT') {
      const parent = await prisma.parentProfile.findFirst({
        where: { schoolId, userId: auth.userId },
        select: { id: true },
      });
      const student = await prisma.studentProfile.findFirst({
        where: { schoolId, userId: submission.studentUserId },
        select: { id: true },
      });
      return Boolean(
        parent &&
          student &&
          (await prisma.studentParent.findFirst({
            where: { parentId: parent.id, studentId: student.id },
          })),
      );
    }
    if (auth.role === 'TEACHER') {
      return Boolean(
        await prisma.teacherAssignment.findFirst({
          where: {
            schoolId,
            teacherId: auth.userId,
            classId: submission.assignment.classId,
            subjectId: submission.assignment.subjectId,
          },
        }),
      );
    }
    return false;
  }

  return false;
}

async function deleteRemoteObject(obj: StorageRow) {
  const { url, key } = env();
  const response = await fetch(`${url}/storage/v1/object/${obj.bucket}/${obj.path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  return response.ok || response.status === 404;
}

async function findOrphanCandidates(schoolId: string, olderThanHours: number, limit: number) {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  return prisma.$queryRaw<StorageRow[]>(Prisma.sql`
    SELECT so.*
    FROM "StorageObject" so
    WHERE so."schoolId"=${schoolId}
      AND so.category IN (${Prisma.join(referenceTrackedCategories)})
      AND so."createdAt" < ${cutoff}
      AND (
        (so.category='school-logo' AND NOT EXISTS (
          SELECT 1 FROM "School" s
          WHERE s.id=so."schoolId" AND s."logoUrl"=('storage://' || so.id)
        ))
        OR (so.category='assignment' AND NOT EXISTS (
          SELECT 1 FROM "Assignment" a
          WHERE a."schoolId"=so."schoolId" AND a."attachmentUrl"=('storage://' || so.id)
        ))
        OR (so.category='material' AND NOT EXISTS (
          SELECT 1 FROM "CourseMaterial" m
          WHERE m."schoolId"=so."schoolId" AND m."fileUrl"=('storage://' || so.id)
        ))
        OR (so.category='submission' AND NOT EXISTS (
          SELECT 1 FROM "AssignmentSubmission" sub
          JOIN "Assignment" a ON a.id=sub."assignmentId"
          WHERE a."schoolId"=so."schoolId" AND sub."attachmentUrl"=('storage://' || so.id)
        ))
      )
    ORDER BY so."createdAt" ASC
    LIMIT ${limit}
  `);
}

router.post(
  '/upload',
  requireRoles('PRINCIPAL', 'STAFF', 'TEACHER', 'STUDENT'),
  raw({ type: 'application/octet-stream', limit: '100mb' }),
  async (req, res) => {
    const parsed = z
      .object({
        fileName: z.string().min(1).max(180),
        mimeType: z.string().min(1).max(150),
        category: z.string().min(1).max(40),
      })
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: 'Invalid upload metadata' });

    const { fileName, mimeType, category } = parsed.data;
    if (!allowed.has(mimeType)) return res.status(415).json({ message: 'File type is not allowed' });
    if (!categories.has(category)) return res.status(400).json({ message: 'Invalid file category' });
    if (!uploadAllowed(req.auth!.role, category)) {
      return res.status(403).json({ message: 'Your role cannot upload this file category' });
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ message: 'Empty file' });
    }

    const schoolId = req.auth!.schoolId!;
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { storageLimitMb: true },
    });
    if (!school) return res.status(404).json({ message: 'School not found' });

    const usage = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(SUM("sizeBytes"),0) total
      FROM "StorageObject"
      WHERE "schoolId"=${schoolId}
    `);
    const used = Number(usage[0]?.total ?? 0);
    const limit = school.storageLimitMb * 1024 * 1024;
    if (used + req.body.length > limit) {
      return res.status(413).json({
        message: 'School storage quota exceeded',
        usedBytes: used,
        limitBytes: limit,
      });
    }

    await ensureBucket();
    const id = randomUUID();
    const path = `${schoolId}/${category}/${new Date().getUTCFullYear()}/${id}-${clean(fileName)}`;
    const { url, key } = env();
    const upload = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': mimeType,
        'x-upsert': 'false',
      },
      body: req.body,
    });
    if (!upload.ok) {
      return res.status(502).json({
        message: 'Storage upload failed',
        detail: (await upload.text()).slice(0, 300),
      });
    }

    try {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "StorageObject"
          (id,"schoolId","uploadedById",bucket,path,"originalName","mimeType","sizeBytes",category)
        VALUES
          (${id},${schoolId},${req.auth!.userId},${bucket},${path},${fileName},${mimeType},${req.body.length},${category})
      `);
    } catch (error) {
      await deleteRemoteObject({
        id,
        schoolId,
        uploadedById: req.auth!.userId,
        bucket,
        path,
        originalName: fileName,
        mimeType,
        sizeBytes: req.body.length,
        category,
      }).catch(() => false);
      throw error;
    }

    await prisma.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: 'FILE_UPLOADED',
        entityType: 'StorageObject',
        entityId: id,
        afterData: { fileName, mimeType, sizeBytes: req.body.length, category },
      },
    });
    return res.status(201).json({
      id,
      reference: `storage://${id}`,
      fileName,
      mimeType,
      sizeBytes: req.body.length,
      category,
    });
  },
);

router.post(
  '/sign',
  requireRoles('PRINCIPAL', 'STAFF', 'TEACHER', 'STUDENT', 'PARENT'),
  async (req, res) => {
    const parsed = z
      .object({ reference: z.string().regex(/^storage:\/\/[0-9a-f-]+$/i) })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Invalid storage reference' });

    const id = parsed.data.reference.slice('storage://'.length);
    const schoolId = req.auth!.schoolId!;
    const rows = await prisma.$queryRaw<StorageRow[]>(Prisma.sql`
      SELECT * FROM "StorageObject" WHERE id=${id} AND "schoolId"=${schoolId} LIMIT 1
    `);
    const obj = rows[0];
    if (!obj) return res.status(404).json({ message: 'File not found' });
    if (!(await canAccessObject(req.auth! as any, obj))) {
      return res.status(403).json({ message: 'You are not allowed to access this file' });
    }

    const { url, key } = env();
    const sign = await fetch(`${url}/storage/v1/object/sign/${obj.bucket}/${obj.path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 900 }),
    });
    if (!sign.ok) return res.status(502).json({ message: 'Could not create download link' });

    const data: any = await sign.json();
    const signed = data.signedURL || data.signedUrl;
    return res.json({
      url: signed?.startsWith('http') ? signed : `${url}/storage/v1${signed}`,
      expiresIn: 900,
      fileName: obj.originalName,
      mimeType: obj.mimeType,
      sizeBytes: Number(obj.sizeBytes),
    });
  },
);

router.get('/orphans', requireRoles('PRINCIPAL'), async (req, res) => {
  const parsed = z
    .object({
      olderThanHours: z.coerce.number().int().min(1).max(24 * 90).default(24),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid orphan scan options' });

  const schoolId = req.auth!.schoolId!;
  const rows = await findOrphanCandidates(
    schoolId,
    parsed.data.olderThanHours,
    parsed.data.limit,
  );
  return res.json({
    dryRun: true,
    olderThanHours: parsed.data.olderThanHours,
    count: rows.length,
    bytes: rows.reduce((sum, row) => sum + Number(row.sizeBytes), 0),
    skippedCategories: ['exam', 'report', 'general'],
    objects: rows.map((row) => ({
      id: row.id,
      fileName: row.originalName,
      category: row.category,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      createdAt: row.createdAt ?? null,
    })),
  });
});

router.post('/orphans/cleanup', requireRoles('PRINCIPAL'), async (req, res) => {
  const parsed = z
    .object({
      olderThanHours: z.coerce.number().int().min(1).max(24 * 90).default(24),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      confirm: z.literal('DELETE_ORPHANS'),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Cleanup requires valid options and confirm="DELETE_ORPHANS"',
    });
  }

  const schoolId = req.auth!.schoolId!;
  const candidates = await findOrphanCandidates(
    schoolId,
    parsed.data.olderThanHours,
    parsed.data.limit,
  );
  const deleted: StorageRow[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const obj of candidates) {
    const linked = await isObjectLinked(obj);
    if (linked !== false) {
      skipped.push({ id: obj.id, reason: linked ? 'File became referenced' : 'Category is not safely tracked' });
      continue;
    }

    try {
      if (!(await deleteRemoteObject(obj))) {
        failed.push({ id: obj.id, reason: 'Remote storage deletion failed' });
        continue;
      }
      await prisma.$executeRaw(Prisma.sql`
        DELETE FROM "StorageObject" WHERE id=${obj.id} AND "schoolId"=${schoolId}
      `);
      deleted.push(obj);
    } catch (error) {
      failed.push({
        id: obj.id,
        reason: error instanceof Error ? error.message.slice(0, 160) : 'Cleanup failed',
      });
    }
  }

  if (deleted.length) {
    await prisma.auditLog.create({
      data: {
        schoolId,
        actorId: req.auth!.userId,
        action: 'STORAGE_ORPHANS_CLEANED',
        entityType: 'StorageObject',
        entityId: schoolId,
        afterData: {
          deletedCount: deleted.length,
          deletedBytes: deleted.reduce((sum, row) => sum + Number(row.sizeBytes), 0),
          ids: deleted.map((row) => row.id),
          olderThanHours: parsed.data.olderThanHours,
        },
      },
    });
  }

  return res.json({
    ok: failed.length === 0,
    scanned: candidates.length,
    deleted: deleted.length,
    deletedBytes: deleted.reduce((sum, row) => sum + Number(row.sizeBytes), 0),
    skipped,
    failed,
  });
});

router.delete('/:id', requireRoles('PRINCIPAL'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const id = routeParam(req.params.id);
  const rows = await prisma.$queryRaw<StorageRow[]>(Prisma.sql`
    SELECT * FROM "StorageObject" WHERE id=${id} AND "schoolId"=${schoolId} LIMIT 1
  `);
  const obj = rows[0];
  if (!obj) return res.status(404).json({ message: 'File not found' });

  const linked = await isObjectLinked(obj);
  if (linked === true) {
    return res.status(409).json({
      message: 'This file is still attached to school data. Remove the reference first.',
      code: 'STORAGE_OBJECT_IN_USE',
    });
  }

  if (!(await deleteRemoteObject(obj))) {
    return res.status(502).json({ message: 'Could not delete storage object' });
  }
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "StorageObject" WHERE id=${obj.id} AND "schoolId"=${schoolId}
  `);
  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: req.auth!.userId,
      action: 'FILE_DELETED',
      entityType: 'StorageObject',
      entityId: obj.id,
      beforeData: { fileName: obj.originalName, category: obj.category },
    },
  });
  return res.json({ ok: true });
});

router.get('/usage', requireRoles('PRINCIPAL', 'STAFF'), async (req, res) => {
  const schoolId = req.auth!.schoolId!;
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { storageLimitMb: true },
  });
  const usage = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT COALESCE(SUM("sizeBytes"),0) bytes,COUNT(*) files
    FROM "StorageObject"
    WHERE "schoolId"=${schoolId}
  `);
  const usedBytes = Number(usage[0]?.bytes ?? 0);
  const limitBytes = (school?.storageLimitMb ?? 0) * 1024 * 1024;
  return res.json({
    usedBytes,
    limitBytes,
    files: Number(usage[0]?.files ?? 0),
    percentage: limitBytes ? Math.round((usedBytes / limitBytes) * 1000) / 10 : 0,
  });
});

export default router;

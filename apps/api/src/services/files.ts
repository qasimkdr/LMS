import crypto from 'node:crypto';
import type { FileCategory, Plan, School } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/errors';
import { storage } from '../storage';
import { effectiveLimits, storageUsedBytes } from './limits';

export const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

const safeName = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-120) || 'file';

/**
 * Saves an upload for a school after checking the plan's per-file and total storage limits.
 * Storage-full blocks only new uploads; everything else keeps working.
 */
export async function saveSchoolFile(opts: {
  school: School & { plan: Plan };
  uploadedById: string;
  category: FileCategory;
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer };
}) {
  const { school, file } = opts;
  const limits = effectiveLimits(school);
  if (!ALLOWED_MIME.has(file.mimetype)) {
    throw new HttpError(415, 'This file type is not allowed', 'UNSUPPORTED_TYPE');
  }
  if (file.size > limits.maxFileBytes) {
    throw new HttpError(413, 'File is larger than your plan allows', 'FILE_TOO_LARGE');
  }
  const used = await storageUsedBytes(school.id);
  if (used + file.size > limits.storageBytes) {
    throw new HttpError(
      413,
      'Storage full. Upgrade your plan or delete old files to free space.',
      'STORAGE_FULL',
      { usedBytes: used, limitBytes: limits.storageBytes },
    );
  }
  const key = `schools/${school.id}/${opts.category.toLowerCase()}/${crypto.randomUUID()}-${safeName(file.originalname)}`;
  await storage.put(key, file.buffer, file.mimetype);
  try {
    return await prisma.storedFile.create({
      data: {
        schoolId: school.id,
        uploadedById: opts.uploadedById,
        category: opts.category,
        storageKey: key,
        originalName: file.originalname.slice(0, 255),
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });
  } catch (e) {
    await storage.delete(key).catch(() => undefined);
    throw e;
  }
}

/** Soft-deletes the record (frees quota immediately) and removes the object from storage. */
export async function deleteSchoolFile(schoolId: string, fileId: string) {
  const file = await prisma.storedFile.findFirst({ where: { id: fileId, schoolId, deletedAt: null } });
  if (!file) return null;
  await prisma.storedFile.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
  await storage.delete(file.storageKey).catch((e) => console.error('storage delete failed', e));
  return file;
}

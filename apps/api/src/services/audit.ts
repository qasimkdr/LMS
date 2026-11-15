import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  schoolId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

const SECRET_KEYS = /password|token|secret|hash/i;

function scrub(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (k, v) => (SECRET_KEYS.test(k) ? '[hidden]' : typeof v === 'bigint' ? Number(v) : v)),
  );
}

/** Records who did what. Never throws (audit failures must not break the request). */
export async function audit(req: Request | null, input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        schoolId: input.schoolId !== undefined ? input.schoolId : (req?.user?.schoolId ?? null),
        actorId: req?.user?.id ?? null,
        actorRole: req?.user?.role ?? null,
        before: scrub(input.before),
        after: scrub(input.after),
        reason: input.reason ?? null,
        ip: req?.ip ?? null,
      },
    });
  } catch (e) {
    console.error('audit failed', e);
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { Prisma, prisma } from '@nexora/database';

export const REFRESH_SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export type RefreshSessionRow = {
  id: string;
  ownerUserId: string;
  currentUserId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export const hashRefreshToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export const newRefreshSessionId = () => randomUUID();

export async function createRefreshSession(input: {
  id: string;
  ownerUserId: string;
  currentUserId: string;
  token: string;
  expiresAt?: Date;
}) {
  const expiresAt = input.expiresAt ?? new Date(Date.now() + REFRESH_SESSION_TTL_MS);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "RefreshSession"
      (id,"ownerUserId","currentUserId","tokenHash","expiresAt","createdAt","updatedAt")
    VALUES
      (${input.id},${input.ownerUserId},${input.currentUserId},${hashRefreshToken(input.token)},${expiresAt},NOW(),NOW())
  `);
  return expiresAt;
}

export async function validateRefreshSession(input: {
  sessionId?: string;
  currentUserId: string;
  token: string;
}) {
  if (!input.sessionId) return null;
  const rows = await prisma.$queryRaw<RefreshSessionRow[]>(Prisma.sql`
    SELECT id,"ownerUserId","currentUserId","tokenHash","expiresAt","revokedAt"
    FROM "RefreshSession"
    WHERE id=${input.sessionId}
      AND "currentUserId"=${input.currentUserId}
      AND "tokenHash"=${hashRefreshToken(input.token)}
      AND "revokedAt" IS NULL
      AND "expiresAt">NOW()
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function rotateRefreshSession(input: {
  sessionId: string;
  currentToken: string;
  nextToken: string;
  nextCurrentUserId?: string;
}) {
  const currentHash = hashRefreshToken(input.currentToken);
  const nextHash = hashRefreshToken(input.nextToken);
  const nextCurrentUserId = input.nextCurrentUserId;
  const updated = nextCurrentUserId
    ? await prisma.$executeRaw(Prisma.sql`
        UPDATE "RefreshSession"
        SET "tokenHash"=${nextHash},"currentUserId"=${nextCurrentUserId},"updatedAt"=NOW()
        WHERE id=${input.sessionId}
          AND "tokenHash"=${currentHash}
          AND "revokedAt" IS NULL
          AND "expiresAt">NOW()
      `)
    : await prisma.$executeRaw(Prisma.sql`
        UPDATE "RefreshSession"
        SET "tokenHash"=${nextHash},"updatedAt"=NOW()
        WHERE id=${input.sessionId}
          AND "tokenHash"=${currentHash}
          AND "revokedAt" IS NULL
          AND "expiresAt">NOW()
      `);
  return updated === 1;
}

export async function rotateRefreshSessionFromAccess(input: {
  sessionId: string;
  ownerUserId: string;
  expectedCurrentUserId: string;
  nextCurrentUserId: string;
  nextToken: string;
}) {
  const updated = await prisma.$executeRaw(Prisma.sql`
    UPDATE "RefreshSession"
    SET "tokenHash"=${hashRefreshToken(input.nextToken)},
        "currentUserId"=${input.nextCurrentUserId},
        "updatedAt"=NOW()
    WHERE id=${input.sessionId}
      AND "ownerUserId"=${input.ownerUserId}
      AND "currentUserId"=${input.expectedCurrentUserId}
      AND "revokedAt" IS NULL
      AND "expiresAt">NOW()
  `);
  return updated === 1;
}

export async function revokeRefreshSession(input: {
  sessionId?: string;
  token?: string;
}) {
  if (!input.sessionId) return false;
  const updated = input.token
    ? await prisma.$executeRaw(Prisma.sql`
        UPDATE "RefreshSession"
        SET "revokedAt"=NOW(),"updatedAt"=NOW()
        WHERE id=${input.sessionId}
          AND "tokenHash"=${hashRefreshToken(input.token)}
          AND "revokedAt" IS NULL
      `)
    : await prisma.$executeRaw(Prisma.sql`
        UPDATE "RefreshSession"
        SET "revokedAt"=NOW(),"updatedAt"=NOW()
        WHERE id=${input.sessionId} AND "revokedAt" IS NULL
      `);
  return updated === 1;
}

export async function cleanupExpiredRefreshSessions() {
  return prisma.$executeRaw(Prisma.sql`
    DELETE FROM "RefreshSession"
    WHERE "expiresAt" < NOW() - INTERVAL '7 days'
       OR ("revokedAt" IS NOT NULL AND "revokedAt" < NOW() - INTERVAL '7 days')
  `);
}

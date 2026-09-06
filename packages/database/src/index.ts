import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var nexoraPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.nexoraPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalThis.nexoraPrisma = prisma;

export * from '@prisma/client';

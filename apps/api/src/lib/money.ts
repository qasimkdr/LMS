import { Prisma } from '@prisma/client';

export const toNum = (d: Prisma.Decimal | number | null | undefined): number | null =>
  d === null || d === undefined ? null : Number(d);

export const round2 = (n: number) => Math.round(n * 100) / 100;

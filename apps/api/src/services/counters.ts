import type { Prisma } from '@prisma/client';

/**
 * Next running number for a school (admission no, family no, employee no).
 * Must be called inside a transaction: the UPDATE locks the row until commit, so numbers never repeat.
 */
export async function nextNumber(tx: Prisma.TransactionClient, schoolId: string, key: string): Promise<number> {
  await tx.$executeRaw`INSERT IGNORE INTO SchoolCounter (schoolId, \`key\`, value) VALUES (${schoolId}, ${key}, 0)`;
  await tx.$executeRaw`UPDATE SchoolCounter SET value = value + 1 WHERE schoolId = ${schoolId} AND \`key\` = ${key}`;
  const rows = await tx.$queryRaw<{ value: number }[]>`SELECT value FROM SchoolCounter WHERE schoolId = ${schoolId} AND \`key\` = ${key}`;
  return Number(rows[0].value);
}

/**
 * Creates the first Super Admin from SUPER_ADMIN_* variables in .env.
 * Safe to run more than once: it does nothing if the username already exists.
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { hashPassword, passwordSchema } from '../lib/password';

async function main() {
  const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!password) throw new Error('Set SUPER_ADMIN_PASSWORD in .env');
  passwordSchema.parse(password);
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`Super admin "${username}" already exists.`);
    return;
  }
  await prisma.user.create({
    data: {
      role: 'SUPER_ADMIN',
      username,
      email: process.env.SUPER_ADMIN_EMAIL || null,
      fullName: process.env.SUPER_ADMIN_NAME || 'Super Admin',
      passwordHash: await hashPassword(password),
      mustChangePassword: false,
    },
  });
  console.log(`Super admin "${username}" created.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

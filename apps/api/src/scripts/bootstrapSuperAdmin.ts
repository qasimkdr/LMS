import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '@nexora/database';

async function main() {
  const firstName = (process.env.BOOTSTRAP_ADMIN_FIRST_NAME || 'Qasim').trim();
  const lastName = (process.env.BOOTSTRAP_ADMIN_LAST_NAME || 'Admin').trim();
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const username = (process.env.BOOTSTRAP_ADMIN_USERNAME || 'qasim').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';

  if (!email || !email.includes('@')) throw new Error('BOOTSTRAP_ADMIN_EMAIL must be a valid email address.');
  if (username.length < 3) throw new Error('BOOTSTRAP_ADMIN_USERNAME must be at least 3 characters.');
  if (password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { id: true, role: true, email: true, username: true },
  });

  if (existing) {
    if (existing.role !== 'SUPER_ADMIN') {
      throw new Error('The requested email or username already belongs to a non-Super-Admin account.');
    }
    console.log(`Super Admin already exists: ${existing.username || existing.email}. No changes made.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.create({
    data: {
      schoolId: null,
      role: 'SUPER_ADMIN',
      email,
      username,
      passwordHash,
      firstName,
      lastName,
      isActive: true,
    },
    select: { id: true, email: true, username: true, firstName: true, lastName: true },
  });

  console.log(`Created Super Admin ${admin.firstName} ${admin.lastName} (${admin.username || admin.email}).`);
  console.log('Remove BOOTSTRAP_ADMIN_PASSWORD from the environment after this command succeeds.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

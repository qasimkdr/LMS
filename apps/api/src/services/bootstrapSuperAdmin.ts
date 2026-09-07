import bcrypt from 'bcryptjs';
import { prisma } from '@nexora/database';

export async function bootstrapSuperAdminFromEnv() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';

  // Bootstrap is opt-in: production behaves normally unless both secrets are configured.
  if (!email && !password) return;
  if (!email || !password) {
    console.error('Super Admin bootstrap skipped: both BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required.');
    return;
  }

  const firstName = (process.env.BOOTSTRAP_ADMIN_FIRST_NAME || 'Qasim').trim();
  const lastName = (process.env.BOOTSTRAP_ADMIN_LAST_NAME || 'Admin').trim();
  const username = (process.env.BOOTSTRAP_ADMIN_USERNAME || 'qasim').trim().toLowerCase();

  if (!email.includes('@') || username.length < 3 || password.length < 12) {
    console.error('Super Admin bootstrap skipped: invalid email/username or password shorter than 12 characters.');
    return;
  }

  try {
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { role: true, email: true, username: true },
    });

    if (existing) {
      if (existing.role === 'SUPER_ADMIN') {
        console.log(`Super Admin bootstrap: ${existing.username || existing.email} already exists; no changes made.`);
      } else {
        console.error('Super Admin bootstrap refused: requested email or username belongs to a non-Super-Admin account.');
      }
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
      select: { email: true, username: true, firstName: true, lastName: true },
    });

    console.log(`Super Admin bootstrap: created ${admin.firstName} ${admin.lastName} (${admin.username || admin.email}).`);
    console.log('Security action required: remove all BOOTSTRAP_ADMIN_* variables from the deployment environment now.');
  } catch (error) {
    console.error('Super Admin bootstrap failed:', error instanceof Error ? error.message : error);
  }
}

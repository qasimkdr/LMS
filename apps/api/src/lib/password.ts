import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';

export const hashPassword = (plain: string) => bcrypt.hash(plain, 11);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

/** Readable temporary password, e.g. "Kite-4821-Moon". The user must change it on first login. */
export function generateTempPassword(): string {
  const words = ['Kite', 'Moon', 'Star', 'Lake', 'Rose', 'Tree', 'Bird', 'Rain', 'Sun', 'Leaf', 'Hill', 'Wave'];
  const pick = () => words[crypto.randomInt(words.length)];
  return `${pick()}-${crypto.randomInt(1000, 10000)}-${pick()}`;
}

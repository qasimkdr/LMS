import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => crypto.scrypt(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

/** scrypt (native, runs on the thread pool so bulk imports hash in parallel). Format: scrypt$N$r$p$salt$hash */
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(plain, salt, 32, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (stored.startsWith('scrypt$')) {
    const [, N, r, p, salt, hash] = stored.split('$');
    const expected = Buffer.from(hash, 'base64');
    const key = await scrypt(plain, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: PARAMS.maxmem });
    return crypto.timingSafeEqual(key, expected);
  }
  // Older bcrypt hashes keep working.
  return bcrypt.compare(plain, stored);
}

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

const WORDS = (
  'Kite Moon Star Lake Rose Tree Bird Rain Leaf Hill Wave Rock Lamp Bell Ship Gold Corn Mint Pine Sand Snow Wind Fire Seed ' +
  'Lion Tiger Eagle Swan Fox Bear Deer Hawk Owl Crow Dove Fish Frog Goat Duck Mango Apple Peach Plum Grape Lemon Olive ' +
  'River Ocean Cloud Storm Light Dawn Dusk Spark Stone Brick Pearl Ruby Jade Amber Coral Cedar Maple Lotus Tulip Daisy'
).split(' ');

/** Readable temporary password, e.g. "Kite-4821-Moon". The user must change it on first login. */
export function generateTempPassword(): string {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${pick()}-${crypto.randomInt(1000, 10000)}-${pick()}`;
}

export interface LoginSecret {
  tempPassword: string;
  hash: string;
}

/** Generates and hashes temporary passwords up front (in parallel), so transactions stay short. */
export async function prepareSecrets(count: number): Promise<LoginSecret[]> {
  return Promise.all(
    Array.from({ length: count }, async () => {
      const tempPassword = generateTempPassword();
      return { tempPassword, hash: await hashPassword(tempPassword) };
    }),
  );
}

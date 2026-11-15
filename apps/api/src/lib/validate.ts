import { z } from 'zod';
import { badRequest } from './errors';

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
    const first = Object.entries(fields)[0];
    const issue = result.error.issues[0];
    const msg = first ? `${first[0]}: ${first[1]?.[0]}` : issue ? `${issue.path.join('.') || 'input'}: ${issue.message}` : 'Invalid input';
    throw badRequest(msg, fields);
  }
  return result.data;
}

/** Optional text: trims, and turns "" into null. */
export const optStr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();

/** Optional email: "" becomes null. */
export const optEmail = z
  .string()
  .trim()
  .max(160)
  .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Invalid email')
  .transform((v) => (v === '' ? null : v))
  .nullish();

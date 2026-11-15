import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be 64 hex characters'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  STORAGE_DRIVER: z.enum(['local', 'oci']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  OCI_S3_ENDPOINT: z.string().optional(),
  OCI_REGION: z.string().optional(),
  OCI_BUCKET: z.string().optional(),
  OCI_ACCESS_KEY_ID: z.string().optional(),
  OCI_SECRET_ACCESS_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

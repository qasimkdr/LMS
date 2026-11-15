import { execSync } from 'node:child_process';
import fs from 'node:fs';

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'mysql://sms:sms_dev_pw@localhost:3306/sms_test';
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
  return () => fs.rmSync('./storage-test', { recursive: true, force: true });
}

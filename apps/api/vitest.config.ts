import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'mysql://sms:sms_dev_pw@localhost:3306/sms_test';

export default defineConfig({
  test: {
    globalSetup: ['./tests/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DB,
      JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-123',
      JWT_REFRESH_SECRET: 'test-refresh-secret-test-refresh-secret-123',
      ENCRYPTION_KEY: 'a'.repeat(64),
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: './storage-test',
      APP_URL: 'http://localhost:3000',
      WHATSAPP_DRY_RUN: 'false',
    },
  },
});

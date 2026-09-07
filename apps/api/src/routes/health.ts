import { Router } from 'express';
import { prisma } from '@nexora/database';

const router = Router();

router.get('/live', (_req, res) => {
  res.json({ ok: true, service: 'nexora-api', status: 'live', timestamp: new Date().toISOString() });
});

router.get('/ready', async (_req, res) => {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({
      ok: true,
      service: 'nexora-api',
      status: 'ready',
      database: 'ok',
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return res.status(503).json({
      ok: false,
      service: 'nexora-api',
      status: 'not_ready',
      database: 'unavailable',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

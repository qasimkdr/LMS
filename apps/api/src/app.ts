import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { prisma } from './lib/prisma';
import { accountGate, authenticate, requireRole, schoolGate } from './middleware/auth';
import { csrfGuard } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/error';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import schoolRoutes from './routes/school';
import fileRoutes from './routes/files';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });

  app.use('/api', csrfGuard);
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', authenticate, accountGate, requireRole('SUPER_ADMIN'), adminRoutes);
  app.use('/api/school', authenticate, accountGate, schoolGate, schoolRoutes);
  app.use('/api/files', authenticate, accountGate, schoolGate, fileRoutes);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}

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
import setupRoutes from './routes/setup';
import studentRoutes from './routes/students';
import staffRoutes, { usersRouter } from './routes/staff';
import importRoutes from './routes/imports';
import { myRouter, recycleRouter, searchRouter } from './routes/people';
import timetableRoutes from './routes/timetable';
import { requireModule } from './middleware/modules';

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
  const school = [authenticate, accountGate, schoolGate];
  app.use('/api/files', ...school, fileRoutes);
  app.use('/api/setup', ...school, setupRoutes);
  app.use('/api/students', ...school, studentRoutes);
  app.use('/api/staff', ...school, staffRoutes);
  app.use('/api/users', ...school, usersRouter);
  app.use('/api/import', ...school, importRoutes);
  app.use('/api/search', ...school, searchRouter);
  app.use('/api/recycle-bin', ...school, recycleRouter);
  app.use('/api/my', ...school, myRouter);
  app.use('/api/timetable', ...school, requireModule('timetable'), timetableRoutes);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}

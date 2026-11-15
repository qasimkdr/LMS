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
import messagingRoutes, { notificationsRouter, webhookRouter } from './routes/messaging';
import attendanceRoutes from './routes/attendance';
import feeRoutes from './routes/fees';
import feeReportRoutes, { myFeesRouter } from './routes/feeReports';
import payRoutes, { payReturnRouter } from './routes/pay';
import examRoutes from './routes/exams';
import resultRoutes from './routes/results';
import onlineExamRoutes from './routes/onlineExams';
import remarkRoutes from './routes/remarks';
import monthlyReportRoutes from './routes/monthlyReports';
import honorRoutes, { rankingsRouter } from './routes/honors';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  // Meta calls this without our cookies or CSRF header; it needs the raw body to check the signature.
  app.use('/api/webhooks', webhookRouter);
  // Payment gateways post the result from the parent's browser (form post, no CSRF header).
  app.use('/api/pay/return', payReturnRouter);
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
  app.use('/api/attendance', ...school, requireModule('attendance'), attendanceRoutes);
  app.use('/api/messaging', ...school, messagingRoutes);
  app.use('/api/notifications', ...school, notificationsRouter);
  app.use('/api/fees/reports', ...school, requireModule('fees'), feeReportRoutes);
  app.use('/api/fees/my', ...school, requireModule('fees'), myFeesRouter);
  app.use('/api/fees', ...school, requireModule('fees'), feeRoutes);
  app.use('/api/pay', ...school, requireModule('fees'), payRoutes);
  app.use('/api/exams', ...school, requireModule('exams'), examRoutes);
  app.use('/api/results', ...school, requireModule('exams'), resultRoutes);
  app.use('/api/online-exams', ...school, requireModule('online_exams'), onlineExamRoutes);
  app.use('/api/remarks', ...school, remarkRoutes);
  app.use('/api/monthly-reports', ...school, monthlyReportRoutes);
  app.use('/api/rankings', ...school, requireModule('honors'), rankingsRouter);
  app.use('/api/honors', ...school, requireModule('honors'), honorRoutes);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}

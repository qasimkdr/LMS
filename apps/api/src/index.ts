import 'dotenv/config';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { requireAuth, requireTenant } from './middleware/auth.js';
import { requireModule } from './middleware/entitlements.js';
import { rateLimit } from './middleware/rateLimit.js';
import authRoutes from './routes/auth.js';
import approvalRoutes from './routes/approvals.js';
import superAdminRoutes from './routes/superAdmin.js';
import subscriptionPlanRoutes from './routes/subscriptionPlans.js';
import subscriptionRoutes from './routes/subscription.js';
import schoolDirectoryRoutes from './routes/schoolDirectory.js';
import examRoutes from './routes/exams.js';
import examImportRoutes from './routes/examImport.js';
import dashboardRoutes from './routes/dashboard.js';
import schoolOperationsRoutes from './routes/schoolOperations.js';
import attendanceRoutes from './routes/attendance.js';
import policyRoutes from './routes/policies.js';
import teacherAssignmentRoutes from './routes/teacherAssignments.js';
import examAttemptRoutes from './routes/examAttempts.js';
import portalRoutes from './routes/portal.js';
import announcementRoutes from './routes/announcements.js';
import courseworkRoutes from './routes/coursework.js';
import parentCourseworkRoutes from './routes/parentCoursework.js';
import notificationRoutes from './routes/notifications.js';
import parentRoutes from './routes/parents.js';
import reportRoutes from './routes/reports.js';
import advancedAnalyticsRoutes from './routes/advancedAnalytics.js';
import feeRoutes from './routes/fees.js';
import feeLedgerRoutes from './routes/feeLedger.js';
import feeAdjustmentRoutes from './routes/feeAdjustments.js';
import financeSettingsRoutes from './routes/financeSettings.js';
import timetableRoutes from './routes/timetable.js';
import leaveCalendarRoutes from './routes/leaveCalendar.js';
import storageRoutes from './routes/storage.js';
import backupRoutes from './routes/backups.js';
import supportRoutes from './routes/support.js';
import healthRoutes from './routes/health.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  }),
);
app.use(cookieParser());
app.use('/api/health', healthRoutes);

const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 900, scope: 'api' });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 80, scope: 'auth' });
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 180,
  scope: 'sensitive',
});

app.use('/api', generalLimiter);

// School backup JSON can legitimately exceed the normal API payload limit.
// Keep the larger parser scoped only to this sensitive, authenticated route.
app.use('/api/backups', express.json({ limit: '20mb' }), sensitiveLimiter, backupRoutes);

// All normal API routes retain the smaller payload ceiling.
app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/super-admin/plans', sensitiveLimiter, subscriptionPlanRoutes);
app.use('/api/super-admin', sensitiveLimiter, superAdminRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/school-directory', schoolDirectoryRoutes);

// Entitlement checks require an authenticated tenant context. Keep this order:
// requireAuth -> requireTenant -> requireModule -> feature router.
app.use('/api/exams', requireAuth, requireTenant, requireModule('EXAMS'), examRoutes);
app.use(
  '/api/exam-import',
  sensitiveLimiter,
  requireAuth,
  requireTenant,
  requireModule('EXAMS'),
  examImportRoutes,
);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/school-operations', schoolOperationsRoutes);
app.use(
  '/api/attendance',
  requireAuth,
  requireTenant,
  requireModule('ATTENDANCE'),
  attendanceRoutes,
);
app.use('/api/policies', policyRoutes);
app.use('/api/teacher-assignments', teacherAssignmentRoutes);
app.use(
  '/api/exam-attempts',
  requireAuth,
  requireTenant,
  requireModule('EXAMS'),
  examAttemptRoutes,
);
app.use('/api/portal', portalRoutes);
app.use(
  '/api/announcements',
  requireAuth,
  requireTenant,
  requireModule('ANNOUNCEMENTS'),
  announcementRoutes,
);
app.use(
  '/api/coursework',
  requireAuth,
  requireTenant,
  requireModule('COURSEWORK'),
  courseworkRoutes,
);
app.use(
  '/api/parent-coursework',
  requireAuth,
  requireTenant,
  requireModule('COURSEWORK'),
  parentCourseworkRoutes,
);
app.use('/api/notifications', notificationRoutes);
app.use('/api/parents', parentRoutes);
app.use('/api/reports', requireAuth, requireTenant, requireModule('REPORTS'), reportRoutes);
app.use(
  '/api/advanced-analytics',
  requireAuth,
  requireTenant,
  requireModule('ANALYTICS'),
  advancedAnalyticsRoutes,
);
app.use(
  '/api/fees',
  sensitiveLimiter,
  requireAuth,
  requireTenant,
  requireModule('FINANCE'),
  feeRoutes,
);
app.use(
  '/api/fee-ledger',
  requireAuth,
  requireTenant,
  requireModule('FINANCE'),
  feeLedgerRoutes,
);
app.use(
  '/api/fee-adjustments',
  sensitiveLimiter,
  requireAuth,
  requireTenant,
  requireModule('FINANCE'),
  feeAdjustmentRoutes,
);
app.use(
  '/api/finance-settings',
  sensitiveLimiter,
  requireAuth,
  requireTenant,
  requireModule('FINANCE'),
  financeSettingsRoutes,
);
app.use(
  '/api/timetable',
  requireAuth,
  requireTenant,
  requireModule('TIMETABLE'),
  timetableRoutes,
);
app.use(
  '/api/school-life',
  requireAuth,
  requireTenant,
  requireModule('LEAVE'),
  leaveCalendarRoutes,
);
app.use(
  '/api/storage',
  sensitiveLimiter,
  requireAuth,
  requireTenant,
  requireModule('STORAGE'),
  storageRoutes,
);
app.use(
  '/api/support',
  requireAuth,
  requireTenant,
  requireModule('SUPPORT'),
  supportRoutes,
);

app.use(
  (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.status === 413 || err?.type === 'entity.too.large') {
      return res.status(413).json({ message: 'Request body is too large.' });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ message: 'Request body contains invalid JSON.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Unexpected server error' });
  },
);
app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

app.listen(port, () => console.log(`Nexora API listening on port ${port}`));

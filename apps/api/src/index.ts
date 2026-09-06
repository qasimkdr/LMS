import 'dotenv/config';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import authRoutes from './routes/auth.js';
import approvalRoutes from './routes/approvals.js';
import superAdminRoutes from './routes/superAdmin.js';
import schoolDirectoryRoutes from './routes/schoolDirectory.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL?.split(',') ?? ['http://localhost:5173'], credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'nexora-api', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/school-directory', schoolDirectoryRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ message: 'Unexpected server error' });
});

app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

app.listen(port, () => {
  console.log(`Nexora API listening on port ${port}`);
});

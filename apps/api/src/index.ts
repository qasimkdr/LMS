import 'dotenv/config';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

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

app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

app.listen(port, () => {
  console.log(`Nexora API listening on port ${port}`);
});

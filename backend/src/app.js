import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { authenticate } from './middleware/auth.js';
import auth from './routes/auth.js';
import faculty from './routes/faculty.js';
import { researchers, publications } from './routes/research.js';
import admin from './routes/admin.js';
import sync from './routes/sync.js';
import reports from './routes/reports.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true }));
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => req.path !== '/api/health' && logger.info({ m: req.method, url: req.originalUrl.split('?')[0], s: res.statusCode, ms: Date.now() - t }, 'req'));
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', auth);
  app.use('/api/faculty', authenticate, faculty);
  app.use('/api/researchers', authenticate, researchers);
  app.use('/api/publications', authenticate, publications);
  app.use('/api/admin', authenticate, admin);
  app.use('/api/sync', authenticate, sync);
  app.use('/api/reports', authenticate, reports);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.flatten().fieldErrors });
    logger.error({ err: err.message, stack: err.stack, url: req.originalUrl }, 'unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

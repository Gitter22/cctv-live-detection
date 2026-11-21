import cookieParser from 'cookie-parser';
import express from 'express';
import { authenticate, csrfGuard } from './auth/session';
import { errorMiddleware, notFound } from './lib/http';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';
import { orgsRouter } from './routes/orgs';
import { sitesRouter } from './routes/sites';
import { sourcesRouter } from './routes/sources';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', csrfGuard, authenticate);

  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', orgsRouter);
  app.use('/api', sitesRouter);
  app.use('/api', sourcesRouter);

  app.use('/api', (_req, _res, next) => next(notFound('Unknown API route')));
  app.use(errorMiddleware);
  return app;
}

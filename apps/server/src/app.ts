import cookieParser from 'cookie-parser';
import express from 'express';
import { authenticate, csrfGuard } from './auth/session';
import { errorMiddleware, notFound } from './lib/http';
import { alertsRouter } from './routes/alerts';
import { authRouter } from './routes/auth';
import { camerasRouter } from './routes/cameras';
import { edgeApiRouter, edgesRouter } from './routes/edges';
import { governanceRouter } from './routes/governance';
import { healthRouter } from './routes/health';
import { orgsRouter } from './routes/orgs';
import { rulesRouter } from './routes/rules';
import { sitesRouter } from './routes/sites';
import { streamRouter } from './routes/stream';
import { sourcesRouter } from './routes/sources';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  // Edge agents: token auth, no cookies, no browser. Mounted before the 1 MB JSON parser
  // because event uploads carry snapshots (route-specific 4 MB limit).
  app.use('/edge/v1', edgeApiRouter);
  app.use('/edge', (_req, _res, next) => next(notFound('Unknown edge route')));

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api', csrfGuard, authenticate);

  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', orgsRouter);
  app.use('/api', sitesRouter);
  app.use('/api', sourcesRouter);
  app.use('/api', camerasRouter);
  app.use('/api', edgesRouter);
  app.use('/api', rulesRouter);
  app.use('/api', alertsRouter);
  app.use('/api', streamRouter);
  app.use('/api', governanceRouter);

  app.use('/api', (_req, _res, next) => next(notFound('Unknown API route')));
  app.use(errorMiddleware);
  return app;
}

import express from 'express';
import { errorMiddleware, notFound } from './lib/http';
import { healthRouter } from './routes/health';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', healthRouter);

  app.use('/api', (_req, _res, next) => next(notFound('Unknown API route')));
  app.use(errorMiddleware);
  return app;
}

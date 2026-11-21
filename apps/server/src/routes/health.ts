import { Router } from 'express';

export const healthRouter = Router();

const startedAt = new Date();

healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', startedAt: startedAt.toISOString(), uptimeS: Math.round(process.uptime()) });
});

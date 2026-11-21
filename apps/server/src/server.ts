import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';

const port = env().SERVER_PORT;
const server = createApp().listen(port, () => logger.info({ port }, 'server listening'));

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

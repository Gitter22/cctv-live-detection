import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { EdgeHub, setEdgeHub } from './edge/control';
import { startPushNotifier } from './lib/push';
import { RulesRunner } from './rules/runner';

const port = env().SERVER_PORT;
const server = createApp().listen(port, () => logger.info({ port }, 'server listening'));
const hub = new EdgeHub().attach(server);
setEdgeHub(hub);
const rules = new RulesRunner();
rules.start().catch((err) => logger.error({ err }, 'rules runner failed to start'));
const stopPush = startPushNotifier();

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  rules.stop();
  stopPush();
  hub.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

import { ConfigSync } from './config-sync';
import { loadEnv } from './env';
import { logger } from './logger';

async function main() {
  const env = loadEnv();
  logger.info({ server: env.SERVER_URL, site: env.EDGE_SITE_ID }, 'edge starting');

  const sync = new ConfigSync({ serverUrl: env.SERVER_URL, token: env.EDGE_TOKEN, stateDir: env.STATE_DIR, pollMs: env.CONFIG_POLL_S * 1000 });
  sync.on('config', (cfg) => {
    if (cfg.site.id !== env.EDGE_SITE_ID) logger.error({ got: cfg.site.id }, 'server config is for another site than EDGE_SITE_ID');
  });
  await sync.start();

  const stop = () => {
    logger.info('edge stopping');
    sync.stop();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  logger.fatal({ err }, 'edge failed to start');
  process.exit(1);
});

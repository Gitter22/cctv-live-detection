import type { EdgeConfig } from '@cctv/shared';
import { ConfigSync } from './config-sync';
import { join } from 'node:path';
import { loadEnv } from './env';
import { applyGo2rtc } from './go2rtc';
import { logger } from './logger';

async function main() {
  const env = loadEnv();
  logger.info({ server: env.SERVER_URL, site: env.EDGE_SITE_ID }, 'edge starting');

  const sync = new ConfigSync({ serverUrl: env.SERVER_URL, token: env.EDGE_TOKEN, stateDir: env.STATE_DIR, pollMs: env.CONFIG_POLL_S * 1000 });
  // Apply each new config in order; never two applies at once.
  let applying: Promise<unknown> = Promise.resolve();
  sync.on('config', (cfg: EdgeConfig) => {
    if (cfg.site.id !== env.EDGE_SITE_ID) {
      logger.error({ got: cfg.site.id }, 'server config is for another site than EDGE_SITE_ID: ignoring');
      return;
    }
    applying = applying.then(() =>
      applyGo2rtc(cfg, { path: join(env.GEN_DIR, 'go2rtc.yaml'), apiUrl: env.GO2RTC_API }).catch((err) =>
        logger.error({ err }, 'applying go2rtc config failed'),
      ),
    );
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

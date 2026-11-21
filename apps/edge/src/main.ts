import type { EdgeConfig } from '@cctv/shared';
import { ConfigSync } from './config-sync';
import { join } from 'node:path';
import { loadEnv } from './env';
import { Forwarder, connectMqtt, type SpooledEvent } from './forwarder';
import { applyGo2rtc } from './go2rtc';
import { Spool } from './spool';
import { applyVision } from './vision-config';
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
    applying = applying.then(async () => {
      try {
        // go2rtc first (streams must exist before vision connects to them), then vision.
        await applyGo2rtc(cfg, { path: join(env.GEN_DIR, 'go2rtc.yaml'), apiUrl: env.GO2RTC_API });
        await applyVision(cfg, { path: join(env.GEN_DIR, 'vision.yaml'), go2rtcRtsp: env.GO2RTC_RTSP });
      } catch (err) {
        logger.error({ err }, 'applying config failed');
      }
    });
  });
  await sync.start();

  // Vision events -> disk spool -> server
  const spool = new Spool<SpooledEvent>(join(env.STATE_DIR, 'spool'));
  await spool.init();
  const forwarder = new Forwarder({ serverUrl: env.SERVER_URL, token: env.EDGE_TOKEN, spool, snapshotDir: env.SNAPSHOT_DIR });
  const mqttClient = connectMqtt(env.MQTT_URL, env.MQTT_TOPIC_PREFIX, forwarder);
  const drainTimer = setInterval(() => void forwarder.drain(), 5000);

  const stop = () => {
    logger.info('edge stopping');
    sync.stop();
    clearInterval(drainTimer);
    mqttClient.end(false, {}, () => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  logger.fatal({ err }, 'edge failed to start');
  process.exit(1);
});

import type { EdgeConfig } from '@cctv/shared';
import { ConfigSync } from './config-sync';
import { join } from 'node:path';
import { ControlChannel } from './control';
import { loadEnv } from './env';
import { Forwarder, connectMqtt, type SpooledEvent } from './forwarder';
import { applyGo2rtc } from './go2rtc';
import { HealthCollector, sendHeartbeat, uploadThumbnails } from './health';
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

  // Instant config pushes (and live-view signalling) over an outbound WebSocket.
  const control = new ControlChannel(env.SERVER_URL, env.EDGE_TOKEN, () => void sync.pollOnce());
  control.start();

  // Vision events -> disk spool -> server
  const spool = new Spool<SpooledEvent>(join(env.STATE_DIR, 'spool'));
  await spool.init();
  const forwarder = new Forwarder({ serverUrl: env.SERVER_URL, token: env.EDGE_TOKEN, spool, snapshotDir: env.SNAPSHOT_DIR });
  const health = new HealthCollector();
  const mqttClient = connectMqtt(env.MQTT_URL, env.MQTT_TOPIC_PREFIX, {
    onEvent: (p) => void forwarder.accept(p).catch((err) => logger.error({ err }, 'spooling event failed')),
    onCameraStatus: (k, p) => health.onCameraStatus(k, p),
    onMetrics: (k, p) => health.onMetrics(k, p),
    onVisionService: (p) => health.onVisionService(p),
  });
  const drainTimer = setInterval(() => void forwarder.drain(), 5000);

  // Health every 30 s; thumbnails 1 min after start, then every THUMBNAIL_INTERVAL_S.
  const enabledKeys = () => (sync.current?.cameras ?? []).filter((c) => c.enabled).map((c) => c.key);
  const heartbeatTimer = setInterval(async () => {
    const spoolSize = (await spool.list()).length;
    await sendHeartbeat(env.SERVER_URL, env.EDGE_TOKEN, health.snapshot(enabledKeys(), spoolSize, env.EDGE_LIVE_URL));
  }, 30_000);
  const thumbs = () =>
    uploadThumbnails({ serverUrl: env.SERVER_URL, token: env.EDGE_TOKEN, go2rtcApi: env.GO2RTC_API, cameraKeys: enabledKeys() });
  const firstThumbs = setTimeout(thumbs, 60_000);
  const thumbTimer = setInterval(thumbs, env.THUMBNAIL_INTERVAL_S * 1000);

  const stop = () => {
    logger.info('edge stopping');
    sync.stop();
    control.stop();
    clearInterval(drainTimer);
    clearInterval(heartbeatTimer);
    clearInterval(thumbTimer);
    clearTimeout(firstThumbs);
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

'use strict';
// Shared contract between services/vision (publisher) and apps/server, apps/web, apps/mobile.
// CommonJS so the Node server can require() it; bundlers (Vite, Metro) handle CJS too.

const visionEventSchema = require('../schemas/vision-event.v1.json');

const EVENT_SCHEMA = 'vision.event/v1';

const EVENT_TYPES = Object.freeze({
  ZONE_ENTER: 'zone.enter',
  ZONE_EXIT: 'zone.exit',
  LINE_CROSS: 'line.cross',
  CAMERA_STATUS: 'camera.status',
});

// MQTT topics (prefix defaults to "cctv/v1", set by MQTT_TOPIC_PREFIX).
//   <prefix>/events/<camera_id>/<event type>     every VisionEvent
//   <prefix>/cameras/<camera_id>/status          retained camera.status event
//   <prefix>/metrics/<camera_id>                 fps / inference timings (not a VisionEvent)
const topics = (prefix = 'cctv/v1') => ({
  events: (cameraId = '+', type = '+') => `${prefix}/events/${cameraId}/${type}`,
  allEvents: `${prefix}/events/#`,
  cameraStatus: (cameraId = '+') => `${prefix}/cameras/${cameraId}/status`,
  metrics: (cameraId = '+') => `${prefix}/metrics/${cameraId}`,
});

module.exports = { EVENT_SCHEMA, EVENT_TYPES, topics, visionEventSchema };

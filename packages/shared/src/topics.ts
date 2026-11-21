/**
 * MQTT topics on the EDGE broker (prefix defaults to "cctv/v1", MQTT_TOPIC_PREFIX).
 *   <prefix>/events/<camera>/<event type>   every VisionEvent
 *   <prefix>/cameras/<camera>/status        retained latest camera.status
 *   <prefix>/metrics/<camera>               retained fps / inference timings
 *   <prefix>/service/vision                 retained {"online": bool}, last will
 */
export const topics = (prefix = 'cctv/v1') => ({
  events: (cameraId = '+', type = '+') => `${prefix}/events/${cameraId}/${type}`,
  allEvents: `${prefix}/events/#`,
  cameraStatus: (cameraId = '+') => `${prefix}/cameras/${cameraId}/status`,
  metrics: (cameraId = '+') => `${prefix}/metrics/${cameraId}`,
  visionService: `${prefix}/service/vision`,
});

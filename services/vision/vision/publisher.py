"""Broker abstraction. MQTT (Mosquitto) now; a NATS JetStream implementation can be
dropped in later behind the same interface if replay is needed."""

from __future__ import annotations

import json
import logging
import socket
from abc import ABC, abstractmethod

import paho.mqtt.client as mqtt

log = logging.getLogger(__name__)


class Publisher(ABC):
    @abstractmethod
    def event(self, event: dict) -> None: ...

    @abstractmethod
    def camera_status(self, event: dict) -> None: ...

    @abstractmethod
    def metrics(self, camera_id: str, data: dict) -> None: ...

    def clear_camera(self, camera_id: str) -> None:
        """Forget retained state of a removed camera."""

    def close(self) -> None:
        pass


class MqttPublisher(Publisher):
    def __init__(self, host: str, port: int, prefix: str):
        self.prefix = prefix
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2, client_id=f"vision-{socket.gethostname()}", clean_session=True
        )
        self.client.reconnect_delay_set(min_delay=1, max_delay=30)
        self.service_topic = f"{prefix}/service/vision"
        self.client.will_set(self.service_topic, json.dumps({"online": False}), qos=1, retain=True)
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = lambda *a: log.warning("MQTT disconnected, will reconnect")
        self.client.connect_async(host, port, keepalive=30)
        self.client.loop_start()  # background network thread; queues while disconnected

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        log.info("MQTT connected (%s)", reason_code)
        client.publish(self.service_topic, json.dumps({"online": True}), qos=1, retain=True)

    def _pub(self, topic: str, payload: dict, qos: int = 1, retain: bool = False) -> None:
        self.client.publish(topic, json.dumps(payload, separators=(",", ":")), qos=qos, retain=retain)

    def event(self, event: dict) -> None:
        self._pub(f"{self.prefix}/events/{event['camera_id']}/{event['type']}", event)

    def camera_status(self, event: dict) -> None:
        # Retained, so a server that (re)connects immediately knows every camera's state.
        self._pub(f"{self.prefix}/cameras/{event['camera_id']}/status", event, retain=True)

    def metrics(self, camera_id: str, data: dict) -> None:
        self._pub(f"{self.prefix}/metrics/{camera_id}", data, qos=0, retain=True)

    def clear_camera(self, camera_id: str) -> None:
        # An empty retained message deletes the retained value.
        self.client.publish(f"{self.prefix}/cameras/{camera_id}/status", b"", qos=1, retain=True)
        self.client.publish(f"{self.prefix}/metrics/{camera_id}", b"", qos=1, retain=True)

    def close(self) -> None:
        self.client.publish(self.service_topic, json.dumps({"online": False}), qos=1, retain=True).wait_for_publish(2)
        self.client.loop_stop()
        self.client.disconnect()

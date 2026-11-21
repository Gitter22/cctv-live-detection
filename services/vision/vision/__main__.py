"""Entry point: `python -m vision`.

One shared detector (CPU) serves all cameras. A simple scheduler runs whichever camera
is due next, so each camera gets its detect_fps; if the CPU can't keep up, every camera
just gets fewer (always fresh) frames instead of building a queue.

The config file (written by the edge agent) is watched: on change, only the cameras whose
settings changed are restarted; a broken file is rejected and the running config is kept.
"""

from __future__ import annotations

import logging
import os
import signal
import time

from . import config as config_mod
from .config import Config
from .detectors import Detector
from .detectors import create as create_detector
from .pipeline import CameraPipeline
from .publisher import MqttPublisher, Publisher

log = logging.getLogger("vision")

CONFIG_CHECK_S = 2.0


class Runtime:
    """The set of running camera pipelines, reconciled against a Config."""

    def __init__(self, detector: Detector, publisher: Publisher):
        self.detector = detector
        self.publisher = publisher
        self.pipelines: dict[str, CameraPipeline] = {}
        self.cfg: Config | None = None

    def apply(self, cfg: Config) -> None:
        # Global pipeline/snapshot settings changed -> every camera restarts.
        global_changed = self.cfg is None or (self.cfg.pipeline, self.cfg.snapshot_dir) != (cfg.pipeline, cfg.snapshot_dir)
        wanted = {c.id: c for c in cfg.cameras}

        for cam_id, p in list(self.pipelines.items()):
            new = wanted.get(cam_id)
            if new is None or global_changed or new.signature() != p.cam.signature():
                p.stop()
                del self.pipelines[cam_id]
                if new is None:
                    self.publisher.clear_camera(cam_id)
                    log.info("[%s] camera removed", cam_id)
                else:
                    log.info("[%s] camera settings changed: restarting", cam_id)

        self.detector.configure(cfg.detector_classes(), cfg.detector_min_confidence())
        for cam_id, cam in wanted.items():
            if cam_id not in self.pipelines:
                p = CameraPipeline(cam, cfg, self.detector, self.publisher)
                p.start()
                self.pipelines[cam_id] = p
        self.cfg = cfg
        log.info("config applied: %d cameras %s", len(self.pipelines), sorted(self.pipelines))

    def stop(self) -> None:
        for p in self.pipelines.values():
            p.stop()


def wait_for_config(path: str) -> None:
    waited = 0
    while not os.path.exists(path):
        if waited % 30 == 0:
            log.info("waiting for config file %s (written by the edge agent)", path)
        time.sleep(1)
        waited += 1


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    logging.getLogger("libav").setLevel(logging.ERROR)

    path = config_mod.config_path()
    wait_for_config(path)
    cfg = config_mod.load(path)
    mtime = os.stat(path).st_mtime

    d = cfg.detector
    detector = create_detector(
        d.type,
        model_path=d.model_path,
        input_size=d.input_size,
        confidence=cfg.detector_min_confidence(),  # each camera applies its own thresholds on top
        classes=cfg.detector_classes(),
        threads=d.threads,
    )
    publisher = MqttPublisher(cfg.mqtt.host, cfg.mqtt.port, cfg.mqtt.prefix)
    runtime = Runtime(detector, publisher)
    runtime.apply(cfg)
    log.info("vision started: detector=%s", d.type)

    running = True

    def stop(*_):
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    next_config_check = time.time() + CONFIG_CHECK_S
    while running:
        now = time.time()
        if now >= next_config_check:
            next_config_check = now + CONFIG_CHECK_S
            try:
                m = os.stat(path).st_mtime
                if m != mtime:
                    mtime = m
                    runtime.apply(config_mod.load(path))
            except Exception:
                log.exception("new config rejected; keeping the running config")

        cams = list(runtime.pipelines.values())
        if not cams:
            time.sleep(0.2)
            continue
        cam = min(cams, key=lambda c: c.next_due)
        if cam.next_due > now:
            time.sleep(min(cam.next_due - now, 0.05))
            continue
        try:
            cam.step(now)
        except Exception:
            log.exception("[%s] pipeline step failed", cam.cam.id)
        for c in cams:
            c.heartbeat(now)

    log.info("shutting down")
    runtime.stop()
    publisher.close()


if __name__ == "__main__":
    main()

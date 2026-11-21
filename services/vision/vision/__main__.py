"""Entry point: `python -m vision`.

One shared detector (CPU) serves all cameras. A simple scheduler runs whichever camera
is due next, so each camera gets ~detect_fps, and if the CPU can't keep up every camera
just gets fewer (always fresh) frames instead of building a queue.
"""

from __future__ import annotations

import logging
import os
import signal
import time

from . import config as config_mod
from .detectors import create as create_detector
from .pipeline import CameraPipeline
from .publisher import MqttPublisher


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    logging.getLogger("libav").setLevel(logging.ERROR)
    log = logging.getLogger("vision")

    cfg = config_mod.load()
    d = cfg.detector
    detector = create_detector(
        d.type,
        model_path=d.model_path,
        input_size=d.input_size,
        confidence=d.low_confidence,  # tracker applies d.confidence itself
        classes=d.classes,
        threads=d.threads,
    )
    publisher = MqttPublisher(cfg.mqtt.host, cfg.mqtt.port, cfg.mqtt.prefix)

    cams = [CameraPipeline(c, cfg, detector, publisher) for c in cfg.cameras]
    for c in cams:
        c.start()
    log.info("vision started: %d cameras, detector=%s, %s fps/camera", len(cams), d.type, cfg.pipeline.detect_fps)

    running = True

    def stop(*_):
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    while running:
        now = time.time()
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
    for c in cams:
        c.reader.stop()
    publisher.close()


if __name__ == "__main__":
    main()

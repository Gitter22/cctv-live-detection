"""Load config/vision.yaml + environment variables into plain dataclasses."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import yaml


@dataclass
class ZoneCfg:
    id: str
    polygon: list[list[float]]  # normalised [[x, y], ...]


@dataclass
class LineCfg:
    id: str
    start: list[float]
    end: list[float]


@dataclass
class CameraCfg:
    id: str
    name: str
    url: str
    zones: list[ZoneCfg] = field(default_factory=list)
    lines: list[LineCfg] = field(default_factory=list)


@dataclass
class DetectorCfg:
    type: str
    model_path: str
    input_size: int = 640
    confidence: float = 0.5  # min score to START a track / count as a sure detection
    low_confidence: float = 0.25  # min score kept at all (ByteTrack rescue stage)
    classes: list[str] = field(default_factory=lambda: ["person"])
    threads: int = 4


@dataclass
class PipelineCfg:
    detect_fps: float = 5
    confirm_frames: int = 3
    exit_after_s: float = 3
    heartbeat_s: float = 30
    offline_after_s: float = 10
    startup_grace_s: float = 30
    anchor: str = "bottom_center"
    snapshot_quality: int = 85
    motion_gate: bool = True
    motion_pixel_threshold: int = 25
    motion_min_area: float = 0.002
    idle_detect_interval_s: float = 2.0


@dataclass
class MqttCfg:
    host: str
    port: int
    prefix: str


@dataclass
class Config:
    detector: DetectorCfg
    pipeline: PipelineCfg
    cameras: list[CameraCfg]
    mqtt: MqttCfg
    snapshot_dir: str


def load() -> Config:
    path = os.environ.get("VISION_CONFIG", "/config/vision.yaml")
    with open(path, encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    rtsp_base = os.environ.get("GO2RTC_RTSP", "rtsp://go2rtc:8554").rstrip("/")

    det = DetectorCfg(**raw["detector"])
    det.threads = int(os.environ.get("VISION_THREADS", det.threads))

    cameras = []
    for c in raw["cameras"]:
        cameras.append(
            CameraCfg(
                id=c["id"],
                name=c.get("name", c["id"]),
                # Either a go2rtc stream name or a full URL (e.g. a recording file for testing)
                url=c.get("url") or f"{rtsp_base}/{c['stream']}",
                zones=[ZoneCfg(**z) for z in c.get("zones") or []],
                lines=[LineCfg(**ln) for ln in c.get("lines") or []],
            )
        )

    return Config(
        detector=det,
        pipeline=PipelineCfg(**(raw.get("pipeline") or {})),
        cameras=cameras,
        mqtt=MqttCfg(
            host=os.environ.get("MQTT_HOST", "localhost"),
            port=int(os.environ.get("MQTT_PORT", "1883")),
            prefix=os.environ.get("MQTT_TOPIC_PREFIX", "cctv/v1"),
        ),
        snapshot_dir=os.environ.get("SNAPSHOT_DIR", "/data/snapshots"),
    )

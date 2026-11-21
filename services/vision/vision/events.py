"""Build VisionEvent v1 dicts. The schema lives in packages/shared/schemas/vision-event.v1.json."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

SCHEMA = "vision.event/v1"


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def make_event(type: str, camera_id: str, ts: float, **fields) -> dict:
    event = {
        "schema": SCHEMA,
        "id": str(uuid.uuid4()),
        "type": type,
        "ts": iso(ts),
        "camera_id": camera_id,
    }
    event.update({k: v for k, v in fields.items() if v is not None})
    return event


def object_payload(class_name: str, track_id: int, confidence: float, bbox_norm, dwell_s: float | None = None) -> dict:
    obj = {
        "class": str(class_name),
        "track_id": int(track_id),
        "confidence": round(float(confidence), 3),
        "bbox": [round(float(v), 4) for v in bbox_norm],
    }
    if dwell_s is not None:
        obj["dwell_s"] = round(float(dwell_s), 2)
    return obj

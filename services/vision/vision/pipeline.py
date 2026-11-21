"""Per-camera pipeline: latest frame -> detect -> track (ByteTrack) -> zones -> events."""

from __future__ import annotations

import logging
import os
import time
from collections import deque
from datetime import datetime, timezone

import cv2
import numpy as np

from .config import CameraCfg, Config
from .detectors import Detector
from .events import make_event, object_payload
from .ingest import LatestFrameReader
from .motion import MotionGate
from .publisher import Publisher
from .tracker import ByteTracker
from .zones import TrackedObject, Transition, ZoneEngine

log = logging.getLogger(__name__)


class CameraPipeline:
    def __init__(self, cam: CameraCfg, cfg: Config, detector: Detector, publisher: Publisher):
        self.cam = cam
        self.cfg = cfg
        self.p = cfg.pipeline
        self.detector = detector
        self.publisher = publisher
        self.reader = LatestFrameReader(cam.id, cam.url)
        self.tracker = ByteTracker(
            high_threshold=cam.confidence,  # the shared detector returns down to the lowest threshold
            max_lost=max(3, int(cam.detect_fps * 3)),  # keep IDs through ~3 s occlusion
        )
        self._classes = set(cam.classes)
        self.zones = ZoneEngine(
            zones=cam.zones,
            lines=cam.lines,
            confirm_frames=self.p.confirm_frames,
            exit_after_s=self.p.exit_after_s,
            anchor=self.p.anchor,
        )
        self.motion = MotionGate(self.p.motion_pixel_threshold, self.p.motion_min_area) if cam.motion_gate else None
        self._last_detect = 0.0
        self._skipped = 0
        self.interval = 1.0 / cam.detect_fps
        self.next_due = 0.0
        self._last_seq = -1
        self.online: bool | None = None  # unknown until first check
        self._last_heartbeat = 0.0
        # metrics
        self._infer_ms: deque[float] = deque(maxlen=100)
        self._frame_age_ms: deque[float] = deque(maxlen=100)
        self._detect_times: deque[float] = deque(maxlen=100)
        self._decoded_at_heartbeat = (0, time.time())

    def start(self) -> None:
        self.reader.start()

    def stop(self) -> None:
        self.reader.stop()

    # ------------------------------------------------------------------ main step
    def step(self, now: float) -> None:
        """Called by the scheduler when this camera is due."""
        self.next_due = max(self.next_due + self.interval, now)  # never "catch up" with bursts
        frame, frame_ts, seq = self.reader.latest()
        self._check_status(now, frame_ts)
        if frame is None or seq == self._last_seq or not self.online:
            return
        self._last_seq = seq

        # Motion gate: skip the detector on still frames, unless something is being tracked
        # or the idle safety interval has passed (catches very slow movers).
        if self.motion is not None:
            moving = self.motion.check(frame)
            if not (moving or self.tracker.tracks or now - self._last_detect >= self.p.idle_detect_interval_s):
                self._skipped += 1
                for tr in self.zones.update([], now):  # let pending zone.exit events fire on time
                    self._emit(tr, frame, frame_ts)
                return
        self._last_detect = now

        t0 = time.perf_counter()
        dets = self.detector.detect(frame)
        self._infer_ms.append((time.perf_counter() - t0) * 1000)
        self._frame_age_ms.append((time.time() - frame_ts) * 1000)
        self._detect_times.append(now)

        # The detector is shared by all cameras: keep only this camera's classes and thresholds.
        keep = np.array(
            [c in self._classes and s >= self.cam.low_confidence for c, s in zip(dets.class_name, dets.confidence)],
            dtype=bool,
        )
        h, w = frame.shape[:2]
        tracked = self.tracker.update(dets.xyxy[keep], dets.confidence[keep], dets.class_name[keep])
        scale = np.array([w, h, w, h], dtype=np.float32)
        objects = [
            TrackedObject(t.track_id, t.class_name, t.confidence, np.clip(t.box / scale, 0.0, 1.0))
            for t in tracked
        ]
        for tr in self.zones.update(objects, now):
            self._emit(tr, frame, frame_ts)

    def heartbeat(self, now: float) -> None:
        if now - self._last_heartbeat < self.p.heartbeat_s:
            return
        self._last_heartbeat = now
        if self.online is not None:
            # Heartbeat: refresh the retained status topic only. Status EVENTS are sent on changes.
            reason = self.reader.last_error if not self.online else None
            self.publisher.camera_status(make_event("camera.status", self.cam.id, now, status={"online": self.online, "reason": reason}))
        decoded, t = self._decoded_at_heartbeat
        dt = max(now - t, 1e-6)
        dts = list(self._detect_times)
        m = {
            "camera_id": self.cam.id,
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "online": bool(self.online),
            "decode_fps": round((self.reader.decoded_frames - decoded) / dt, 1),
            "detect_fps": round((len(dts) - 1) / (dts[-1] - dts[0]), 2) if len(dts) > 1 and dts[-1] > dts[0] else 0.0,
            "infer_ms_avg": round(float(np.mean(self._infer_ms)), 1) if self._infer_ms else None,
            "infer_ms_p95": round(float(np.percentile(self._infer_ms, 95)), 1) if self._infer_ms else None,
            "frame_age_ms_avg": round(float(np.mean(self._frame_age_ms)), 1) if self._frame_age_ms else None,
            "motion_skipped": self._skipped,
            "active_tracks": len(self.tracker.tracks),
        }
        self._skipped = 0
        self._decoded_at_heartbeat = (self.reader.decoded_frames, now)
        self.publisher.metrics(self.cam.id, m)
        log.info(
            "[%s] online=%s decode=%sfps detect=%sfps infer=%sms(p95 %s) frame_age=%sms skipped=%s tracks=%s",
            self.cam.id, m["online"], m["decode_fps"], m["detect_fps"],
            m["infer_ms_avg"], m["infer_ms_p95"], m["frame_age_ms_avg"], m["motion_skipped"], m["active_tracks"],
        )

    # ------------------------------------------------------------------ helpers
    def _check_status(self, now: float, frame_ts: float) -> None:
        online = frame_ts > 0 and (now - frame_ts) < self.p.offline_after_s
        if online == self.online:
            return
        # Don't report "offline" during the first connection attempt grace period.
        # Startup grace: don't report "offline" before this camera has had startup_grace_s
        # to connect, counted from its first real attempt (the login guard may delay it).
        first = self.reader.first_attempt_ts
        if self.online is None and not online and (not first or now - first < self.p.startup_grace_s):
            return
        self.online = online
        reason = None if online else (self.reader.last_error or "no frames")
        log.warning("[%s] camera %s%s", self.cam.id, "ONLINE" if online else "OFFLINE", f" ({reason})" if reason else "")
        self._publish_status(now, online, reason)

    def _publish_status(self, now: float, online: bool, reason: str | None) -> None:
        ev = make_event("camera.status", self.cam.id, now, status={"online": online, "reason": reason})
        self.publisher.event(ev)
        self.publisher.camera_status(ev)

    def _emit(self, tr: Transition, frame: np.ndarray, frame_ts: float) -> None:
        h, w = frame.shape[:2]
        ev = make_event(
            tr.type,
            self.cam.id,
            frame_ts,
            zone_id=tr.zone_id,
            line_id=tr.line_id,
            direction=tr.direction,
            object=object_payload(tr.obj.class_name, tr.obj.track_id, tr.obj.confidence, tr.obj.bbox, tr.dwell_s),
            frame={"width": w, "height": h},
        )
        if tr.type != "zone.exit":
            ev["snapshot"] = self._save_snapshot(ev, frame, tr)
        self.publisher.event(ev)
        log.info(
            "[%s] %s %s#%d zone=%s line=%s conf=%.2f",
            self.cam.id, tr.type, tr.obj.class_name, tr.obj.track_id, tr.zone_id, tr.line_id, tr.obj.confidence,
        )

    def _save_snapshot(self, ev: dict, frame: np.ndarray, tr: Transition) -> dict:
        h, w = frame.shape[:2]
        img = frame.copy()
        x1, y1, x2, y2 = (tr.obj.bbox * np.array([w, h, w, h])).astype(int)
        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 255), 2)
        label = f"{tr.obj.class_name} #{tr.obj.track_id} {tr.obj.confidence:.2f}"
        cv2.putText(img, label, (x1, max(15, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1, cv2.LINE_AA)
        rel = f"{self.cam.id}/{ev['ts'][:10]}/{ev['id']}.jpg"
        path = os.path.join(self.cfg.snapshot_dir, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        cv2.imwrite(path, img, [cv2.IMWRITE_JPEG_QUALITY, self.p.snapshot_quality])
        return {"path": rel, "width": w, "height": h}

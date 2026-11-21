"""Faces (opt-in per camera): YuNet (MIT) detects, SFace (Apache-2.0) embeds. OpenCV model zoo.

Generic like the rest of vision: we publish `face.observed` with a 128-d embedding and a face
crop. Whether the face is "known" is decided by the server (pgvector matching), never here.

Flow: a person enters a zone -> the worker grabs ONE high-resolution frame from the camera's
main stream via go2rtc (faces on the 640x360 detection stream are too small), finds faces,
assigns each face to the tracked person whose box contains it, and emits one event per person.
A person without a usable face is retried a few times while still tracked.
"""

from __future__ import annotations

import logging
import os
import queue
import threading
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Callable

import cv2
import numpy as np

log = logging.getLogger(__name__)

YUNET_PATH = os.environ.get("YUNET_MODEL", "/models/yunet.onnx")
SFACE_PATH = os.environ.get("SFACE_MODEL", "/models/sface.onnx")


@dataclass
class Face:
    bbox: tuple[float, float, float, float]  # normalised x1, y1, x2, y2
    score: float
    size_px: int
    embedding: np.ndarray  # (128,) float32, L2-normalised
    crop: np.ndarray  # BGR face crop for the snapshot


class FaceAnalyzer:
    def __init__(self, yunet_path: str = YUNET_PATH, sface_path: str = SFACE_PATH, min_score: float = 0.75):
        self.detector = cv2.FaceDetectorYN.create(yunet_path, "", (320, 320), min_score, 0.3, 50)
        self.recognizer = cv2.FaceRecognizerSF.create(sface_path, "")

    def analyze(self, bgr: np.ndarray, max_side: int = 1280, min_face_px: int = 40) -> list[Face]:
        h, w = bgr.shape[:2]
        scale = min(1.0, max_side / max(w, h))
        small = cv2.resize(bgr, (int(w * scale), int(h * scale))) if scale < 1 else bgr
        self.detector.setInputSize((small.shape[1], small.shape[0]))
        _, rows = self.detector.detect(small)
        out: list[Face] = []
        for r in [] if rows is None else rows:
            row = r.copy()
            row[:14] /= scale  # back to full-resolution coordinates (box + 5 landmarks)
            fw, fh = row[2], row[3]
            if fh < min_face_px:  # too small to recognise reliably
                continue
            aligned = self.recognizer.alignCrop(bgr, row)
            emb = self.recognizer.feature(aligned).reshape(-1).astype(np.float32)
            emb /= np.linalg.norm(emb) + 1e-9
            x1, y1 = max(0.0, row[0]), max(0.0, row[1])
            x2, y2 = min(float(w), row[0] + fw), min(float(h), row[1] + fh)
            pad = int(fh * 0.3)
            crop = bgr[max(0, int(y1) - pad) : min(h, int(y2) + pad), max(0, int(x1) - pad) : min(w, int(x2) + pad)]
            out.append(Face((x1 / w, y1 / h, x2 / w, y2 / h), float(row[14]), int(fh), emb, crop.copy()))
        return out


def assign_faces(faces: list[Face], persons: list[tuple[int, tuple[float, float, float, float]]]) -> dict[int, Face]:
    """Map track_id -> best face whose centre lies in the upper part of that person's box."""
    best: dict[int, Face] = {}
    for f in faces:
        cx, cy = (f.bbox[0] + f.bbox[2]) / 2, (f.bbox[1] + f.bbox[3]) / 2
        for track_id, (x1, y1, x2, y2) in persons:
            upper = y1 + (y2 - y1) * 0.6  # a face is in the top part of a person
            if x1 <= cx <= x2 and y1 <= cy <= upper:
                if track_id not in best or f.score > best[track_id].score:
                    best[track_id] = f
    return best


@dataclass
class FaceJob:
    camera_id: str
    stream: str  # go2rtc stream name of the MAIN stream
    zone_id: str | None
    attempt: int = 1
    not_before: float = field(default_factory=time.time)


class FaceWorker:
    """Background thread: one main-stream frame per job, never blocks detection."""

    MAX_ATTEMPTS = 3
    RETRY_S = 3.0

    def __init__(
        self,
        analyzer_factory: Callable[[], FaceAnalyzer],
        go2rtc_api: str,
        persons_of: Callable[[str], list[tuple[int, tuple[float, float, float, float]]]],
        emit: Callable[[str, str | None, int, Face, np.ndarray], None],
        fetch: Callable[[str], np.ndarray | None] | None = None,
    ):
        self._analyzer_factory = analyzer_factory
        self._analyzer: FaceAnalyzer | None = None
        self.go2rtc_api = go2rtc_api.rstrip("/")
        self.persons_of = persons_of
        self.emit = emit
        self.fetch = fetch or self._fetch_frame
        self.jobs: queue.Queue[FaceJob] = queue.Queue(maxsize=32)
        self.done_tracks: dict[str, set[int]] = {}
        self._pending: set[str] = set()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="faces", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def request(self, camera_id: str, stream: str, zone_id: str | None) -> None:
        """A person entered a zone: look for faces soon (deduplicated per camera)."""
        if camera_id in self._pending:
            return
        try:
            self.jobs.put_nowait(FaceJob(camera_id, stream, zone_id))
            self._pending.add(camera_id)
        except queue.Full:
            log.debug("face queue full; skipping %s", camera_id)

    def _fetch_frame(self, stream: str) -> np.ndarray | None:
        url = f"{self.go2rtc_api}/api/frame.jpeg?src={urllib.parse.quote(stream)}"
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                data = np.frombuffer(r.read(), np.uint8)
            return cv2.imdecode(data, cv2.IMREAD_COLOR)
        except Exception as e:  # stream down, no main stream, timeout
            log.debug("face frame fetch failed for %s: %s", stream, e)
            return None

    def process(self, job: FaceJob) -> bool:
        """Handle one job. Returns True if it should be retried."""
        persons = [p for p in self.persons_of(job.camera_id) if p[0] not in self.done_tracks.get(job.camera_id, set())]
        if not persons:
            return False
        frame = self.fetch(job.stream)
        if frame is None:
            return job.attempt < self.MAX_ATTEMPTS
        if self._analyzer is None:
            self._analyzer = self._analyzer_factory()
        # Use the tracks' positions NOW (the frame was grabbed just now, they may have moved).
        persons = [p for p in self.persons_of(job.camera_id) if p[0] not in self.done_tracks.get(job.camera_id, set())]
        matched = assign_faces(self._analyzer.analyze(frame), persons)
        for track_id, face in matched.items():
            self.done_tracks.setdefault(job.camera_id, set()).add(track_id)
            self.emit(job.camera_id, job.zone_id, track_id, face, frame)
        # Somebody still without a face: try again shortly.
        return len(matched) < len(persons) and job.attempt < self.MAX_ATTEMPTS

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                job = self.jobs.get(timeout=0.5)
            except queue.Empty:
                continue
            wait = job.not_before - time.time()
            if wait > 0 and self._stop.wait(wait):
                break
            try:
                retry = self.process(job)
            except Exception:
                log.exception("[%s] face job failed", job.camera_id)
                retry = False
            if retry:
                job.attempt += 1
                job.not_before = time.time() + self.RETRY_S
                try:
                    self.jobs.put_nowait(job)
                    continue
                except queue.Full:
                    pass
            self._pending.discard(job.camera_id)

    def forget_tracks(self, camera_id: str, live_track_ids: set[int]) -> None:
        """Drop bookkeeping for tracks that no longer exist."""
        done = self.done_tracks.get(camera_id)
        if done:
            done &= live_track_ids

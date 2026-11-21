"""Small ByteTrack-style multi-object tracker (NumPy only).

Idea of ByteTrack (Zhang et al. 2021): match existing tracks to HIGH-confidence
detections first, then try to rescue still-unmatched tracks with LOW-confidence
detections (a person half hidden behind the gate often scores 0.3). Only high-
confidence detections may start new tracks.

Simplifications vs. the paper (fine for a handful of objects per camera):
  * constant-velocity prediction with exponential smoothing instead of a Kalman filter
  * greedy IoU matching (best pairs first) instead of the Hungarian algorithm
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """IoU between every box in a (N,4) and b (M,4), xyxy -> (N, M)."""
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)), dtype=np.float32)
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / (area_a[:, None] + area_b[None, :] - inter + 1e-9)


def greedy_match(iou: np.ndarray, threshold: float) -> list[tuple[int, int]]:
    """Pairs (row, col) with the highest IoU first; each row/col used at most once."""
    pairs = []
    if iou.size == 0:
        return pairs
    iou = iou.copy()
    while True:
        r, c = np.unravel_index(np.argmax(iou), iou.shape)
        if iou[r, c] < threshold:
            return pairs
        pairs.append((int(r), int(c)))
        iou[r, :] = -1
        iou[:, c] = -1


@dataclass
class Track:
    id: int
    box: np.ndarray  # xyxy (pixels)
    class_name: str
    confidence: float
    velocity: np.ndarray = field(default_factory=lambda: np.zeros(4, np.float32))
    hits: int = 1
    lost: int = 0  # consecutive frames without a match
    confirmed: bool = False

    def predict(self) -> np.ndarray:
        return self.box + self.velocity

    def update(self, box: np.ndarray, confidence: float) -> None:
        self.velocity = 0.6 * self.velocity + 0.4 * (box - self.box)
        self.box = box
        self.confidence = confidence
        self.hits += 1
        self.lost = 0


@dataclass
class TrackedBox:
    track_id: int
    box: np.ndarray  # xyxy pixels
    class_name: str
    confidence: float


class ByteTracker:
    def __init__(
        self,
        high_threshold: float = 0.5,
        match_iou: float = 0.3,
        max_lost: int = 15,
        min_hits: int = 2,
    ):
        self.high = high_threshold
        self.match_iou = match_iou
        self.max_lost = max_lost  # frames a lost track is kept (for re-identification)
        self.min_hits = min_hits  # matches before a new track is reported
        self.tracks: list[Track] = []
        self._next_id = 1

    def update(self, boxes: np.ndarray, scores: np.ndarray, classes: np.ndarray) -> list[TrackedBox]:
        boxes = np.asarray(boxes, np.float32).reshape(-1, 4)
        high_idx = np.where(scores >= self.high)[0]
        low_idx = np.where(scores < self.high)[0]

        unmatched_tracks = list(range(len(self.tracks)))
        predicted = np.array([t.predict() for t in self.tracks], np.float32).reshape(-1, 4)

        def associate(det_idx: np.ndarray) -> np.ndarray:
            """Match unmatched tracks to the given detections (same class only)."""
            nonlocal unmatched_tracks
            if len(det_idx) == 0 or not unmatched_tracks:
                return det_idx
            iou = iou_matrix(predicted[unmatched_tracks], boxes[det_idx])
            for ti, track_row in enumerate(unmatched_tracks):
                for di, d in enumerate(det_idx):
                    if self.tracks[track_row].class_name != classes[d]:
                        iou[ti, di] = 0
            used_t, used_d = set(), set()
            for ti, di in greedy_match(iou, self.match_iou):
                track = self.tracks[unmatched_tracks[ti]]
                track.update(boxes[det_idx[di]], float(scores[det_idx[di]]))
                used_t.add(ti)
                used_d.add(di)
            unmatched_tracks = [t for i, t in enumerate(unmatched_tracks) if i not in used_t]
            return np.array([d for i, d in enumerate(det_idx) if i not in used_d], dtype=int)

        new_high = associate(high_idx)  # stage 1: high-confidence detections
        associate(low_idx)  # stage 2: rescue with low-confidence ones (never start tracks)

        for row in unmatched_tracks:
            t = self.tracks[row]
            t.lost += 1
            t.box = t.predict()  # coast along the last velocity while hidden
        for d in new_high:
            self.tracks.append(Track(self._next_id, boxes[d], str(classes[d]), float(scores[d])))
            self._next_id += 1

        # Tentative tracks that are lost are noise: drop at once. Confirmed ones get max_lost frames.
        self.tracks = [t for t in self.tracks if t.lost == 0 or (t.confirmed and t.lost <= self.max_lost)]

        out = []
        for t in self.tracks:
            if t.lost == 0 and t.hits >= self.min_hits:
                t.confirmed = True
            if t.confirmed and t.lost == 0:
                out.append(TrackedBox(t.id, t.box.copy(), t.class_name, t.confidence))
        return out

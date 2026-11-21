"""Cheap motion gate: decide whether a frame is worth sending to the (expensive) detector.

Compares a tiny blurred grayscale copy of the frame with a slowly updated background.
Costs well under 1 ms per frame, versus ~150 ms for detection on this CPU.
"""

from __future__ import annotations

import cv2
import numpy as np


class MotionGate:
    def __init__(self, pixel_threshold: int = 25, min_area: float = 0.002, size: tuple[int, int] = (160, 90)):
        self.pixel_threshold = pixel_threshold  # grey-level change that counts as "changed"
        self.min_area = min_area  # fraction of the image that must change (0.002 = 0.2 %)
        self.size = size
        self._bg: np.ndarray | None = None
        self.last_score = 0.0

    def check(self, bgr: np.ndarray) -> bool:
        small = cv2.resize(bgr, self.size, interpolation=cv2.INTER_AREA)
        gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0).astype(np.float32)
        if self._bg is None:
            self._bg = gray
            return True
        diff = cv2.absdiff(gray, self._bg)
        # Slowly adapt to lighting changes (clouds, IR switching) so they stop counting as motion.
        cv2.accumulateWeighted(gray, self._bg, 0.1)
        self.last_score = float((diff > self.pixel_threshold).mean())
        return self.last_score >= self.min_area

"""Every detector implements this interface, so models are swapped via config only."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

import numpy as np


@dataclass
class Detections:
    """Results for one frame. All arrays have length N."""

    xyxy: np.ndarray  # (N, 4) float32, PIXELS of the input frame
    confidence: np.ndarray  # (N,) float32 0..1
    class_name: np.ndarray  # (N,) str

    @classmethod
    def empty(cls) -> "Detections":
        return cls(np.zeros((0, 4), np.float32), np.zeros((0,), np.float32), np.array([], dtype=object))

    def __len__(self) -> int:
        return len(self.confidence)


class Detector(ABC):
    @abstractmethod
    def detect(self, bgr: np.ndarray) -> Detections:
        """Run on one BGR image (OpenCV layout, H x W x 3 uint8)."""

    @abstractmethod
    def configure(self, classes: list[str] | None, confidence: float) -> None:
        """Change which classes are reported and the minimum score (hot reload)."""

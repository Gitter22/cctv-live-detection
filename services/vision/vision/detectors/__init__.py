"""Detector registry: config `detector.type` -> class. Add new models here."""

from .base import Detections, Detector
from .dfine import DFineDetector

REGISTRY: dict[str, type[Detector]] = {
    "dfine": DFineDetector,
    "rtdetr": DFineDetector,  # same ONNX I/O format
}


def create(type: str, **kwargs) -> Detector:
    try:
        cls = REGISTRY[type]
    except KeyError:
        raise ValueError(f"Unknown detector type {type!r}. Known: {sorted(REGISTRY)}") from None
    return cls(**kwargs)


__all__ = ["Detections", "Detector", "create"]

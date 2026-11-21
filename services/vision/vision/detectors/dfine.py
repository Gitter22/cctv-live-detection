"""D-FINE (Apache-2.0) via ONNX Runtime. Also works for RT-DETR / RT-DETRv2 exports
from Hugging Face `onnx-community`, which share the same inputs/outputs:

  input  pixel_values [B, 3, H, W]      RGB, 0..1, plain resize (no letterbox, no mean/std).
                                         H and W are dynamic (multiples of 32): we keep the
                                         frame's aspect ratio, e.g. 640x360 -> 640x384, which
                                         is ~40% cheaper than a 640x640 square.
  output logits       [B, Q, C]          per-class logits (sigmoid, not softmax)
  output pred_boxes   [B, Q, 4]          cx, cy, w, h normalised 0..1
"""

from __future__ import annotations

import logging

import cv2
import numpy as np
import onnxruntime as ort

from .base import Detections, Detector
from .coco import COCO_CLASSES

log = logging.getLogger(__name__)


class DFineDetector(Detector):
    def __init__(
        self,
        model_path: str,
        input_size: int = 640,
        confidence: float = 0.5,
        classes: list[str] | None = None,
        threads: int = 4,
        **_: object,
    ):
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        so.inter_op_num_threads = 1
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # OpenVINO EP is used automatically if onnxruntime-openvino is installed (Intel CPUs).
        available = ort.get_available_providers()
        providers = [p for p in ("OpenVINOExecutionProvider", "CPUExecutionProvider") if p in available]
        self.session = ort.InferenceSession(model_path, sess_options=so, providers=providers)
        log.info("D-FINE loaded %s providers=%s threads=%d", model_path, self.session.get_providers(), threads)

        self.input_name = self.session.get_inputs()[0].name
        outs = self.session.get_outputs()
        # Identify outputs by name, falling back to shape (boxes have last dim 4).
        names = [o.name for o in outs]
        self.boxes_name = "pred_boxes" if "pred_boxes" in names else next(o.name for o in outs if o.shape[-1] == 4)
        self.logits_name = "logits" if "logits" in names else next(n for n in names if n != self.boxes_name)

        self.size = input_size
        self.class_names = np.array(COCO_CLASSES, dtype=object)
        self.configure(classes, confidence)

    def configure(self, classes: list[str] | None, confidence: float) -> None:
        unknown = set(classes or []) - set(COCO_CLASSES)
        if unknown:
            log.warning("ignoring classes this model does not know: %s", sorted(unknown))
        wanted = set(classes or COCO_CLASSES)
        self.class_mask = np.array([c in wanted for c in COCO_CLASSES])
        self.confidence = confidence

    def _input_wh(self, w: int, h: int) -> tuple[int, int]:
        """Long side = input_size, short side scaled to match, both rounded to multiples of 32."""
        scale = self.size / max(w, h)
        r32 = lambda v: max(32, int(round(v * scale / 32)) * 32)  # noqa: E731
        return r32(w), r32(h)

    def detect(self, bgr: np.ndarray) -> Detections:
        h, w = bgr.shape[:2]
        img = cv2.resize(bgr, self._input_wh(w, h), interpolation=cv2.INTER_LINEAR)
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        x = (img.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]

        logits, boxes = self.session.run([self.logits_name, self.boxes_name], {self.input_name: x})
        scores = 1.0 / (1.0 + np.exp(-logits[0]))  # (Q, C)
        scores[:, ~self.class_mask] = 0.0  # ignore classes we don't care about
        cls = scores.argmax(axis=1)
        conf = scores[np.arange(len(cls)), cls]
        keep = conf >= self.confidence
        if not keep.any():
            return Detections.empty()

        cx, cy, bw, bh = boxes[0][keep].T
        xyxy = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], axis=1)
        xyxy = np.clip(xyxy, 0.0, 1.0) * np.array([w, h, w, h], dtype=np.float32)
        return Detections(
            xyxy=xyxy.astype(np.float32),
            confidence=conf[keep].astype(np.float32),
            class_name=self.class_names[cls[keep]],
        )

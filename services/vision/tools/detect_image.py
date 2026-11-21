"""Smoke test the detector on one image (no camera needed).

  docker compose run --rm --no-deps -v "$PWD/data:/data" vision python tools/detect_image.py /data/test.jpg

Prints detections + timing and writes <image>.out.jpg with boxes drawn.
"""

import sys
import time

import cv2

sys.path.insert(0, ".")
from vision import config as config_mod  # noqa: E402
from vision.detectors import create  # noqa: E402

cfg = config_mod.load().detector
det = create(cfg.type, model_path=cfg.model_path, input_size=cfg.input_size,
             confidence=cfg.confidence, classes=None, threads=cfg.threads)
img = cv2.imread(sys.argv[1])
assert img is not None, f"cannot read {sys.argv[1]}"
det.detect(img)  # warm-up
t = time.perf_counter()
n = 10
for _ in range(n):
    d = det.detect(img)
print(f"{img.shape[1]}x{img.shape[0]}  avg {(time.perf_counter() - t) / n * 1000:.1f} ms/frame  ({len(d)} objects)")
for box, conf, name in zip(d.xyxy, d.confidence, d.class_name):
    print(f"  {name:12s} {conf:.2f}  {box.astype(int).tolist()}")
    x1, y1, x2, y2 = box.astype(int)
    cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 255), 2)
    cv2.putText(img, f"{name} {conf:.2f}", (x1, max(12, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
out = sys.argv[1].rsplit(".", 1)[0] + ".out.jpg"
cv2.imwrite(out, img)
print("wrote", out)

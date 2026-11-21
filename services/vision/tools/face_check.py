"""Smoke test YuNet + SFace on an image: python tools/face_check.py <image> <yunet.onnx> <sface.onnx>"""
import sys
import time

import cv2

img = cv2.imread(sys.argv[1])
det = cv2.FaceDetectorYN.create(sys.argv[2], "", (img.shape[1], img.shape[0]), 0.7, 0.3, 50)
rec = cv2.FaceRecognizerSF.create(sys.argv[3], "")
t = time.perf_counter()
_, faces = det.detect(img)
t_det = (time.perf_counter() - t) * 1000
faces = [] if faces is None else faces
print(f"{img.shape[1]}x{img.shape[0]}: {len(faces)} faces, detect {t_det:.0f} ms")
for f in faces[:5]:
    t = time.perf_counter()
    crop = rec.alignCrop(img, f)
    emb = rec.feature(crop)
    print(f"  face {int(f[2])}x{int(f[3])} px score {f[14]:.2f} embedding {emb.shape} in {(time.perf_counter()-t)*1000:.0f} ms")

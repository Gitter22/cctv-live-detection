"""Inside the vision container: models load, a real main-stream frame can be fetched, faces are found.
python tools/face_live_check.py <camera key> [test image]"""
import sys
import time

import cv2

from vision.faces import FaceAnalyzer, FaceWorker

key = sys.argv[1]
fa = FaceAnalyzer()
w = FaceWorker(lambda: fa, "http://go2rtc:1984", lambda c: [], lambda *a: None)
t = time.perf_counter()
frame = w._fetch_frame(f"{key}_main")
print(f"main stream frame: {None if frame is None else frame.shape} in {time.perf_counter()-t:.1f}s")
if frame is not None:
    t = time.perf_counter()
    faces = fa.analyze(frame)
    print(f"faces in live frame: {len(faces)} ({(time.perf_counter()-t)*1000:.0f} ms)")
if len(sys.argv) > 2:
    img = cv2.imread(sys.argv[2])
    big = cv2.resize(img, (img.shape[1] * 3, img.shape[0] * 3))  # simulate a 1920x1440 main-stream frame
    faces = fa.analyze(big)
    print(f"faces in test image: {len(faces)}; first embedding norm {float((faces[0].embedding**2).sum())**0.5:.3f}" if faces else "no faces")

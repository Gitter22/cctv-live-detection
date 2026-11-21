"""`python -m vision.probe` (or `npm run probe`): grab one frame from every camera,
print stream info, save JPEGs to data/snapshots/probe/ so you can see which channel
shows which place and draw zones."""

from __future__ import annotations

import os
import sys
import time

import av
import cv2

from . import config as config_mod
from .ingest import is_auth_failure


def main() -> int:
    cfg = config_mod.load()
    out_dir = os.path.join(cfg.snapshot_dir, "probe")
    os.makedirs(out_dir, exist_ok=True)
    rtsp_base = os.environ.get("GO2RTC_RTSP", "rtsp://go2rtc:8554").rstrip("/")
    # Default: every camera's detection stream, then its main stream (go2rtc "<stream>_main").
    urls = {c.id: c.url for c in cfg.cameras}
    urls.update({f"{c.id}_main": f"{c.url}_main" for c in cfg.cameras if c.url.startswith(rtsp_base)})
    names = sys.argv[1:] or list(urls)
    ok = True
    for name in names:
        url = urls.get(name, f"{rtsp_base}/{name}")
        for attempt in (1, 2):
            try:
                with av.open(url, options={"rtsp_transport": "tcp", "timeout": "8000000", "analyzeduration": "12000000", "probesize": "10000000"}, timeout=(15, 10)) as c:
                    s = c.streams.video[0]
                    frame = next(c.decode(s))
                    img = frame.to_ndarray(format="bgr24")
                    path = os.path.join(out_dir, f"{name}.jpg")
                    cv2.imwrite(path, img)
                    fps = s.average_rate or s.guessed_rate
                    print(f"OK   {name:10s} {s.codec_context.name} {img.shape[1]}x{img.shape[0]} ~{fps}fps -> {path}")
                break
            except av.error.InvalidDataError:
                # go2rtc was still opening its NVR session (first viewer after a restart)
                if attempt == 1:
                    time.sleep(2)
                    continue
                ok = False
                print(f"FAIL {name:10s} invalid data twice (stream not ready?)")
            except Exception as e:
                ok = False
                print(f"FAIL {name:10s} {type(e).__name__}: {e}")
                if is_auth_failure(e, url):
                    print("Stopping: NVR login failed (wrong password or account locked). "
                          "Not trying more streams, to avoid locking the account.")
                    return 1
                break
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

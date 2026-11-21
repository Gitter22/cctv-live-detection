"""Diagnose how PyAV opens an RTSP stream with different ffmpeg options.

  docker compose run --rm --no-deps -v "$PWD/services/vision/tools:/app/tools" vision \
      python tools/rtsp_check.py rtsp://go2rtc:8554/cam1

Opens the stream once per option set (each open = one go2rtc consumer; go2rtc keeps a
single NVR session, so this does not multiply NVR logins once the password is right).
"""

import sys

import av

url = sys.argv[1] if len(sys.argv) > 1 else "rtsp://go2rtc:8554/cam1"
print("PyAV", av.__version__, "libavformat", av.library_versions.get("libavformat"))
tests = {
    "tcp only": {"rtsp_transport": "tcp"},
    "tcp+timeout": {"rtsp_transport": "tcp", "timeout": "5000000"},
    "tcp+stimeout": {"rtsp_transport": "tcp", "stimeout": "5000000"},
    "tcp+nobuffer+lowdelay": {"rtsp_transport": "tcp", "fflags": "nobuffer", "flags": "low_delay"},
    "all (ingest.py v1)": {
        "rtsp_transport": "tcp", "stimeout": "5000000", "timeout": "5000000",
        "fflags": "nobuffer", "flags": "low_delay",
    },
}
for name, opts in tests.items():
    try:
        with av.open(url, options=opts, timeout=(10.0, 10.0)) as c:
            s = c.streams.video[0]
            f = next(c.decode(s))
            print(f"OK   {name}: {s.codec_context.name} {f.width}x{f.height}")
    except Exception as e:
        print(f"FAIL {name}: {type(e).__name__}: {e}")

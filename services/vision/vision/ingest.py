"""Camera ingest: decode an RTSP stream with PyAV and keep ONLY the latest frame.

One background thread per camera decodes continuously (the decoder must see every
packet anyway). The detection loop grabs whatever frame is newest; older frames are
simply overwritten, so a slow detector never builds up a backlog / latency.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import av
import numpy as np

log = logging.getLogger(__name__)


class LoginGuard:
    """Protects the NVR account from lockout (Dahua locks after ~5 failed logins).

    go2rtc answers 404 (or 401) when it can't log in to the NVR. After such a failure the
    guard becomes "suspect": only ONE camera may try at a time, and only after a growing
    wait (1, 2, 4, then 10 min). The first successful connection clears it for all cameras.
    """

    def __init__(self, first_wait: float = 60.0, max_wait: float = 600.0, start_suspect: bool = True):
        self._lock = threading.Lock()
        self.first_wait = first_wait
        self.max_wait = max_wait
        # Start suspect: at startup ONE camera tests the login before the others connect.
        self.suspect = start_suspect
        self._wait = first_wait
        self._next_try = 0.0
        self._probing = False

    def acquire(self) -> bool:
        """True if this reader may connect now."""
        with self._lock:
            if not self.suspect:
                return True
            if self._probing or time.time() < self._next_try:
                return False
            self._probing = True
            return True

    def report(self, auth_failure: bool) -> None:
        with self._lock:
            was_probe = self._probing
            self._probing = False
            if not auth_failure:
                if self.suspect:
                    log.info("NVR login OK again; all cameras may reconnect")
                self.suspect, self._wait = False, self.first_wait
                return
            if not self.suspect or was_probe:
                if self.suspect and self._next_try > 0:
                    self._wait = min(self._wait * 2, self.max_wait)
                self.suspect = True
                self._next_try = time.time() + self._wait
                log.warning(
                    "go2rtc could not open an NVR stream (wrong password, locked account, or NVR busy). "
                    "Pausing logins; next single try in %.0f s. If this repeats, check go2rtc logs "
                    "for 'wrong user/pass' and NVR_PASSWORD in .env.",
                    self._wait,
                )


def stream_known_to_go2rtc(url: str) -> bool | None:
    """Ask go2rtc's API whether a stream name exists. None = can't tell (not go2rtc / API down)."""
    api = os.environ.get("GO2RTC_API", "http://go2rtc:1984").rstrip("/")
    parsed = urllib.parse.urlparse(url)
    if parsed.hostname not in (urllib.parse.urlparse(api).hostname, "go2rtc"):
        return None
    name = parsed.path.lstrip("/")
    try:
        with urllib.request.urlopen(f"{api}/api/streams?src={urllib.parse.quote(name)}", timeout=2) as r:
            return r.status == 200
    except urllib.error.HTTPError as he:
        return False if he.code == 404 else None
    except Exception:
        return None


def is_auth_failure(e: Exception, url: str | None = None) -> bool:
    """go2rtc answers 404 both when it cannot log in to the NVR and when the stream is not
    configured (yet). Only the first may lock the NVR account, so tell them apart."""
    name = type(e).__name__
    if name not in ("HTTPNotFoundError", "HTTPUnauthorizedError", "HTTPForbiddenError"):
        return False
    if url and name == "HTTPNotFoundError" and stream_known_to_go2rtc(url) is False:
        return False  # stream simply doesn't exist (config not applied yet): not a login problem
    return True


LOGIN_GUARD = LoginGuard()


class LatestFrameReader:
    def __init__(self, camera_id: str, url: str):
        self.camera_id = camera_id
        self.url = url
        self._lock = threading.Lock()
        self._frame: np.ndarray | None = None
        self._frame_ts = 0.0  # wall clock time the frame was decoded
        self._seq = 0  # increments per decoded frame
        self.last_error: str | None = None
        self.decoded_frames = 0
        self.first_attempt_ts = 0.0  # when we first actually tried to connect (after the login guard)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name=f"ingest-{camera_id}", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def latest(self) -> tuple[np.ndarray | None, float, int]:
        """Return (bgr_frame, decode_time, seq). Frame is shared: copy before mutating."""
        with self._lock:
            return self._frame, self._frame_ts, self._seq

    def _run(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            if not LOGIN_GUARD.acquire():
                if self._stop.wait(2.0):
                    break
                continue
            if not self.first_attempt_ts:
                self.first_attempt_ts = time.time()
            try:
                self._read_stream()
                backoff = 1.0  # stream ended cleanly; reconnect quickly
            except Exception as e:  # network errors, auth errors, decoder errors
                self.last_error = f"{type(e).__name__}: {e}"
                auth = is_auth_failure(e, self.url)
                LOGIN_GUARD.report(auth_failure=auth)
                if isinstance(e, av.error.HTTPNotFoundError) and not auth:
                    log.info("[%s] stream not configured in go2rtc yet, retrying", self.camera_id)
                    if self._stop.wait(2.0):
                        break
                    continue
                if isinstance(e, av.error.InvalidDataError):
                    # go2rtc is still opening its NVR session: not a real failure, retry soon.
                    log.info("[%s] stream not ready yet, retrying", self.camera_id)
                    if self._stop.wait(1.0):
                        break
                    continue
                if not auth:
                    log.warning("[%s] stream error: %s (retry in %.0fs)", self.camera_id, self.last_error, backoff)
            if self._stop.wait(backoff):
                break
            backoff = min(backoff * 2, 30.0)

    def _read_stream(self) -> None:
        options = {
            "rtsp_transport": "tcp",  # TCP: no packet loss / smeared frames over Wi-Fi
            "stimeout": "5000000",  # 5 s socket timeout (microseconds), older ffmpeg name
            "timeout": "5000000",  # same, newer ffmpeg name
            # H.265 needs a keyframe before the decoder knows the stream. Night/IR channels can
            # send keyframes several seconds apart; ffmpeg's default 5 s wait then fails with
            # "Invalid data". Wait up to 12 s instead.
            "analyzeduration": "12000000",
            "probesize": "10000000",
            "fflags": "nobuffer",
            "flags": "low_delay",
        }
        log.info("[%s] connecting %s", self.camera_id, self.url)
        with av.open(self.url, options=options, timeout=(15.0, 10.0)) as container:
            stream = container.streams.video[0]
            stream.thread_type = "AUTO"  # multi-threaded decode
            log.info(
                "[%s] connected: %s %sx%s",
                self.camera_id,
                stream.codec_context.name,
                stream.codec_context.width,
                stream.codec_context.height,
            )
            self.last_error = None
            LOGIN_GUARD.report(auth_failure=False)
            for frame in container.decode(stream):
                if self._stop.is_set():
                    return
                img = frame.to_ndarray(format="bgr24")
                with self._lock:
                    self._frame = img
                    self._frame_ts = time.time()
                    self._seq += 1
                self.decoded_frames += 1

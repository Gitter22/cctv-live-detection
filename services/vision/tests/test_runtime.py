"""Hot reload: only changed cameras restart; removed cameras are cleared."""

import textwrap
import unittest
from unittest import mock

from vision import config as config_mod
from vision.__main__ import Runtime


class FakeDetector:
    def __init__(self):
        self.calls = []

    def configure(self, classes, confidence):
        self.calls.append((classes, confidence))

    def detect(self, bgr):  # pragma: no cover - not used
        raise AssertionError


class FakePublisher:
    def __init__(self):
        self.cleared = []

    def clear_camera(self, cam_id):
        self.cleared.append(cam_id)


BASE = """
detector: {type: dfine, model_path: /m.onnx}
cameras:
  - {id: entrance-1, stream: entrance-1, classes: [person], low_confidence: 0.3}
  - {id: backyard-2, stream: backyard-2, classes: [person, dog], low_confidence: 0.2}
"""


def load(text, tmp):
    p = tmp / "vision.yaml"
    p.write_text(textwrap.dedent(text))
    return config_mod.load(str(p))


class RuntimeTest(unittest.TestCase):
    def setUp(self):
        import pathlib
        import tempfile

        self.tmp = pathlib.Path(tempfile.mkdtemp())
        patcher = mock.patch("vision.__main__.CameraPipeline")
        self.Pipeline = patcher.start()
        self.addCleanup(patcher.stop)
        self.started = []

        def make(cam, cfg, det, pub, faces=None):
            m = mock.MagicMock()
            m.cam = cam
            self.started.append(cam.id)
            return m

        self.Pipeline.side_effect = make

    def test_reload_restarts_only_changed_cameras(self):
        det, pub = FakeDetector(), FakePublisher()
        rt = Runtime(det, pub)
        rt.apply(load(BASE, self.tmp))
        self.assertEqual(sorted(self.started), ["backyard-2", "entrance-1"])
        self.assertEqual(det.calls[-1], (["dog", "person"], 0.2))

        entrance = rt.pipelines["entrance-1"]
        changed = BASE.replace("[person, dog], low_confidence: 0.2", "[person], low_confidence: 0.4")
        rt.apply(load(changed, self.tmp))
        self.assertIs(rt.pipelines["entrance-1"], entrance)  # untouched
        self.assertEqual(self.started.count("backyard-2"), 2)  # restarted
        self.assertEqual(det.calls[-1], (["person"], 0.3))

    def test_removed_camera_is_stopped_and_cleared(self):
        det, pub = FakeDetector(), FakePublisher()
        rt = Runtime(det, pub)
        rt.apply(load(BASE, self.tmp))
        backyard = rt.pipelines["backyard-2"]
        only_entrance = "detector: {type: dfine, model_path: /m.onnx}\ncameras:\n  - {id: entrance-1, stream: entrance-1}\n"
        rt.apply(load(only_entrance, self.tmp))
        backyard.stop.assert_called_once()
        self.assertEqual(pub.cleared, ["backyard-2"])
        self.assertEqual(sorted(rt.pipelines), ["entrance-1"])


class AuthFailureTest(unittest.TestCase):
    def test_unknown_go2rtc_stream_is_not_a_login_failure(self):
        from vision import ingest

        class HTTPNotFoundError(Exception):
            pass

        with mock.patch.object(ingest, "stream_known_to_go2rtc", return_value=False):
            self.assertFalse(ingest.is_auth_failure(HTTPNotFoundError(), "rtsp://go2rtc:8554/x"))
        with mock.patch.object(ingest, "stream_known_to_go2rtc", return_value=True):
            self.assertTrue(ingest.is_auth_failure(HTTPNotFoundError(), "rtsp://go2rtc:8554/x"))
        self.assertFalse(ingest.is_auth_failure(ValueError(), "rtsp://go2rtc:8554/x"))


if __name__ == "__main__":
    unittest.main()

"""Face assignment and the worker flow (no models needed: analyzer is faked)."""

import unittest

import numpy as np

from vision.faces import Face, FaceJob, FaceWorker, assign_faces


def face(x1, y1, x2, y2, score=0.9):
    return Face((x1, y1, x2, y2), score, 60, np.ones(128, np.float32) / np.sqrt(128), np.zeros((10, 10, 3), np.uint8))


class AssignTest(unittest.TestCase):
    def test_face_goes_to_the_person_whose_upper_body_contains_it(self):
        persons = [(1, (0.1, 0.1, 0.3, 0.9)), (2, (0.6, 0.1, 0.8, 0.9))]
        got = assign_faces([face(0.15, 0.12, 0.22, 0.2), face(0.65, 0.12, 0.72, 0.2)], persons)
        self.assertEqual(sorted(got), [1, 2])
        self.assertAlmostEqual(got[1].bbox[0], 0.15)

    def test_face_at_feet_level_or_outside_is_ignored(self):
        persons = [(1, (0.1, 0.1, 0.3, 0.9))]
        self.assertEqual(assign_faces([face(0.15, 0.8, 0.2, 0.88)], persons), {})
        self.assertEqual(assign_faces([face(0.5, 0.1, 0.55, 0.2)], persons), {})


class WorkerTest(unittest.TestCase):
    def make(self, faces_found, persons=((1, (0.1, 0.1, 0.3, 0.9)),)):
        emitted = []

        class FakeAnalyzer:
            def analyze(self, frame):
                return faces_found

        w = FaceWorker(
            analyzer_factory=FakeAnalyzer,
            go2rtc_api="http://g",
            persons_of=lambda cam: list(persons),
            emit=lambda cam, zone, tid, f, frame: emitted.append((cam, zone, tid)),
            fetch=lambda stream: np.zeros((1296, 2304, 3), np.uint8),
        )
        return w, emitted

    def test_emits_once_per_track(self):
        w, emitted = self.make([face(0.15, 0.12, 0.22, 0.2)])
        self.assertFalse(w.process(FaceJob("entrance-1", "entrance-1_main", "gate")))
        self.assertEqual(emitted, [("entrance-1", "gate", 1)])
        w.process(FaceJob("entrance-1", "entrance-1_main", "gate"))
        self.assertEqual(len(emitted), 1)  # same track not analysed again

    def test_retries_when_no_face_yet(self):
        w, emitted = self.make([])
        self.assertTrue(w.process(FaceJob("entrance-1", "entrance-1_main", None, attempt=1)))
        self.assertFalse(w.process(FaceJob("entrance-1", "entrance-1_main", None, attempt=3)))
        self.assertEqual(emitted, [])


if __name__ == "__main__":
    unittest.main()

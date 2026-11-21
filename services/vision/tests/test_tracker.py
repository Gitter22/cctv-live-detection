import unittest

import numpy as np

from vision.tracker import ByteTracker, iou_matrix


def box(x, y=100, w=40, h=100):
    return [x, y, x + w, y + h]


def run(tr, items):
    """items: list of (box, score, class)"""
    if not items:
        return tr.update(np.zeros((0, 4)), np.zeros(0), np.array([], dtype=object))
    b, s, c = zip(*items)
    return tr.update(np.array(b, np.float32), np.array(s, np.float32), np.array(c, dtype=object))


class TrackerTest(unittest.TestCase):
    def test_iou(self):
        m = iou_matrix(np.array([box(0)], np.float32), np.array([box(0), box(20), box(500)], np.float32))
        self.assertAlmostEqual(m[0, 0], 1.0, places=4)
        self.assertAlmostEqual(m[0, 1], 1 / 3, places=3)
        self.assertEqual(m[0, 2], 0)

    def test_stable_id_while_moving(self):
        tr = ByteTracker(min_hits=2)
        self.assertEqual(run(tr, [(box(0), 0.9, "person")]), [])  # tentative
        ids = {run(tr, [(box(x), 0.9, "person")])[0].track_id for x in range(5, 60, 5)}
        self.assertEqual(len(ids), 1)

    def test_low_confidence_keeps_track_but_cannot_start_one(self):
        tr = ByteTracker(high_threshold=0.5, min_hits=1)
        tid = run(tr, [(box(0), 0.9, "person")])[0].track_id
        out = run(tr, [(box(3), 0.3, "person"), (box(400), 0.3, "person")])
        self.assertEqual([t.track_id for t in out], [tid])  # rescued; the far low box started nothing

    def test_survives_short_occlusion(self):
        tr = ByteTracker(min_hits=1, max_lost=5)
        tid = run(tr, [(box(0), 0.9, "person")])[0].track_id
        run(tr, [(box(5), 0.9, "person")])
        for _ in range(3):
            self.assertEqual(run(tr, []), [])
        out = run(tr, [(box(20), 0.9, "person")])  # reappears roughly where predicted
        self.assertEqual(out[0].track_id, tid)

    def test_classes_never_swap(self):
        tr = ByteTracker(min_hits=1)
        p = run(tr, [(box(0), 0.9, "person")])[0].track_id
        out = run(tr, [(box(0), 0.9, "dog")])
        self.assertNotEqual(out[0].track_id, p)


if __name__ == "__main__":
    unittest.main()

"""Run: docker compose run --rm --no-deps vision python -m unittest discover -s tests -v"""

import unittest

import numpy as np

from vision.config import LineCfg, ZoneCfg
from vision.zones import TrackedObject, ZoneEngine

# Zone = left half of the frame
LEFT = ZoneCfg(id="left", polygon=[[0, 0], [0.5, 0], [0.5, 1], [0, 1]])


def person(track_id, x):
    """Box whose bottom-centre is at (x, 0.9)."""
    return TrackedObject(track_id, "person", 0.9, np.array([x - 0.05, 0.5, x + 0.05, 0.9]))


class ZoneEngineTest(unittest.TestCase):
    def test_enter_needs_confirm_frames(self):
        z = ZoneEngine([LEFT], [], confirm_frames=3, exit_after_s=2)
        self.assertEqual(z.update([person(1, 0.2)], 0.0), [])
        self.assertEqual(z.update([person(1, 0.2)], 0.2), [])
        out = z.update([person(1, 0.2)], 0.4)
        self.assertEqual([t.type for t in out], ["zone.enter"])
        self.assertEqual(out[0].zone_id, "left")
        # no duplicate enter while staying
        self.assertEqual(z.update([person(1, 0.2)], 0.6), [])

    def test_single_frame_flicker_does_not_fire(self):
        z = ZoneEngine([LEFT], [], confirm_frames=3, exit_after_s=2)
        z.update([person(1, 0.2)], 0.0)
        z.update([person(1, 0.8)], 0.2)  # outside -> streak reset
        z.update([person(1, 0.2)], 0.4)
        self.assertEqual(z.update([person(1, 0.2)], 0.6), [])

    def test_exit_after_grace_period(self):
        z = ZoneEngine([LEFT], [], confirm_frames=1, exit_after_s=2)
        self.assertEqual([t.type for t in z.update([person(1, 0.2)], 0.0)], ["zone.enter"])
        self.assertEqual(z.update([], 1.0), [])  # lost briefly: no exit yet
        self.assertEqual(z.update([person(1, 0.2)], 1.5), [])  # back: still the same visit
        out = z.update([], 4.0)
        self.assertEqual([t.type for t in out], ["zone.exit"])
        self.assertAlmostEqual(out[0].dwell_s, 1.5)

    def test_line_cross_direction_and_jitter(self):
        line = LineCfg(id="l", start=[0.5, 0.0], end=[0.5, 1.0])
        z = ZoneEngine([], [line], exit_after_s=2)
        z.update([person(1, 0.3)], 0.0)
        out = z.update([person(1, 0.7)], 0.2)
        self.assertEqual([(t.type, t.line_id) for t in out], [("line.cross", "l")])
        first_dir = out[0].direction
        self.assertEqual(z.update([person(1, 0.3)], 0.4), [])  # jitter back within 2 s ignored
        out = z.update([person(1, 0.7)], 3.0)
        out = out or z.update([person(1, 0.3)], 3.2)
        self.assertEqual(len(out), 1)
        self.assertIn(first_dir, ("in", "out"))


if __name__ == "__main__":
    unittest.main()

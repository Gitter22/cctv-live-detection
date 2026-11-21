import unittest
from unittest import mock

from vision.ingest import LoginGuard


class LoginGuardTest(unittest.TestCase):
    def test_only_one_probe_after_failure_and_growing_wait(self):
        g = LoginGuard(first_wait=60, max_wait=600, start_suspect=False)
        with mock.patch("vision.ingest.time.time", return_value=0):
            self.assertTrue(g.acquire())
            g.report(auth_failure=True)  # first failure -> suspect, wait 60 s
            self.assertFalse(g.acquire())  # everyone blocked
        with mock.patch("vision.ingest.time.time", return_value=61):
            self.assertTrue(g.acquire())  # one probe allowed
            self.assertFalse(g.acquire())  # second camera must wait
            g.report(auth_failure=True)  # probe failed -> wait doubles
        with mock.patch("vision.ingest.time.time", return_value=121):
            self.assertFalse(g.acquire())  # 61 + 120 not reached
        with mock.patch("vision.ingest.time.time", return_value=182):
            self.assertTrue(g.acquire())
            g.report(auth_failure=False)  # success clears for all
            self.assertTrue(g.acquire())
            self.assertTrue(g.acquire())

    def test_startup_lets_only_one_camera_try(self):
        g = LoginGuard(first_wait=60)
        with mock.patch("vision.ingest.time.time", return_value=0):
            self.assertEqual([g.acquire() for _ in range(4)], [True, False, False, False])
            g.report(auth_failure=True)  # wrong password: only ONE failed login
            self.assertFalse(g.acquire())
        self.assertEqual(g._wait, 60)

    def test_startup_success_releases_all(self):
        g = LoginGuard()
        with mock.patch("vision.ingest.time.time", return_value=0):
            self.assertTrue(g.acquire())
            g.report(auth_failure=False)
            self.assertEqual([g.acquire() for _ in range(3)], [True, True, True])


if __name__ == "__main__":
    unittest.main()


class GuardPerDeviceTest(unittest.TestCase):
    def test_devices_have_independent_guards(self):
        from vision.ingest import guard_for

        nvr, other = guard_for("192.168.1.17:554"), guard_for("10.0.0.9:554")
        self.assertIs(nvr, guard_for("192.168.1.17:554"))
        self.assertIsNot(nvr, other)
        with mock.patch("vision.ingest.time.time", return_value=0):
            # a broken camera on another device...
            other.suspect = False
            other.acquire()
            other.report(auth_failure=True)
            # ...doesn't block this NVR
            nvr.suspect = False
            self.assertTrue(nvr.acquire())

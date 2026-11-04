"""Offline tests for the pure transform pieces. Run: python -m unittest discover -s tests"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.build_session import Clock, _columnar, build_track  # noqa: E402
from pipeline.jolpica import Jolpica  # noqa: E402


class MergeRaces(unittest.TestCase):
    def test_rows_split_across_pages_are_merged(self):
        pages = [
            {"season": "2024", "round": "1", "Results": [{"p": 1}, {"p": 2}]},
            {"season": "2024", "round": "1", "Results": [{"p": 3}]},
            {"season": "2024", "round": "2", "Results": [{"p": 1}]},
        ]
        merged = Jolpica._merge_races(pages, "Results")
        self.assertEqual([len(r["Results"]) for r in merged], [3, 1])
        self.assertEqual(len(pages[0]["Results"]), 2, "input must not be mutated")


class Columnar(unittest.TestCase):
    def test_sorted_and_relative_ms(self):
        clock = Clock("2024-09-01T13:00:00+00:00")
        rows = [{"date": "2024-09-01T13:00:01.500000+00:00", "speed": 200},
                {"date": "2024-09-01T13:00:00.250000+00:00", "speed": 100}]
        self.assertEqual(_columnar(rows, clock, {"v": "speed"}), {"t": [250, 1500], "v": [100, 200]})


class Track(unittest.TestCase):
    def test_uses_fastest_clean_lap(self):
        clock = Clock("2024-01-01T00:00:00+00:00")
        laps = [
            {"lap_number": 1, "driver_number": 1, "lap_duration": 90.0, "is_pit_out_lap": True,
             "date_start": "2024-01-01T00:00:00+00:00"},
            {"lap_number": 2, "driver_number": 1, "lap_duration": 80.0, "is_pit_out_lap": False,
             "date_start": "2024-01-01T00:01:30+00:00"},
        ]
        t = list(range(90_000, 170_001, 500))
        loc = {"t": t, "x": [i for i in range(len(t))], "y": [1] * len(t)}
        track = build_track(laps, loc, clock)
        self.assertEqual(track["lap"], 2)
        self.assertEqual(len(track["x"]), len(t))


if __name__ == "__main__":
    unittest.main()


class LiveLock(unittest.TestCase):
    def test_waits_through_live_session_lock_then_succeeds(self):
        import io, tempfile, urllib.error
        from unittest import mock
        from pipeline import http
        calls = {"n": 0}

        class Resp(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def fake_urlopen(req, timeout):
            calls["n"] += 1
            if calls["n"] <= 2:
                body = io.BytesIO(b'{"detail":"Live F1 session in progress. Global API access ... restricted"}')
                raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, body)
            return Resp(b'[{"ok": 1}]')

        c = http.Client(tempfile.mkdtemp(), http.RateLimiter(0), "t", verbose=False)
        with mock.patch.object(http.urllib.request, "urlopen", fake_urlopen), \
             mock.patch.object(http.time, "sleep") as slept:
            self.assertEqual(c.get("https://example/x"), [{"ok": 1}])
        self.assertEqual(calls["n"], 3)
        self.assertEqual(slept.call_count, 2)

    def test_other_401_is_an_error(self):
        import io, tempfile, urllib.error
        from unittest import mock
        from pipeline import http

        def fake_urlopen(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, io.BytesIO(b'{"detail":"bad key"}'))

        c = http.Client(tempfile.mkdtemp(), http.RateLimiter(0), "t", verbose=False)
        with mock.patch.object(http.urllib.request, "urlopen", fake_urlopen):
            with self.assertRaises(urllib.error.HTTPError):
                c.get("https://example/y")

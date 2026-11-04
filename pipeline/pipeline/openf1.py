"""OpenF1 source: per-session timing, telemetry and GPS from 2023.

Free tier: 3 requests/second, 30/minute; data for a session is free once the
session is over. We space requests 2.1 s apart.
"""

from __future__ import annotations

import datetime as dt
import urllib.parse

from .http import Client, NotFound, RateLimiter

BASE = "https://api.openf1.org/v1"
LIMITER = RateLimiter(min_interval=2.1)

# Small per-session tables, fetched once for the whole field.
SESSION_TABLES = [
    "drivers", "laps", "stints", "pit", "race_control", "weather",
    "team_radio", "position", "session_result", "starting_grid",
]


def parse_time(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


class OpenF1:
    def __init__(self, cache_dir, verbose=True):
        self.client = Client(cache_dir, LIMITER, "openf1", verbose)

    def _get(self, endpoint: str, ttl=None, **params) -> list:
        # "date>": "x" must become date>x, not date%3E=x
        parts = []
        for k, v in params.items():
            v = urllib.parse.quote(str(v), safe=":")
            parts.append(f"{k}{v}" if k.endswith((">", "<")) else f"{k}={v}")
        qs = "&".join(parts)
        try:
            rows = self.client.get(f"{BASE}/{endpoint}?{qs}", ttl)
        except NotFound:
            return []
        return rows if isinstance(rows, list) else []

    def sessions(self, year: int) -> list:
        return self._get("sessions", ttl=6 * 3600, year=year)

    def meetings(self, year: int) -> list:
        """Race weekends of a season, with the official name ("Miami Grand Prix")."""
        current = dt.date.today().year
        return self._get("meetings", ttl=None if year < current else 6 * 3600, year=year)

    def meeting_name(self, year: int, meeting_key: int) -> str | None:
        for m in self.meetings(year):
            if m.get("meeting_key") == meeting_key:
                return m.get("meeting_name")
        return None

    def session(self, key: int) -> dict:
        rows = self._get("sessions", session_key=key)
        if not rows:
            raise ValueError(f"unknown session {key}")
        return rows[0]

    def table(self, name: str, key: int) -> list:
        return self._get(name, session_key=key)

    @staticmethod
    def _window(start: str | None, end: str | None) -> dict:
        # OpenF1 filters use the operator inside the key: date>...&date<...
        return {"date>": start, "date<": end} if start and end else {}

    def car_data(self, key: int, driver: int, start: str | None = None, end: str | None = None) -> list:
        return self._get("car_data", session_key=key, driver_number=driver, **self._window(start, end))

    def location(self, key: int, driver: int, start: str | None = None, end: str | None = None) -> list:
        return self._get("location", session_key=key, driver_number=driver, **self._window(start, end))

    @staticmethod
    def is_finished(session: dict, margin_hours: float = 1.0) -> bool:
        """OpenF1 data is free once the session is over; wait a margin to be safe."""
        end = parse_time(session["date_end"])
        return dt.datetime.now(dt.timezone.utc) > end + dt.timedelta(hours=margin_hours)

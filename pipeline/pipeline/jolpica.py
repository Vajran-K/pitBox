"""Jolpica-F1 (Ergast-compatible) source: results and standings from 1950.

Limits: 4 requests/second burst, 500/hour sustained, 100 rows per page.
We space requests 7.5 s apart so long runs stay under the hourly cap.
"""

from __future__ import annotations

import datetime as dt

from .http import Client, NotFound, RateLimiter

BASE = "https://api.jolpi.ca/ergast/f1"
PAGE = 100
LIMITER = RateLimiter(min_interval=7.5)
CURRENT_TTL = 6 * 3600  # current-season data is refreshed every 6 h


class Jolpica:
    def __init__(self, cache_dir, verbose=True):
        self.client = Client(cache_dir, LIMITER, "jolpica", verbose)

    def _ttl(self, year: int | None):
        return CURRENT_TTL if year is None or year >= dt.date.today().year else None

    def _paged(self, path: str, table: str, items: str, year: int | None = None) -> list:
        out, offset = [], 0
        while True:
            try:
                d = self.client.get(f"{BASE}/{path}.json?limit={PAGE}&offset={offset}", self._ttl(year))
            except NotFound:
                return out
            mr = d["MRData"]
            out.extend(mr[table][items])
            offset += PAGE
            if offset >= int(mr["total"]):
                return out

    @staticmethod
    def _merge_races(races: list, key: str) -> list:
        """Pagination splits a race's rows across pages; merge them back by round."""
        merged: dict[tuple, dict] = {}
        for r in races:
            k = (r["season"], int(r["round"]))
            if k in merged:
                merged[k][key].extend(r.get(key, []))
            else:
                merged[k] = {**r, key: list(r.get(key, []))}
        return [merged[k] for k in sorted(merged)]

    # --- reference tables -------------------------------------------------
    def seasons(self):
        return [int(s["season"]) for s in self._paged("seasons", "SeasonTable", "Seasons")]

    def drivers(self):
        return self._paged("drivers", "DriverTable", "Drivers")

    def constructors(self):
        return self._paged("constructors", "ConstructorTable", "Constructors")

    def circuits(self):
        return self._paged("circuits", "CircuitTable", "Circuits")

    # --- per season ---------------------------------------------------------
    def races(self, year: int):
        return self._paged(f"{year}", "RaceTable", "Races", year)

    def results(self, year: int):
        return self._merge_races(self._paged(f"{year}/results", "RaceTable", "Races", year), "Results")

    def sprints(self, year: int):
        if year < 2021:
            return []
        return self._merge_races(self._paged(f"{year}/sprint", "RaceTable", "Races", year), "SprintResults")

    def driver_standings(self, year: int):
        lists = self._paged(f"{year}/driverStandings", "StandingsTable", "StandingsLists", year)
        return lists[0]["DriverStandings"] if lists else []

    def constructor_standings(self, year: int):
        if year < 1958:  # constructors' championship started in 1958
            return []
        lists = self._paged(f"{year}/constructorStandings", "StandingsTable", "StandingsLists", year)
        return lists[0]["ConstructorStandings"] if lists else []

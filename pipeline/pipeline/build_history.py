"""Turn Jolpica data into compact JSON exports for the frontend.

Outputs (under data/public/history/):
  drivers.json, constructors.json, circuits.json
  seasons/<year>.json        races with results, sprints, final standings
  careers.json               per-driver career totals
"""

from __future__ import annotations

from collections import defaultdict

from .jolpica import Jolpica
from .store import write_json


def _num(v, cast=int):
    try:
        return cast(v)
    except (TypeError, ValueError):
        return None


def _result_row(r: dict) -> dict:
    return {
        "pos": _num(r.get("position")),
        "posText": r.get("positionText"),
        "driver": r["Driver"]["driverId"],
        "team": r["Constructor"]["constructorId"],
        "grid": _num(r.get("grid")),
        "laps": _num(r.get("laps")),
        "status": r.get("status"),
        "points": _num(r.get("points"), float) or 0.0,
        "fastestLapRank": _num((r.get("FastestLap") or {}).get("rank")),
        "fastestLap": ((r.get("FastestLap") or {}).get("Time") or {}).get("time"),
    }


def build_reference(src: Jolpica, out) -> None:
    drivers = [{
        "id": d["driverId"], "code": d.get("code"), "number": d.get("permanentNumber"),
        "first": d["givenName"], "last": d["familyName"],
        "dob": d.get("dateOfBirth"), "nationality": d.get("nationality"),
    } for d in src.drivers()]
    teams = [{"id": c["constructorId"], "name": c["name"], "nationality": c.get("nationality")}
             for c in src.constructors()]
    circuits = [{
        "id": c["circuitId"], "name": c["circuitName"],
        "locality": c["Location"].get("locality"), "country": c["Location"].get("country"),
        "lat": _num(c["Location"].get("lat"), float), "lng": _num(c["Location"].get("long"), float),
    } for c in src.circuits()]
    write_json(out / "history/drivers.json", drivers)
    write_json(out / "history/constructors.json", teams)
    write_json(out / "history/circuits.json", circuits)
    print(f"reference: {len(drivers)} drivers, {len(teams)} constructors, {len(circuits)} circuits")


def build_season(src: Jolpica, year: int, out) -> dict:
    results = {int(r["round"]): r for r in src.results(year)}
    sprints = {int(r["round"]): r for r in src.sprints(year)}
    # Past seasons: race info comes with the results, saving a request.
    # Current season: fetch the calendar so future races are listed too.
    calendar = src.races(year) if year >= _current_year() else list(results.values())
    races = []
    for r in calendar:
        rnd = int(r["round"])
        races.append({
            "round": rnd, "name": r["raceName"], "date": r["date"],
            "circuit": r["Circuit"]["circuitId"],
            "results": [_result_row(x) for x in results.get(rnd, {}).get("Results", [])],
            "sprint": [_result_row(x) for x in sprints.get(rnd, {}).get("SprintResults", [])],
        })
    season = {
        "year": year,
        "races": races,
        "driverStandings": [{
            "pos": _num(s.get("position")), "driver": s["Driver"]["driverId"],
            "teams": [c["constructorId"] for c in s.get("Constructors", [])],
            "points": _num(s["points"], float), "wins": _num(s["wins"]),
        } for s in src.driver_standings(year)],
        "constructorStandings": [{
            "pos": _num(s.get("position")), "team": s["Constructor"]["constructorId"],
            "points": _num(s["points"], float), "wins": _num(s["wins"]),
        } for s in src.constructor_standings(year)],
    }
    write_json(out / f"history/seasons/{year}.json", season)
    done = sum(1 for r in races if r["results"])
    print(f"season {year}: {len(races)} races ({done} with results)")
    return season


def build_careers(seasons: list[dict], out) -> None:
    c = defaultdict(lambda: {"starts": 0, "wins": 0, "podiums": 0, "poles": 0, "points": 0.0,
                             "fastestLaps": 0, "titles": 0, "seasons": set(), "teams": set()})
    for s in seasons:
        for race in s["races"]:
            for r in race["results"]:
                d = c[r["driver"]]
                d["starts"] += 1
                d["wins"] += r["pos"] == 1
                d["podiums"] += r["pos"] is not None and r["pos"] <= 3
                d["poles"] += r["grid"] == 1  # grid 1 ~ pole (penalties make this approximate)
                d["fastestLaps"] += r["fastestLapRank"] == 1
                d["points"] += r["points"]
                d["seasons"].add(s["year"])
                d["teams"].add(r["team"])
            for r in race["sprint"]:
                c[r["driver"]]["points"] += r["points"]
        if s["driverStandings"] and s["year"] < _current_year():
            c[s["driverStandings"][0]["driver"]]["titles"] += 1
    careers = {k: {**v, "points": round(v["points"], 1), "seasons": sorted(v["seasons"]),
                   "teams": sorted(v["teams"])} for k, v in c.items()}
    write_json(out / "history/careers.json", careers)

    # One file per driver with every race they started, for head-to-head charts.
    races_by_driver = defaultdict(list)
    for s in seasons:
        for race in s["races"]:
            sprint_pts = {r["driver"]: r["points"] for r in race["sprint"]}
            for r in race["results"]:
                races_by_driver[r["driver"]].append({
                    "year": s["year"], "round": race["round"], "race": race["name"], "date": race["date"],
                    "pos": r["pos"], "posText": r["posText"], "grid": r["grid"], "team": r["team"],
                    "points": r["points"] + sprint_pts.get(r["driver"], 0.0), "status": r["status"],
                })
    for driver, rows in races_by_driver.items():
        write_json(out / f"history/drivers/{driver}.json", rows)
    print(f"careers: {len(careers)} drivers")


def _current_year():
    import datetime
    return datetime.date.today().year


def build(src: Jolpica, out, years: list[int], reference: bool = True, careers: bool = True) -> None:
    if reference:
        build_reference(src, out)
    seasons = [build_season(src, y, out) for y in years]
    if careers:
        build_careers(seasons, out)

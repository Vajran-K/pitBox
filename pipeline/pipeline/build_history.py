"""Turn Jolpica data into compact JSON exports for the frontend.

Outputs (under data/public/history/):
  drivers.json, constructors.json, circuits.json
  seasons/<year>.json        races with results, sprints, final standings
  careers.json               per-driver career totals
  summary.json               champions per season, every race's winner and pole, team totals
                             (what the chat's general F1 answers are computed from)
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


def build_summary(seasons: list[dict], out) -> None:
    """Small enough to load in one go for any question: every race's winner, pole and podium,
    each season's champions, and totals per team."""
    cur = _current_year()
    champions, races = [], []
    teams = defaultdict(lambda: {"wins": 0, "podiums": 0, "poles": 0, "titles": 0, "driverTitles": 0, "years": set()})
    for s in sorted(seasons, key=lambda x: x["year"]):
        y = s["year"]
        done = [r for r in s["races"] if r["results"]]
        for race in done:
            res = sorted((r for r in race["results"] if r["pos"]), key=lambda r: r["pos"])
            pole = next((r for r in race["results"] if r["grid"] == 1), None)
            races.append({"y": y, "r": race["round"], "name": race["name"], "circuit": race["circuit"], "date": race["date"],
                          "podium": [[r["driver"], r["team"]] for r in res[:3]],
                          "pole": pole["driver"] if pole else None})
            for r in race["results"]:
                t = teams[r["team"]]
                t["years"].add(y)
            for r in res[:3]:
                teams[r["team"]]["podiums"] += 1
            if res:
                teams[res[0]["team"]]["wins"] += 1
            if pole:
                teams[pole["team"]]["poles"] += 1
        ds, cs = s["driverStandings"], s["constructorStandings"]
        finished = y < cur
        if ds:
            champions.append({
                "year": y, "final": finished, "races": len(done), "scheduled": len(s["races"]),
                "drivers": [{"driver": x["driver"], "teams": x["teams"], "points": x["points"], "wins": x["wins"]} for x in ds[:3]],
                "constructors": [{"team": x["team"], "points": x["points"], "wins": x["wins"]} for x in cs[:3]],
            })
            if finished:
                for t in ds[0]["teams"][-1:]:
                    teams[t]["driverTitles"] += 1
                if cs:
                    teams[cs[0]["team"]]["titles"] += 1
    team_out = {k: {**v, "first": min(v["years"]), "last": max(v["years"]), "seasons": len(v["years"]), "years": None}
                for k, v in teams.items()}
    for v in team_out.values():
        del v["years"]
    write_json(out / "history/summary.json", {"champions": champions, "races": races, "teams": team_out})
    print(f"summary: {len(champions)} seasons, {len(races)} races, {len(team_out)} teams")


def _load_all_seasons(out) -> list[dict]:
    import json
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted((out / "history/seasons").glob("*.json"))]


def _current_year():
    import datetime
    return datetime.date.today().year


def build(src: Jolpica, out, years: list[int], reference: bool = True, careers: bool = True) -> None:
    if reference:
        build_reference(src, out)
    seasons = [build_season(src, y, out) for y in years]
    # careers and the summary cover every season, so they're rebuilt from all season files on
    # disk (the auto-update job only refetches the current season)
    everything = _load_all_seasons(out)
    build_careers(everything, out)
    build_summary(everything, out)

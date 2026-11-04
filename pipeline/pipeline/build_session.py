"""Turn one OpenF1 session into compact JSON exports for the frontend.

Outputs (under data/public/sessions/<key>/):
  meta.json                 session info, drivers, result, grid
  timing.json               laps, stints, pits, race control, weather, positions, radio
  track.json                track outline from one clean lap (for the map)
  telemetry/<num>.json.gz   columnar car data + GPS for one driver

All times are milliseconds from the session start ("t"), which keeps files
small and makes the replay clock trivial.
"""

from __future__ import annotations

from .openf1 import SESSION_TABLES, OpenF1, parse_time
from .store import write_json


class Clock:
    def __init__(self, start_iso: str):
        self.t0 = parse_time(start_iso)

    def ms(self, iso: str | None):
        return None if not iso else int((parse_time(iso) - self.t0).total_seconds() * 1000)


def _columnar(rows: list, clock: Clock, fields: dict) -> dict:
    rows = sorted(rows, key=lambda r: r["date"])
    out = {"t": [clock.ms(r["date"]) for r in rows]}
    for out_key, src_key in fields.items():
        out[out_key] = [r.get(src_key) for r in rows]
    return out


def build_track(laps: list, loc: dict, clock: Clock) -> dict | None:
    """Pick one clean, fast lap and return its GPS trace as the track outline."""
    clean = [l for l in laps if l.get("lap_duration") and not l.get("is_pit_out_lap") and l.get("date_start")]
    if not clean or not loc.get("t"):
        return None
    lap = min(clean, key=lambda l: l["lap_duration"])
    start = clock.ms(lap["date_start"])
    end = start + int(lap["lap_duration"] * 1000)
    pts = [(t - start, x, y) for t, x, y in zip(loc["t"], loc["x"], loc["y"]) if start <= t <= end and (x or y)]
    if len(pts) < 50:
        return None
    ts, xs, ys = [p[0] for p in pts], [p[1] for p in pts], [p[2] for p in pts]
    # t (ms into the lap) and the sector times let the replay place any car on this
    # reference lap by scaling its own sector progress, so cars slow for corners.
    return {"driver": lap["driver_number"], "lap": lap["lap_number"],
            "lapDuration": lap["lap_duration"],
            "sectors": [lap.get("duration_sector_1"), lap.get("duration_sector_2"), lap.get("duration_sector_3")],
            "bounds": [min(xs), min(ys), max(xs), max(ys)], "t": ts, "x": xs, "y": ys}


def _iso(dt_):
    return dt_.isoformat().replace("+00:00", "Z")


def build(src: OpenF1, key: int, out, telemetry: str = "fastest") -> dict:
    """telemetry: "fastest" (each driver's fastest lap only, ~2 small requests per driver),
    "full" (the whole session, ~10 MB per driver), or "none"."""
    s = src.session(key)
    if not src.is_finished(s):
        raise RuntimeError(f"session {key} is not finished yet (ends {s['date_end']}); its data is not free until then")
    clock = Clock(s["date_start"])
    tables = {name: src.table(name, key) for name in SESSION_TABLES}
    base = out / f"sessions/{key}"

    drivers = sorted({d["driver_number"]: d for d in tables["drivers"]}.values(), key=lambda d: d["driver_number"])
    meta = {
        "key": key, "meeting": s["meeting_key"], "year": s["year"],
        # country alone is ambiguous (Miami, Austin and Las Vegas are all "United States")
        "meetingName": src.meeting_name(s["year"], s["meeting_key"]),
        "name": s["session_name"], "type": s["session_type"],
        "country": s["country_name"], "circuit": s["circuit_short_name"], "location": s["location"],
        "start": s["date_start"], "end": s["date_end"], "gmtOffset": s.get("gmt_offset"),
        "drivers": [{
            "number": d["driver_number"], "code": d.get("name_acronym"), "name": d.get("full_name"),
            "team": d.get("team_name"), "colour": d.get("team_colour"), "headshot": d.get("headshot_url"),
        } for d in drivers],
        "result": [{k: r.get(k) for k in ("position", "driver_number", "number_of_laps", "dnf", "dns", "dsq", "duration", "gap_to_leader")}
                   for r in sorted(tables["session_result"], key=lambda r: (r.get("position") is None, r.get("position") or 0))],
        "grid": [{"position": g.get("position"), "driver_number": g["driver_number"], "lap_duration": g.get("lap_duration")}
                 for g in sorted(tables["starting_grid"], key=lambda g: g.get("position") or 99)],
        "hasTelemetry": telemetry != "none",
        "telemetry": telemetry,
    }
    if not meta["grid"] and tables["position"]:
        # starting_grid is often empty; the first position update per driver is the grid order
        first = {}
        for x in sorted(tables["position"], key=lambda x: x["date"]):
            first.setdefault(x["driver_number"], x["position"])
        meta["grid"] = [{"position": p, "driver_number": d, "lap_duration": None}
                        for d, p in sorted(first.items(), key=lambda kv: kv[1])]
        meta["gridSource"] = "first position update"

    laps = tables["laps"]
    timing = {
        "laps": [{
            "d": l["driver_number"], "lap": l["lap_number"], "t": clock.ms(l.get("date_start")),
            "dur": l.get("lap_duration"), "s1": l.get("duration_sector_1"), "s2": l.get("duration_sector_2"),
            "s3": l.get("duration_sector_3"), "pitOut": l.get("is_pit_out_lap"), "st": l.get("st_speed"),
        } for l in sorted(laps, key=lambda l: (l["driver_number"], l["lap_number"]))],
        "stints": [{"d": x["driver_number"], "n": x["stint_number"], "from": x.get("lap_start"), "to": x.get("lap_end"),
                    "compound": x.get("compound"), "age": x.get("tyre_age_at_start")} for x in tables["stints"]],
        "pits": [{"d": x["driver_number"], "lap": x.get("lap_number"), "t": clock.ms(x.get("date")),
                  "dur": x.get("pit_duration")} for x in tables["pit"]],
        "raceControl": [{"t": clock.ms(x.get("date")), "lap": x.get("lap_number"), "cat": x.get("category"),
                         "flag": x.get("flag"), "d": x.get("driver_number"), "msg": x.get("message")}
                        for x in sorted(tables["race_control"], key=lambda x: x["date"])],
        "weather": _columnar(tables["weather"], clock, {"air": "air_temperature", "track": "track_temperature",
                                                        "humidity": "humidity", "rain": "rainfall", "wind": "wind_speed"}),
        "positions": [{"t": clock.ms(x["date"]), "d": x["driver_number"], "p": x["position"]}
                      for x in sorted(tables["position"], key=lambda x: x["date"])],
        "radio": [{"t": clock.ms(x["date"]), "d": x["driver_number"], "url": x["recording_url"]}
                  for x in sorted(tables["team_radio"], key=lambda x: x["date"])],
    }
    write_json(base / "meta.json", meta)
    write_json(base / "timing.json", timing)

    if telemetry != "none":
        import datetime as dt
        track = None
        for d in meta["drivers"]:
            n = d["number"]
            start = end = None
            if telemetry == "fastest":
                clean = [l for l in laps if l["driver_number"] == n and l.get("lap_duration")
                         and l.get("date_start") and not l.get("is_pit_out_lap")]
                if not clean:
                    continue
                best = min(clean, key=lambda l: l["lap_duration"])
                t0 = parse_time(best["date_start"])
                start = _iso(t0 - dt.timedelta(seconds=2))
                end = _iso(t0 + dt.timedelta(seconds=best["lap_duration"] + 2))
            car = _columnar(src.car_data(key, n, start, end), clock, {"speed": "speed", "throttle": "throttle", "brake": "brake",
                                                                      "gear": "n_gear", "rpm": "rpm", "drs": "drs"})
            loc = _columnar(src.location(key, n, start, end), clock, {"x": "x", "y": "y"})
            write_json(base / f"telemetry/{n}.json.gz", {"driver": n, "car": car, "pos": loc})
            if track is None:
                track = build_track([l for l in laps if l["driver_number"] == n], loc, clock)
        if track:
            write_json(base / "track.json", track)

    print(f"session {key}: {s['year']} {meta['meetingName'] or s['country_name']} {s['session_name']} - "
          f"{len(drivers)} drivers, {len(laps)} laps, {len(timing['radio'])} radio clips"
          + (f", telemetry ({telemetry}) saved" if telemetry != "none" else ""))
    return meta

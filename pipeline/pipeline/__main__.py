"""PitBox pipeline CLI.

  python -m pipeline history                     all seasons 1950 -> now (~1 h first run, rate limited)
  python -m pipeline history --from 2020 --to 2024
  python -m pipeline session 11396               one OpenF1 session (2023+), fastest-lap telemetry
  python -m pipeline session 11396 --telemetry full   whole-session telemetry (~200 MB download)
  python -m pipeline session 11396 --telemetry none
  python -m pipeline sessions --year 2026 --type Race   every finished race of a season
  python -m pipeline index                       rebuild data/public/index.json

Data lives in ../data (override with PITBOX_DATA). raw/ is the HTTP cache,
public/ is what the frontend reads.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
from pathlib import Path

from . import build_history, build_session
from .jolpica import Jolpica
from .openf1 import OpenF1
from .store import read_json, write_json

DATA = Path(os.environ.get("PITBOX_DATA", Path(__file__).resolve().parents[2] / "data"))
RAW, PUBLIC = DATA / "raw", DATA / "public"


def _upcoming() -> list:
    """Next sessions on the calendar, for the Live page. Uses the cached OpenF1 schedule (refreshed every 6 h)."""
    try:
        src = OpenF1(RAW, verbose=False)
        year = dt.date.today().year
        now = dt.datetime.now(dt.timezone.utc)
        names = {m["meeting_key"]: m.get("meeting_name") for m in src.meetings(year)}
        out = []
        for s in src.sessions(year):
            start = dt.datetime.fromisoformat(s["date_start"].replace("Z", "+00:00"))
            if start > now - dt.timedelta(hours=3) and not s.get("is_cancelled"):
                out.append({"key": s["session_key"], "name": s["session_name"], "type": s["session_type"],
                            "country": s["country_name"], "meetingName": names.get(s["meeting_key"]), "start": s["date_start"]})
        return sorted(out, key=lambda s: s["start"])[:12]
    except Exception as e:  # the schedule is a nice-to-have; never fail the export over it
        print(f"  (couldn't load the upcoming schedule: {e})")
        return []


def build_index() -> None:
    seasons = sorted(int(p.stem) for p in (PUBLIC / "history/seasons").glob("*.json"))
    sessions = []
    for p in sorted((PUBLIC / "sessions").glob("*/meta.json")):
        m = read_json(p)
        brief = {k: m[k] for k in ("key", "year", "name", "type", "country", "circuit", "start", "hasTelemetry")}
        brief["meetingName"] = m.get("meetingName")
        brief["location"] = m.get("location")
        sessions.append(brief)
    sessions.sort(key=lambda s: s["start"])
    upcoming = _upcoming()
    write_json(PUBLIC / "index.json", {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "historySeasons": seasons, "sessions": sessions, "upcoming": upcoming,
        "sources": {"history": "Jolpica-F1 (api.jolpi.ca)", "sessions": "OpenF1 (openf1.org)"},
    })
    print(f"index: {len(seasons)} seasons, {len(sessions)} sessions")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)
    h = sub.add_parser("history")
    h.add_argument("--from", dest="start", type=int, default=1950)
    h.add_argument("--to", dest="end", type=int, default=dt.date.today().year)
    h.add_argument("--no-reference", action="store_true")
    tel = dict(choices=["fastest", "full", "none"], default="fastest")
    s = sub.add_parser("session")
    s.add_argument("key", type=int)
    s.add_argument("--telemetry", **tel)
    ss = sub.add_parser("sessions")
    ss.add_argument("--year", type=int, required=True)
    ss.add_argument("--type", default="Race", help="Race, Qualifying, Practice, Sprint... or 'all'")
    ss.add_argument("--telemetry", **tel)
    ss.add_argument("--skip-existing", action="store_true", help="skip sessions already exported")
    sub.add_parser("index")
    a = p.parse_args(argv)

    if a.cmd == "history":
        src = Jolpica(RAW)
        build_history.build(src, PUBLIC, list(range(a.start, a.end + 1)), reference=not a.no_reference,
                            careers=(a.start == 1950))
        print(f"jolpica requests: {src.client.misses} fetched, {src.client.hits} from cache")
    elif a.cmd == "session":
        src = OpenF1(RAW)
        build_session.build(src, a.key, PUBLIC, telemetry=a.telemetry)
    elif a.cmd == "sessions":
        src = OpenF1(RAW)
        todo = [x for x in src.sessions(a.year)
                if (a.type == "all" or x["session_type"] == a.type or x["session_name"] == a.type)
                and not x.get("is_cancelled") and src.is_finished(x)
                and not (a.skip_existing and (PUBLIC / f"sessions/{x['session_key']}/meta.json").exists())]
        print(f"{len(todo)} finished sessions to build")
        for x in todo:
            try:
                build_session.build(src, x["session_key"], PUBLIC, telemetry=a.telemetry)
            except Exception as e:  # keep going; one bad session shouldn't stop the batch
                print(f"  session {x['session_key']} failed: {e}", file=sys.stderr)
    build_index()
    return 0


if __name__ == "__main__":
    sys.exit(main())

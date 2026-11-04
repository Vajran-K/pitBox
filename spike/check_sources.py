"""PitBox spike: check that the free F1 data sources are reachable and usable.

Checks:
  1. Jolpica-F1 (historical results, 1950 onward)
  2. F1 static live-timing archive (timing + telemetry, 2018 onward, ~30 min after a session)
  3. FastF1 (loads a past session's laps and telemetry) -- optional, skipped if not installed

Run:  python check_sources.py
Throwaway code: this only proves the data is there before we design PitBox's data layer.
"""

import json
import sys
import time
import urllib.request

UA = {"User-Agent": "PitBox-spike/0.1 (personal project)"}


def get_json(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    ms = (time.perf_counter() - t0) * 1000
    # F1 static files start with a UTF-8 BOM
    return json.loads(raw.decode("utf-8-sig")), ms, len(raw)


def check_jolpica():
    print("\n[1] Jolpica-F1")
    data, ms, size = get_json("https://api.jolpi.ca/ergast/f1/1950/1/results.json?limit=3")
    race = data["MRData"]["RaceTable"]["Races"][0]
    winner = race["Results"][0]["Driver"]
    print(f"  OK {ms:.0f} ms, {size} bytes")
    print(f"  Oldest race: {race['season']} {race['raceName']} - winner {winner['givenName']} {winner['familyName']}")

    data, ms, _ = get_json("https://api.jolpi.ca/ergast/f1/2011/1/pitstops.json?limit=3")
    races = data["MRData"]["RaceTable"]["Races"]
    stops = races[0].get("PitStops", []) if races else []
    print(f"  Pit stops 2011 R1: {'available' if stops else 'MISSING'} ({ms:.0f} ms)")

    data, ms, _ = get_json("https://api.jolpi.ca/ergast/f1/1996/1/laps.json?limit=3")
    races = data["MRData"]["RaceTable"]["Races"]
    print(f"  Lap times 1996 R1: {'available' if races and races[0].get('Laps') else 'MISSING'} ({ms:.0f} ms)")


def check_static_archive():
    print("\n[2] F1 static live-timing archive")
    base = "https://livetiming.formula1.com/static/"
    index, ms, size = get_json(base + "2024/Index.json")
    meetings = index.get("Meetings", [])
    print(f"  OK {ms:.0f} ms, {len(meetings)} meetings in 2024")
    meeting = meetings[0]
    race = next((s for s in meeting["Sessions"] if s.get("Type") == "Race"), meeting["Sessions"][-1])
    path = race["Path"]
    print(f"  Session: {meeting['Name']} / {race['Name']} -> {path}")

    feeds, ms, _ = get_json(base + path + "Index.json")
    names = sorted(feeds.get("Feeds", {}).keys())
    print(f"  {len(names)} feeds published ({ms:.0f} ms)")
    for wanted in ["TimingData", "CarData.z", "Position.z", "RaceControlMessages", "TyreStintSeries", "WeatherData"]:
        print(f"    {wanted:22s} {'yes' if wanted in names else 'NO'}")


def check_openf1():
    print("\n[2b] OpenF1 (historical, free; replaces the static archive)")
    base = "https://api.openf1.org/v1/"
    races, ms, _ = get_json(base + "sessions?year=2026&session_name=Race&date_end%3C" + time.strftime("%Y-%m-%d"))
    s = races[-1]
    key = s["session_key"]
    print(f"  OK {ms:.0f} ms - latest finished race: {s['country_name']} {s['date_start'][:10]} (session {key})")
    for ep in ["laps", "stints", "pit", "race_control", "weather", "position", "car_data", "location"]:
        q = f"{ep}?session_key={key}" + ("&driver_number=1" if ep in ("car_data", "location", "laps") else "")
        rows, ms, size = get_json(base + q, timeout=60)
        print(f"    {ep:13s} {len(rows):>7} rows  {size/1024:>8.0f} KB  {ms:>5.0f} ms")
        time.sleep(2.1)  # free tier: 30 requests/minute


def check_fastf1():
    print("\n[3] FastF1")
    try:
        import fastf1
    except ImportError:
        print("  SKIPPED - not installed (pip install fastf1)")
        return
    import os
    os.makedirs("ff1_cache", exist_ok=True)
    fastf1.Cache.enable_cache("ff1_cache")
    t0 = time.perf_counter()
    s = fastf1.get_session(2024, "Monza", "Q")
    s.load(laps=True, telemetry=True, weather=False, messages=False)
    print(f"  Loaded {s.event['EventName']} Q in {time.perf_counter() - t0:.1f}s (first run downloads)")
    lap = s.laps.pick_fastest()
    tel = lap.get_car_data().add_distance()
    print(f"  Pole lap: {lap['Driver']} {lap['LapTime']}")
    print(f"  Telemetry samples: {len(tel)}, columns: {list(tel.columns)[:8]}")
    print(f"  Top speed on that lap: {tel['Speed'].max()} km/h")


if __name__ == "__main__":
    ok = True
    # check_static_archive and check_fastf1 are expected to fail: F1 put the
    # static archive behind an F1 TV login around 15 Oct 2026 (FastF1 issue #978).
    for fn in (check_jolpica, check_openf1, check_static_archive):
        try:
            fn()
        except Exception as e:  # spike: report and keep going
            ok = False
            print(f"  FAILED: {type(e).__name__}: {e}")
    print("\nDone." if ok else "\nDone, with failures above.")
    sys.exit(0 if ok else 1)

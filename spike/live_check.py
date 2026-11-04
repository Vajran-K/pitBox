"""PitBox spike: does F1's live timing feed send data WITHOUT an F1 TV login?

Connects to F1's SignalR Core feed, subscribes to the timing topics, and records
whatever arrives for a few minutes. Run it during a live session (practice is fine).

    pip install websockets
    python live_check.py                       # starts now, records 15 min
    python live_check.py --wait-until 2026-10-30T18:25:00Z --minutes 15

Output: live_capture.jsonl (raw messages) and a summary of which topics sent data.
Throwaway spike code - the real client gets written in phase 6.
"""

import argparse
import asyncio
import datetime as dt
import json
import sys
import urllib.request
from collections import Counter

try:
    import websockets
except ImportError:
    sys.exit("Install first:  pip install websockets")

BASE = "livetiming.formula1.com/signalrcore"
SEP = "\x1e"  # SignalR record separator

TOPICS = [
    "Heartbeat", "SessionInfo", "SessionStatus", "TrackStatus", "LapCount",
    "TimingData", "TimingAppData", "TimingStats", "DriverList", "TopThree",
    "RaceControlMessages", "WeatherData", "TeamRadio", "ExtrapolatedClock",
    "PitLaneTimeCollection", "TyreStintSeries",
    # These two are expected to need F1 TV - recorded to confirm:
    "CarData.z", "Position.z",
]


def negotiate():
    req = urllib.request.Request(
        f"https://{BASE}/negotiate?negotiateVersion=1", data=b"", method="POST",
        headers={"User-Agent": "PitBox-spike/0.1"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        cookie = "; ".join(c.split(";")[0] for c in r.headers.get_all("Set-Cookie") or [])
        return json.loads(r.read()), cookie


async def run(minutes, out_path):
    neg, cookie = negotiate()
    token = neg.get("connectionToken") or neg["connectionId"]
    url = f"wss://{BASE}?id={token}"
    headers = {"User-Agent": "PitBox-spike/0.1"}
    if cookie:
        headers["Cookie"] = cookie
    print(f"negotiate OK, connecting...")

    counts, errors = Counter(), []
    try:
        ws_ctx = websockets.connect(url, additional_headers=headers, max_size=None)
    except TypeError:  # older websockets versions
        ws_ctx = websockets.connect(url, extra_headers=headers, max_size=None)

    async with ws_ctx as ws:
        await ws.send(json.dumps({"protocol": "json", "version": 1}) + SEP)
        await ws.send(json.dumps({"type": 1, "invocationId": "0", "target": "Subscribe",
                                  "arguments": [TOPICS]}) + SEP)
        end = asyncio.get_event_loop().time() + minutes * 60
        with open(out_path, "w", encoding="utf-8") as f:
            while (left := end - asyncio.get_event_loop().time()) > 0:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=min(left, 30))
                except asyncio.TimeoutError:
                    continue
                for part in filter(None, raw.split(SEP)):
                    msg = json.loads(part)
                    f.write(json.dumps({"t": dt.datetime.utcnow().isoformat(), "m": msg}) + "\n")
                    if msg.get("type") == 3:  # reply to Subscribe: initial state per topic
                        if msg.get("error"):
                            errors.append(msg["error"])
                        for topic in (msg.get("result") or {}):
                            counts[topic + " (initial)"] += 1
                    elif msg.get("type") == 1 and msg.get("target") == "feed":
                        counts[msg["arguments"][0]] += 1
                    elif msg.get("type") == 7:
                        errors.append(f"server closed: {msg.get('error')}")
                print(f"\r{sum(counts.values())} messages, {len(counts)} topics", end="")

    print("\n\n=== RESULT ===")
    if errors:
        print("Errors:", *errors, sep="\n  ")
    for t in TOPICS:
        n = counts.get(t, 0) + counts.get(t + " (initial)", 0)
        print(f"  {t:24s} {'YES' if n else 'no '}  {n}")
    free = [t for t in TOPICS if counts.get(t) and not t.endswith(".z")]
    print(f"\nLive topics with updates and no login: {len(free)}")
    print(f"Raw messages saved to {out_path}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--wait-until", help="UTC start time, e.g. 2026-10-30T18:25:00Z")
    p.add_argument("--minutes", type=float, default=15)
    p.add_argument("--out", default="live_capture.jsonl")
    a = p.parse_args()
    if a.wait_until:
        start = dt.datetime.fromisoformat(a.wait_until.replace("Z", "+00:00"))
        wait = (start - dt.datetime.now(dt.timezone.utc)).total_seconds()
        if wait > 0:
            print(f"Waiting {wait/60:.0f} min until {start.isoformat()} ...")
            import time
            time.sleep(wait)
    asyncio.run(run(a.minutes, a.out))


if __name__ == "__main__":
    main()

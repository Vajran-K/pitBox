# PitBox data pipeline

Fetches F1 data from free sources, caches every response, and writes compact
JSON for the frontend. Standard library only — no installs needed.

| Source | Years | Used for | Limit (we stay under it) |
|---|---|---|---|
| Jolpica-F1 | 1950 → | results, standings, drivers, teams, circuits | 500 req/hour → 1 request / 7.5 s |
| OpenF1 | 2023 → | laps, stints, pits, race control, weather, positions, radio, telemetry, GPS | 30 req/min → 1 request / 2.1 s |

## Usage (from this folder)

```
python -m pipeline session 11396          # one session (2026 US GP race) ~2 min
python -m pipeline sessions --year 2026 --skip-existing   # every finished 2026 race
python -m pipeline history                # 1950 → now, ~1 hour the first time
python -m unittest discover -s tests      # offline tests
```

Re-runs are fast: responses are cached in `../data/raw/`. Current-season
Jolpica data refreshes every 6 hours; everything else is cached permanently.

## Output (`../data/public/`)

```
index.json                         seasons + sessions available
history/drivers.json, constructors.json, circuits.json, careers.json
history/seasons/<year>.json        races, results, sprints, final standings
sessions/<key>/meta.json           session, drivers, result, grid
sessions/<key>/timing.json         laps, stints, pits, race control, weather, positions, radio
sessions/<key>/track.json          track outline (GPS of one clean lap)
sessions/<key>/telemetry/<n>.json.gz  car data + GPS for driver n, columnar
```

Times inside a session are milliseconds from session start (`t`).

Telemetry defaults to each driver's fastest lap (`--telemetry fastest`), which is
what the head-to-head view needs and costs ~2 small requests per driver.
`--telemetry full` downloads the whole session (~200 MB per race) — use it sparingly,
OpenF1 is a free community service.

## Known limits
- Telemetry and GPS exist only from 2023 (OpenF1). F1's own archive needs an F1 TV login since Oct 2026.
- `careers.json` poles are approximated by grid position 1.
- Season standings are the final table only; progressions are computed from results.

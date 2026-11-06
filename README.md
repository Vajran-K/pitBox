# PitBox

F1 race data and 75 years of history, explored together. Personal project; free data only.
https://pitbox-6he.pages.dev
```
pipeline/   Python, standard library only: fetch + cache + export JSON  (see pipeline/README.md)
web/        React + Vite frontend that reads data/public/
rooms/      Cloudflare Worker for watch rooms (one Durable Object per room)
data/       generated (raw HTTP cache + public exports), not committed
spike/      throwaway source checks
PLAN.md     decisions and build order
```

## Run it

```
cd pipeline
python -m pipeline history                      # 1950 → now (first run ~1 h, then cached)
python -m pipeline sessions --year 2026 --skip-existing
cd ..
dev.bat                                         # starts the website and the rooms server
```
Then open http://localhost:5173. (Or run `npm run dev` in `rooms/` and in `web/` yourself.)

Or double-click `run_overnight.bat` to export every race and qualifying session since 2023 (`export_qualifying.bat` does just this season's qualifying).

Double-click `eval_ai.bat` to check the local model on questions with known answers (accuracy, speed, and whether the recap adds anything not in its fact sheet). Report: `data/ai_eval.txt`.

## Pages
- **Home** — the race weekend that's on (or next) with its schedule, the last race's podium, and a tile for every part of the site.
- **Live** — F1 live timing during sessions (timing tower, flags, clock, race control, team radio with transcripts), relayed by the rooms worker.
- **Races** — every exported race (and qualifying replay) by season.
- **Race** — lap chart with safety-car periods, classification with places gained and fastest lap,
  tyre strategy, fastest-lap head to head (mini-sector track map + speed/gap/throttle/brake), team radio.
  Qualifying sessions show Q1/Q2/Q3 times.
- **Seasons** — title-fight points chart and standings for every year since 1950.
- **Compare drivers** — career totals, wins by career start, and how they fared racing each other.
- **Replay** — every car on the track map, timing tower at sector timing points, tyres, flags, race control and radio.
  Qualifying replays show a Q1/Q2/Q3 timing board with the drop zone and eliminations (deleted laps don't count).
- **Watch rooms** — share a code and watch together: a live session (race, sprint or qualifying: live timing tower, chat,
  race control, radio; no map, since live positions need F1 TV) or a replay (shared clock, map). Chat, react, and call
  the result (podium, fastest lap, safety car; pole and top three for qualifying).
- **Team radio transcripts** — Whisper runs in the browser (free, on-device; about 250 MB downloaded once). Clips come
  through the rooms worker because F1's file host doesn't allow browsers to read them.
- **Ask PitBox** — a chat on every page that answers anything about F1. Questions about the race on screen become charts and answers computed from its timing data, and the AI's wording is checked against those numbers. Other questions (any season, Grand Prix, driver, team or record since 1950, rules, history) are answered by the AI with PitBox's own computed facts from `history/summary.json` and `careers.json` given to it; the chat shows which facts it used and says when an answer is the model's own knowledge. Uses a local Ollama model if one is running (`ollama pull qwen2.5:7b`), Cloudflare Workers AI when deployed, otherwise a built-in reader.

## Licence
The code is under the [MIT License](LICENSE). The race data in `data/public` comes from
[OpenF1](https://openf1.org) and [Jolpica-F1](https://github.com/jolpica/jolpica-f1) and stays under their terms.
PitBox isn't affiliated with Formula 1; F1 names and marks belong to their owners.

# PitBox — project plan

F1 stats visualizer with shared watch rooms. Free tools only, no paid APIs or hosting.

## Decisions so far
- Sport: F1 (switched from football; replaces MatchDay).
- Name: PitBox.
- Data sources (all free, no keys):
  - **Jolpica-F1** — historical results, standings, drivers, constructors from 1950.
  - **OpenF1 (historical, free)** — laps, stints, pits, race control, weather, positions, car telemetry and GPS from 2023. Limit: 30 requests/minute, so the pipeline caches everything.
  - ~~FastF1 / F1 static archive~~ — dropped: F1 put `livetiming.formula1.com/static` behind an F1 TV login around 15 Oct 2026 (spike got HTTP 401; FastF1 issue #978).
  - **F1 live SignalR feed** — live timing (positions, gaps, laps, tyres, weather, race control) with no login. Live car telemetry/GPS needs F1 TV, so it's out.
- Live client written from scratch (Pitwall's MIT code used only as a protocol reference).
- Replay-first; live timing is added once the core works.
- DraftRoom (fantasy) left out of v1.
- Real-time rooms: Cloudflare Workers + Durable Objects.

## Two data tiers
| Tier | Years | Powers |
|---|---|---|
| History (Jolpica) | 1950 → | career comparisons, all-time head-to-heads, season progressions, eras |
| Telemetry (OpenF1) | 2023 → | speed traces, race traces, tyre strategy, track map replay |

Pre-2023 sessions hide telemetry features instead of showing empty charts.

## Architecture (draft)
```
Python pipeline (offline, cron/manual)
  Jolpica  ─┐
  OpenF1   ─┼─> clean + precompute ─> static JSON/Parquet ─> Cloudflare Pages (React/Vite)
            │
Live ingest (FastAPI, optional)
  F1 SignalR ─> merge deltas ─> push to rooms
                                     │
Cloudflare Worker + Durable Object per room: chat, reactions, predictions, shared replay clock
```
All sources sit behind one adapter interface so a broken endpoint only breaks the adapter.
The app falls back to clearly labelled sample data when a source is down.

## Build order
0. **Spike** — done 2026-10-30: Jolpica OK; OpenF1 OK incl. the 25 Oct 2026 US GP; static archive/FastF1 blocked (401).
1. Data pipeline — done 2026-10-30: Jolpica 1950→2026 (474 requests, cached), OpenF1 sessions with fastest-lap telemetry.
2. Stats explorer — done 2026-10-30 (v1): home, race page (lap chart, classification, tyre strategy, mini-sector map + telemetry, team radio), seasons, driver comparison.
3. Replay page — done 2026-10-31 (v1): track map (cars placed on a reference GPS lap by their own sector times), timing tower ordered and gapped at sector timing points, tyres, pit status, SC/VSC/red flags, race control and radio feed, 1×/4×/16×/64×, keyboard controls.
4. Watch rooms — done 2026-10-31 (v1): Cloudflare Worker + one Durable Object per room (rooms/); shared replay clock (server anchor + NTP-style offset), chat tagged with the lap, reactions, predictions locked at the start and scored at the flag; create/join pages and invite links. Runs locally with wrangler dev; deploying needs a free Cloudflare account.
5. AI layer — done 2026-10-31 (v1): Ask about this race (model writes a strict JSON query via Ollama structured outputs; PitBox computes every number; rule-based reader as fallback when no model runs) and race recaps written only from a computed fact sheet shown alongside. Local Ollama via the Vite proxy; Workers AI to be added at deployment.
6. Live timing — done 2026-10-31 (v1): Live Durable Object relays F1's SignalR Core feed (no-login topics) only while someone watches; shared merge module tested against the real Mexico FP1 capture; Live page with tower (gaps, intervals, last/best, purple/green sectors, tyres, pit flags), track status, clock, weather, race control, team radio, upcoming schedule. Verified against the real feed from the laptop (Mexico FP2 final state).
7. Deploy — next: Cloudflare Pages (site + data) and Workers (rooms, live relay); Vite upgrade clears the dev-server audit warnings.

## Notes
- 2026-11-04: deployment. Rooms worker gets CORS and a Workers AI endpoint (llama-3.1-8b, JSON mode; only in rooms/wrangler.deploy.toml so local dev needs no login); web build copies data into dist and drops the unused 27 MB ORT wasm (loaded from jsdelivr at run time); deploy.mjs/deploy.bat deploy both. Auto-update: GitHub Actions (tools/github-update.yml -> .github/workflows/update.yml) every 4 h Fri-Mon + Wed, skips while OpenF1 is live-locked, exports new races/qualifying with --skip-existing, commits data/public (now kept in git) and redeploys only on change; pushes to main redeploy.
- 2026-11-03: home reduced to the current/next weekend (schedule from `/api/schedule`, OpenF1 cached in the Live DO so it survives OpenF1's live lock), last race and navigation tiles; race list moved to /races. Live watch rooms (kind "live": live tower + chat + picks locked at the scheduled start; the first browser to see the final classification saves it to the room; no map). Qualifying: exported with `--type Qualifying`, replay board (parts from chequered flags, deleted laps from race control, eliminations from the official result, no-spoiler order before times), pole/P2/P3 picks. Team radio transcripts: Whisper base.en via transformers.js 4.3.1 in a Web Worker; clips via `/api/radio` (F1's static host has no CORS). Note: from this cloud sandbox Node/workerd get 403 from F1's CloudFront (curl/Python fine); on the laptop it should work, check on Cloudflare at deploy.
- Race chat (2026-10-31): drawer on race pages with follow-ups; model writes the query, PitBox computes, model rewords the computed facts, reply checked against them (falls back to PitBox's own summary). 19 tests; phone overflow fixed on race page (results table, track map).
- AI check (`eval_ai.bat`, qwen2.5:7b, 82% on GPU): queries 14/14 at ~3.3 s each (from 11/14 at first; fixes: codes in the prompt, empty list for "everyone", multi-word name lookup). Built-in reader 14/14. Recap went from 3 false claims ("first win of the season", "led until the end", "a minute behind") to none: lap counts and gaps precomputed in the fact sheet, sentences cite numbered facts, each checked (`checkRecap`), one rewrite, then dropped. Recap takes ~35 s.
- Dev server: `web/vite.config.ts` filters Vite's harmless `ws proxy socket error` (ECONNABORTED/ECONNRESET/EPIPE, from a live socket closing on reload); other proxy errors still log. Checked: 19 logged without the filter, 0 with it, real ECONNREFUSED still shown.

## Open
- Jolpica rate limits: check before the bulk fetch.
- LLM: local Ollama now; at deployment, Cloudflare Workers AI free tier behind the same chat() function.

- 2026-11-04: transcripts upgraded from whisper-base.en to whisper-small.en (q8, wasm). Tested on 10 real Mexico City clips: base.en missed words and returned "the" for one clip; small.en got most; large-v3-turbo is better still but ~700 MB and 4x slower, so not shipped. Clips are level-normalised before decoding; looping output is collapsed.

- 2026-11-06: Cloudflare is retiring llama-3.1-8b-instruct-fp8 and qwen3-30b-a3b-fp8 on 20 Nov. AI model list in rooms/src/index.ts is now gemma-4-26b-a4b-it, qwen3.8-27b, mistral-small-3.1, llama-3.3-70b (falls through on failure). Transcription: whisper-small.en in the browser (base.en was too error-prone on radio).

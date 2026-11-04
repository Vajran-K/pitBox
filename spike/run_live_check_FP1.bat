@echo off
REM Mexico FP1 starts 2026-10-30 18:30 UTC (12:00 am IST). Starts recording 5 min early, records 20 min.
cd /d "%~dp0"
python -m pip install --quiet websockets
python live_check.py --wait-until 2026-10-30T18:25:00Z --minutes 20 --out live_capture_FP1.jsonl > live_check_FP1_result.txt 2>&1

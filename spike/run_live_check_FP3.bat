@echo off
REM Mexico FP3 starts 2026-10-31 17:30 UTC (11:00 pm IST Saturday). Starts recording 5 min early, records 20 min.
cd /d "%~dp0"
python -m pip install --quiet websockets
python live_check.py --wait-until 2026-10-31T17:25:00Z --minutes 20 --out live_capture_FP3.jsonl > live_check_FP3_result.txt 2>&1

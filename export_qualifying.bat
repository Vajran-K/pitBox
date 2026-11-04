@echo off
REM Exports this season's qualifying sessions (about 2 minutes each, once). Then they appear in Races and Watch rooms.
cd /d "%~dp0pipeline"
python -u -m pipeline sessions --year 2026 --type Qualifying --skip-existing
pause

@echo off
REM PitBox overnight job. Leave the laptop plugged in with "close lid: do nothing".
REM Exports every race and qualifying session since 2023 from OpenF1 (about 2 minutes per new race; already-downloaded races rebuild from cache in seconds).
REM OpenF1 locks its free API while an F1 session is live; the pipeline waits and resumes by itself.
REM Progress goes to data\overnight.log. Safe to stop and re-run: everything is cached.
cd /d "%~dp0"
if not exist data mkdir data
REM The FP1 live check only runs if it hasn't already produced a result.
if not exist spike\live_check_FP1_result.txt start "PitBox live check" /min cmd /c spike\run_live_check_FP1.bat
cd pipeline
echo ==== started %date% %time% ==== >> ..\data\overnight.log
for %%Y in (2026 2025 2024 2023) do (
  echo ==== %%Y ==== >> ..\data\overnight.log
  python -u -m pipeline sessions --year %%Y --type Race >> ..\data\overnight.log 2>&1
  python -u -m pipeline sessions --year %%Y --type Qualifying --skip-existing >> ..\data\overnight.log 2>&1
)
echo ==== done %date% %time% ==== >> ..\data\overnight.log

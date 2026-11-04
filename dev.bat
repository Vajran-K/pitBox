@echo off
REM Starts the PitBox website and the watch-rooms server in two windows.
cd /d "%~dp0"
if not exist rooms\node_modules (cd rooms && call npm install && cd ..)
if not exist web\node_modules\@huggingface\transformers (cd web && call npm install && cd ..)
start "PitBox rooms server" cmd /k "cd rooms && npm run dev"
start "PitBox website" cmd /k "cd web && npm run dev"
echo Open http://localhost:5173 once both windows say they're ready.

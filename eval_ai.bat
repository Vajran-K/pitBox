@echo off
rem Checks the AI layer against the local Ollama model. Report: data\ai_eval.txt
cd /d "%~dp0web"
call npx vite-node scripts/ai-eval.ts %*
pause

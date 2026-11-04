@echo off
REM Deploys PitBox to Cloudflare (free): rooms server, then the website with its race data.
REM First time: a browser window asks you to sign in to Cloudflare. See DEPLOY.md.
cd /d "%~dp0"
if not exist rooms\node_modules (cd rooms && call npm install && cd ..)
if not exist web\node_modules\@huggingface\transformers (cd web && call npm install && cd ..)
node deploy.mjs
pause

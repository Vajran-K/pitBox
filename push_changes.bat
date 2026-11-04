@echo off
REM Sends your changes to GitHub; the update job then deploys them (about 5 minutes).
cd /d "%~dp0"
if not exist .github\workflows mkdir .github\workflows
copy /y tools\github-update.yml .github\workflows\update.yml >nul
git pull --rebase --autostash
git add -A
set /p MSG=What changed (one line, Enter for "Update"): 
if "%MSG%"=="" set MSG=Update
git commit -m "%MSG%"
git push
echo Pushed. Watch it deploy on GitHub: your repository, Actions tab.
pause

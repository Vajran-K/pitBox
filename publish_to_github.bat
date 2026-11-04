@echo off
REM One time: puts PitBox on GitHub so it can keep itself updated. See DEPLOY.md, part B.
cd /d "%~dp0"
where git >nul 2>nul || (echo Git isn't installed. Get it from https://git-scm.com/download/win , install with the default options, then run this again. & pause & exit /b 1)
if not exist .git git init -b main
for /f "delims=" %%e in ('git config user.email') do set HAVE_EMAIL=%%e
if not defined HAVE_EMAIL (
  set /p GNAME=Your name for commits: 
  set /p GEMAIL=Your GitHub email: 
)
if not defined HAVE_EMAIL (
  git config user.name "%GNAME%"
  git config user.email "%GEMAIL%"
)
REM the auto-update job (kept in tools\ so it can be edited like any other file)
if not exist .github\workflows mkdir .github\workflows
copy /y tools\github-update.yml .github\workflows\update.yml >nul
set /p REPO=Paste your new GitHub repository address (like https://github.com/you/pitbox.git): 
git add -A
git commit -m "PitBox"
git branch -M main
git remote remove origin >nul 2>nul
git remote add origin %REPO%
echo Uploading (about 50 MB of race data the first time). A GitHub sign-in window may open.
git push -u origin main
pause

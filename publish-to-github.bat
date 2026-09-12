@echo off
REM ============================================================
REM  Select Mobility India Pvt. Ltd. - Transport Management
REM  Publish the project to your own GitHub repository
REM ============================================================
REM
REM  Run this ONCE, after you have created an empty repository on
REM  github.com. The repository must NOT be pre-filled with a
REM  README, .gitignore or licence - it has to be completely empty.
REM
REM  This script is safe: it only adds a remote and pushes. It does
REM  not touch your files, and it will refuse to run twice.
REM

title Select Mobility TMS - Publish to GitHub
cd /d "%~dp0"

echo.
echo  ============================================================
echo    PUBLISH TO GITHUB
echo  ============================================================
echo.
echo  Before continuing, create an EMPTY repository on GitHub:
echo    1. Go to  https://github.com/new
echo    2. Name it  select-mobility-tms
echo    3. Choose Private
echo    4. Do NOT tick "Add a README" or ".gitignore" or "licence"
echo.
echo  Then paste the repository URL below.
echo  It looks like:  https://github.com/YOUR-USERNAME/select-mobility-tms.git
echo.
echo  Leave blank and press Enter to cancel.
echo.

set /p REPOURL="Repository URL: "

if "%REPOURL%"=="" (
  echo.
  echo  Cancelled. Nothing was changed.
  echo.
  pause
  exit /b 0
)

REM --- Sanity checks -------------------------------------------------
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERROR] This folder is not a git repository.
  echo          Expected: "%~dp0"
  echo.
  pause
  exit /b 1
)

REM Refuse to overwrite an existing remote.
for /f "tokens=*" %%r in ('git remote get-url origin 2^>nul') do set EXISTING=%%r
if not "%EXISTING%"=="" (
  echo.
  echo  [ERROR] A remote named "origin" already exists:
  echo          %EXISTING%
  echo.
  echo  To change it deliberately, run:
  echo          git remote set-url origin %REPOURL%
  echo.
  pause
  exit /b 1
)

REM Verify no secrets are about to be published.
echo.
echo  Checking that secrets and data are excluded...
git check-ignore -q .env
if errorlevel 1 (
  echo  [ERROR] .env is NOT ignored - refusing to publish.
  echo          Add ".env" to .gitignore before continuing.
  echo.
  pause
  exit /b 1
)
git check-ignore -q server/data/tms.db
if errorlevel 1 (
  echo  [ERROR] server/data/tms.db is NOT ignored - refusing to publish.
  echo.
  pause
  exit /b 1
)
echo  OK - .env and the database are excluded.
echo.

git remote add origin "%REPOURL%"
if errorlevel 1 (
  echo  [ERROR] Could not add the remote. Check the URL and try again.
  echo.
  pause
  exit /b 1
)

echo  Pushing to GitHub...
echo  If asked for a password, paste a Personal Access Token
echo  (GitHub password authentication is not accepted for git).
echo.
git push -u origin main

if errorlevel 1 (
  echo.
  echo  [ERROR] Push failed. Common causes:
  echo    - The repository was not created as completely empty
  echo    - The URL is wrong
  echo    - Authentication was refused (use a Personal Access Token)
  echo.
  echo  To retry:
  echo    git remote remove origin
  echo    then run this script again.
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo    SUCCESS - your project is now on GitHub.
echo  ============================================================
echo.
echo  Next step: deploy it on Render.
echo    1. Go to  https://render.com  and sign in with GitHub
echo    2. New +  -^>  Blueprint
echo    3. Pick the repository - Render reads render.yaml automatically
echo    4. Set ADMIN_EMAIL and ADMIN_PASSWORD when prompted
echo.
echo  Full instructions: docs\DEPLOYMENT-FREE-HOST.md
echo.
pause

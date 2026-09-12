@echo off
REM ============================================================
REM  Select Mobility India Pvt. Ltd. - Transport Management
REM  Run the full verification suite (server must be running)
REM ============================================================

title Select Mobility TMS - Verification
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install it from https://nodejs.org
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo    SELECT MOBILITY TMS - VERIFICATION SUITE
echo  ============================================================
echo.
echo  The server must already be running. Start it with
echo  start-tms.bat in another window if it is not.
echo.

echo  Press any key to begin, or Ctrl+C to cancel.
pause >nul
echo.

echo  --- API end-to-end suite -----------------------------------
node tools\smoke-test.js
set API_RESULT=%errorlevel%
echo.

echo  --- Frontend asset suite -----------------------------------
node tools\verify-frontend.js
set UI_RESULT=%errorlevel%
echo.

echo  ============================================================
if %API_RESULT%==0 if %UI_RESULT%==0 (
  echo   RESULT: ALL CHECKS PASSED
) else (
  echo   RESULT: SOME CHECKS FAILED
  echo   API suite exit code: %API_RESULT%
  echo   UI suite exit code:  %UI_RESULT%
)
echo  ============================================================
echo.
pause
exit /b %API_RESULT%

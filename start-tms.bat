@echo off
REM ============================================================
REM  Select Mobility India Pvt. Ltd. - Transport Management
REM  Start the transport desk server
REM ============================================================

title Select Mobility TMS - Transport Desk
cd /d "%~dp0"

echo.
echo  ============================================================
echo    SELECT MOBILITY INDIA PVT. LTD.
echo    Employee Transportation Management System
echo  ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js was not found on this computer.
  echo.
  echo  Please install Node.js 18 or newer from https://nodejs.org
  echo  then run this script again.
  echo.
  pause
  exit /b 1
)

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] cloudflared was not found on this computer.
  echo  Install Cloudflare Tunnel, then run this script again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODEVER=%%v
echo  Node.js detected: %NODEVER%
echo.

if not exist "node_modules" (
  echo  First run detected - installing dependencies...
  echo  This may take a minute.
  echo.
  call npm install --omit=dev
  if errorlevel 1 (
    echo.
    echo  [ERROR] Dependency installation failed.
    echo  Check your internet connection and try again.
    echo.
    pause
    exit /b 1
  )
  echo.
  echo  Dependencies installed.
  echo.
)

echo  Starting the server...
echo  Starting the Cloudflare tunnel...
echo  Public SMIPL login: https://tms.cdsinfo.in/smipl/login
echo  Keep this window open while the system is in use.
echo  Press Ctrl+C in this window to stop the server.
echo.

start "" /b cloudflared tunnel --config "%~dp0cloudflared.yml" run
start "" /b cmd /c "timeout /t 5 /nobreak >nul && start https://tms.cdsinfo.in/smipl/login"

node server\start.js

echo.
echo  ============================================================
echo   The server has stopped.
echo  ============================================================
echo.
pause

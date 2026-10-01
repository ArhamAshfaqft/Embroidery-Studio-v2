@echo off
title Embroidery Studio - Tatami ^& Satin
cd /d "%~dp0"
echo ========================================================
echo   Embroidery Studio - Tatami ^& Satin (Simple)
echo   Starting app at http://localhost:5174
echo ========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js LTS from https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies first time...
  call npm install --no-audit --no-fund
  echo.
)

echo Opening browser...
start "" "http://localhost:5174"
call npm run dev
pause

@echo off
title FishBill API Server (port 4000)

echo ============================================
echo  FishBill API Server
echo ============================================
echo.

:: Check if Node.js is available
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Starting FishBill API on port 4000...
echo Press Ctrl+C to stop the server.
echo.

cd /d "E:\xaamp\htdocs\fishbill\fishbill-api"
node src/server.js

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Server exited with code %errorlevel%.
    echo Check the logs above for details.
    pause
)

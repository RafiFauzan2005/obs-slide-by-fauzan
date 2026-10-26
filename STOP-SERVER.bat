@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo Memeriksa server OBS Presentation Dock pada port 3210...

set "FOUND="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3210" ^| findstr "LISTENING"') do (
    set "PID=%%a"
    echo Menghentikan server dengan PID !PID!...
    taskkill /f /pid !PID! >nul 2>&1
    set "FOUND=1"
    goto :done
)

if not defined FOUND (
    echo Server tidak sedang berjalan di port 3210.
)

:done
if defined FOUND (
    echo Server OBS Presentation Dock berhasil dihentikan.
)
echo.
ping 127.0.0.1 -n 3 >nul

@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js belum terpasang. Install Node.js LTS dari https://nodejs.org lalu coba lagi.& pause & exit /b 1)
if not exist node_modules (echo Menginstall dependency pertama kali...& npm install)
if errorlevel 1 (echo Instalasi dependency gagal.& pause & exit /b 1)
node server.js
pause

@echo off
:loop
node server.js
echo Crashed with error %errorlevel%.
timeout /t 1 >nul
goto loop
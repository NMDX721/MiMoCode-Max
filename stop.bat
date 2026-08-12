@echo off
taskkill /F /IM mimocode-max-tauri.exe 2>nul
taskkill /F /IM node.exe /FI "WINDOWTITLE eq server.js*" 2>nul
echo MiMo Code - Max 已关闭
pause

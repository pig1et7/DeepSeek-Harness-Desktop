@echo off
rem 零依赖启动（无需 Electron）：Edge 应用模式窗口 + 后台 dsh web 服务
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-edge-appmode.ps1"
pause

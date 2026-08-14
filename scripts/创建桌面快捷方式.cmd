@echo off
rem 创建 "DeepSeek Harness Desktop" 桌面快捷方式
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

set "PORTABLE="
if exist "dist\DeepSeek-Harness-Desktop-*-portable.exe" (
  for %%f in ("dist\DeepSeek-Harness-Desktop-*-portable.exe") do set "PORTABLE=%%~f"
)

if defined PORTABLE (
  set "TARGET=%PORTABLE%"
  set "ARGS="
  set "WORKDIR=%~dp0.."
) else (
  if exist "node_modules\electron\dist\electron.exe" (
    set "TARGET=%CD%\node_modules\electron\dist\electron.exe"
    set "ARGS=."
    set "WORKDIR=%CD%"
  ) else (
    echo [错误] 未找到打包后的 exe，也未找到 Electron。请先运行: npm install
    pause
    exit /b 1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\DeepSeek Harness Desktop.lnk');" ^
  "$lnk.TargetPath = '%TARGET%';" ^
  "$lnk.Arguments = '%ARGS%';" ^
  "$lnk.WorkingDirectory = '%WORKDIR%';" ^
  "$lnk.IconLocation = '%TARGET%,0';" ^
  "$lnk.Description = 'DeepSeek Harness 桌面版';" ^
  "$lnk.Save()"

if exist "%USERPROFILE%\Desktop\DeepSeek Harness Desktop.lnk" (
  echo 已创建桌面快捷方式: DeepSeek Harness Desktop
) else (
  echo 快捷方式可能已创建（OneDrive 桌面路径时请手动确认）。
)
pause

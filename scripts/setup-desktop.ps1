<#
  setup-desktop.ps1 — DeepSeek Harness Desktop 一键安装脚本（适用于全新主机）

  运行一次自动完成：
    1. 检查 Node.js（缺失时尝试用 winget 自动安装）
    2. 准备桌面应用 portable exe（-ExePath 指定 / 仓库已有 / -Build 自动构建）
    3. 复制 exe 到安装目录（默认 %USERPROFILE%\DeepSeek-Harness-Desktop）
    4. 初始化 DSH web profile（首次自动联网下载 dsh）
    5. 安装文件上传插件 dsh-upload（复用 install-upload-plugin.ps1）
    6. 创建桌面快捷方式

  用法（在 clone 下来的仓库目录里运行）：
    # 最快：已有 portable exe（从旧主机拷贝过来）
    powershell -ExecutionPolicy Bypass -File scripts\setup-desktop.ps1 -ExePath D:\downloads\DeepSeek-Harness-Desktop-1.0.3-portable.exe

    # 全自动：从源码构建（首次需下载 Electron，较慢）
    powershell -ExecutionPolicy Bypass -File scripts\setup-desktop.ps1 -Build

    # 只安装插件和快捷方式（假设 exe 已在安装目录）
    powershell -ExecutionPolicy Bypass -File scripts\setup-desktop.ps1 -SkipApp

  参数：
    -ExePath      portable exe 路径（不指定时：优先用仓库 dist 下已有 exe）
    -Build        自动 clone/构建（仓库模式下即 npm install + npm run dist）
    -SkipApp      跳过桌面应用准备（只初始化 DSH + 装插件 + 快捷方式）
    -InstallDir   安装目录（默认 %USERPROFILE%\DeepSeek-Harness-Desktop）
    -NoShortcut   不创建桌面快捷方式
#>
param(
  [string]$ExePath = "",
  [switch]$Build,
  [switch]$SkipApp,
  [string]$InstallDir = "",
  [switch]$NoShortcut
)
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=============================================="
Write-Host "  DeepSeek Harness Desktop 一键安装"
Write-Host "=============================================="
Write-Host ""

$repoRoot = Split-Path $PSScriptRoot -Parent

# ---------- 0. 检查 Node.js ----------
Write-Host "== [1/6] 检查 Node.js =="
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host "未检测到 Node.js，尝试用 winget 自动安装 LTS 版..."
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements | Out-Host
    # 刷新 PATH（新装的 Node 需要）
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  }
}
if (-not $nodeCmd) {
  throw "需要 Node.js（请到 https://nodejs.org 安装 LTS 版），安装完成后重新运行本脚本。"
}
Write-Host "  ✓ Node.js: $($nodeCmd.Source) ($(node --version))"

# ---------- 1. 准备 portable exe ----------
$destExe = ""
if (-not $SkipApp) {
  Write-Host "== [2/6] 准备桌面应用 exe =="
  if (-not $ExePath) {
    $built = Get-ChildItem (Join-Path $repoRoot "dist\*-portable.exe") -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($built) { $ExePath = $built.FullName; Write-Host "  ✓ 使用仓库 dist 下已有 exe: $(Split-Path $ExePath -Leaf)" }
  }
  if (-not $ExePath -and $Build) {
    Write-Host "  开始构建桌面应用（首次需要下载 Electron 约 100MB，请耐心等待）..."
    Push-Location $repoRoot
    npm install --no-audit --no-fund | Out-Host
    if (Test-Path (Join-Path $PSScriptRoot "install-7za-wrapper.ps1")) {
      powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "install-7za-wrapper.ps1") | Out-Null
    }
    npm run dist | Out-Host
    Pop-Location
    $built = Get-ChildItem (Join-Path $repoRoot "dist\*-portable.exe") -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $built) { throw "构建失败：dist 下未生成 portable exe" }
    $ExePath = $built.FullName
    Write-Host "  ✓ 构建完成: $(Split-Path $ExePath -Leaf)"
  }
  if (-not $ExePath) {
    throw "未找到桌面应用 exe。请用 -ExePath 指定 portable exe 路径，或加 -Build 自动构建。"
  }

  if (-not $InstallDir) { $InstallDir = Join-Path $env:USERPROFILE "DeepSeek-Harness-Desktop" }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $destExe = Join-Path $InstallDir (Split-Path $ExePath -Leaf)
  Copy-Item $ExePath $destExe -Force
  Write-Host "  ✓ 已安装到: $destExe"
} else {
  Write-Host "== [2/6] 跳过桌面应用（-SkipApp）=="
  if (-not $InstallDir) { $InstallDir = Join-Path $env:USERPROFILE "DeepSeek-Harness-Desktop" }
  $existing = Get-ChildItem (Join-Path $InstallDir "*-portable.exe") -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existing) { $destExe = $existing.FullName }
}

# ---------- 2. 初始化 DSH web profile ----------
Write-Host "== [3/6] 初始化 DSH（首次自动联网下载 dsh，约 1-3 分钟）=="
$port = 31900 + (Get-Random -Minimum 1 -Maximum 900)
$initOut = Join-Path $env:TEMP "dsh-init.out.log"
$initErr = Join-Path $env:TEMP "dsh-init.err.log"
Remove-Item $initOut, $initErr -ErrorAction SilentlyContinue

# 优先直接使用 npx 缓存里已下载的 dsh（跳过 npx 版本检查/重装，
# 避免与正在运行的其他 DSH 服务争用缓存文件导致 EPERM）
function Find-CachedDsh {
  $candidates = @()
  if ($env:npm_config_cache) { $candidates += Join-Path $env:npm_config_cache "_npx" }
  $candidates += Join-Path $env:LOCALAPPDATA "npm-cache\_npx"
  foreach ($base in $candidates) {
    if (-not (Test-Path $base)) { continue }
    Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $bin = Join-Path $_.FullName "node_modules\@deepseek-ai\dsh\lib\bin.js"
      if (Test-Path $bin) { return $bin }
    }
  }
  return $null
}

$cachedDsh = @(Find-CachedDsh) | Select-Object -First 1
if ($cachedDsh) {
  Write-Host "  ✓ 使用已缓存的 dsh: $cachedDsh"
  $dshProc = Start-Process -FilePath "node" -ArgumentList @($cachedDsh, "web", "--port", $port) -PassThru -WindowStyle Hidden -RedirectStandardOutput $initOut -RedirectStandardError $initErr
} else {
  Write-Host "  npx 缓存中没有 dsh，通过 npx 联网下载..."
  $npxCmd = Get-Command npx -ErrorAction SilentlyContinue
  if (-not $npxCmd) { throw "未找到 npx（Node.js 未正确安装）" }
  # npx 是 .cmd 批处理，Start-Process 不能直接执行，用 cmd /c 包装
  $dshProc = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "npx --yes @deepseek-ai/dsh web --port $port") -PassThru -WindowStyle Hidden -RedirectStandardOutput $initOut -RedirectStandardError $initErr
}

$deadline = (Get-Date).AddMinutes(4)
$ready = $false
while ((Get-Date) -lt $deadline) {
  if ($dshProc.HasExited) { break }
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 2
    if ($resp.Content -match "__DSH_BOOT__") { $ready = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}
# 杀掉整个进程树，避免残留服务
taskkill /PID $dshProc.Id /T /F 2>$null | Out-Null
if (-not $ready) {
  Write-Host "  ⚠ 初始化超时（可能网络慢）。可稍后双击桌面应用完成首次初始化。"
} else {
  Write-Host "  ✓ DSH 初始化完成（dsh 已缓存，桌面应用启动会很快）"
}

# ---------- 3. 安装上传插件 ----------
Write-Host "== [4/6] 安装文件上传插件 dsh-upload =="
$pluginScript = Join-Path $PSScriptRoot "install-upload-plugin.ps1"
if (Test-Path $pluginScript) {
  powershell -NoProfile -ExecutionPolicy Bypass -File $pluginScript | Out-Host
  Write-Host "  ✓ 上传插件安装完成"
} else {
  Write-Host "  ⚠ 未找到 install-upload-plugin.ps1，跳过插件安装"
}

# ---------- 4. 创建桌面快捷方式 ----------
if ($NoShortcut -or -not $destExe) {
  Write-Host "== [5/6] 跳过桌面快捷方式 =="
} else {
  Write-Host "== [5/6] 创建桌面快捷方式 =="
  $ws = New-Object -ComObject WScript.Shell
  $lnkPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "DeepSeek Harness Desktop.lnk"
  $lnk = $ws.CreateShortcut($lnkPath)
  $lnk.TargetPath = $destExe
  $lnk.WorkingDirectory = (Split-Path $destExe -Parent)
  $lnk.IconLocation = "$destExe,0"
  $lnk.Description = "DeepSeek Harness 桌面版"
  $lnk.Save()
  Write-Host "  ✓ 桌面快捷方式: $lnkPath"
}

# ---------- 5. 完成 ----------
Write-Host "== [6/6] 完成 =="
Write-Host ""
Write-Host "✅ 安装完成！"
if ($destExe) { Write-Host "   桌面应用: $destExe" }
Write-Host "   启动方式: 双击桌面「DeepSeek Harness Desktop」快捷方式"
Write-Host "   或浏览器访问 http://127.0.0.1:3080"
Write-Host ""
Write-Host "   首次双击后，输入框左侧会出现 📎 上传按钮（图片/Word/PDF/文本），"
Write-Host "   Agent 会自动读取上传的文件。"

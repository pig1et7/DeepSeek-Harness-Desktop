<#
  Lightweight fallback launcher (no Electron needed):
  starts `dsh web` hidden, opens the GUI in Edge app-mode window, and stops
  the server when the window closes. Double-click 启动-无依赖版.cmd instead.
#>
$ErrorActionPreference = "Stop"

function Find-DshBin {
  # 1) npx cache
  $cache = $env:npm_config_cache
  if (-not $cache) { $cache = Join-Path $env:LOCALAPPDATA "npm-cache" }
  $candidates = @()
  if (Test-Path (Join-Path $cache "_npx")) {
    Get-ChildItem (Join-Path $cache "_npx") -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $bin = Join-Path $_.FullName "node_modules\@deepseek-ai\dsh\lib\bin.js"
      if (Test-Path $bin) { $candidates += $bin }
    }
  }
  # 2) dsh on PATH -> npm shim derives node_modules path
  $dsh = Get-Command dsh -ErrorAction SilentlyContinue
  if ($dsh) {
    $derived = Join-Path (Split-Path $dsh.Source -Parent) "node_modules\@deepseek-ai\dsh\lib\bin.js"
    if (Test-Path $derived) { $candidates += $derived }
  }
  if ($candidates.Count -gt 0) {
    return $candidates | Sort-Object { (Get-Item $_).LastWriteTime } -Descending | Select-Object -First 1
  }
  return $null
}

$port = 3080
$base = if ($env:DSH_DESKTOP_PORT) { [int]$env:DSH_DESKTOP_PORT } else { 3080 }

# find a free port (or reuse an existing DSH instance)
function Test-Port($p) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect("127.0.0.1", $p)
    $c.Close()
    return $true
  } catch { return $false }
}
function Is-Dsh($p) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p/" -UseBasicParsing -TimeoutSec 2
    return ($r.Content -match "__DSH_BOOT__")
  } catch { return $false }
}

$usePort = $null
for ($p = $base; $p -lt $base + 24; $p++) {
  if (Test-Port $p) {
    if (Is-Dsh $p) { $usePort = $p; $reuse = $true; break }
  } else { $usePort = $p; $reuse = $false; break }
}
if (-not $usePort) { Write-Host "未找到可用端口"; exit 1 }

$serverProc = $null
if (-not $reuse) {
  $dshBin = Find-DshBin
  $node = (Get-Command node).Source
  if (-not $dshBin) {
    Write-Host "未找到 dsh，回退到 npx（首次需要联网）…"
    $npx = (Get-Command npx).Source
    $serverProc = Start-Process -FilePath $npx -ArgumentList @("--yes", "@deepseek-ai/dsh", "web", "--port", $usePort) -PassThru -WindowStyle Hidden -WorkingDirectory (Get-Location)
  } else {
    $serverProc = Start-Process -FilePath $node -ArgumentList @($dshBin, "web", "--port", $usePort) -PassThru -WindowStyle Hidden -WorkingDirectory (Get-Location)
  }
  # wait for boot
  $deadline = (Get-Date).AddSeconds(120)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if ($serverProc.HasExited) { break }
    if (Is-Dsh $usePort) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { Write-Host "服务未能就绪"; if ($serverProc) { Stop-Process -Id $serverProc.Id -Force }; exit 1 }
}

Write-Host "DSH 已就绪: http://127.0.0.1:$usePort (reuse=$reuse)"

# open Edge app-mode window
$edge = @(
  "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  (Get-Command msedge -ErrorAction SilentlyContinue).Source
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $edge) {
  Write-Host "未找到 Edge，改用默认浏览器"
  Start-Process "http://127.0.0.1:$usePort"
} else {
  $edgeProc = Start-Process -FilePath $edge -ArgumentList @("--app=http://127.0.0.1:$usePort", "--new-window") -PassThru
  # wait until the Edge app window closes, then stop our server
  while (-not $edgeProc.HasExited) { Start-Sleep -Seconds 2 }
}

if ($serverProc -and -not $serverProc.HasExited) {
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
}
Write-Host "已退出，服务已停止。"

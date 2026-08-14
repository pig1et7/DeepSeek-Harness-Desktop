<#
  install-upload-plugin.ps1 — 在任意一台主机上安装 dsh-upload 插件（一键）。

  用法（在仓库的 scripts 目录下，或指定 -PluginSrc）：
    powershell -ExecutionPolicy Bypass -File scripts\install-upload-plugin.ps1

  可选参数：
    -ProfileDir  目标 profile 目录（默认 $env:DSH_HOME\profiles\web）
    -PluginSrc   插件源码目录（默认 本仓库 plugins\dsh-upload）

  步骤：
    1. 复制插件到 $DSH_HOME\plugins\dsh-upload（稳定位置）
    2. 安装插件依赖（fflate / pdfjs-dist / @deepseek-ai/*）
    3. pnpm add 到目标 profile
    4. 写入 cordis.patch.yml（insert 条目，幂等）
    5. 提示重启 dsh web
#>
param(
  [string]$ProfileDir = "",
  [string]$PluginSrc = ""
)
$ErrorActionPreference = "Stop"

Write-Host "== dsh-upload 安装脚本 =="

# 1. 定位插件源码
if (-not $PluginSrc) {
  $PluginSrc = Join-Path $PSScriptRoot "..\plugins\dsh-upload"
}
$PluginSrc = (Resolve-Path $PluginSrc -ErrorAction SilentlyContinue)
if (-not $PluginSrc -or -not (Test-Path (Join-Path $PluginSrc "package.json"))) {
  throw "找不到插件源码: $PluginSrc（请先 clone DeepSeek-Harness-Desktop 仓库，或用 -PluginSrc 指定）"
}
Write-Host "[1/5] 插件源码: $PluginSrc"

# 2. 目标 profile
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
if (-not $ProfileDir) { $ProfileDir = Join-Path $dshHome "profiles\web" }
if (-not (Test-Path (Join-Path $ProfileDir "package.json"))) {
  throw "目标 profile 不存在: $ProfileDir"
}
Write-Host "[2/5] 目标 profile: $ProfileDir"

# 3. 复制插件到 $DSH_HOME\plugins\dsh-upload（稳定位置，link 不依赖仓库路径）
$dest = Join-Path $dshHome "plugins\dsh-upload"
if (-not (Test-Path $dest)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
  Copy-Item $PluginSrc $dest -Recurse -Force
  Write-Host "[3/5] 已复制插件到: $dest"
} else {
  Write-Host "[3/5] 插件已存在（更新）: $dest"
  Copy-Item (Join-Path $PluginSrc "*") $dest -Recurse -Force
}

# 4. 插件依赖（fflate / pdfjs-dist / @deepseek-ai/*）
Push-Location $dest
npm install --no-audit --no-fund | Out-Host
Pop-Location
Write-Host "[4/5] 插件依赖安装完成"

# 5. pnpm add 到 profile（link 模式）
Push-Location $ProfileDir
pnpm add $dest | Out-Host
Pop-Location
Write-Host "[5/5] 已安装到 profile"

# 6. 写入 cordis.patch.yml（幂等）
$patchFile = Join-Path $ProfileDir "cordis.patch.yml"
$patchText = Get-Content $patchFile -Raw -ErrorAction SilentlyContinue
if ($patchText -match "dsh-upload") {
  Write-Host "cordis.patch.yml 已包含 dsh-upload，跳过。"
} else {
  $block = @"

# dsh-upload: Web GUI 文件上传（图片 / Word / PDF / 文本）+ Agent 工具
# uploaded_files / read_uploaded_file
- insert:
    - id: upload
      name: 'dsh-upload'
"@
  # 无 BOM 追加（PS 5.1 的 Add-Content -Encoding UTF8 会写 BOM，破坏 YAML/JSON 兼容性）
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $existing = if (Test-Path $patchFile) { [System.IO.File]::ReadAllText($patchFile) } else { "" }
  [System.IO.File]::WriteAllText($patchFile, $existing.TrimEnd() + $block, $utf8NoBom)
  Write-Host "已写入 cordis.patch.yml（insert 条目）。"
}

Write-Host ""
Write-Host "✅ 安装完成！请重启 dsh web 服务（Ctrl+C 后重新运行 dsh web），"
Write-Host "   然后在浏览器打开界面，输入框左侧应出现 📎 上传按钮。"

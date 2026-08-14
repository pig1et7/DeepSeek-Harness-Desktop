# Replaces 7zip-bin's 7za.exe with a transparent wrapper that adds "-y" and
# "-xr!darwin" so electron-builder can extract winCodeSign on Windows accounts
# WITHOUT the SeCreateSymbolicLinkPrivilege (non-admin / no Developer Mode).
# Run this after a fresh `npm install` if `npm run dist` fails with
# "ERROR: Cannot create symbolic link ... libcrypto.dylib".
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "..\node_modules\7zip-bin\win\x64"
$real = Join-Path $dir "7za-real.exe"
$wrapper = Join-Path $dir "7za.exe"
$src = Join-Path $PSScriptRoot "7za-wrapper.cs"

if (-not (Test-Path $real)) {
  if (-not (Test-Path $wrapper)) { throw "7za.exe not found under $dir" }
  Rename-Item $wrapper $real
}

$csc = Get-ChildItem "C:\Windows\Microsoft.NET\Framework64" -Recurse -Filter csc.exe -ErrorAction SilentlyContinue |
       Sort-Object FullName -Descending | Select-Object -First 1
if (-not $csc) { throw "csc.exe not found" }

& $csc.FullName /nologo /optimize+ "/out:$wrapper" $src
if ($LASTEXITCODE -ne 0) { throw "compile failed" }
Write-Host "7za wrapper installed: $wrapper"

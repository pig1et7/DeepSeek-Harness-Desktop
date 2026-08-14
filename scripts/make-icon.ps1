# Generates assets/icon.png (512x512) — a simple rounded-square "DSH" glyph.
Add-Type -AssemblyName System.Drawing
$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

# rounded-rect path
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 110
$d = $r * 2
$path.AddArc(0, 0, $d, $d, 180, 90)
$path.AddArc($size - $d, 0, $d, $d, 270, 90)
$path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
$path.AddArc(0, $size - $d, $d, $d, 90, 90)
$path.CloseFigure()

# vertical gradient fill
$rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 38, 92, 255),
  [System.Drawing.Color]::FromArgb(255, 122, 46, 220),
  90.0)
$g.FillPath($brush, $path)

# subtle top-left highlight
$hl = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Rectangle(0, 0, $size, [int]($size / 2))),
  [System.Drawing.Color]::FromArgb(60, 255, 255, 255),
  [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
  90.0)
$g.FillPath($hl, $path)

# "DSH" text
$font = New-Object System.Drawing.Font("Segoe UI", 150, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$textRect = New-Object System.Drawing.RectangleF(0, 6, $size, $size)
$g.DrawString("DSH", $font, $textBrush, $textRect, $sf)

$outDir = Join-Path $PSScriptRoot "..\assets"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir "icon.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "icon written: $out"

$g.Dispose(); $bmp.Dispose(); $path.Dispose(); $brush.Dispose(); $hl.Dispose()
$font.Dispose(); $textBrush.Dispose(); $sf.Dispose()

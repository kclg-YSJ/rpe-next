# Regenerates launcher icons and splash screens from the project logo.
# Existing PNG sizes are preserved so the Android density buckets stay correct.
#
# Run: powershell -ExecutionPolicy Bypass -File tools\gen-icons.ps1

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$shell = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $shell
$res = Join-Path $shell 'android\app\src\main\res'
$logoPath = Join-Path $repo 'assets\rpe\icons\rpelogo.png'
if (-not (Test-Path $logoPath)) { throw "Logo not found: $logoPath" }
$logo = [System.Drawing.Image]::FromFile($logoPath)

$bg = [System.Drawing.Color]::FromArgb(255, 0x16, 0x18, 0x1C)
$splashBg = [System.Drawing.Color]::FromArgb(255, 0x10, 0x10, 0x10)

function New-Canvas([int]$w, [int]$h, [System.Drawing.Color]$color) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear($color)
  return @($bmp, $g)
}

function Add-Logo($g, [int]$w, [int]$h, [double]$scale) {
  $size = [int]([Math]::Min($w, $h) * $scale)
  $x = [int](($w - $size) / 2)
  $y = [int](($h - $size) / 2)
  $g.DrawImage($logo, $x, $y, $size, $size)
}

function Save-Png($bmp, $g, [string]$path) {
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

foreach ($file in Get-ChildItem $res -Recurse -Filter '*.png') {
  $rel = $file.FullName.Replace("$res\", '')
  $existing = [System.Drawing.Image]::FromFile($file.FullName)
  $w = $existing.Width; $h = $existing.Height
  $existing.Dispose()

  if ($file.Name -eq 'ic_launcher_foreground.png') {
    # Adaptive-icon foreground: transparent, logo inside the safe zone.
    $pair = New-Canvas $w $h ([System.Drawing.Color]::Transparent)
    Add-Logo $pair[1] $w $h 0.50
    Save-Png $pair[0] $pair[1] $file.FullName
  }
  elseif ($file.Name -eq 'ic_launcher_round.png') {
    $pair = New-Canvas $w $h ([System.Drawing.Color]::Transparent)
    $g = $pair[1]
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse(0, 0, $w, $h)
    $g.SetClip($path)
    $g.Clear($bg)
    Add-Logo $g $w $h 0.68
    Save-Png $pair[0] $g $file.FullName
  }
  elseif ($file.Name -eq 'ic_launcher.png') {
    $pair = New-Canvas $w $h ([System.Drawing.Color]::Transparent)
    $g = $pair[1]
    $radius = [int]($w * 0.18)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $radius * 2, $radius * 2, 180, 90)
    $path.AddArc($w - $radius * 2 - 1, 0, $radius * 2, $radius * 2, 270, 90)
    $path.AddArc($w - $radius * 2 - 1, $h - $radius * 2 - 1, $radius * 2, $radius * 2, 0, 90)
    $path.AddArc(0, $h - $radius * 2 - 1, $radius * 2, $radius * 2, 90, 90)
    $path.CloseFigure()
    $g.SetClip($path)
    $g.Clear($bg)
    Add-Logo $g $w $h 0.72
    Save-Png $pair[0] $g $file.FullName
  }
  elseif ($file.Name -eq 'splash.png') {
    $pair = New-Canvas $w $h $splashBg
    Add-Logo $pair[1] $w $h 0.30
    Save-Png $pair[0] $pair[1] $file.FullName
  }
  Write-Output ("{0}  {1}x{2}" -f $rel, $w, $h)
}

$logo.Dispose()
Write-Output 'icons and splash screens regenerated'

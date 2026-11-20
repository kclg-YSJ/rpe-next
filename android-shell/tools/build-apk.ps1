# Builds the Re:PhiEdit Next APK from the repository next to this shell.
#
#   powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1              # debug + release
#   powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1 -DebugOnly   # debug only
#
# Requires Node.js 22+, JDK 21 (JAVA_HOME) and the Android SDK
# (ANDROID_HOME / ANDROID_SDK_ROOT, or an existing android\local.properties).
#
# Kept ASCII-only and free of $ErrorActionPreference='Stop': Windows PowerShell 5.1 turns any
# native command's stderr output (java -version, Gradle warnings) into a terminating error.

param([switch]$DebugOnly)

$shell = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $shell

if (-not $env:JAVA_HOME) { throw 'JAVA_HOME is not set. Point it at a JDK 21 (AGP 8.7 does not support newer).' }

# java -version writes to stderr; capture it without letting 5.1 treat that as a failure.
$versionText = ''
try { $versionText = (& "$env:JAVA_HOME\bin\java.exe" -version 2>&1 | Out-String) } catch { $versionText = "$_" }
if ($versionText -notmatch 'version "(\d+)') { throw 'Cannot read the Java version from JAVA_HOME.' }
$major = [int]$Matches[1]
if ($major -ne 21) { throw "This build needs JDK 21, but JAVA_HOME points at Java $major." }

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { $null }
$localProperties = Join-Path $shell 'android\local.properties'
if (-not (Test-Path $localProperties)) {
  if (-not $sdk) { throw 'Set ANDROID_HOME, or create android\local.properties with an sdk.dir entry.' }
  Set-Content -LiteralPath $localProperties -Value ('sdk.dir=' + ($sdk -replace '\\', '\\')) -Encoding ASCII
  Write-Host "Wrote $localProperties"
}

if (-not (Test-Path (Join-Path $shell 'node_modules\@capacitor\cli'))) {
  Write-Host 'Installing Capacitor dependencies...'
  Push-Location $shell
  try { & npm.cmd install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw "npm install failed ($LASTEXITCODE)" } }
  finally { Pop-Location }
}

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

Step '1/4 building the web bundle'
Push-Location $repo
try {
  node tools/build.mjs --pages
  if ($LASTEXITCODE -ne 0) { throw "web build failed ($LASTEXITCODE)" }
} finally { Pop-Location }

Step '2/4 staging www/'
Push-Location $shell
try {
  node tools/patch-web.mjs
  if ($LASTEXITCODE -ne 0) { throw "staging failed ($LASTEXITCODE)" }
} finally { Pop-Location }

Step '3/4 syncing the Capacitor project'
Push-Location $shell
try {
  node node_modules/@capacitor/cli/bin/capacitor sync android
  if ($LASTEXITCODE -ne 0) { throw "capacitor sync failed ($LASTEXITCODE)" }
} finally { Pop-Location }

Step '4/4 assembling the APK'
$version = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
Push-Location (Join-Path $shell 'android')
try {
  if ($DebugOnly) { & .\gradlew.bat assembleDebug --console=plain }
  else { & .\gradlew.bat assembleDebug assembleRelease --console=plain }
  $gradleExit = $LASTEXITCODE
} finally { Pop-Location }
if ($gradleExit -ne 0) { throw "Gradle failed with exit code $gradleExit" }

$outputs = Join-Path $shell 'android\app\build\outputs\apk'
$targets = @(@{ Source = "$outputs\debug\app-debug.apk"; Name = "RePhiEdit-Next-$version-debug.apk" })
if (-not $DebugOnly) { $targets += @{ Source = "$outputs\release\app-release.apk"; Name = "RePhiEdit-Next-$version.apk" } }
foreach ($target in $targets) {
  if (-not (Test-Path $target.Source)) { throw "Missing build output $($target.Source)" }
  $path = Join-Path $shell $target.Name
  Copy-Item $target.Source $path -Force
  Write-Host ("APK: {0} ({1:N1} MB)" -f $path, ((Get-Item $path).Length / 1MB)) -ForegroundColor Green
}

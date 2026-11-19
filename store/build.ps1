# Builds the Chrome Web Store upload: store/mindclub-extension-<version>.zip from extension/ (README left out).
# usage: pwsh store/build.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$ext = Join-Path $root "extension"
$version = (Get-Content (Join-Path $ext "manifest.json") -Raw | ConvertFrom-Json).version
$zip = Join-Path $PSScriptRoot "mindclub-extension-$version.zip"

# The extension's parser must match the site's, or the two disagree about results.
if ((Get-FileHash (Join-Path $root "parser.js")).Hash -ne (Get-FileHash (Join-Path $ext "parser.js")).Hash) {
  throw "extension/parser.js differs from parser.js. Run: cp parser.js extension/parser.js"
}

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("mc-build-" + [guid]::NewGuid())
New-Item -ItemType Directory $stage | Out-Null
Get-ChildItem $ext | Where-Object { $_.Name -ne "README.md" } | Copy-Item -Destination $stage -Recurse
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip
Remove-Item $stage -Recurse -Force
Write-Output "built $zip"

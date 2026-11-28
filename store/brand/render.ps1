# Renders the brand images with headless Chrome and resizes the icon. Run: pwsh store/brand/render.ps1
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot/../.."
$chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe"
$tmp = Join-Path $env:TEMP "mc-brand"; New-Item -ItemType Directory -Force $tmp | Out-Null
function Shot($html, $out, $w, $h) {
  & $chrome --headless --disable-gpu --hide-scrollbars --user-data-dir="$tmp/profile" --default-background-color=00000000 `
    --virtual-time-budget=4000 --window-size="$w,$h" --screenshot="$out" "file:///$((Resolve-Path $html).Path.Replace([char]92,[char]47))" 2>$null | Out-Null
}
Shot "$PSScriptRoot/og.html" "$root/og.png" 1200 630
Shot "$PSScriptRoot/icon.html" "$tmp/icon.png" 512 512
python -c @"
from PIL import Image
src = Image.open(r'$tmp/icon.png').convert('RGBA')
for size, path in [(512, r'$root/icon-512.png'), (192, r'$root/icon-192.png'),
                   (128, r'$root/extension/icons/128.png'), (48, r'$root/extension/icons/48.png'),
                   (32, r'$root/extension/icons/32.png'), (16, r'$root/extension/icons/16.png')]:
    src.resize((size, size), Image.LANCZOS).save(path)
    print('wrote', path)
"@

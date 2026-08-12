#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

Write-Host "=== Pushing to GitHub ==="

$repo = "NMDX721/MiMoCode-Max"
$branch = "main"

# Files to upload
$files = @(
    "src/main.js", "src/renderer.js", "src/preload.js", "src/api.js", "src/cache.js",
    "src/index.html", "src/styles.css", "package.json"
)

# Add .gitignore content
$giContent = "node_modules/`nout/`ndist/`n*.log"
$giB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($giContent))
$giBody = @{ message = "init: add .gitignore"; content = $giB64 } | ConvertTo-Json -Compress
$giResult = echo $giBody | gh api -X PUT "repos/$repo/contents/.gitignore" --input - 2>&1
Write-Host "  .gitignore OK"

foreach ($f in $files) {
    $content = [System.IO.File]::ReadAllText("$PSScriptRoot\$f")
    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($content))
    $body = @{ message = "feat: $f"; content = $b64 } | ConvertTo-Json -Compress
    $result = echo $body | gh api -X PUT "repos/$repo/contents/$f" --input - 2>&1
    Write-Host "  $f OK"
}

Write-Host "`n=== Done! ==="
Write-Host "https://github.com/NMDX721/MiMoCode-Max"

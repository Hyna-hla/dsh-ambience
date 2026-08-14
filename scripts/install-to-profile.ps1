# Installs a locally built DSH plugin into the user's web profile via the
# "vendor copy + cordis.patch.yml insert" route — the same route the
# dsh-plugin-marketplace uses, which avoids touching the profile's npm-managed
# node_modules through a package manager.
#
# Usage:
#   .\scripts\install-to-profile.ps1 -Name dsh-my-plugin -SourceDir E:\AI搓的小东西\dsh-my-plugin
#   .\scripts\install-to-profile.ps1 -Name dsh-my-plugin -SourceDir . -Build
#
# After a successful run, restart the DeepSeek Harness app (the composition is
# loaded at process startup).
param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [Parameter(Mandatory = $true)]
    [string]$SourceDir,

    [switch]$Build,

    [string]$ProfileDir = "C:\Users\Administrator\.dsh\profiles\web"
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path $SourceDir).Path

Write-Host "===== install $Name -> profile node_modules ====="
if (-not (Test-Path (Join-Path $source "package.json"))) {
    throw "package.json not found in $source — is -SourceDir the plugin repo root?"
}

if ($Build) {
    Write-Host "[build] node build.mjs"
    Push-Location $source
    try { & node build.mjs } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "build failed" }
}

if (-not (Test-Path (Join-Path $source "lib\index.js"))) {
    throw "lib\index.js missing — run the build (or pass -Build) first"
}

$dest = Join-Path $ProfileDir "node_modules\$Name"
New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Copy-Item $source $dest -Recurse

# Prune everything that is not a runtime file: the app only needs lib/,
# cordis.patch.yml, dsh.plugin.json, package.json (+ README/LICENSE).
foreach ($junk in @(".git", "node_modules", "src", "scripts", "docs", "build.mjs", "tsconfig.json", "vitest.config.ts", "pnpm-lock.yaml", "pnpm-workspace.yaml")) {
    $p = Join-Path $dest $junk
    if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}

Write-Host "[install] copied to $dest"

$patch = Join-Path $ProfileDir "cordis.patch.yml"
if (-not (Test-Path $patch)) {
    throw "cordis.patch.yml not found under $ProfileDir"
}
$registered = [bool](Select-String -Path $patch -Pattern ("^\s*name:\s+" + [regex]::Escape($Name) + "\s*$") -Quiet)
if (-not $registered) {
    $entry = "`n- insert:`n    - id: $Name`n      name: $Name`n"
    Add-Content -Path $patch -Value $entry -NoNewline
    Write-Host "[patch] registered in cordis.patch.yml"
} else {
    Write-Host "[patch] already registered in cordis.patch.yml"
}

Write-Host "===== verify ====="
Write-Host "--- node_modules\$Name exists: $(Test-Path $dest)"
Write-Host "--- lib\index.js exists: $(Test-Path (Join-Path $dest 'lib\index.js'))"
Write-Host "--- lib\client.js exists: $(Test-Path (Join-Path $dest 'lib\client.js'))"
Write-Host "--- patch entry:"
Get-Content $patch -Raw
Write-Host ""
Write-Host "Restart the DeepSeek Harness app to load the new plugin."

# Alternative route (only if the patch-insert route ever stops being honored):
# register through the app's own package manager, which edits the profile
# package.json (dependencies + dsh.profile.bundles) and runs npm itself:
#   node <path-to-@deepseek-ai/dsh/lib/bin.js> plugin --profile web add "file:$source"
# The dsh bin ships inside the DeepSeek Harness app install directory.

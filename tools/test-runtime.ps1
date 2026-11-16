# Starts a test copy of Basalt on an isolated profile, running the sources of ONE worktree.
#   powershell -File tools\test-runtime.ps1 -Worktree <path of your git worktree> -Scratch <empty temp dir> -Port 9601 -Vault <throw-away vault or folder>
# The runtime is copied once (about 330 MB); its app-src and app folders are junctions to YOUR worktree (src, stub), so the main checkout is never used.
# The window is placed off screen. Talk to it with the Chrome DevTools protocol on http://127.0.0.1:<Port>/json.
param([Parameter(Mandatory)][string]$Worktree, [Parameter(Mandatory)][string]$Scratch, [int]$Port = 9601, [Parameter(Mandatory)][string]$Vault)
$ErrorActionPreference = "Stop"
$main = Split-Path -Parent $PSScriptRoot
$rt = Join-Path $Scratch "runtime"
if (-not (Test-Path (Join-Path $rt "Basalt.exe"))) {
  New-Item -ItemType Directory -Force $rt | Out-Null
  robocopy (Join-Path $main "runtime") $rt /E /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
}
$res = Join-Path $rt "resources"
foreach ($n in "app", "app-src") { $p = Join-Path $res $n; if (Test-Path $p) { cmd /c rmdir `"$p`" 2>$null; if (Test-Path $p) { Remove-Item $p -Recurse -Force } } }
cmd /c mklink /J `"$(Join-Path $res 'app')`" `"$(Join-Path $Worktree 'stub')`" | Out-Null
cmd /c mklink /J `"$(Join-Path $res 'app-src')`" `"$(Join-Path $Worktree 'src')`" | Out-Null
$data = Join-Path $Scratch "data"; New-Item -ItemType Directory -Force $data | Out-Null
$cfg = @{ vaults = @{ "tv0000000001" = @{ path = (Resolve-Path $Vault).Path; ts = [int64](Get-Date -UFormat %s) * 1000; open = $true } }; cli = $true } | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::WriteAllText((Join-Path $data "obsidian.json"), $cfg, (New-Object System.Text.UTF8Encoding($false)))
$env:BASALT_HEADLESS = "1"   # no visible window, no taskbar entry, no timer throttling (agents must never pop up windows)
Start-Process (Join-Path $rt "Basalt.exe") -ArgumentList "--user-data-dir=$data", "--remote-debugging-port=$Port", "--window-position=-3000,0"
"started: http://127.0.0.1:$Port/json  (profile $data, sources $Worktree\src)"

# Builds .\runtime from the installed Obsidian's Electron on first run, then launches the fork.
$P = $PSScriptRoot
$rt = Join-Path $P 'runtime'
if (-not (Test-Path "$rt\Basalt.exe")) {
    $inst = "$env:LOCALAPPDATA\Programs\Obsidian"
    if (-not (Test-Path "$inst\Obsidian.exe")) { throw "Install Obsidian first: need its Electron runtime in $inst" }
    New-Item -ItemType Directory -Force $rt | Out-Null
    Copy-Item "$inst\*" $rt -Recurse -Force
    Remove-Item "$rt\resources\app.asar","$rt\resources\obsidian.asar","$rt\Uninstall Obsidian.exe" -Force -ErrorAction SilentlyContinue
    Rename-Item "$rt\Obsidian.exe" 'Basalt.exe'
    Rename-Item "$rt\Obsidian.com" 'Basalt.com'   # the terminal command: `basalt`
    Write-Host 'Runtime copied. Set the icon with: node -e "require(''rcedit'')..." (optional)'
}
# stub + src are linked live so edits apply on next launch
foreach ($n in 'app','app-src') { $l = "$rt\resources\$n"; if (Test-Path $l) { Remove-Item $l -Recurse -Force } }
New-Item -ItemType Junction -Path "$rt\resources\app" -Target "$P\stub" | Out-Null
New-Item -ItemType Junction -Path "$rt\resources\app-src" -Target "$P\src" | Out-Null
Start-Process "$rt\Basalt.exe" -ArgumentList "--user-data-dir=`"$P\data`" --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-features=CalculateNativeWinOcclusion $env:OBSIDIAN_EXTRA_ARGS" -WorkingDirectory $rt

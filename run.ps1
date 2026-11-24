# Builds .\runtime from a stock Electron zip on first run, then launches the fork.
# The zip comes from the electron cache (%LOCALAPPDATA%\electron\Cache) or from $env:BASALT_ELECTRON_ZIP.
$P = $PSScriptRoot
$rt = Join-Path $P 'runtime'
$ElectronVersion = '39.8.6'
if (-not (Test-Path "$rt\Basalt.exe")) {
    $zip = $env:BASALT_ELECTRON_ZIP
    if (-not $zip) { $zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter "electron-v$ElectronVersion-win32-x64.zip" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
    if (-not $zip -or -not (Test-Path $zip)) { throw "Need electron-v$ElectronVersion-win32-x64.zip (github.com/electron/electron/releases): put it in the electron cache or set BASALT_ELECTRON_ZIP" }
    Remove-Item $rt -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive $zip $rt -Force
    Rename-Item "$rt\electron.exe" 'Basalt.exe'
    # only English and Russian are used; the app brings its own translations
    Get-ChildItem "$rt\locales" | Where-Object { $_.Name -notin 'en-US.pak','ru.pak' } | Remove-Item
    Remove-Item "$rt\resources\default_app.asar" -Force -ErrorAction SilentlyContinue
    & powershell -NoProfile -File "$P\tools\set-exe-icon.ps1" -Exe "$rt\Basalt.exe" -Ico "$P\branding\icon.ico"
    Write-Host 'Runtime created from stock Electron.'
}
# stub + src are linked live so edits apply on next launch
foreach ($n in 'app','app-src') { $l = "$rt\resources\$n"; if (Test-Path $l) { Remove-Item $l -Recurse -Force } }
New-Item -ItemType Junction -Path "$rt\resources\app" -Target "$P\stub" | Out-Null
New-Item -ItemType Junction -Path "$rt\resources\app-src" -Target "$P\src" | Out-Null
Start-Process "$rt\Basalt.exe" -ArgumentList "--user-data-dir=`"$P\data`" --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-features=CalculateNativeWinOcclusion $env:OBSIDIAN_EXTRA_ARGS" -WorkingDirectory $rt

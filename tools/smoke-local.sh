#!/bin/bash
# fresh isolated runtime on the current checkout + app-smoke; prints only the failures
cd "$(dirname "$0")/.."; S="$LOCALAPPDATA/Temp"; P=${1:-9657}
rm -rf "$S/bt6" "$S/wv6"; node tools/app-smoke.mjs --make-vault "$S/wv6" >/dev/null
(powershell -File tools/test-runtime.ps1 -Worktree "$PWD" -Scratch "$S/bt6" -Port $P -Vault "$S/wv6" >/dev/null 2>&1 &)
sleep 35
OUT=$(timeout 120 node tools/app-smoke.mjs --port $P 2>&1); echo "$OUT" | grep -c "^ok" | sed 's/^/passed: /'; echo "$OUT" | grep -v "^ok" | cut -c1-300 | head -10
powershell -c "Get-Process | ? { \$_.Path -like '*\Temp\bt6\runtime*' } | Stop-Process -Force" >/dev/null 2>&1

#!/bin/bash
# fresh isolated runtime on the current checkout + app-smoke; prints the pass count and only the failures.
# usage: tools/smoke-local.sh [port]   (scratch dir and vault are per port, so parallel runs do not collide)
cd "$(dirname "$0")/.."; S="$LOCALAPPDATA/Temp"; P=${1:-9657}
D="$S/bsmoke$P"; V="$S/bsmokev$P"
powershell -c "Get-Process | ? { \$_.Path -like '*bsmoke$P*' } | Stop-Process -Force; Start-Sleep 3" >/dev/null 2>&1
rm -rf "$D" "$V" 2>/dev/null
node tools/app-smoke.mjs --make-vault "$V" >/dev/null
(powershell -File tools/test-runtime.ps1 -Worktree "$PWD" -Scratch "$D" -Port $P -Vault "$V" >/dev/null 2>&1 &)
for i in $(seq 1 60); do curl -s http://127.0.0.1:$P/json >/dev/null 2>&1 && break; sleep 3; done
sleep 20
OUT=$(timeout 300 node tools/app-smoke.mjs --port $P 2>&1)
echo "$OUT" | grep -c "^ok" | sed 's/^/passed: /'
echo "$OUT" | grep -v "^ok" | cut -c1-300 | head -10
powershell -c "Get-Process | ? { \$_.Path -like '*bsmoke$P*' } | Stop-Process -Force" >/dev/null 2>&1

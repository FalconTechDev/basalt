#!/bin/bash
# usage: tools/merge-slice.sh rewrite-sNN  -- merges one agent branch into the current branch, rebuilds app.js, runs dup check + smoke
set -u
b="$1"; cd "$(dirname "$0")/.."
git merge "$b" --no-edit 2>&1 | grep -i "conflict\|Merge made\|up to date\|error" | head -8
U=$(git diff --name-only --diff-filter=U | tr '\n' ' '); echo "conflicts: $U"
for f in $U; do case "$f" in src-app/manifest.json) node tools/merge-manifest.mjs | head -1 | cut -c1-80;; src/app.js) git checkout --ours src/app.js;; docs/REWRITE-PROGRESS.md) node -e 'const fs=require("fs");let p=fs.readFileSync("docs/REWRITE-PROGRESS.md","utf8");p=p.replace(/<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>> [^\n]*\r?\n/g,(x,h,b)=>h+"\n"+b);fs.writeFileSync("docs/REWRITE-PROGRESS.md",p)';; *) echo "MANUAL CONFLICT: $f"; exit 2;; esac; done
node tools/check-dups.mjs || { echo "DUPLICATE NAMES (fix, then rebuild)"; exit 3; }
node build-app.mjs --no-cargo 2>&1 | tail -1 | cut -c1-200 || exit 4
node --check src/app.js || exit 5
echo MERGE-BUILD-OK

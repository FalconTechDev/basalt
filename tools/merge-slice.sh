#!/bin/bash
# usage: tools/merge-slice.sh rewrite-sNN  -- merges one agent branch into the current branch, rebuilds app.js, runs dup check
# (run tools/smoke-local.sh afterwards). Conflicts it knows how to resolve: manifest (union), src/app.js (rebuilt),
# text docs (keep both sides). Anything else stops with MANUAL CONFLICT.
set -u
b="$1"; cd "$(dirname "$0")/.."
git merge "$b" --no-edit 2>&1 | grep -i "conflict\|Merge made\|up to date\|error" | head -8
U=$(git diff --name-only --diff-filter=U | tr '\n' ' '); echo "conflicts: $U"
for f in $U; do
  case "$f" in
    src-app/manifest.json) node tools/merge-manifest.mjs | head -1 | cut -c1-80 ;;
    src/app.js) git checkout --ours src/app.js ;;
    build-app.mjs) git checkout --ours build-app.mjs ;;  # every slice re-did the envBind getters; main has the superset
    docs/*.md|THIRD_PARTY.md) node tools/keep-both.mjs "$f" ;;
    src-app/*.js) st=$(git status --porcelain -- "$f" | cut -c1-2); if [ "$st" = "UD" ]; then git rm -q -- "$f"; else echo "MANUAL CONFLICT: $f ($st)"; exit 2; fi ;;  # the clean-room branch deleted the old module
    *) echo "MANUAL CONFLICT: $f"; exit 2 ;;
  esac
done
node tools/check-dups.mjs || { echo "DUPLICATE NAMES (fix, then rebuild)"; exit 3; }
node build-app.mjs --no-cargo > /tmp/build.log 2>&1 || { grep -m2 "Error" /tmp/build.log; echo BUILD-FAILED; exit 4; }; tail -1 /tmp/build.log | cut -c1-200
node --check src/app.js || exit 5
echo MERGE-BUILD-OK

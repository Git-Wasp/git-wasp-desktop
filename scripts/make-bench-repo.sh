#!/usr/bin/env bash
# scripts/make-bench-repo.sh — build a throwaway repo for perf measurement.
# Usage: scripts/make-bench-repo.sh /tmp/bench-monorepo 50000 2000
set -euo pipefail
DEST="${1:?dest path}"; COMMITS="${2:-50000}"; FILES="${3:-2000}"
rm -rf "$DEST"; mkdir -p "$DEST"; cd "$DEST"; git init -q
git config user.email bench@example.com; git config user.name Bench
mkdir -p src
for i in $(seq 1 "$FILES"); do echo "line 0" > "src/file_$i.txt"; done
git add -A; git commit -q -m "seed: $FILES files"
for c in $(seq 1 "$COMMITS"); do
f=$(( (RANDOM % FILES) + 1 )); echo "change $c" >> "src/file_$f.txt"
git add "src/file_$f.txt"; git commit -q -m "chore: commit $c"
if (( c % 500 == 0 )); then git branch "feat/b-$c" >/dev/null; fi
done
echo "Built $COMMITS commits, $FILES files, $((COMMITS/500)) branches at $DEST"

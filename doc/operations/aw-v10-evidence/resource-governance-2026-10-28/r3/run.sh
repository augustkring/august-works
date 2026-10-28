#!/usr/bin/env bash
set -u
OUT="$(cd "$(dirname "$0")" && pwd)"
ROOT=/workspace/blentera-v10
cd "$ROOT"
python3 /workspace/v10-preparation/snapshot-current-source-for-dependency-check.py "$OUT/source-pins.json" > "$OUT/snapshot.log" 2>&1
echo "$?" > "$OUT/snapshot.exit"
if [ "$(cat "$OUT/snapshot.exit")" != 0 ]; then
  echo 1 > "$OUT/exit"
  exit 1
fi
./node_modules/.bin/prettier --check server/src/__tests__/v7-free-core.integration.test.ts > "$OUT/syntax.log" 2>&1
echo "$?" > "$OUT/syntax.exit"
./node_modules/.bin/vitest run server/src/__tests__/v7-free-core.integration.test.ts --reporter=verbose --maxWorkers=1 > "$OUT/test.log" 2>&1
echo "$?" > "$OUT/test.exit"
cat "$OUT/syntax.exit" "$OUT/test.exit" | awk 'BEGIN { bad=0 } $1 != 0 { bad=1 } END { print bad }' > "$OUT/exit"
cat "$OUT/exit"

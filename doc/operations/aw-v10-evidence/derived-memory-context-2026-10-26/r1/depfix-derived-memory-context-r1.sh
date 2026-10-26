#!/usr/bin/env bash
set -uo pipefail
source /workspace/v10-preparation/env.sh
export PATH=/workspace/v10-preparation/pinned-bin:$PATH
NAME=depfix-derived-memory-context-r1-20261026
OUT=/workspace/v10-preparation
ROOT=/workspace/v10-dep-qualification
exec 9>/workspace/v10-preparation/v10-pg-tests.lock
flock -x 9
python3 /workspace/v10-preparation/snapshot-current-source-for-dependency-check.py "$OUT/$NAME-source-pins.json" > "$OUT/$NAME-snapshot.log" 2>&1
snap=$?
printf '%s\n' "$snap" > "$OUT/$NAME-snapshot.exit"
if [[ "$snap" -ne 0 ]]; then exit "$snap"; fi
node /workspace/v10-preparation/check-snapshot-syntax.cjs "$OUT/$NAME-source-pins.json" > "$OUT/$NAME-syntax.log" 2>&1
syntax=$?
printf '%s\n' "$syntax" > "$OUT/$NAME-syntax.exit"
if [[ "$syntax" -ne 0 ]]; then exit "$syntax"; fi
cd "$ROOT/server" || exit 90
timeout 180s ../node_modules/.bin/vitest run src/__tests__/v7-derived-memory.integration.test.ts --maxWorkers=1 > "$OUT/$NAME-test.log" 2>&1
test_rc=$?
printf '%s\n' "$test_rc" > "$OUT/$NAME-test.exit"
exit "$test_rc"

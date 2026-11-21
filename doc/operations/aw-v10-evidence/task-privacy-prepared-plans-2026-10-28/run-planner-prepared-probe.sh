#!/usr/bin/env bash
set -u
exec flock -x /workspace/v10-preparation/v10-pg-tests.lock bash -lc '
source /workspace/v10-preparation/env.sh
NAME=planner-prepared-r1-20261028
OUT=/workspace/v10-preparation
python3 "$OUT/snapshot-current-source-for-dependency-check.py" "$OUT/$NAME-source-pins.json" > "$OUT/$NAME-snapshot.log" 2>&1
rc=$?; printf "%s\n" "$rc" > "$OUT/$NAME-snapshot.exit"; if [ "$rc" != 0 ]; then exit "$rc"; fi
cp "$OUT/planner-prepared-probe.test.ts" /workspace/v10-dep-qualification/server/src/__tests__/planner-prepared-probe.test.ts
sha256sum "$OUT/planner-prepared-probe.test.ts" /workspace/v10-dep-qualification/server/src/__tests__/planner-prepared-probe.test.ts /workspace/v10-dep-qualification/pnpm-lock.yaml > "$OUT/$NAME-pretest.sha256"
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/$NAME-pretest.utc"
cd /workspace/v10-dep-qualification/server
timeout 90 ../node_modules/.bin/vitest run src/__tests__/planner-prepared-probe.test.ts --reporter=verbose > "$OUT/$NAME-test.log" 2>&1
rc=$?; printf "%s\n" "$rc" > "$OUT/$NAME-test.exit"
cat "$OUT/$NAME-test.log"
exit "$rc"
'

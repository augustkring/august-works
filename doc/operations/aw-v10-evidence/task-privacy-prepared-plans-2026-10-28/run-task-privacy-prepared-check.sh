#!/usr/bin/env bash
set -u
exec flock -x /workspace/v10-preparation/v10-pg-tests.lock bash -lc '
source /workspace/v10-preparation/env.sh
NAME=task-privacy-prepared-implementation-r1-20261028
OUT=/workspace/v10-preparation
python3 "$OUT/snapshot-current-source-for-dependency-check.py" "$OUT/$NAME-source-pins.json" > "$OUT/$NAME-snapshot.log" 2>&1
rc=$?; printf "%s\n" "$rc" > "$OUT/$NAME-snapshot.exit"; if [ "$rc" != 0 ]; then exit "$rc"; fi
sha256sum /workspace/v10-dep-qualification/packages/db/src/client.ts /workspace/v10-dep-qualification/server/src/services/authorization.ts /workspace/v10-dep-qualification/server/src/__tests__/task-privacy-prepared-plan.integration.test.ts /workspace/v10-dep-qualification/pnpm-lock.yaml > "$OUT/$NAME-pretest.sha256"
cd /workspace/v10-dep-qualification
node_modules/.bin/tsc --noEmit -p packages/db/tsconfig.json > "$OUT/$NAME-db-types.log" 2>&1
rc=$?; printf "%s\n" "$rc" > "$OUT/$NAME-db-types.exit"
if [ "$rc" != 0 ]; then cat "$OUT/$NAME-db-types.log"; exit "$rc"; fi
cd server
timeout 90 ../node_modules/.bin/vitest run src/__tests__/task-privacy-prepared-plan.integration.test.ts --reporter=verbose > "$OUT/$NAME-test.log" 2>&1
rc=$?; printf "%s\n" "$rc" > "$OUT/$NAME-test.exit"
cat "$OUT/$NAME-test.log"
exit "$rc"
'

#!/usr/bin/env bash
set -uo pipefail
source /workspace/v10-preparation/env.sh
export PATH=/workspace/v10-preparation/pinned-bin:$PATH
OUT=/workspace/v10-preparation
NAME=issue-comment-wake-route-r1-20261026
ROOT=/workspace/v10-dep-qualification
python3 /workspace/v10-preparation/snapshot-current-source-for-dependency-check.py "$OUT/$NAME-source-pins.json" > "$OUT/$NAME-snapshot.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/$NAME-snapshot.exit"
if [ "$rc" -ne 0 ]; then printf '%s\n' "$rc" > "$OUT/$NAME.exit"; exit "$rc"; fi
node /workspace/v10-preparation/check-snapshot-syntax.cjs "$OUT/$NAME-source-pins.json" > "$OUT/$NAME-syntax.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/$NAME-syntax.exit"
if [ "$rc" -ne 0 ]; then printf '%s\n' "$rc" > "$OUT/$NAME.exit"; exit "$rc"; fi
cd "$ROOT/server"
PATTERN='does not bypass .* task guards from the Slack Board composer or its outbox|dispatches and publishes a queued Slack Board send with a one-connection database pool|publishes only explicitly selected board attachments and stays idempotent across retries|rechecks the outbound link when publication commits between reaction preflight reads|does not deadlock reaction replay against publication link settlement|filters a staged reaction when destination reach is revoked before replay|retires only the removed source.s pre-run FIFO notice after its surviving batch promotes|preserves all 100000 characters for slack .*comment publication'
timeout --signal=TERM --kill-after=5s 240s ../node_modules/.bin/vitest run src/__tests__/issue-update-comment-wakeup-routes.test.ts --maxWorkers=1 > "$OUT/$NAME-test.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/$NAME-test.exit"
printf '%s\n' "$rc" > "$OUT/$NAME.exit"
exit "$rc"

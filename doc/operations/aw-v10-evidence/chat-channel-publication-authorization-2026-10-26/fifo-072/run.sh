#!/usr/bin/env bash
set -uo pipefail
source /workspace/v10-preparation/env.sh
export PATH=/workspace/v10-preparation/pinned-bin:$PATH
OUT=/workspace/v10-preparation
NAME=chat-channel-12-focused-072-20261026
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
PATTERN='retires only the removed source.s pre-run FIFO notice after its surviving batch promotes'
timeout --signal=TERM --kill-after=5s 300s ../node_modules/.bin/vitest run src/__tests__/chat-channels.integration.test.ts -t "$PATTERN" --maxWorkers=1 > "$OUT/$NAME-test.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/$NAME-test.exit"
printf '%s\n' "$rc" > "$OUT/$NAME.exit"
exit "$rc"

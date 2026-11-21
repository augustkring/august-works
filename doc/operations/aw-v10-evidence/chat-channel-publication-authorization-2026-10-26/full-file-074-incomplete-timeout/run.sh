#!/usr/bin/env bash
set -uo pipefail
source /workspace/v10-preparation/env.sh
export PATH=/workspace/v10-preparation/pinned-bin:$PATH
OUT=/workspace/v10-preparation
NAME=chat-channel-full-074-20261026
ROOT=/workspace/v10-dep-qualification
for suffix in source-pins.json snapshot.log snapshot.exit syntax.log syntax.exit test.log test.exit exit; do
  if [ -e "$OUT/$NAME-$suffix" ] || [ -e "$OUT/$NAME.$suffix" ]; then
    echo "attempt artifact already exists: $NAME" >&2
    exit 73
  fi
done
python3 /workspace/v10-preparation/snapshot-current-source-for-dependency-check.py "$OUT/$NAME-source-pins.json" > "$OUT/$NAME-snapshot.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/$NAME-snapshot.exit"
if [ "$rc" -ne 0 ]; then printf '%s\n' "$rc" > "$OUT/$NAME.exit"; exit "$rc"; fi
node /workspace/v10-preparation/check-snapshot-syntax.cjs "$OUT/$NAME-source-pins.json" > "$OUT/$NAME-syntax.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/$NAME-syntax.exit"
if [ "$rc" -ne 0 ]; then printf '%s\n' "$rc" > "$OUT/$NAME.exit"; exit "$rc"; fi
cd "$ROOT/server"
timeout --signal=TERM --kill-after=5s 600s ../node_modules/.bin/vitest run src/__tests__/chat-channels.integration.test.ts --maxWorkers=1 > "$OUT/$NAME-test.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/$NAME-test.exit"
printf '%s\n' "$rc" > "$OUT/$NAME.exit"
exit "$rc"

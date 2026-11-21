#!/usr/bin/env bash
set -uo pipefail
source /workspace/v10-preparation/env.sh
export PATH=/workspace/v10-preparation/pinned-bin:$PATH
export PAPERCLIP_TEST_TMPDIR=/tmp/paperclip-chat-partitions
mkdir -p "$PAPERCLIP_TEST_TMPDIR"
OUT=/workspace/v10-preparation
NAME=chat-stable-shards-075-20261026
ROOT=/workspace/v10-dep-qualification
python3 /workspace/v10-preparation/snapshot-current-source-for-dependency-check.py "$OUT/$NAME-source-pins.json" > "$OUT/$NAME-snapshot.log" 2>&1
snapshot_rc=$?
printf '%s\n' "$snapshot_rc" > "$OUT/$NAME-snapshot.exit"
if [ "$snapshot_rc" -ne 0 ]; then printf '%s\n' "$snapshot_rc" > "$OUT/$NAME.exit"; exit "$snapshot_rc"; fi
node /workspace/v10-preparation/check-snapshot-syntax.cjs "$OUT/$NAME-source-pins.json" > "$OUT/$NAME-syntax.log" 2>&1
syntax_rc=$?
printf '%s\n' "$syntax_rc" > "$OUT/$NAME-syntax.exit"
if [ "$syntax_rc" -ne 0 ]; then printf '%s\n' "$syntax_rc" > "$OUT/$NAME.exit"; exit "$syntax_rc"; fi
cd "$ROOT"
overall=0
for index in 0 1 2; do
  timeout --signal=TERM --kill-after=5s 600s node scripts/run-vitest-stable.mjs --mode general --group general-chat --shard-index "$index" --shard-count 3 > "$OUT/$NAME-shard-$index.log" 2>&1
  rc=$?
  printf '%s\n' "$rc" > "$OUT/$NAME-shard-$index.exit"
  if [ "$rc" -ne 0 ] && [ "$overall" -eq 0 ]; then overall="$rc"; fi
done
printf '%s\n' "$overall" > "$OUT/$NAME.exit"
exit "$overall"

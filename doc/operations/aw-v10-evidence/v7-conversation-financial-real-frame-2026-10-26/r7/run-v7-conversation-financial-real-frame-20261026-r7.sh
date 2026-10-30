#!/usr/bin/env bash
set -uo pipefail
source /workspace/v10-preparation/env.sh
NAME=v7-conversation-financial-real-frame-20261026-r7
OUT=/workspace/v10-preparation
ROOT=/workspace/v10-dep-qualification
BINARY=/workspace/.cloud-setup/lockfile/node_modules/.pnpm/opencode-linux-x64@1.18.32/node_modules/opencode-linux-x64/bin/opencode
EXPECTED=513f500a1a5ea1dc7d865547ac87b32a8936334e8d5abd5b3ff585c45a170080
actual="$(sha256sum "$BINARY" | awk '{print $1}')"
printf '%s\n' "$actual" > "$OUT/$NAME-binary.sha256"
printf '%s\n' "$BINARY" > "$OUT/$NAME-binary.path"
if [ "$actual" != "$EXPECTED" ]; then
  echo "qualified OpenCode binary SHA mismatch" > "$OUT/$NAME-snapshot.log"
  printf '78\n' > "$OUT/$NAME.exit"
  exit 78
fi
export PAPERCLIP_QUALIFIED_OPENCODE_BINARY="$BINARY"
cd /workspace/blentera-v10
python3 /workspace/v10-preparation/snapshot-current-source-for-dependency-check.py "$OUT/$NAME-source-pins.json" > "$OUT/$NAME-snapshot.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/$NAME-snapshot.exit"
if [ "$rc" -ne 0 ]; then printf '%s\n' "$rc" > "$OUT/$NAME.exit"; exit "$rc"; fi
node /workspace/v10-preparation/check-snapshot-syntax.cjs "$OUT/$NAME-source-pins.json" > "$OUT/$NAME-syntax.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/$NAME-syntax.exit"
if [ "$rc" -ne 0 ]; then printf '%s\n' "$rc" > "$OUT/$NAME.exit"; exit "$rc"; fi
cd "$ROOT/server"
python3 /workspace/v10-preparation/run-with-child-reaper.py timeout --signal=TERM --kill-after=5s 600s ../node_modules/.bin/vitest run src/__tests__/v7-model-reservations.integration.test.ts -t 'binds live reservations to the actual Human session and current conversation generation|settles the actual qualified conversation usage once and preserves the exact debit in canonical purge|allows the last exact-budget dispatch and rejects the next reservation|dispatches the 64th actual funded call and refuses the 65th|rolls back settlement if an actual reservation receipt is preempted, then settles once|retains an actual unknown conversation hold and blocks canonical company purge' --maxWorkers=1 > "$OUT/$NAME-test.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/$NAME-test.exit"
executed="$(python3 - "$OUT/$NAME-test.log" <<'PYCOUNT'
from pathlib import Path
import re, sys
text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
lines = re.findall(r"^\s*Tests\s+(.+?)\s+\(\d+\)\s*$", text, re.M)
if not lines:
    print(0)
else:
    counts = {name: int(count) for count, name in re.findall(r"(\d+)\s+(passed|failed|skipped|todo|pending)", lines[-1])}
    print(counts.get("passed", 0) + counts.get("failed", 0))
PYCOUNT
)"
if [ "$executed" -ne 6 ]; then
  echo "Expected all six actual-frame financial tests to execute; observed $executed" >> "$OUT/$NAME-test.log"
  if [ "$rc" -eq 0 ]; then rc=79; fi
fi
printf '%s\n' "$rc" > "$OUT/$NAME.exit"
exit "$rc"

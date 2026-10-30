#!/usr/bin/env bash
set -uo pipefail
ROOT=/workspace/blentera-v10
QUAL=/workspace/v10-dep-qualification
OUT="$ROOT/doc/operations/aw-v10-evidence/rt01-runtime-probe-contract-2026-10-27/r2"
source /workspace/v10-preparation/env.sh
export PATH=/workspace/v10-preparation/pinned-bin:$PATH
export PAPERCLIP_QUALIFIED_OPENCODE_BINARY=/workspace/.cloud-setup/lockfile/node_modules/.pnpm/opencode-linux-x64@1.18.32/node_modules/opencode-linux-x64/bin/opencode
export PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH=/tmp/paperclip-runner-provider-pack-v10-a0275fd01
exec 9>/workspace/v10-preparation/v10-pg-tests.lock
flock 9
python3 /workspace/v10-preparation/snapshot-current-source-for-dependency-check.py "$OUT/source-pins.json" > "$OUT/snapshot.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/snapshot.exit"
if [ "$rc" -ne 0 ]; then printf '%s\n' "$rc" > "$OUT/exit"; exit "$rc"; fi
node /workspace/v10-preparation/check-snapshot-syntax.cjs "$OUT/source-pins.json" > "$OUT/syntax.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/syntax.exit"
if [ "$rc" -ne 0 ]; then printf '%s\n' "$rc" > "$OUT/exit"; exit "$rc"; fi
cd "$QUAL/server"
timeout --signal=TERM --kill-after=5s 300s ../node_modules/.bin/vitest run src/__tests__/v7-sandbox-qualification-faults.test.ts src/__tests__/v7-sandbox-policy.test.ts src/__tests__/v7-sandbox-host-bridge.integration.test.ts --maxWorkers=1 > "$OUT/probe-contract-test.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/probe-contract-test.exit"
if [ "$rc" -ne 0 ]; then printf '%s\n' "$rc" > "$OUT/exit"; exit "$rc"; fi
timeout --signal=TERM --kill-after=5s 600s ../node_modules/.bin/vitest run src/services/native-runtime/native-opencode-managed-conversation-frame.integration.test.ts --maxWorkers=1 > "$OUT/c0-full5-test.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/c0-full5-test.exit"
if [ "$rc" -ne 0 ]; then printf '%s\n' "$rc" > "$OUT/exit"; exit "$rc"; fi
cd "$QUAL"
timeout --signal=TERM --kill-after=5s 120s node --test deploy/v6/host-agent/openshell.test.mjs > "$OUT/openshell-test.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$OUT/openshell-test.exit"
printf '%s\n' "$rc" > "$OUT/exit"
exit "$rc"

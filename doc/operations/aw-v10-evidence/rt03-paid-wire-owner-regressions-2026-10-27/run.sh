#!/usr/bin/env bash
set -uo pipefail
ROOT=/workspace/blentera-v10
QUAL=/workspace/v10-dep-qualification
OUT="$ROOT/doc/operations/aw-v10-evidence/rt03-paid-wire-owner-regressions-2026-10-27"
mkdir -p "$OUT"
source /workspace/v10-preparation/env.sh
export PATH=/workspace/v10-preparation/pinned-bin:$PATH
export PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH=/tmp/paperclip-runner-provider-pack-v10-a0275fd01
exec 9>/workspace/v10-preparation/v10-pg-tests.lock
flock 9
python3 /workspace/v10-preparation/snapshot-current-source-for-dependency-check.py "$OUT/source-pins.json" > "$OUT/snapshot.log" 2>&1
rc=$?; printf '%s\n' "$rc" > "$OUT/snapshot.exit"
if ((rc)); then printf '%s\n' "$rc" > "$OUT/exit"; exit "$rc"; fi
node /workspace/v10-preparation/check-snapshot-syntax.cjs "$OUT/source-pins.json" > "$OUT/syntax.log" 2>&1
rc=$?; printf '%s\n' "$rc" > "$OUT/syntax.exit"
if ((rc)); then printf '%s\n' "$rc" > "$OUT/exit"; exit "$rc"; fi
cd "$QUAL"
node_modules/.bin/tsc -p packages/paperclip-runner/tsconfig.json --singleThreaded > "$OUT/runner-emit.log" 2>&1
rc=$?; printf '%s\n' "$rc" > "$OUT/runner-emit.exit"
if ((rc)); then printf '%s\n' "$rc" > "$OUT/exit"; exit "$rc"; fi
node packages/paperclip-runner/scripts/generate-semantic-action-catalog.mjs --check > "$OUT/runner-catalog.log" 2>&1
rc=$?; printf '%s\n' "$rc" > "$OUT/runner-catalog.exit"
if ((rc)); then printf '%s\n' "$rc" > "$OUT/exit"; exit "$rc"; fi
cd "$QUAL/server"
run_case() {
  local name="$1" file="$2" pattern="$3" code
  timeout --signal=TERM --kill-after=10s 300s ../node_modules/.bin/vitest run "$file" \
    -t "$pattern" --maxWorkers=1 --no-file-parallelism --reporter=verbose > "$OUT/$name.log" 2>&1
  code=$?
  printf '%s\n' "$code" > "$OUT/$name.exit"
  return 0
}
run_case reservations src/__tests__/v7-model-reservations.integration.test.ts \
  'requires a current accountable Agent run and active Worker attempt for decision-shadow spend|serializes concurrent reservations before spend and debits the native counter exactly once|requires the persisted provider wire receipt after a single irreversible dispatch claim|retains the entire debit after unknown dispatch or expired preflight|blocks authority loss between reservation and dispatch while keeping immutable financial metadata|admits only the registered Jev Skill purpose through the same taskless budget owner|atomically caps concurrent taskless company-purpose reservations'
run_case worker_gateway src/__tests__/v7-worker-model-gateway.integration.test.ts \
  'forces the real heartbeat through native admission and the budget gateway|rejects actual Native admission after a private grant is revoked|withholds draft publication after human Pause during the actual heartbeat model call|runs the real one-call Native draft backend'
run_case native_draft_conformance src/__tests__/v7-native-draft-conformance.integration.test.ts \
  'qualifies a canonical virtual candidate through original probes|bootstraps through the actual operator service|preserves runtime revocation while settling a dispatched probe|blocks the next dispatch before exceeding the combined two-company ceiling|rejects provider usage outside the qualified envelope|does not qualify a provider that returns the wrong synthetic response'
run_case safe_tests src/__tests__/v9-agent-safe-tests.integration.test.ts \
  'executes exactly once, retains real evidence|retains an ambiguous model debit and never dispatches again after a lost reply|tests an actual newly prepared Custom Agent|fences changed candidates after actual dispatch'
run_case read_only_verifier src/__tests__/v7-read-only-model-verifier.integration.test.ts \
  'requires a separately qualified trajectory purpose|records on-track evidence without resuming work|retains a single uncertain trajectory debit|automatically queues a current observable trajectory|sends possible completion through a separate reserved verifier call|serializes two consumers of one spend identity|does not refund or retry a usage-ceiling violation'
run_case jev_decisions src/__tests__/jev-decisions-routes.integration.test.ts .
run_case billing src/__tests__/v6-billing-provider.test.ts .
run_case costs src/__tests__/v6-costs.integration.test.ts .
cd "$ROOT"
failed=0
for f in "$OUT"/*.exit; do
  [[ "$f" == "$OUT/snapshot.exit" || "$f" == "$OUT/syntax.exit" || "$f" == "$OUT/runner-emit.exit" || "$f" == "$OUT/runner-catalog.exit" ]] && continue
  [[ "$(cat "$f")" == 0 ]] || failed=1
done
sha256sum "$OUT"/*.log "$OUT"/*.exit "$OUT/source-pins.json" > "$OUT/SHA256SUMS"
printf '%s\n' "$failed" > "$OUT/exit"
exit "$failed"

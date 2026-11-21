#!/usr/bin/env bash
set -u
OUT="$(cd "$(dirname "$0")" && pwd)"
ROOT=/workspace/blentera-v10
cd "$ROOT"
python3 /workspace/v10-preparation/snapshot-current-source-for-dependency-check.py "$OUT/source-pins.json" > "$OUT/snapshot.log" 2>&1
rc=$?; echo "$rc" > "$OUT/snapshot.exit"
if [ "$rc" -ne 0 ]; then echo "$rc" > "$OUT/exit"; exit "$rc"; fi
./node_modules/.bin/esbuild server/src/__tests__/company-portability.test.ts server/src/__tests__/company-portability-routes.test.ts --outdir=/tmp/company-portability-fixture-parse-r1 --platform=node --format=esm --log-level=warning > "$OUT/parse.log" 2>&1
rc=$?; echo "$rc" > "$OUT/parse.exit"
git diff --check -- server/src/__tests__/company-portability.test.ts server/src/__tests__/company-portability-routes.test.ts > "$OUT/diff-check.log" 2>&1
rc2=$?; echo "$rc2" > "$OUT/diff-check.exit"
if [ "$rc" -ne 0 ] || [ "$rc2" -ne 0 ]; then echo 1 > "$OUT/exit"; exit 1; fi
./node_modules/.bin/vitest run server/src/__tests__/company-portability.test.ts server/src/__tests__/company-portability-routes.test.ts --reporter=verbose --maxWorkers=1 > "$OUT/test.log" 2>&1
rc=$?; echo "$rc" > "$OUT/test.exit"
if [ "$rc" -ne 0 ]; then echo "$rc" > "$OUT/exit"; exit "$rc"; fi
echo 0 > "$OUT/exit"
cat "$OUT/exit"

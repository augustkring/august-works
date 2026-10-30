#!/usr/bin/env bash
set -uo pipefail
cd /workspace/blentera-v10
evidence=doc/operations/aw-v10-evidence/model-lifecycle-2026-10-28/attempt-15
{ printf 'HEAD '; git rev-parse HEAD; while IFS= read -r file; do sha256sum "$file"; done < "$evidence/source-files.txt"; } > "$evidence/source-pins.txt"
/workspace/v10-preparation/pinned-bin/pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-persona-persistence.test.ts > "$evidence/agent-service-test.log" 2>&1
status=$?
printf '%s\n' "$status" > "$evidence/agent-service-test.exit"
exit "$status"

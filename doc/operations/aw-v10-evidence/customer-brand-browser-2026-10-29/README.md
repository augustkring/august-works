# Customer-facing brand browser evidence (2026-10-29)

These are two independent Playwright runs. They share Git `sourceHead` `0de39c2c17cb5ce713ecea4e20845ae825a562be`, but their captured worktree snapshots are not identical: the copied-file manifests differ in nine files. Do not combine their case counts as one same-snapshot run. The captured bytes differ at: `deploy/v6/host-agent/openshell.mjs`, `deploy/v6/host-agent/openshell.test.mjs`, `packages/shared/src/sandbox-host-contracts.ts`, `server/src/__tests__/account-deletion-sso-reauth.integration.test.ts`, `server/src/__tests__/native-session-resumption.test.ts`, `server/src/services/execution-sandbox/native-host-bridge.ts`, `server/src/services/native-direct-input.ts`, `server/src/services/native-runtime/native-opencode-managed-conversation-frame.integration.test.ts`, and `server/src/services/runtime/control.ts`.

Each run directory contains the original `source-pins.json`, its `source-pins.source.patch`, `snapshot.log`, `syntax.log`, and the exact `browser.exit`. The source-pin manifest records the qualification base, source head, copied-file hashes, dependency pins, and reconstruction format; its untracked-source list is empty. The patch plus the pinned base/head and manifest reconstruct the captured source. `evidence.json` records SHA-256 digests for the pin manifest, patch, raw browser log, and sanitized log.

`browser.log.sanitized` is the only browser log copy here. The raw logs remain privately under `/workspace/v10-preparation` and are not included. For each raw log, two invite-path occurrences were found and both opaque invite-token occurrences were redacted; the raw SHA-256 is retained in `evidence.json` so the original can be verified without publishing the credential. No traces, screenshots, or raw logs are archived.

## `runtime-candidate-telegram-r1` — 2 cases, exit 0

Source pin: `0de39c2c17cb5ce713ecea4e20845ae825a562be`, qualification base `886014cae5a7d6ed5a9ab99d62613ec7646308cb`.

Passed `aw-v9-runtime-candidates.spec.ts` (“saved runtime selection survives reload and an unknown qualification uses only its Original receipt”) and the Telegram catalog/setup/connection-management case in `chat-adapters-ui-providers.spec.ts`.

## `agent-publication-r1` — 3 cases, exit 0

Source pin: `0de39c2c17cb5ce713ecea4e20845ae825a562be`, qualification base `886014cae5a7d6ed5a9ab99d62613ec7646308cb`.

`selected-count.txt` and `test-list.log` preserve the pre-run selection check. The three passed cases cover custom publication in English, hire publication in Danish, and hire publication in English. They verify explicit confirmations and recovery of the original receipt without resending.

These results qualify only the listed browser cases and their recorded snapshots; they do not establish complete V10, branding, or browser coverage.

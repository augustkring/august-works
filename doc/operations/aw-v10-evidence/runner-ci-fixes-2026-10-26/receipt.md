# Runner CI failure receipt — 2026-10-26

Source baseline for CI diagnosis: commit `40b354f61cb4fc693e007b797da408739802f6ae`. GitHub CI run: PR `40245236328`; Runner static-check job `121325307299`; Vitest shard job `121325307353`. Logs were fetched through the GitHub workflow-job-logs connector because `gh` log access was unavailable.

## Findings and minimal changes

- Runner API integration failures came from a fixture Task linked to a raw, unqualified Project. The source-read guard correctly rejected that Task. Ordinary source-free fixtures now leave `issues.projectId` and `projectWorkspaceId` null. Project-coupled cases still create the Human-owned Project through the canonical route, then link that qualified Project and workspace to the Task. The real current and legacy HTTP E2E tests continue asserting that the returned project is the qualified Human-owned Project.
- Two mutation-route tests require a current Human organization member. They now opt into the same canonical Human Project fixture, which creates that user and membership; the production authorization check is unchanged.
- The restricted REST mutation catalog test had executed all local pre-dispatch denials serially and exceeded Vitest's existing 30-second test timeout. It now submits the complete restricted set concurrently, checks every operation individually for the expected denial, and verifies no durable receipt. No operations were removed and no timeout was increased.
- The package-install integrity fixture and pin still expected Zod `4.4.3`, while the workspace override/lockfile pin is `4.6.6`. Both expected pins now match `4.6.6`.
- The OpenCode config file is deliberately chmodded to `0400`; its test expected stale mode `0600`. The assertion now checks `0400`.

## Verification

- Initial focused Runner API attempt: exit 1, 15 passed / 3 failed. Preserved in `runner-api-integration-direct.log` and `.exit`. The failures were: deny-catalog test timeout; project creation returned 403 due missing Human membership; API-only issue patch returned 403 for the same missing Human membership.
- Final full Runner API integration file: exit 0, 18 passed / 18 total, using installed Vitest directly from the main workspace under `/workspace/v10-preparation/v10-pg-tests.lock`, with `--maxWorkers=1`. Raw output and numeric exit are in `runner-api-integration-final.log` and `.exit`.
- Exact package checks: `installation-integrity.test.ts` and `opencode-server-driver.test.ts`, filtered to the two CI test cases, exit 0; 2 passed / 76 skipped. Raw output and numeric exit are in `runner-pinned-and-opencode-direct.log` and `.exit`.
- Initial package-manager wrapper attempts failed before tests with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; those raw logs and exit codes remain in `runner-api-integration.log/.exit` and `runner-pinned-and-opencode.log/.exit`. No install, purge, or `CI=true` workaround was used for those attempts.
- `git diff --check` passed after the final changes. This receipt records focused verification only; it does not claim a full repository run.

## Source scope

Changes owned by this receipt are in the Runner API fixture and integration test, the Runner ACPX installation-integrity pin/test, and the OpenCode driver test. Other concurrent worktree edits are owned by other tasks and were not included in this receipt's changes. No commit or push was made.

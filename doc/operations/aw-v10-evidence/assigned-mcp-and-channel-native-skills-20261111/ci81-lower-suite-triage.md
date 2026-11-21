# CI81 lower-suite triage (read-only)

PR 43026860631, head `418927deb40016024ef56c2473761933be6770a9`.

## Server shard 4 — job 130552022792

Fetched decoded log via GitHub MCP. Vitest summary: 18 failed, 4,677 passed across 91 files.

- `business-experiment-recording.integration.test.ts` — “captures all 68,000 exact outcomes at the 4,000-unit and seventeen-metric maxima without dropping sources”. Assertion: elapsed `30,208.430447 ms` expected `< 30,000 ms`; this is an observed performance-threshold overrun.
- Nine rows in `wake-queue/adapters/postgres.test.ts` — “waits for native cleanup and finalizer ownership before recovering saved input” cases (`active_lease`, `pending_cleanup`, `failed_cleanup`, `unknown_cleanup`, `local_provider_resource`, `ssh_provider_mismatch`, `cleanup_claim`, `finalizer_owner`, `workspace_owner`) fail their post-clear promotion expectation. The emitted assertion detail includes expected `promoted`, received `released` (line 413). The current test fixture manually flips leases/cleanup metadata and clears finalizer/workspace owner fields, but never writes the canonical Native Stop/cleanup proof. The separate “keeps legacy terminal cleanup and clears Native only after its canonical local Stop” test does call `recordSettledNativeLocalRun`; the nine failing cases do not. Treat these as missing canonical-positive fixture evidence until qualified, not grounds to relax the owner-release guard.
- Five rows — “allows native queue recovery after settled [released|retained|local_release|ssh_release|unrelated_cleanup] cleanup” — likewise expect `promoted` while constructing only finalization/lease rows; there is no `recordSettledNativeLocalRun` or canonical physical cleanup proof in that case setup.
- `releases an acknowledged native handoff without blocking or restarting the old owner` and `does not drain a deferred message after an acknowledged native task Stop` fail because the `issues` row still has `executionRunId` and `checkoutRunId` set to the old run although the assertions expect both null.
- `keeps an accepted message behind a persisted unknown native outcome despite committed result retention` observes the intended blocked status, but the old assertion expects both run pointers null; the actual row retains both pointers to the unknown physical owner. Preserve that safety behavior; update the stale assertion only after confirming the exact owner-liability contract.

The queue failures are 17 test rows plus the one performance test. No code or tests were run or modified.

## Server shard 7 — job 130552022798

GitHub MCP decoded-log calls repeatedly failed with `Transport closed`. The job-steps endpoint confirms the grouped Vitest step failed, but the artifact list has no matching shard-7 Vitest artifact. Filtered artifact lookup for `vitest-43026860631-1-general-server-without-chat-7` returns empty. Failure case/root cause remains unavailable from accessible GitHub evidence.

## Chat shard 2 — job 130552023327

Fetched decoded log via GitHub MCP. One failed test: `chat-channels.integration.test.ts:26049` — “materializes direct external-chat finals once and accepts the next turn without agent bookkeeping writes”. At line 26156, `expect(firstRun).toBeDefined()` fails because no succeeded `heartbeatRuns` row was found for the fixture company/assigned agent after delivering the first mentioned Slack message and draining active executions. This is the precise observed failure; the log does not include adapter/run error details, so the underlying cause is not established. The artifact reports 350 passed, 701 skipped, 1 failed.

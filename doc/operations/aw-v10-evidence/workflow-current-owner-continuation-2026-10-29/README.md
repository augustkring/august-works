# Continue an existing workflow wait under its current owner

A successful subworkflow wait recovered without a current authenticated reader stays deferred. The run view now lets its original Human or verified Local initiator replay the existing manual/Task start endpoint with the retained immutable revision, input, coverage ID and idempotency key. It accepts only the same returned run. Task input is rebuilt by the existing endpoint; current source, actor and exact-input checks remain authoritative. There is no new API or background reader.

Successful covered continuation now uses the original coverage authorizer before private child-result reads and again after source/privacy/parent waits immediately before consuming the wait. The original transaction holds membership and coverage locks across these checks. The second check samples real expiry after contention; a previously valid grant does not outlive its deadline.

## Current scoped qualification

| Capture | Result | Duration |
|---|---|---|
| `workflow-covered-current-owner-resume-r3-20261029` | Full original workflow authoring/recovery file: 24/24 passed, zero skipped, exit 0 | 114.38s |
| `workflow-continue-ui-r2-20261029` | Full run-view DOM/API suite: 23/23 passed, zero skipped, exit 0 | 4.81s |

All six feature source files matched the actual capture hashes when archived; see `source-boundaries.json`. Full source reconstruction pins and raw test output are compressed without changing the uncompressed bytes; each raw and stored SHA is recorded there.

Backend checks include covered manual and Task positive continuation, real revoked coverage refusal, same original run and one-child replay, and genuine expiry during an actual parent-row lock wait. The expiry fixture observes the early coverage row lock through a separate NOWAIT transaction, proves the grant is still live, waits for actual PostgreSQL time to pass its deadline, releases the parent lock and requires a final 403 with wait/output untouched. It leaves the existing eight-second source statement budget unchanged. Negative cases use canonical cancellation afterward to keep the original recovery-count oracle independent.

UI checks include the exact manual/Task replay request, preservation of a manual input field named `task`, Danish critical copy, verified Local continuation without fabricated Human/coverage, wrong actor/revision/key/source exclusions, refused coverage/changed Task/no replacement-run adoption, and current-session checks before dispatch and after late/unmounted replies. Private results remain in the original query scope rather than mutation state.

## Superseded attempts and limits

Backend r1 passed 21/24: revoked fixtures left active waits for later cases' global recovery sweep. Canonical cancellation cleanup corrected isolation without changing the original count assertion. Backend r2 passed 23/24: the expiry fixture held the parent lock beyond the unchanged source statement budget and hit the real timeout. Scheduling contention with four seconds of genuine validity remaining corrected the fixture; no production timeout or clock was altered. UI r1 passed its earlier 20-case source and is superseded by current r2's 23-case source.

These results qualify the scoped original service and DOM/API paths. They do not claim an assembled browser journey, provider/physical-host qualification, whole-workspace compilation or final frozen-workspace acceptance. Locale source contains concurrent model-migration monitor keys; this feature owns only `workflowRunContinue`, `workflowRunContinuing`, `workflowRunContinueFailed` and `workflowRunChildWait`. The qualified executor source also preserves Root's nullable wait-reference predicate fix.

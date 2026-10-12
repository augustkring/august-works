# V9 environment recovery and customer pause checkpoint

Full V9 remains incomplete. PR #38 stays draft until the remaining implementation
and integrated verification requirements are complete.

The execution service disconnected and returned `409 environment_offline`.
The replacement environment contained the older original checkout, but neither
the integrated V9 worktree nor the uncommitted knowledge worktree. GitHub retained
the published V9 head `86a24bf0b1d54ef060a6168542a954c49d85137b`.
The recovered worktree starts at that exact head. The original checkout is preserved.

## Recovered customer pause

The Hire receipt and customer monitor offer a current-source pause decision.
The human must select drain or cancel. The adapter uses the Original Agent pause,
heartbeat cancellation and activity transaction owners. It captures the exact
pending run IDs. Subsequent resume/admission cannot widen that cancellation set.
Current human access is checked again after the last write. Audit or authority
failure rolls back admission. A durable acceptance does not prove settled work.

Only Original command identity remains in tab storage. A known or unknown reply
can recover through a fresh, scope-checked Original receipt GET after a remount.
No reload, read or replay dispatches cancellation again. Original receipts and
exact replays remain available when later work exceeds new-decision bounds.

The reconstruction includes the earlier fixture repair: a retired guest presence
tests lifecycle refusal without bypassing the home-identity archive/rehome guard.
Monitor copy now describes the actual drain/cancel choice. Its assertions preserve
the distinction between a recorded pause and a confirmed remote stop.

## Current narrow verification

- Shared, DB, plugin SDK and runner TypeScript builds pass.
- 28 actual PostgreSQL pause/monitor cases pass, including the late audit and
  authority failures, concurrent confirmation, source changes and resume race.
- 46 focused UI/API cases pass, including known/unknown receipt recovery and
  withdrawal of private details during rechecking.
- Token gates, server/UI types and all seven built browser cases pass.
  The browser cases include keyboard pause, mobile accessibility, EN/DA publication
  and representative-test receipts. The reconstructed Source stayed frozen during
  the type/browser qualification: `3f115753383c52c1ef1ecf885479c73223d61a1061754bc68e06c8254376eb91`.

The PostgreSQL cases ran as the non-root task user. This checkpoint does not claim
physical Native artifact-sandbox, hosted-provider, channel or human acceptance proof.
The first DB build used the inherited incompatible pnpm shim; the restored
Corepack wrapper selects the repository-pinned pnpm version. Missing compiled SDK
and runner entries were rebuilt before the passing PostgreSQL run.

## Reference use and remaining work

Brief sections 79.2 and 79.6 define the receipt action and drain/cancel behavior.
Construction playbook 04 sections 10.5–10.6 guide safe errors, partial completion,
duplicate handling and failure tests. Security playbook 06 guides current,
revocable, scoped authority. Privacy playbook 07 guides content-free tab identity
and private read withdrawal. Verification playbook 05 distinguishes real boundary
evidence from fixtures and compile-only checks. All 36 supplied playbooks and the
extracted logo package remain in the recovered repository.

The selected-knowledge implementation from the unavailable worktree must be
reconstructed and qualified. Runtime provisioning/live staging, broader behavior
and access mappings, maintenance/channel/privacy work, screen contracts, full
integrated types/tests/build, current CI and review remain open. Earlier evidence
is historical and does not certify reconstructed uncommitted Source.

# Keep cold route loading outside behavioral setup budgets

Status: implemented. Both affected actual HTTP suites pass all 128 cases.
The final current server typecheck is being repeated with the configured Rust
PATH; its previous attempt stopped at cargo not found, before type validation.

The frozen checkpoint-69 serialized shard 1 passes 39 suites, then fails before
all 122 checkout-ownership cases in issue-agent-mutation-ownership-routes.
Its beforeAll module-graph import exceeds 30 seconds. The corrected file passes
all 122 cases: 36.17 seconds import and 882 ms behavior (37.40 seconds total).
The failure had skipped every case; it was not evidence of passing ownership.

Checkpoint-72 serialized shard 0 similarly stops at its first suite,
access-routes-hidden-floor, before all six cases. Its createApp performs the
cold access-router import inside an explicit unchanged 30-second beforeAll.
The new static imports keep cold loading in collection; the same synchronous
app construction stays in that hook with its original bound.

The checkout file registers its exact stable mocks once, then imports the same
actual route/error graph once with top-level await. Per-test mock behavior,
issue-list cache clearing, actors, checkout/run/permission assertions and every
HTTP request remain. The shared hoist helper and other suites are unchanged.
No hook/test timeout, assertion, production route or authorization is relaxed.

Both corrected files pass together: 128 cases, two suites, no skips or unhandled
errors; 44.21 seconds import and 957 ms behavior (45.66 seconds total). Their
source filenames retain the original serialized classification. The original
runner's 81-file shard 1 order is reconciled exactly: 39 earlier passes, the
corrected suite, then 41 unrun suites. Shard 0 contains 79 files: its corrected
first suite and 78 remaining. No subset is relabeled as the complete suite.

Guidance: the supplied construction, SDLC/configuration, verification and
security playbooks. This is test initialization work only. Product behavior and
Native runtime/source authority remain those of checkpoint 72. Whole V9 and
all 70 launch-evidence rows remain open. No PR/push.

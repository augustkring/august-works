# Current responsible-account qualification at the draft write boundary

Original AI workflow authoring now checks the actual running heartbeat's
responsible account against the canonical auth user row. An unverified, missing
or empty account cannot authorize a conversation draft write, even when the
Agent still has its workflow grant. Autonomous runs with no responsible user
retain their Original granted behavior.

The account row is share-locked when this check runs inside the Original
create/update transaction, and qualification is checked again after mutation.
A PostgreSQL fixture withdraws verification after the revision insert and
proves the entire draft and transaction-local withdrawal roll back. Another
fixture withdraws verification while the run remains active and proves the SDK
creates no draft. The existing current Source/generation/permission checks stay
in place; this does not claim global locking of every authorization owner.

## Verification

Original authoring, current-conversation Native and tool gateway suites passed
91 cases. The final 13-case current-conversation suite passed independently;
affected server types and diff checks passed. The preceding unchanged published
artifact `0a1d3dc1b7c9ff20163f2eeb06f7994024f36b71` passed the full sequential
35-workspace typecheck, including Rust, server, UI and CLI. That is exact-parent
evidence, with the changed server rechecked separately, not a full repository
test/build or launch result for this later source.

References: V9 current identity/Source/corruption boundary, supplied security,
privacy, backend and verification playbooks. Full V9 completion remains pending.

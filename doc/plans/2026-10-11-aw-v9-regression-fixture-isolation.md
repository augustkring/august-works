# V9 regression fixture isolation

## Observed failure and correction

The frozen integrated full test run at `69f506926` reports three failures in
the original `native-session-resumption.test.ts`. Its actual execution logs
show failed Native wake-input staging: the provider-recovery fixture uses the
contributor's source checkout as its persisted workspace and attempts to create
`.paperclip-inbound` there. That checkout is intentionally unavailable for
private writes by the isolated test account. No existing inbound directory was
read, traversed or made accessible.

The recovery fixture now assigns its original checkpoint, project workspace
and execution workspace to the same unique temporary workspace, created by its
actual test account before PostgreSQL setup and removed after original runtime
drain and database cleanup. All original thirteen cases, assertions, Native
authorizers, provider contracts and deadlines are retained. Production Native
staging and workspace behavior remain unchanged.

## Verification and remaining work

The complete original file still needs PostgreSQL/Native qualification under
the original isolated account. No failed case is waived or skipped. The frozen
full run continues unchanged; its failure artifacts remain available. The
separate plugin-build and workspace-exposure failures need their own actual
failure analysis. Full latest-source regression, build and V9 source completion
remain pending.

Actual Native v1 and v2 passed 52 of 55 cases. The diagnostic retry showed
that the fresh fixture workspace needs real Git metadata for the unchanged
legacy adapter preflight. It now initializes only its owned disposable Git
repository with host Git configuration disabled. Standalone plugin fixture
postinstall previously invoked the repository-wide SDK linker and tried to
write unrelated excluded plugin packages. It now imports and executes the
same original SDK linker for only its owned disposable fixture package.
Original production owners, success assertions and timeouts remain unchanged.
These current fixture changes require fresh Native qualification; prior
failures remain preserved. No customer inbound directory was accessed.

## Completed bounded qualification — 2026-10-11

Actual checks passed: Shared/server/UI types and all 55 Native cases in three complete original files (13 session, 11 plugin install and 31 workspace exposure).

Frozen scope HEAD: `f1494451dd7d833fed6c5d33860865d8e1b4c0d3`. Matching before/after public Source SHA-256: `79c4502cc3d10e1b7efa259da7af8529a5adc14cd774da77eebafc69069cc9be`. Stage logs and source snapshots are retained under `/workspace/v9-regression-fixture-isolation-<stage>-v<version>-*`: types v2, native v3. Earlier failures are preserved. No original assertion, skip policy or deadline was weakened.

These checks qualify this bounded implementation in its own worktree. They do not replace the current integrated full typecheck, test run and build. Built browser transport fixtures do not qualify external provider effects. Full V9 implementation, human acceptance, provider operating proof and review remain open; `sourceComplete` stays false and all 70 launch surfaces stay pending.

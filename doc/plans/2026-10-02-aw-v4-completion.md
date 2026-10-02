# August Works V4 completion

Baseline: `056f04072003c67672a9470837f909633c710705`.
Acceptance: the supplied V4 Implementation Golden Master, especially §§189,
200–208, 231–248. Playbooks inform implementation; they do not add unrelated
blockchain, embedded or native-client scope. Wave 15 remains explicitly later.

## Completion checklist

- [x] Repair pilot validator with the compiler API supported by its AST checks.
- [x] Repair the other compiler-API consumer without changing the native CLI.
- [x] Verify CI-owned dependency resolution and exact-candidate verification.
- [x] Preserve initiating execution authority across workflow recovery.
- [x] Execute governed Connector Action and immutable Automation Artifact nodes.
- [x] Implement graph/failure contracts and existing delegated triggers.
- [x] Complete structured Task results and bounded Direct Agent Call.
- [ ] Connect optimizer compilation, replay, shadow, promotion, fallback and drift.
- [x] Implement Memory deletion/export/retention and source-deletion propagation.
- [x] Complete native Memory maintenance and reviewed reflection handlers.
- [x] Complete changed product API/UI and keyboard/browser acceptance tests.
- [ ] Verify migrations, rollback, recovery and privacy invariants.
- [ ] Run full typecheck, repository tests, build and deterministic security gates.
- [ ] Record build identity, test results and remaining target-environment checks.

## Implemented and checked so far

The native compiler CLI stays on TypeScript 7; AST-based pilot and telemetry
checks use the pinned TypeScript 5.9 compiler API (20 tests passed). Workflow
runs now persist the initiating principal and heartbeat provenance, and recovery
rechecks company membership (41 executor tests passed).

Reviewed pure C0/C1 artifacts execute as pinned workflow steps through existing
validation and sandbox services. The catalogue and review UI exposes source,
schemas, tests, gates, activation and revocation (10 artifact tests passed using
the qualified Linux sandbox). Connector steps call the application's configured
gateway with persisted authority, pinned catalogue/schema hashes, durable
operation keys and typed receipts. The provider integration verifies successful
execution and denial before dispatch when the catalogue drifts. Approval waits
and remaining graph contracts still require completion.

Memory now supports scoped export, permanent content/citation deletion,
correction/share-lineage propagation, company retention, and a content-free
deletion ledger. Deleted operation/source identifiers cannot be replayed; the
read path also hides restored payloads covered by the ledger before cleanup.
Ledger import is available with Memory disabled for the restore procedure.
Service/maintenance checks passed 33 tests; broader privacy and lifecycle checks
remain part of final verification. Verbatim design-token extraction makes all
four existing UI token gates pass without changing the underlying values.

Changes reuse Connections, permissions, approvals, existing durable workflow
rows and artifact/optimizer services. Published revisions and execution history
remain immutable. Model output never grants permission, and generated code
remains sandboxed. No customer pilot evidence is fabricated or inferred from
successful local tests.

## Build and deployment evidence

Repository checks establish a build candidate. Customer-specific migration,
real provider/model execution, operational SLO, accessibility user review,
restore and exposure-control evidence are recorded separately according to
`doc/operations/aw-v4-customer-pilot-readiness.md`. Feature flags stay default-off;
deployment and customer release remain distinct decisions.

## Verified integration progress (2026-10-02 13:46 UTC)

Connector approval waits now use existing signed reviews and persist typed
receipts. Recovery consumes approved receipts without repeating provider writes;
rejection, expiry, cancellation and principal revocation are covered. Local MCP
processes have bounded group cleanup, response size limits and cooperative abort.

Switch/default routing, explicit sequential forks/all-merges, bounded HTTPS
reads, Foundation/Memory reads, pure collection mapping and pinned durable
subworkflows are connected to the builder and executor. Subworkflow tests verify
recovery, cancellation, recursion and company isolation. Structured Agent Task
results are immutable, schema-checked and tied to the agent holding the Task in
an active execution. Missing required results fail rather than parsing comments.
The total workflow deadline now applies during waits and stops accountable work.

Memory deletion tags propagate through derived steps and child inputs, tool
receipts and signed approval payloads. Deleting a source Task erases its linked
Memory and workflow copies and blocks recapture. Run reviews are explicit board
attestations, immutable and content-erased with their Memory sources. They
supply the previously missing authoritative correction evidence to optimizer
traces. Candidate evaluation/promotion/runtime integration remains outstanding.

The Chromium browser flow passed artifact review/activation, Memory export,
retention, permanent deletion and company-scoped navigation. Recent focused
checks passed 87 workflow/gateway tests, 77 workflow/registry/routing tests,
14 map/local-stdio tests, 54 deadline/trace tests, and 10 Memory/map tests.
These are intermediate results, not final release qualification.

Outstanding work includes explicit failure-policy completion, trigger/delegation
contract review, complete optimizer lifecycle/runtime wiring, applicable Memory
maintenance jobs, broader browser/security acceptance, fresh full repository
checks, migration/restore evidence and exact build identity. V4 is not yet
claimed complete.

## Integration progress (2026-10-02 14:42 UTC)

Optimizer candidates now use explicit immutable run reviews, hash-bound artifact
qualification and actual historical replay. A pure transform replacement can
run in shadow, request an existing bound board approval, enter a bounded canary,
and activate after ten accepted committed canary observations. Runtime records
actual candidate usage and restores the published transform on failure or an
unknown input shape. Human corrections and changed workflow revisions feed the
existing drift evaluator and quarantine live bindings. Candidate retirement is
atomic. The builder exposes qualification, evidence, lifecycle actions, artifact
review and approval review. The complete service integration test passes;
broader replacement spans still need qualification rather than implied support.

Explicit failure branches, nullable continuation and human recovery now preserve
failed checkpoints and route through published recovery contracts. Four real
database tests cover recovery, nullable gates, worker restart and approval
rejection. Async child failure and browser policy authoring require broader
verification. Schema changes were generated using the repository workflow.

The full repository suite is running. Final typechecks, build, pilot gates,
restore evidence and build identity remain outstanding, as do the remaining
trigger/delegation and Memory maintenance contracts. This is progress evidence;
it is not a V4 completion declaration.

## Qualification progress (2026-10-02)

Direct Agent Call now uses the existing durable heartbeat queue without a Task.
Its result is tied to the active target execution and the published schema.
Six PostgreSQL scenarios cover immutable results, restart, child cancellation,
missing results, async failure recovery, source erasure and revoked authority
before prompt hydration or result submission. Delegated Routine
and Pipeline targets retain the configuring actor and recheck current authority;
the Pipeline ledger also snapshots that authority. Three focused revocation and
tenant tests passed, with Routine/Pipeline regression checks retained.

Memory maintenance now implements dedupe, compaction, native index refresh and
an explicit operator-proposed reflection lesson. Derived candidates remain
pending review. The 15 maintenance/job tests passed. Erasure now reaches native
child results, Task/document copies, sessions and logs. Database guards suppress
late child writes. A durable outbox removes log objects and retains local/S3
tombstones; 19 log-store tests passed, including concurrent finalize/erase and
restore. Restore remains subject to the separately retained deletion ledger.

Optimizer proposals derive scalar copy/literal contracts from at least three
reviewed runs. Compiler/replay/shadow/promotion/canary/activation are connected
to live execution. Four lifecycle/drift scenarios passed, including corrections,
changed revisions, unknown shapes and revoked artifacts. The live path remains
one pure C0 transform; larger and semantic replacement spans are not claimed
implemented. This is a remaining Golden Master scope item, not a waived gate.

Three Chromium journeys passed: artifact review and Memory privacy/maintenance;
optimizer review/proposal/replay/actual shadow/retirement; and keyboard failure
policy authoring. The client preserves Content-Type and other headers when an
operation adds an idempotency header. The browser checks now run in V4 CI.

Fresh full typecheck and build passed. Migration safety/numbering, all UI token
gates, security coverage and the pilot static contract passed. All 805 tests in
the expanded 27-suite security gate and all 13 pilot-validator tests passed. The
final repository suite is still in progress. Build qualification,
target-environment evidence and remaining scope are recorded in
`doc/operations/aw-v4-build-qualification.md`; the migration runbook and ADR
ledger now describe delegation rebinding, restore and log tombstone behavior.

The whole UI partition passed 647 files / 6,772 tests. CLI qualification found
and corrected umask-dependent executable modes, ambient telemetry opt-out in
mocked tests, and logical backups omitting CHECK constraints. The preserved
development database is current with all 15 late-write guards. PostgreSQL
backup/restore and the three affected CLI suites passed. The full official
server/workspace/serialized partitions remain under qualification; partial
partition success does not establish whole-repository acceptance.


### Final local qualification and delivery

The implemented product paths are committed on `feat/aw-v4-completion` and
pushed to GitHub. Exact official-manifest coverage includes 1,888 files and
27,745 passed tests, with 63 existing skips. Counts combine
partition runs and focused correction reruns; there was no single uninterrupted
green full-suite invocation. All 305 heartbeat recovery scenarios, all 17
workflow route checks and all 12 OpenAPI checks passed on the final source.
The three Chromium journeys passed again after route contract synchronization.

The CI matrix now has 11 complete partitions. Shared wire schemas document
32 new V4 operations, including run-bound agent results and required maintenance
idempotency. No route coverage exclusions or production security reductions
were introduced to make qualification pass.

Full V4 Golden Master acceptance remains open for the broader optimizer
agent/tool/subgraph replacement paths and target-environment evidence. The
implementation report records concrete gates rather than declaring those
requirements complete. PR creation is blocked by GitHub API `Forbidden`;
the code branch is available for review. See the build qualification report
for source identity, final build evidence and the complete acceptance limits.

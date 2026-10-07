# Native explicit process conformance — bounded source implementation

The human-published Process Analysis Definition can select `conformance` and
provide exactly one explicit typed model per requested Task or Project
perspective. The version freezes expected initial and terminal states, required
state visits and allowed transitions. Models use the canonical native object
states. Every admitted start must have a path that visits all required states
and reaches an expected terminal. Draft and proposed revisions grant no run
authority; publication remains a separate human action with expected revision.

`aw-native-object-process-v2` compares qualified primary status paths with that
published version and records the model hash. It counts evaluated, conforming
and deviating objects, plus unexpected starts, terminals, transitions and missing
required states. Repeated status observations and metadata updates are not
transitions. This is an explicit state-model comparison, not calibrated fitness,
anomaly probability, process discovery or an employee score. No work is changed.

Readiness derives typed-creation/latest-terminal lifecycle requirements for
conformance, blocked time and reopening. Unknown object states, missing primary
creation, a latest open state, ties or incomplete current coverage yield
`DATA_NOT_READY`, rather than a process deviation. Cycle-time-only definitions
retain their declared first-recorded-completion semantics even if later reopened.
Related objects cannot borrow the primary object's lifecycle. Existing bounded
source scans, exact UTC microseconds, current Governance/Memory checks, source
hashes and native lineage still apply before calculation and every retained read.

Readiness V3 additionally checks supplied native previous-state receipts against
the preceding observed primary state for complete-state families. A mismatch
marks lifecycle completeness unknown and yields `DATA_NOT_READY`, not a model
violation. Metadata observations preserve the last known state. Absent legacy
receipts are not fabricated and do not prove whole-producer completeness.
Historical run assessments retain their recorded engine version; current access
is assessed independently. Kernel and native PostgreSQL tests verify that only a
missing-data finding is admitted for a contradictory receipt.

No new raw-path table or provider store is introduced: the immutable definition
JSON holds the model and the immutable run JSON holds aggregate comparisons.
Persisted V1 definitions without the additive nullable model field are validated
without changing their original hash material; new proposals use the new schema.
Native run/source/Memory erasure, retention and company purge continue to own the
stored result. No source snapshot is reconstructed from current assignments.

Verification uses kernel cases for matching/deviating paths, typed project
states, repeated observations, incomplete/reopened paths, mutually incompatible
required visits and legacy JSON. Migrated PostgreSQL exercises exact published
model pins, proposed-model isolation, immutable results, current source denial
and retained V1 definition hashes. Native UI tests and Storybook browser checks
cover the human editor, model inspection, both themes, keyboard interaction,
390/1200-pixel layouts and WCAG rules. Storybook data is synthetic presentation
evidence, not a real source or rollout qualification.

This slice does not qualify Workflow or Pipeline version references, external
event providers, alignment/token replay algorithms, PM4Py, Learning conversion
or resolution, official published visual baselines, hosted
restore/rollout evidence or overall V8 completion. Those remain separate build
requirements; this document makes no production qualification claim.

The subsequent native finding slice admits positive explicit-model deviations
as frozen human investigation records (see `aw-v8-process-findings.md`). It adds
no automatic action, policy judgment or new source authority.
